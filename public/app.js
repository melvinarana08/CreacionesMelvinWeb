// app.js — UI de la PWA de ventas de Creaciones Melvin.
// Flujo offline-first: guardar en IndexedDB (cola) → mostrar comprobante →
// limpiar carrito → sincronizar con el servidor (idempotente por UUID).
'use strict';

import * as D from './domain.js';
import * as S from './storage.js';
import * as Api from './api.js';
import * as Printer from './printer.js';
import { createReceiptPngFile, receiptImageFilename } from './receipt-image.js';
import {
  applySelectedCustomer,
  downloadFileWithObjectUrl,
  filterCustomerSuggestions,
  performShare,
  shouldDismissCustomerSuggestions,
  shouldShowCustomerSuggestions,
  updateQuantityControls,
  updateSizeChipSelection,
} from './ui-interactions.js';

const $ = (id) => document.getElementById(id);

const state = {
  catalog: [],
  selectedCategory: null,
  selectedSize: null,
  qty: 1,
  cart: S.loadCart(),
  discountCents: 0,
  clientName: '',
  receipt: null,
  receiptImageFile: null,
  receiptImageToken: 0,
  receiptImagePreparing: false,
  sharingReceipt: false,
  online: navigator.onLine,
  pendingCount: 0,
  admin: { csrf: null, authenticated: false },
  pendingVoidId: null,
  finishBtnVisible: false,
  encargos: [],
  clients: S.loadClients(),
  customerSuggestionsEngaged: false,
  encargoMode: false,
  activeEncargoId: null,
  encargosSubtab: 'summary',
  printingKeys: new Set(),
  finalizingSale: false,
};

// ---------------- Utilidades de render (siempre textContent) ----------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function updateMobileCartBar() {
  const bar = $('mobileCartBar');
  if (!bar) return;
  const isSaleVisible = !$('saleView').hidden;
  // Se oculta si no hay prendas, si la venta no está activa, o si el botón "Finalizar venta" ya está visible en pantalla
  const shouldShow = isSaleVisible && state.cart.length > 0 && !state.finishBtnVisible;
  bar.hidden = !shouldShow;
  if (shouldShow) {
    const totalQty = state.cart.reduce((sum, l) => sum + l.quantity, 0);
    const subtotal = D.computeSubtotal(state.cart);
    const total = D.computeTotal(subtotal, state.discountCents);
    $('mobileCartCount').textContent = `${totalQty} prenda${totalQty === 1 ? '' : 's'}`;
    $('mobileCartTotal').textContent = D.formatUSD(total);
  }
}

function renderCart() {
  const list = $('cartList');
  list.replaceChildren();
  const subtotal = D.computeSubtotal(state.cart);
  const total = D.computeTotal(subtotal, state.discountCents);

  $('cartEmpty').hidden = state.cart.length > 0;
  for (const line of D.groupLinesByProduct(state.cart)) {
    const li = el('li', 'cart-item');
    const info = el('div', 'cart-item-info');
    info.append(el('div', 'cart-item-name', line.product), el('div', 'cart-item-sub', D.formatUnitPriceSummary(line)));
    const price = el('div', 'cart-item-price', D.formatUSD(D.computeLineTotal(line.unitPriceCents, line.quantity)));
    const rm = el('button', 'remove-btn', '✕');
    rm.setAttribute('aria-label', `Quitar ${line.product} talla ${line.size}`);
    rm.addEventListener('click', () => {
      const i = state.cart.indexOf(line);
      if (i < 0) return;
      state.cart.splice(i, 1);
      S.saveCart(state.cart);
      renderCart();
    });
    li.append(info, price, rm);
    list.append(li);
  }

  const discountValid = D.validateDiscount(state.discountCents, subtotal);
  $('discountInput').value = state.discountCents > 0 ? (state.discountCents / 100).toFixed(2) : '';
  $('subtotalVal').textContent = D.formatUSD(subtotal);
  $('totalVal').textContent = D.formatUSD(total);

  // Modo Encargo vs Venta normal
  if (state.encargoMode) {
    $('cartTitle').textContent = state.activeEncargoId ? 'Entregando Encargo' : 'Nuevo Encargo (Pedido)';
    $('cancelEncargoModeBtn').hidden = false;
    $('encargoNotesRow').hidden = false;
    $('finishBtn').hidden = !state.activeEncargoId;
    $('saveAsEncargoBtn').hidden = Boolean(state.activeEncargoId);
  } else {
    $('cartTitle').textContent = 'Venta actual';
    $('cancelEncargoModeBtn').hidden = true;
    $('encargoNotesRow').hidden = true;
    $('finishBtn').hidden = false;
    $('saveAsEncargoBtn').hidden = false;
  }

  $('finishBtn').disabled = state.cart.length === 0 || !discountValid.ok;
  $('saveAsEncargoBtn').disabled = state.cart.length === 0;
  showError('cartError', discountValid.ok ? null : discountValid.reason);

  updateMobileCartBar();
}

function showError(id, message) {
  const node = $(id);
  node.hidden = !message;
  if (message) node.textContent = message;
}

function showCatalogStatus(message, type = 'saving') {
  const node = $('catalogStatus');
  node.hidden = !message;
  node.className = `status-text ${type}`;
  node.textContent = message || '';
}

function renderCatalog() {
  const list = $('categoryList');
  list.replaceChildren();
  for (const product of state.catalog) {
    const btn = el('button', 'btn' + (state.selectedCategory === product.name ? ' selected' : ''), product.name);
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(state.selectedCategory === product.name));
    btn.addEventListener('click', () => {
      openPicker(product);
      renderCatalog();
    });
    list.append(btn);
  }
  if (state.selectedCategory) {
    const current = state.catalog.find((p) => p.name === state.selectedCategory);
    if (current) openPicker(current, true);
  }
}

function openPicker(product, keepSelection = false) {
  const productChanged = state.selectedCategory !== product.name;
  state.selectedCategory = product.name;
  if (!keepSelection || productChanged) {
    state.selectedSize = null;
    state.qty = 1;
  } else if (!product.sizes.some((s) => s.size === state.selectedSize)) {
    state.selectedSize = null;
  }
  $('pickerTitle').textContent = `${product.name} — cantidad y talla`;
  const chips = $('sizeChips');
  chips.replaceChildren();
  for (const s of product.sizes) {
    const chip = el('button', 'btn' + (s.size === state.selectedSize ? ' selected' : ''), String(s.size));
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(s.size === state.selectedSize));
    chip.addEventListener('click', () => {
      state.selectedSize = s.size;
      updateSizeChipSelection(chips.children, chip);
      $('addLineBtn').disabled = false;
    });
    chips.append(chip);
  }
  setQuantity(state.qty);
  $('addLineBtn').disabled = state.selectedSize === null;
  $('sizePicker').hidden = false;
}

function setQuantity(value) {
  state.qty = updateQuantityControls({
    value,
    valueNode: $('qtyValue'),
    minusButton: $('qtyMinus'),
    plusButton: $('qtyPlus'),
    presets: document.querySelectorAll('.qty-preset'),
  });
  return state.qty;
}

// ---------------- Consulta de precios ----------------

function renderPricesFilter() {
  const filter = $('pricesFilter');
  const current = filter.value;
  filter.replaceChildren();
  const allOpt = el('option', null, 'Todos los productos');
  allOpt.value = '';
  filter.append(allOpt);
  for (const product of state.catalog) {
    const opt = el('option', null, product.name);
    opt.value = product.name;
    filter.append(opt);
  }
  if (current && state.catalog.some((p) => p.name === current)) filter.value = current;
}

function renderPricesList() {
  const rows = D.priceRowsFromCatalog(state.catalog, $('pricesFilter').value);
  const container = $('pricesList');
  container.replaceChildren();
  if (rows.length === 0) {
    container.append(el('p', 'muted', 'No hay productos para mostrar.'));
    return;
  }
  for (const product of rows) {
    const card = el('div', 'price-card');
    card.append(el('h4', 'price-card-title', product.name));
    const rowsDiv = el('div', 'price-rows');
    for (const size of product.sizes) {
      const row = el('div', 'price-row');
      row.append(el('span', null, `Talla ${size.size}`), el('span', 'price-row-value', D.formatUSD(size.priceCents)));
      rowsDiv.append(row);
    }
    card.append(rowsDiv);
    container.append(card);
  }
}

/** Abre la consulta de precios refrescando el catálogo desde el servidor cuando hay conexión. */
async function openPricesDialog() {
  const res = await Api.fetchCatalog();
  if (res.ok) {
    state.catalog = res.data.catalog;
    S.saveCatalog(state.catalog);
    state.online = true;
    renderCatalog();
  } else {
    state.online = false;
  }
  renderStatus();
  renderPricesFilter();
  renderPricesList();
  $('pricesDialog').showModal();
}

function renderStatus() {
  $('connDot').className = 'dot ' + (state.online ? 'dot-on' : 'dot-off');
  $('connText').textContent = state.online ? 'En línea' : 'Sin conexión';
  const badge = $('pendingBadge');
  badge.hidden = state.pendingCount === 0;
  badge.textContent = `${state.pendingCount} pendiente${state.pendingCount === 1 ? '' : 's'}`;
}

// ---------------- Sincronización (cola offline) ----------------

async function refreshPendingCount() {
  try {
    state.pendingCount = await S.countPending();
  } catch {
    state.pendingCount = 0;
  }
  renderStatus();
}

/** Pide el token de vendedor una vez si el servidor lo exige. */
function askSellerToken() {
  const token = window.prompt('Este servidor requiere el token de vendedor:');
  if (token && token.trim()) {
    S.setSellerToken(token.trim());
    return token.trim();
  }
  return null;
}

async function syncAll() {
  let records = [];
  try {
    records = await S.listPendingSales();
  } catch (e) {
    console.error('No se pudo leer la cola local:', e);
    return;
  }
  for (const rec of records) {
    if (rec.status !== 'pending') continue;
    let sellerToken = S.hasSellerToken() ? S.getSellerToken() : null;
    let res = await Api.postSale(rec.payload, sellerToken);
    if (!res.ok && res.error && res.error.code === 'seller_token_required') {
      const token = askSellerToken();
      if (!token) { state.online = false; continue; }
      res = await Api.postSale(rec.payload, token);
    }
    if (res.ok) {
      await S.markSynced(rec.id, res.data.sale);
      if (state.receipt && state.receipt.id === rec.id && !state.receipt.folio) {
        state.receipt.folio = res.data.sale.folio;
        renderReceipt();
      }
    } else if (res.error && res.error.code === 'price_changed') {
      await S.markConflict(rec.id, res.error.message);
      alert(`⚠️ La venta ${rec.id.slice(0, 8)} no se pudo enviar: el precio cambió. Revísala en la administración (pendiente de resolver).`);
    } else {
      state.online = false; // red caída o error transitorio: se reintenta luego
    }
  }
  await refreshPendingCount();
}

// ---------------- Flujo de venta ----------------

async function finalizeSale() {
  if (state.finalizingSale) return;
  const built = D.buildSalePayload({
    cart: state.cart,
    clientName: $('clientInput').value,
    discountCents: state.discountCents,
    deviceId: S.getDeviceId(),
    id: S.createUuid(),
  });
  if (!built.ok) {
    showError('cartError', built.reason);
    return;
  }

  state.finalizingSale = true;
  const finishButton = $('finishBtn');
  finishButton.disabled = true;
  finishButton.setAttribute('aria-busy', 'true');
  try {
    if (built.payload.clientName === null && !window.confirm(
      'No agregaste el nombre del cliente. ¿Deseas finalizar la venta sin nombre? Pulsa Cancelar para volver y agregarlo.'
    )) return;

    // Guardar local PRIMERO (offline-first). Solo si se guarda se limpia el carrito.
    await S.savePendingSale(built.payload);

    if (built.payload.clientName) {
      S.rememberClient(built.payload.clientName);
      if (state.online) Api.postClient(built.payload.clientName).catch(() => {});
      loadClientsList();
    }

    // Si correspondía a un encargo en entrega, marcarlo como entregado.
    if (state.activeEncargoId) {
      const encargoId = state.activeEncargoId;
      state.activeEncargoId = null;
      exitEncargoMode();
      const sellerToken = S.hasSellerToken() ? S.getSellerToken() : null;
      Api.deliverEncargo(encargoId, built.payload.id, sellerToken)
        .then(() => loadEncargos())
        .catch((err) => console.error('Error al marcar encargo entregado:', err));
    }

    const subtotalCents = D.computeSubtotal(built.payload.lines);
    state.receipt = {
      id: built.payload.id,
      lines: built.payload.lines.map((l) => ({ ...l })),
      subtotalCents,
      discountCents: built.payload.discountCents,
      totalCents: D.computeTotal(subtotalCents, built.payload.discountCents),
      clientName: built.payload.clientName,
      folio: null,
      savedAt: new Date().toLocaleString('es'),
    };
    state.cart = [];
    state.discountCents = 0;
    $('clientInput').value = '';
    $('encargoNotesInput').value = '';
    S.clearCart();
    renderCart();
    showReceipt();
    refreshPendingCount();
    syncAll(); // intento inmediato; si falla, queda en cola
  } catch (e) {
    console.error('Fallo al guardar localmente:', e);
    showError('cartError', 'No se pudo guardar la venta en este dispositivo. Intenta de nuevo.');
  } finally {
    state.finalizingSale = false;
    finishButton.removeAttribute('aria-busy');
    const discountValid = D.validateDiscount(state.discountCents, D.computeSubtotal(state.cart));
    finishButton.disabled = state.cart.length === 0 || !discountValid.ok;
  }
}

// ---------------- Impresión térmica Bluetooth ----------------

function printKey(kind, id) {
  return id ? `${kind}:${id}` : null;
}

function duplicatePrintMessage() {
  return 'Este ticket ya se imprimió correctamente en este dispositivo. Si continúas, saldrá otra copia. ¿Deseas imprimir otra copia?';
}

async function runPrintWithSafety({ key, button = null, status, print }) {
  if (key && state.printingKeys.has(key)) return { ok: false, reason: 'Impresión en curso' };
  if (key && S.hasPrintSuccess(key) && !window.confirm(duplicatePrintMessage())) {
    status?.('Impresión cancelada. No se imprimió otra copia.', 'failure');
    return { ok: false, canceled: true };
  }
  if (key) state.printingKeys.add(key);
  if (button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  }
  try {
    const result = await print();
    if (result.ok && key) S.markPrintSuccess(key);
    return result;
  } finally {
    if (button) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
    if (key) state.printingKeys.delete(key);
  }
}

function showPrintStatus(message, type = 'saving') {
  const node = $('printStatus');
  node.hidden = !message;
  node.className = `status-text ${type}`;
  node.textContent = message || '';
}

function showShareStatus(message, type = 'saving') {
  const node = $('shareStatus');
  node.hidden = !message;
  node.className = `status-text ${type}`;
  node.textContent = message || '';
}

function downloadReceiptFile(file, filename) {
  return downloadFileWithObjectUrl({
    file,
    filename,
    createObjectURL: (value) => URL.createObjectURL(value),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    createAnchor: () => {
      const link = document.createElement('a');
      link.hidden = true;
      document.body.append(link);
      return link;
    },
    schedule: (callback) => setTimeout(callback, 0),
  });
}

async function prepareReceiptImage(receipt) {
  const token = ++state.receiptImageToken;
  state.receiptImageFile = null;
  state.receiptImagePreparing = true;
  const button = $('shareReceiptBtn');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  showShareStatus('Preparando imagen del ticket…', 'saving');
  try {
    const { file } = await createReceiptPngFile(receipt);
    if (token !== state.receiptImageToken || state.receipt !== receipt) return;
    state.receiptImageFile = file;
    showShareStatus('Imagen lista para compartir.', 'success');
  } catch (error) {
    if (token !== state.receiptImageToken || state.receipt !== receipt) return;
    console.error('No se pudo preparar la imagen del ticket:', error);
    showShareStatus('No se pudo preparar la imagen. Todavía podés compartir el texto.', 'failure');
  } finally {
    if (token === state.receiptImageToken && state.receipt === receipt) {
      state.receiptImagePreparing = false;
      button.disabled = state.sharingReceipt;
      if (!state.sharingReceipt) button.removeAttribute('aria-busy');
    }
  }
}

async function shareCurrentReceipt() {
  if (!state.receipt || state.sharingReceipt) return;
  state.sharingReceipt = true;
  const button = $('shareReceiptBtn');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  const receipt = state.receipt;
  const text = D.formatShareTicket(receipt);
  const title = receipt.folio
    ? `Ticket Creaciones Melvin · Folio ${receipt.folio}`
    : 'Ticket Creaciones Melvin · Pendiente de sincronizar';
  const file = state.receiptImageFile;
  showShareStatus(file ? 'Abriendo opciones para compartir…' : 'Compartiendo respaldo en texto…', 'saving');

  try {
    const result = await performShare({
      payload: { title, text },
      file,
      filename: receiptImageFilename(receipt),
      canShare: typeof navigator.canShare === 'function' ? (payload) => navigator.canShare(payload) : null,
      share: typeof navigator.share === 'function' ? (payload) => navigator.share(payload) : null,
      download: file ? downloadReceiptFile : null,
      copy: navigator.clipboard && typeof navigator.clipboard.writeText === 'function'
        ? (value) => navigator.clipboard.writeText(value)
        : null,
    });

    if (result.status === 'shared' || result.status === 'shared-text') {
      showShareStatus(result.status === 'shared' ? 'Ticket compartido como imagen.' : 'Ticket compartido como texto.', 'success');
    } else if (result.status === 'cancelled') {
      showShareStatus('Compartir cancelado.', 'saving');
    } else if (result.status === 'downloaded-copied') {
      showShareStatus('Imagen descargada y texto copiado para compartir.', 'success');
    } else if (result.status === 'copied') {
      showShareStatus('Ticket copiado. Abrí WhatsApp y pegalo en la conversación.', 'success');
    } else {
      window.prompt('Copiá este ticket y pegalo en WhatsApp:', text);
      showShareStatus(result.downloaded
        ? 'Imagen descargada. Copiá el texto mostrado para acompañarla.'
        : 'Copiá el ticket mostrado y pegalo en WhatsApp.', 'saving');
    }
  } finally {
    state.sharingReceipt = false;
    button.disabled = state.receiptImagePreparing;
    if (!state.receiptImagePreparing) button.removeAttribute('aria-busy');
  }
}

async function printCurrentReceipt(event) {
  if (!state.receipt) return;
  showPrintStatus('Conectando con la impresora… Por favor espera.', 'saving');
  const r = state.receipt;
  const ticketData = {
    title: r.folio ? `Folio ${r.folio}` : 'Ticket',
    lines: r.lines.map((l) => ({
      product: l.product,
      size: l.size,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      lineTotalCents: D.computeLineTotal(l.unitPriceCents, l.quantity),
    })),
    subtotalCents: r.subtotalCents,
    discountCents: r.discountCents,
    totalCents: r.totalCents,
    folio: r.folio,
    clientName: r.clientName,
    date: r.savedAt,
  };
  const result = await runPrintWithSafety({
    key: printKey('sale', r.id),
    button: event?.currentTarget || $('printReceiptBtn'),
    status: showPrintStatus,
    print: () => Printer.printReceipt(ticketData),
  });
  if (result.canceled) return;
  if (result.ok) {
    showPrintStatus('✅ Ticket impreso correctamente.', 'success');
  } else {
    showPrintStatus(`No se pudo imprimir. Revisa la impresora e intenta de nuevo. Detalle: ${result.reason}`, 'failure');
  }
}

function showReceipt() {
  $('saleView').hidden = true;
  $('adminView').hidden = true;
  $('encargosView').hidden = true;
  $('receiptView').hidden = false;
  const bar = $('mobileCartBar');
  if (bar) bar.hidden = true;
  renderReceipt();
}

function renderReceipt() {
  const r = state.receipt;
  if (!r) return;
  $('receiptStatus').textContent = r.folio
    ? `Venta registrada · Folio ${r.folio}`
    : 'Venta guardada en este dispositivo. Se sincronizará automáticamente al recuperar conexión.';
  const body = $('receiptBody');
  body.replaceChildren();
  body.append(el('p', 'muted', `Fecha: ${r.savedAt}`));
  if (r.clientName) body.append(el('p', 'muted', `Cliente: ${r.clientName}`));
  body.append(el('p', 'receipt-key', 'Cantidad # Talla'));
  for (const line of r.lines) {
    const row = el('div', 'receipt-line');
    const desc = el('span', null, `${line.product} · ${line.quantity} # ${line.size} · Unitario ${D.formatUSD(line.unitPriceCents)}`);
    const price = el('span', null, D.formatUSD(D.computeLineTotal(line.unitPriceCents, line.quantity)));
    row.append(desc, price);
    body.append(row);
  }
  const sub = el('div', 'receipt-line');
  sub.append(el('span', null, 'Subtotal'), el('span', null, D.formatUSD(r.subtotalCents)));
  body.append(sub);
  if (r.discountCents > 0) {
    const disc = el('div', 'receipt-line');
    disc.append(el('span', null, 'Descuento'), el('span', null, `−${D.formatUSD(r.discountCents)}`));
    body.append(disc);
  }
  const total = el('div', 'receipt-line receipt-total');
  total.append(el('span', null, 'TOTAL'), el('span', null, D.formatUSD(r.totalCents)));
  body.append(total);
  body.append(el('p', 'muted', 'Gracias por su compra.'));
  prepareReceiptImage(r);
}

function localSaleDisplay(record) {
  const serverSale = record.serverResponse;
  const payload = record.payload;
  const folio = serverSale?.folio ? `Folio ${serverSale.folio}` : 'Pendiente de sincronizar';
  const rawDate = serverSale?.serverTs || record.syncedAt || payload?.clientTs || record.savedAt;
  const date = rawDate ? new Date(rawDate).toLocaleString('es') : 'Fecha no disponible';
  const client = serverSale?.clientName || payload?.clientName || '';
  const subtotal = serverSale?.subtotalCents ?? D.computeSubtotal(payload?.lines || []);
  const discount = serverSale?.discountCents ?? payload?.discountCents ?? 0;
  const total = serverSale?.totalCents ?? D.computeTotal(subtotal, discount);
  return { folio, date, client, total };
}

function localSaleTicketData(record) {
  const serverSale = record.serverResponse;
  if (serverSale?.items) {
    return {
      key: printKey('sale', serverSale.id || record.id),
      ticketData: {
        title: serverSale.folio ? `Folio ${serverSale.folio}` : 'Ticket',
        lines: serverSale.items.map((it) => ({
          product: it.productName,
          size: it.size,
          quantity: it.quantity,
          unitPriceCents: it.unitPriceCents,
          lineTotalCents: D.computeLineTotal(it.unitPriceCents, it.quantity),
        })),
        subtotalCents: serverSale.subtotalCents,
        discountCents: serverSale.discountCents,
        totalCents: serverSale.totalCents,
        folio: serverSale.folio,
        clientName: serverSale.clientName,
        date: serverSale.serverTs ? new Date(serverSale.serverTs).toLocaleString('es') : undefined,
      },
    };
  }

  const payload = record.payload;
  const subtotal = D.computeSubtotal(payload.lines || []);
  const discount = payload.discountCents || 0;
  return {
    key: printKey('sale', payload.id || record.id),
    ticketData: {
      title: 'Ticket pendiente',
      lines: (payload.lines || []).map((l) => ({
        product: l.product,
        size: l.size,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        lineTotalCents: D.computeLineTotal(l.unitPriceCents, l.quantity),
      })),
      subtotalCents: subtotal,
      discountCents: discount,
      totalCents: D.computeTotal(subtotal, discount),
      folio: null,
      clientName: payload.clientName,
      date: record.savedAt ? new Date(record.savedAt).toLocaleString('es') : undefined,
    },
  };
}

function showLocalSalesStatus(message, type = 'saving') {
  const node = $('localSalesStatus');
  node.hidden = !message;
  node.className = `status-text ${type}`;
  node.textContent = message || '';
}

async function printLocalSaleRecord(record, button) {
  const { key, ticketData } = localSaleTicketData(record);
  showLocalSalesStatus('Conectando con la impresora… Por favor espera.', 'saving');
  const result = await runPrintWithSafety({
    key,
    button,
    status: showLocalSalesStatus,
    print: () => Printer.printReceipt(ticketData),
  });
  if (result.canceled) return;
  if (result.ok) {
    showLocalSalesStatus('✅ Copia impresa correctamente.', 'success');
  } else {
    showLocalSalesStatus(`No se pudo imprimir. Revisa la impresora e intenta de nuevo. Detalle: ${result.reason}`, 'failure');
  }
}

function renderLocalSales(records) {
  const list = $('localSalesList');
  list.replaceChildren();
  if (records.length === 0) {
    list.append(el('p', 'muted', 'No hay ventas guardadas en este dispositivo todavía.'));
    return;
  }
  for (const record of records) {
    const info = localSaleDisplay(record);
    const btn = el('button', 'local-sale-button');
    btn.type = 'button';
    btn.append(
      el('span', 'local-sale-title', info.folio),
      el('span', 'local-sale-meta', `${info.date}${info.client ? ` · ${info.client}` : ''}`),
      el('span', 'local-sale-total', D.formatUSD(info.total))
    );
    btn.addEventListener('click', () => printLocalSaleRecord(record, btn));
    list.append(btn);
  }
}

async function openLocalSalesDialog() {
  showLocalSalesStatus('Cargando ventas recientes de este dispositivo…', 'saving');
  $('localSalesDialog').showModal();
  try {
    const records = await S.listRecentLocalSales();
    renderLocalSales(records);
    showLocalSalesStatus(null);
  } catch (e) {
    console.error('No se pudo leer el historial local:', e);
    renderLocalSales([]);
    showLocalSalesStatus('No se pudieron leer las ventas guardadas en este dispositivo.', 'failure');
  }
}

// ---------------- Administración ----------------

function showAdminLogin() {
  state.admin.authenticated = false;
  $('saleView').hidden = true;
  $('receiptView').hidden = true;
  $('encargosView').hidden = true;
  $('adminView').hidden = false;
  $('adminLogin').hidden = false;
  $('adminPanel').hidden = true;
  const bar = $('mobileCartBar');
  if (bar) bar.hidden = true;
}

/** Regresa al panel principal (venta). Usado al salir de administración o cancelar el login. */
function showSaleView() {
  $('adminView').hidden = true;
  $('receiptView').hidden = true;
  $('encargosView').hidden = true;
  $('saleView').hidden = false;
  $('navSalesBtn').classList.add('active');
  $('navEncargosBtn').classList.remove('active');
  $('navSalesBtn').setAttribute('aria-pressed', 'true');
  $('navEncargosBtn').setAttribute('aria-pressed', 'false');
  renderCart();
}

function showEncargosView() {
  $('adminView').hidden = true;
  $('receiptView').hidden = true;
  $('saleView').hidden = true;
  $('encargosView').hidden = false;
  $('navEncargosBtn').classList.add('active');
  $('navSalesBtn').classList.remove('active');
  $('navEncargosBtn').setAttribute('aria-pressed', 'true');
  $('navSalesBtn').setAttribute('aria-pressed', 'false');
  const bar = $('mobileCartBar');
  if (bar) bar.hidden = true;
  loadEncargos();
}

function requireAdminLogin(message = 'Tu sesión de administración terminó. Inicia sesión nuevamente.') {
  state.admin.csrf = null;
  showAdminLogin();
  showError('adminLoginError', message);
}

async function enterAdminPanel() {
  state.admin.authenticated = true;
  $('adminLogin').hidden = true;
  $('adminPanel').hidden = false;
  $('adminPasswordInput').value = '';
  showError('adminLoginError', null);
  await loadAdminSales();
}

async function loadAdminSales() {
  const status = $('salesFilter').value;
  const res = await Api.adminListSales(state.admin.csrf, status);
  if (!res.ok) {
    if (res.status === 401) {
      requireAdminLogin();
      return;
    }
    showError('adminSalesEmpty', 'No se pudieron cargar las ventas.');
    return;
  }
  const list = $('adminSalesList');
  list.replaceChildren();
  if (res.data.sales.length === 0) {
    $('adminSalesEmpty').textContent = 'Sin ventas.';
    $('adminSalesEmpty').hidden = false;
    return;
  }
  $('adminSalesEmpty').hidden = true;
  for (const sale of res.data.sales) {
    const li = el('li', 'admin-item' + (sale.status === 'voided' ? ' voided' : ''));
    const head = el('div', 'admin-item-head');
    head.append(el('span', null, `Folio ${sale.folio}`), el('span', null, sale.status === 'voided' ? 'ANULADA' : D.formatUSD(sale.totalCents)));
    li.append(head);
    const sub = el('div', 'admin-item-sub');
    const client = sale.clientName ? ` · ${sale.clientName}` : '';
    const when = new Date(sale.serverTs).toLocaleString('es');
    sub.append(el('span', null, `${when}${client} · ${sale.items.length} línea(s) · ${sale.deviceId || ''}`));
    li.append(sub);
    for (const item of sale.items) {
      const line = el('div', 'admin-item-sub');
      line.textContent = `${item.productName} · ${D.formatUnitPriceSummary(item)}`;
      li.append(line);
    }
    if (sale.status === 'voided') {
      const vr = el('div', 'void-reason', `Anulada: ${sale.voidReason || 'sin motivo'}`);
      li.append(vr);
    }
    // Botones de acción: Ver (detalle + reimprimir) y Anular
    const actions = el('div', 'admin-item-actions');
    const viewBtn = el('button', 'btn btn-small', 'Ver');
    viewBtn.addEventListener('click', () => openSaleDetail(sale));
    actions.append(viewBtn);
    if (sale.status !== 'voided') {
      if (state.pendingVoidId === sale.id) {
        const form = el('div', 'meta-row void-form');
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 200;
        input.placeholder = 'Motivo de anulación (obligatorio)';
        const okBtn = el('button', 'btn btn-primary', 'Confirmar');
        const cancelBtn = el('button', 'btn', 'Cancelar');
        okBtn.addEventListener('click', async () => {
          const reason = input.value.trim();
          if (!reason) return;
          const resVoid = await Api.adminVoidSale(state.admin.csrf, sale.id, reason);
          if (resVoid.ok) state.pendingVoidId = null;
          else showError('adminSalesEmpty', resVoid.error.message);
          await loadAdminSales();
        });
        cancelBtn.addEventListener('click', () => { state.pendingVoidId = null; loadAdminSales(); });
        form.append(input, okBtn, cancelBtn);
        li.append(form);
      } else {
        const voidBtn = el('button', 'btn btn-small', 'Anular');
        voidBtn.addEventListener('click', () => { state.pendingVoidId = sale.id; loadAdminSales(); });
        actions.append(voidBtn);
      }
    }
    li.append(actions);
    list.append(li);
  }
}

// ---- Detalle de venta (diálogo) ----

let saleDetailCache = null;

function openSaleDetail(sale) {
  saleDetailCache = sale;
  const body = $('saleDetailBody');
  body.replaceChildren();
  const when = new Date(sale.serverTs).toLocaleString('es');
  body.append(el('p', 'muted', `Folio: ${sale.folio} · ${when}`));
  if (sale.clientName) body.append(el('p', 'muted', `Cliente: ${sale.clientName}`));
  if (sale.status === 'voided') body.append(el('p', 'void-reason', `ANULADA: ${sale.voidReason || 'sin motivo'}`));
  body.append(el('div', 'receipt-sep', '-'.repeat(32)));
  for (const item of sale.items) {
    const line = el('div', 'receipt-line');
    const desc = el('span', null, `${item.productName} · ${D.formatUnitPriceSummary(item)}`);
    const price = el('span', null, D.formatUSD(D.computeLineTotal(item.unitPriceCents, item.quantity)));
    line.append(desc, price);
    body.append(line);
  }
  body.append(el('div', 'receipt-sep', '-'.repeat(32)));
  const sub = el('div', 'receipt-line');
  sub.append(el('span', null, 'Subtotal'), el('span', null, D.formatUSD(sale.subtotalCents)));
  body.append(sub);
  if (sale.discountCents > 0) {
    const disc = el('div', 'receipt-line');
    disc.append(el('span', null, 'Descuento'), el('span', null, `−${D.formatUSD(sale.discountCents)}`));
    body.append(disc);
  }
  const total = el('div', 'receipt-line receipt-total');
  total.append(el('span', null, 'TOTAL'), el('span', null, D.formatUSD(sale.totalCents)));
  body.append(total);
  showSaleDetailStatus(null);
  $('saleDetailDialog').showModal();
}

function showSaleDetailStatus(message, type = 'saving') {
  const node = $('saleDetailStatus');
  node.hidden = !message;
  node.className = `status-text ${type}`;
  node.textContent = message || '';
}

async function reprintFromDetail(event) {
  if (!saleDetailCache) return;
  showSaleDetailStatus('Conectando con la impresora… Por favor espera.', 'saving');
  const s = saleDetailCache;
  const ticketData = {
    title: `Folio ${s.folio}`,
    lines: s.items.map((it) => ({
      product: it.productName,
      size: it.size,
      quantity: it.quantity,
      unitPriceCents: it.unitPriceCents,
      lineTotalCents: D.computeLineTotal(it.unitPriceCents, it.quantity),
    })),
    subtotalCents: s.subtotalCents,
    discountCents: s.discountCents,
    totalCents: s.totalCents,
    folio: s.folio,
    clientName: s.clientName,
    date: new Date(s.serverTs).toLocaleString('es'),
  };
  const result = await runPrintWithSafety({
    key: printKey('sale', s.id),
    button: event?.currentTarget || $('saleDetailReprintBtn'),
    status: showSaleDetailStatus,
    print: () => Printer.printReceipt(ticketData),
  });
  if (result.canceled) return;
  if (result.ok) {
    showSaleDetailStatus('✅ Ticket reimpreso correctamente.', 'success');
  } else {
    showSaleDetailStatus(`No se pudo imprimir. Revisa la impresora e intenta de nuevo. Detalle: ${result.reason}`, 'failure');
  }
}

// ---- Editor de catálogo y precios ----

/** Modelo editable en memoria: [{name, sizes:[{size, priceCents, priceInput}]}] */
let priceEditor = [];
const selectedNewProductSizes = new Map();
const LETTER_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', 'Otro'];

function sizeSelectionKey(size) {
  return `${typeof size}:${String(size).toLocaleLowerCase('es')}`;
}

async function loadCatalogEditor() {
  showCatalogStatus('Cargando catálogo…', 'saving');
  const res = await Api.fetchCatalog();
  if (!res.ok) {
    showCatalogStatus('No se pudo cargar el catálogo. Revisa la conexión e intenta de nuevo.', 'failure');
    return;
  }
  priceEditor = D.priceEditorFromCatalog(res.data.catalog);
  renderCatalogEditor();
  showCatalogStatus(null);
  showError('catalogError', null);
}

function renderCatalogEditor() {
  const container = $('catalogEditor');
  container.replaceChildren();
  for (const product of priceEditor) {
    const card = el('div', 'price-card');
    card.dataset.productName = product.name;

    // Cabecera con título y acciones (Renombrar y Borrar producto)
    const header = el('div', 'price-card-header');
    const title = el('h4', 'price-card-title', product.name);
    const actions = el('div', 'price-card-actions');

    const renameBtn = el('button', 'btn btn-small btn-rename-product', '✏️ Renombrar');
    renameBtn.type = 'button';
    renameBtn.setAttribute('aria-label', `Renombrar producto ${product.name}`);
    renameBtn.addEventListener('click', () => {
      const newName = window.prompt(`Nuevo nombre para "${product.name}":`, product.name);
      if (newName === null) return;
      const res = D.renameProductInEditor(priceEditor, product.name, newName);
      if (!res.ok) {
        alert(`⚠️ ${res.reason}`);
        return;
      }
      priceEditor = res.editor;
      renderCatalogEditor();
      showCatalogStatus('Hay cambios sin guardar.', 'saving');
    });

    const delProdBtn = el('button', 'btn btn-small btn-danger-soft btn-delete-product', '🗑️ Borrar');
    delProdBtn.type = 'button';
    delProdBtn.setAttribute('aria-label', `Eliminar producto ${product.name}`);
    delProdBtn.addEventListener('click', () => {
      if (!window.confirm(`¿Eliminar el producto "${product.name}" y todas sus tallas del catálogo?`)) return;
      const res = D.deleteProductFromEditor(priceEditor, product.name);
      if (!res.ok) {
        alert(`⚠️ ${res.reason}`);
        return;
      }
      priceEditor = res.editor;
      renderCatalogEditor();
      showCatalogStatus('Hay cambios sin guardar.', 'saving');
    });

    actions.append(renameBtn, delProdBtn);
    header.append(title, actions);
    card.append(header);

    // Lista de tallas con input de precio y botón para borrar talla
    const rows = el('div', 'price-rows');
    for (const size of product.sizes) {
      const row = el('div', 'price-row');
      const label = el('label', null, `Talla ${size.size}`);
      const group = el('div', 'price-input-group');

      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.value = size.priceInput;
      input.placeholder = '0.00';
      input.setAttribute('aria-label', `Precio talla ${size.size} de ${product.name}`);
      input.addEventListener('focus', function () { this.select(); });
      input.addEventListener('input', () => {
        size.priceInput = input.value;
        showCatalogStatus('Hay cambios sin guardar.', 'saving');
      });

      const delSizeBtn = el('button', 'btn-delete-size', '✕');
      delSizeBtn.type = 'button';
      delSizeBtn.setAttribute('aria-label', `Quitar talla ${size.size} de ${product.name}`);
      delSizeBtn.title = 'Eliminar esta talla';
      delSizeBtn.addEventListener('click', () => {
        const res = D.deleteSizeFromProduct(priceEditor, product.name, size.size);
        if (!res.ok) {
          alert(`⚠️ ${res.reason}`);
          return;
        }
        priceEditor = res.editor;
        renderCatalogEditor();
        showCatalogStatus('Hay cambios sin guardar.', 'saving');
      });

      group.append(input, delSizeBtn);
      row.append(label, group);
      rows.append(row);
    }
    card.append(rows);

    // Pie de tarjeta para agregar una talla individual a este producto
    const footer = el('div', 'price-card-footer');
    const addSizeBtn = el('button', 'btn btn-small btn-add-size', '+ Talla');
    addSizeBtn.type = 'button';
    addSizeBtn.setAttribute('aria-label', `Agregar talla a ${product.name}`);
    addSizeBtn.addEventListener('click', () => {
      const raw = window.prompt(`Nueva talla para "${product.name}" (ej: 16, M, 22 o 4XL):`);
      if (raw === null) return;
      const res = D.addSizeToProduct(priceEditor, product.name, raw);
      if (!res.ok) {
        alert(`⚠️ ${res.reason}`);
        return;
      }
      priceEditor = res.editor;
      renderCatalogEditor();
      showCatalogStatus('Hay cambios sin guardar.', 'saving');
    });
    footer.append(addSizeBtn);
    card.append(footer);

    container.append(card);
  }
}

function updateSelectedSizesText() {
  const sizes = [...selectedNewProductSizes.values()];
  $('selectedSizesText').textContent = sizes.length
    ? `Tallas seleccionadas: ${sizes.join(', ')}`
    : 'Ninguna talla seleccionada.';
}

function toggleNewProductSize(size, button) {
  const key = sizeSelectionKey(size);
  if (selectedNewProductSizes.has(key)) selectedNewProductSizes.delete(key);
  else selectedNewProductSizes.set(key, size);
  const selected = selectedNewProductSizes.has(key);
  button.classList.toggle('selected', selected);
  button.setAttribute('aria-pressed', String(selected));
  updateSelectedSizesText();
}

function renderSizeOption(containerId, sizes) {
  const container = $(containerId);
  container.replaceChildren();
  for (const size of sizes) {
    const button = el('button', 'btn btn-small', String(size));
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => toggleNewProductSize(size, button));
    container.append(button);
  }
}

function openProductDialog() {
  selectedNewProductSizes.clear();
  $('productNameInput').value = '';
  $('customSizeInput').value = '';
  showError('productDialogError', null);
  renderSizeOption('newProductSizeOptions', Array.from({ length: 20 }, (_, i) => i + 1));
  renderSizeOption('newProductLetterSizes', LETTER_SIZES);
  updateSelectedSizesText();
  $('productDialog').showModal();
  $('productNameInput').focus();
}

function addCustomProductSize() {
  const raw = $('customSizeInput').value;
  const size = D.normalizeSizeInput(raw);
  if (size === null) {
    showError('productDialogError', 'Escribe una talla válida (por ejemplo: 22 o 4XL).');
    return;
  }
  selectedNewProductSizes.set(sizeSelectionKey(size), size);
  $('customSizeInput').value = '';
  showError('productDialogError', null);
  updateSelectedSizesText();
}

function createNewProduct() {
  const created = D.createProductEditor(
    $('productNameInput').value,
    [...selectedNewProductSizes.values()],
    priceEditor
  );
  if (!created.ok) {
    showError('productDialogError', created.reason);
    return;
  }
  priceEditor.push(created.product);
  renderCatalogEditor();
  $('productDialog').close();
  showCatalogStatus(`Producto “${created.product.name}” agregado. Completa sus precios y pulsa Guardar cambios.`, 'saving');
  const cards = $('catalogEditor').querySelectorAll('.price-card');
  cards[cards.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function saveCatalog() {
  showError('catalogError', null);
  const converted = D.priceEditorToCatalog(priceEditor);
  if (!converted.ok) {
    showCatalogStatus(converted.reason, 'failure');
    return;
  }

  const saveButton = $('catalogSaveBtn');
  saveButton.disabled = true;
  saveButton.textContent = 'Guardando…';
  showCatalogStatus('Guardando cambios en el servidor…', 'saving');

  const res = await Api.adminPutCatalog(state.admin.csrf, converted.catalog);
  if (res.ok) {
    priceEditor = D.priceEditorFromCatalog(res.data.catalog);
    state.catalog = res.data.catalog;
    S.saveCatalog(state.catalog);
    renderCatalogEditor();
    renderCatalog();
    showCatalogStatus('✅ Catálogo actualizado correctamente. Los nuevos precios y productos ya están disponibles en ventas.', 'success');
  } else {
    if (res.status === 401) {
      requireAdminLogin('La sesión terminó antes de guardar. Tus cambios no se enviaron; inicia sesión y vuelve a introducirlos.');
    } else {
      showCatalogStatus(`No se guardaron los cambios: ${res.error.message}`, 'failure');
    }
  }

  saveButton.disabled = false;
  saveButton.textContent = 'Guardar cambios';
}

async function loadAudit() {
  const res = await Api.adminAudit(state.admin.csrf);
  const list = $('auditList');
  list.replaceChildren();
  if (!res.ok) {
    list.append(el('li', 'admin-item', 'No se pudo cargar la auditoría.'));
    return;
  }
  for (const entry of res.data.entries) {
    const li = el('li', 'admin-item');
    const head = el('div', 'admin-item-head');
    head.append(el('span', null, entry.action), el('span', null, new Date(entry.ts).toLocaleString('es')));
    li.append(head);
    const sub = el('div', 'admin-item-sub');
    sub.textContent = `${entry.actor || ''}${entry.detail ? ' — ' + JSON.stringify(entry.detail) : ''}`.trim();
    li.append(sub);
    list.append(li);
  }
}

// ---------------- Gestión de Encargos y Clientes ----------------

function enterEncargoMode(activeEncargo = null) {
  state.encargoMode = true;
  if (activeEncargo) {
    state.activeEncargoId = activeEncargo.id;
    $('clientInput').value = activeEncargo.clientName || '';
    $('encargoNotesInput').value = activeEncargo.notes || '';
  } else {
    state.activeEncargoId = null;
  }
  showSaleView();
  renderCart();
  if (!$('clientInput').value) {
    $('clientInput').focus();
  }
}

function exitEncargoMode() {
  state.encargoMode = false;
  state.activeEncargoId = null;
  $('encargoNotesInput').value = '';
  renderCart();
}

async function saveCurrentCartAsEncargo() {
  if (state.cart.length === 0) {
    showError('cartError', 'Agrega al menos una prenda para el encargo.');
    return;
  }
  const clientName = $('clientInput').value.trim();
  if (!clientName) {
    showError('cartError', 'Por favor ingresa o selecciona el nombre del cliente para el encargo.');
    $('clientInput').focus();
    return;
  }
  showError('cartError', null);

  const notes = $('encargoNotesInput').value.trim() || null;
  const payload = {
    id: S.createUuid(),
    clientName,
    notes,
    items: state.cart.map((line) => ({
      productName: line.product,
      size: line.size,
      unitPriceCents: line.unitPriceCents,
      quantity: line.quantity,
    })),
    totalCents: D.computeSubtotal(state.cart),
  };

  let token = S.hasSellerToken() ? S.getSellerToken() : null;
  let res = await Api.postEncargo(payload, token);
  if (!res.ok && res.error && res.error.code === 'seller_token_required') {
    token = askSellerToken();
    if (!token) return;
    res = await Api.postEncargo(payload, token);
  }

  if (!res.ok) {
    showError('cartError', res.error?.message || 'No se pudo guardar el encargo en el servidor.');
    return;
  }

  // Guardado exitoso: registrar cliente
  S.rememberClient(clientName);
  if (state.online) Api.postClient(clientName).catch(() => {});
  loadClientsList();

  // Limpiar carrito y estado
  state.cart = [];
  state.discountCents = 0;
  S.clearCart();
  $('clientInput').value = '';
  $('encargoNotesInput').value = '';
  exitEncargoMode();
  renderCart();

  const folioText = res.data?.encargo?.folio ? `Folio E-${res.data.encargo.folio}` : 'guardado';
  alert(`📦 Encargo guardado con éxito (${folioText}) para ${clientName}.`);
  showEncargosView();
  switchEncargosSubtab('clients');
}

function switchEncargosSubtab(tabName) {
  state.encargosSubtab = tabName;
  $('tabSummaryBtn').classList.toggle('active', tabName === 'summary');
  $('tabClientsBtn').classList.toggle('active', tabName === 'clients');
  $('tabDeliveredBtn').classList.toggle('active', tabName === 'delivered');

  $('tabSummaryBtn').setAttribute('aria-selected', String(tabName === 'summary'));
  $('tabClientsBtn').setAttribute('aria-selected', String(tabName === 'clients'));
  $('tabDeliveredBtn').setAttribute('aria-selected', String(tabName === 'delivered'));

  $('encargosSummarySection').hidden = tabName !== 'summary';
  $('encargosClientsSection').hidden = tabName !== 'clients';
  $('encargosDeliveredSection').hidden = tabName !== 'delivered';
}

async function loadEncargos() {
  const token = S.hasSellerToken() ? S.getSellerToken() : null;
  const [pendingRes, deliveredRes] = await Promise.all([
    Api.fetchEncargos(token, 'pending'),
    Api.fetchEncargos(token, 'delivered'),
  ]);

  if (pendingRes.ok && Array.isArray(pendingRes.data?.encargos)) {
    state.encargos = pendingRes.data.encargos;
  } else {
    state.encargos = [];
  }

  const delivered = (deliveredRes.ok && Array.isArray(deliveredRes.data?.encargos)) ? deliveredRes.data.encargos : [];

  const count = state.encargos.length;
  $('encargosBadge').textContent = String(count);
  $('encargosBadge').hidden = count === 0;
  $('encargosCountText').textContent = String(count);

  renderEncargosSummary(state.encargos);
  renderEncargosClients(state.encargos);
  renderEncargosDelivered(delivered);
}

function renderEncargosSummary(encargos) {
  const container = $('encargosSummaryContent');
  container.replaceChildren();

  const summary = D.aggregateEncargosByProductAndSize(encargos);
  if (summary.products.length === 0) {
    container.append(el('p', 'muted', 'No hay encargos pendientes en este momento. Los pedidos que tomes en tus rutas aparecerán aquí consolidados por prenda y talla para el taller.'));
    return;
  }

  const headerBox = el('div', 'workshop-summary-header');
  headerBox.append(
    el('div', 'workshop-summary-title', `Total a confeccionar / alistar: ${summary.grandTotalQty} prenda${summary.grandTotalQty === 1 ? '' : 's'}`),
    el('div', 'workshop-summary-sub', `Consolidado de ${encargos.length} pedido${encargos.length === 1 ? '' : 's'} activo${encargos.length === 1 ? '' : 's'}`)
  );
  container.append(headerBox);

  for (const prod of summary.products) {
    const card = el('div', 'encargo-card workshop-card');
    const head = el('div', 'admin-item-head');
    head.append(
      el('strong', null, `🧵 ${prod.name}`),
      el('span', 'badge badge-primary', `${prod.subtotalQty} prenda${prod.subtotalQty === 1 ? '' : 's'}`)
    );
    card.append(head);

    const grid = el('div', 'workshop-size-grid');
    for (const s of prod.sizes) {
      const chip = el('div', 'workshop-size-chip');
      const sLabel = typeof s.size === 'string' ? `Talla ${s.size}` : `Talla ${s.size}`;
      chip.append(el('span', 'size-label', sLabel), el('span', 'size-qty', `x${s.quantity}`));
      grid.append(chip);
    }
    card.append(grid);
    container.append(card);
  }
}

function renderEncargosClients(encargos) {
  const container = $('encargosClientsList');
  container.replaceChildren();

  if (encargos.length === 0) {
    container.append(el('p', 'muted', 'No hay pedidos pendientes por cliente.'));
    return;
  }

  for (const enc of encargos) {
    const card = el('div', 'encargo-card');
    const head = el('div', 'admin-item-head');
    head.append(
      el('strong', null, `👤 ${enc.clientName}`),
      el('span', 'badge', `Folio E-${enc.folio}`)
    );
    card.append(head);

    const meta = el('div', 'encargo-meta');
    const dateStr = enc.serverTs ? new Date(enc.serverTs).toLocaleDateString('es') : '';
    meta.append(el('span', 'muted', dateStr));
    if (enc.notes) meta.append(el('span', 'encargo-note', ` · Nota: ${enc.notes}`));
    card.append(meta);

    const itemsList = el('ul', 'encargo-items-list');
    for (const it of enc.items || []) {
      const li = el('li', 'encargo-item-row');
      const sLabel = typeof it.size === 'string' ? `Talla ${it.size}` : `Talla ${it.size}`;
      li.append(
        el('span', null, `${it.productName} · ${sLabel} (${it.quantity} pza${it.quantity === 1 ? '' : 's'})`),
        el('span', 'muted', D.formatUSD(D.computeLineTotal(it.unitPriceCents, it.quantity)))
      );
      itemsList.append(li);
    }
    card.append(itemsList);

    const totalRow = el('div', 'encargo-total-row');
    totalRow.append(el('span', null, 'Total estimado:'), el('strong', null, D.formatUSD(enc.totalCents)));
    card.append(totalRow);

    const actions = el('div', 'encargo-actions');
    const convertBtn = el('button', 'btn btn-primary btn-small', '🛒 Convertir a Venta');
    convertBtn.addEventListener('click', () => convertEncargoToSale(enc));

    const printBtn = el('button', 'btn btn-small', '🖨️ Ticket');
    printBtn.addEventListener('click', () => printSingleEncargoTicket(enc, printBtn));

    const cancelBtn = el('button', 'btn btn-small btn-danger-soft', '✕ Cancelar');
    cancelBtn.addEventListener('click', () => cancelEncargoAction(enc));

    actions.append(convertBtn, printBtn, cancelBtn);
    card.append(actions);
    container.append(card);
  }
}

function convertEncargoToSale(encargo) {
  if (state.cart.length > 0) {
    if (!window.confirm('Tu carrito actual tiene prendas. ¿Deseas reemplazarlas con las prendas de este encargo?')) {
      return;
    }
  }

  state.cart = (encargo.items || []).map((it) => ({
    product: it.productName,
    size: it.size,
    quantity: it.quantity,
    unitPriceCents: it.unitPriceCents,
  }));
  S.saveCart(state.cart);
  state.discountCents = 0;
  state.activeEncargoId = encargo.id;
  state.encargoMode = true;

  $('clientInput').value = encargo.clientName || '';
  $('encargoNotesInput').value = encargo.notes || '';

  showSaleView();
  renderCart();
}

async function printSingleEncargoTicket(encargo, button = null) {
  const res = await runPrintWithSafety({
    key: printKey('encargo', encargo.id),
    button,
    print: () => Printer.printSingleEncargo(encargo),
  });
  if (res.canceled) return;
  if (res.ok) {
    alert('✅ Ticket de encargo impreso correctamente.');
  } else {
    alert(`No se pudo imprimir. Revisa la impresora e intenta de nuevo. Detalle: ${res.reason}`);
  }
}

async function cancelEncargoAction(encargo) {
  if (!window.confirm(`¿Deseas cancelar el encargo E-${encargo.folio} de ${encargo.clientName}?`)) {
    return;
  }
  const token = S.hasSellerToken() ? S.getSellerToken() : null;
  const res = await Api.cancelEncargo(encargo.id, token);
  if (res.ok) {
    await loadEncargos();
  } else {
    alert(`No se pudo cancelar: ${res.error?.message || 'Error del servidor'}`);
  }
}

function renderEncargosDelivered(deliveredEncargos) {
  const container = $('encargosDeliveredList');
  container.replaceChildren();

  if (!deliveredEncargos || deliveredEncargos.length === 0) {
    container.append(el('p', 'muted', 'No hay historial de encargos entregados recientemente.'));
    return;
  }

  for (const enc of deliveredEncargos) {
    const card = el('div', 'encargo-card delivered');
    const head = el('div', 'admin-item-head');
    head.append(
      el('strong', null, `👤 ${enc.clientName}`),
      el('span', 'badge badge-success', 'Entregado')
    );
    card.append(head);

    const meta = el('div', 'encargo-meta');
    const delDate = enc.deliveredAt ? new Date(enc.deliveredAt).toLocaleString('es') : '';
    meta.append(el('span', 'muted', `Entregado: ${delDate} · Folio E-${enc.folio}`));
    card.append(meta);

    const totalRow = el('div', 'encargo-total-row');
    const countItems = (enc.items || []).reduce((sum, it) => sum + (it.quantity || 1), 0);
    totalRow.append(
      el('span', null, `${countItems} prenda${countItems === 1 ? '' : 's'}`),
      el('strong', null, D.formatUSD(enc.totalCents))
    );
    card.append(totalRow);
    container.append(card);
  }
}

async function printEncargosSummaryTicketAction(event) {
  if (!state.encargos || state.encargos.length === 0) {
    alert('No hay encargos activos para imprimir.');
    return;
  }
  const summary = D.aggregateEncargosByProductAndSize(state.encargos);
  const summaryKey = `workshop:${state.encargos.map((enc) => enc.id).sort().join(',')}`;
  const res = await runPrintWithSafety({
    key: summaryKey,
    button: event?.currentTarget || $('printEncargosSummaryBtn'),
    print: () => Printer.printEncargosTicket({
      encargos: state.encargos,
      summary,
      date: new Date().toLocaleDateString('es'),
    }),
  });
  if (res.canceled) return;
  if (res.ok) {
    alert('✅ Ticket de taller impreso correctamente.');
  } else {
    alert(`No se pudo imprimir. Revisa la impresora e intenta de nuevo. Detalle: ${res.reason}`);
  }
}

// ---------------- Directorio y selector de clientes ----------------

async function loadClientsList() {
  state.clients = S.loadClients();
  if (state.customerSuggestionsEngaged) renderInlineCustomerSuggestions();
  try {
    const res = await Api.fetchClients();
    if (res.ok && Array.isArray(res.data?.clients)) {
      for (const c of res.data.clients) {
        if (c && c.name) S.rememberClient(c.name);
      }
      state.clients = S.loadClients();
      if (state.customerSuggestionsEngaged) renderInlineCustomerSuggestions();
    }
  } catch {
    /* offline */
  }
}

function openClientPicker() {
  const searchInput = $('clientPickerSearch');
  searchInput.value = $('clientInput').value || '';
  renderClientChips(searchInput.value);
  $('clientPickerDialog').showModal();
  searchInput.focus();
}

function hideInlineCustomerSuggestions() {
  state.customerSuggestionsEngaged = false;
  $('inlineClientSuggestions').hidden = true;
  $('clientInput').setAttribute('aria-expanded', 'false');
}

function renderInlineCustomerSuggestions() {
  const input = $('clientInput');
  const container = $('inlineClientSuggestions');
  const matches = filterCustomerSuggestions(state.clients, input.value);
  container.replaceChildren();
  if (!shouldShowCustomerSuggestions({ engaged: state.customerSuggestionsEngaged, matches })) {
    container.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    return;
  }
  for (const name of matches) {
    const button = el('button', 'inline-client-suggestion', name);
    button.type = 'button';
    button.addEventListener('pointerdown', (event) => event.preventDefault());
    button.addEventListener('click', () => chooseCustomer(name));
    container.append(button);
  }
  container.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}

function showInlineCustomerSuggestions() {
  state.customerSuggestionsEngaged = true;
  renderInlineCustomerSuggestions();
}

function chooseCustomer(name) {
  const selected = applySelectedCustomer({
    name,
    input: $('clientInput'),
    dialog: $('clientPickerDialog'),
    suggestions: $('inlineClientSuggestions'),
    status: $('clientSelectionStatus'),
  });
  if (!selected) return;
  state.customerSuggestionsEngaged = false;
  $('clientInput').setAttribute('aria-expanded', 'false');
  S.rememberClient(name);
  state.clients = S.loadClients();
  loadClientsList();
}

function renderClientChips(filterText = '') {
  const container = $('clientChipsList');
  container.replaceChildren();

  const query = (filterText || '').trim().toLocaleLowerCase('es');
  const matched = state.clients.filter((c) => !query || c.toLocaleLowerCase('es').includes(query));

  if (matched.length === 0) {
    container.append(el('p', 'muted', 'No hay clientes guardados que coincidan. Escribe el nombre arriba para usarlo.'));
    return;
  }

  for (const name of matched) {
    const chip = el('button', 'client-chip', name);
    chip.type = 'button';
    chip.addEventListener('click', () => chooseCustomer(name));
    container.append(chip);
  }
}

// ---------------- Carga inicial ----------------

async function loadCatalog() {
  const cached = S.loadCatalog();
  if (cached) {
    state.catalog = cached;
    renderCatalog();
  }
  const res = await Api.fetchCatalog();
  if (res.ok) {
    state.catalog = res.data.catalog;
    S.saveCatalog(state.catalog);
    state.online = true;
    renderCatalog();
  } else {
    state.online = false;
    showError('cartError', cached ? null : 'No se pudo cargar el catálogo. Conéctate una vez para guardar los productos en este dispositivo.');
  }
  renderStatus();
}

const THEME_COLORS = Object.freeze({ light: '#0f766e', dark: '#0f172a', eink: '#ffffff' });

function applyTheme(theme) {
  const selectedTheme = Object.hasOwn(THEME_COLORS, theme) ? theme : 'light';
  document.documentElement.dataset.theme = selectedTheme;
  document.documentElement.classList.toggle('eink-mode', selectedTheme === 'eink');
  $('themeSelect').value = selectedTheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[selectedTheme]);
}

async function init() {
  applyTheme(S.loadTheme());

  // Service worker (PWA)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.error('SW:', e));
  }

  // Micro-interacción háptica sutil para dispositivos táctiles
  const triggerHaptic = (ms = 12) => {
    try {
      if (document.documentElement.classList.contains('eink-mode')) return;
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(ms);
      }
    } catch { /* soporte opcional */ }
  };

  // Eventos
  $('qtyMinus').addEventListener('click', () => {
    setQuantity(state.qty - 1);
    triggerHaptic(10);
  });
  $('qtyPlus').addEventListener('click', () => {
    setQuantity(state.qty + 1);
    triggerHaptic(10);
  });
  for (const preset of document.querySelectorAll('.qty-preset')) {
    preset.addEventListener('click', () => {
      setQuantity(Number(preset.dataset.quantity));
      triggerHaptic(10);
    });
  }
  $('addLineBtn').addEventListener('click', () => {
    if (state.selectedSize === null) return;
    const product = state.catalog.find((p) => p.name === state.selectedCategory);
    if (!product) return;
    const price = product.sizes.find((s) => s.size === state.selectedSize)?.priceCents;
    const line = { product: product.name, size: state.selectedSize, quantity: state.qty, unitPriceCents: price };
    const v = D.validateLine(line);
    if (!v.ok) { showError('cartError', v.reason); return; }
    const existing = state.cart.find((l) => l.product === line.product && l.size === line.size);
    if (existing) existing.quantity = Math.min(99, existing.quantity + line.quantity);
    else state.cart.push(line);
    S.saveCart(state.cart);
    showError('cartError', null);

    // Reset de cantidad para el siguiente producto y feedback táctil/visual
    setQuantity(1);
    $('addLineBtn').classList.add('btn-pulse');
    setTimeout(() => $('addLineBtn').classList.remove('btn-pulse'), 250);
    triggerHaptic(16);

    renderCart();
  });
  $('discountInput').addEventListener('focus', function() {
    this.select();
  });
  $('discountInput').addEventListener('input', () => {
    const cents = D.parseDiscountInput($('discountInput').value);
    state.discountCents = cents === null ? 0 : cents;
    renderCart();
  });
  $('finishBtn').addEventListener('click', finalizeSale);
  $('printReceiptBtn').addEventListener('click', printCurrentReceipt);
  $('shareReceiptBtn').addEventListener('click', shareCurrentReceipt);
  $('localReprintBtn').addEventListener('click', openLocalSalesDialog);
  $('closeLocalSalesBtn').addEventListener('click', () => $('localSalesDialog').close());
  $('newSaleBtn').addEventListener('click', () => {
    state.receipt = null;
    state.receiptImageFile = null;
    state.receiptImageToken += 1;
    state.receiptImagePreparing = false;
    state.sharingReceipt = false;
    $('shareReceiptBtn').disabled = false;
    $('shareReceiptBtn').removeAttribute('aria-busy');
    showPrintStatus(null);
    showShareStatus(null);
    $('receiptView').hidden = true;
    $('saleView').hidden = false;
    renderCart();
  });
  // Observador para ocultar la barra flotante móvil en cuanto el botón "Finalizar venta" entra en pantalla
  if (typeof IntersectionObserver !== 'undefined') {
    const finishBtn = $('finishBtn');
    if (finishBtn) {
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          state.finishBtnVisible = entry.isIntersecting;
        }
        updateMobileCartBar();
      }, {
        threshold: 0.05,
      });
      observer.observe(finishBtn);
    }
  }

  $('mobileCartBtn')?.addEventListener('click', () => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    $('finishBtn')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  });
  $('togglePasswordBtn')?.addEventListener('click', () => {
    const input = $('adminPasswordInput');
    const btn = $('togglePasswordBtn');
    if (!input || !btn) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    btn.textContent = isPassword ? '🙈' : '👁️';
  });
  $('themeSelect').addEventListener('change', (event) => {
    applyTheme(event.currentTarget.value);
    S.saveTheme(event.currentTarget.value);
  });
  $('syncBtn').addEventListener('click', () => { state.online = navigator.onLine; renderStatus(); syncAll(); });
  $('pricesBtn').addEventListener('click', openPricesDialog);
  $('pricesFilter').addEventListener('change', renderPricesList);
  $('closePricesBtn').addEventListener('click', () => $('pricesDialog').close());

  // Admin
  $('adminLink').addEventListener('click', showAdminLogin);
  $('adminLogin').addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = $('adminPasswordInput').value;
    if (!password) return;
    const res = await Api.adminLogin(password);
    if (res.ok) {
      const session = await Api.adminSession();
      if (session.ok && session.data?.authenticated && session.data.csrfToken) {
        state.admin.csrf = session.data.csrfToken;
        await enterAdminPanel();
      } else {
        requireAdminLogin('La contraseña fue aceptada, pero el navegador no conservó la sesión. Abre la aplicación desde su dirección original y vuelve a intentarlo.');
      }
    } else {
      showError('adminLoginError', res.error.message);
    }
  });
  $('adminLogoutBtn').addEventListener('click', async () => {
    await Api.adminLogout(state.admin.csrf);
    state.admin.csrf = null;
    showSaleView();
  });
  $('adminBackBtn').addEventListener('click', showSaleView);
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      for (const name of ['ventas', 'catalogo', 'auditoria']) {
        $('tab-' + name).hidden = name !== tab.dataset.tab;
      }
      if (tab.dataset.tab === 'ventas') loadAdminSales();
      if (tab.dataset.tab === 'catalogo') loadCatalogEditor();
      if (tab.dataset.tab === 'auditoria') loadAudit();
    });
  });
  $('salesFilter').addEventListener('change', loadAdminSales);
  $('catalogSaveBtn').addEventListener('click', saveCatalog);
  $('addProductBtn').addEventListener('click', openProductDialog);
  $('cancelProductBtn').addEventListener('click', () => $('productDialog').close());
  $('addCustomSizeBtn').addEventListener('click', addCustomProductSize);
  $('customSizeInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addCustomProductSize();
    }
  });
  $('createProductBtn').addEventListener('click', createNewProduct);

  // Detalle de venta (diálogo)
  $('saleDetailCloseBtn').addEventListener('click', () => $('saleDetailDialog').close());
  $('saleDetailReprintBtn').addEventListener('click', reprintFromDetail);

  // Estado de conexión
  window.addEventListener('online', () => { state.online = true; renderStatus(); syncAll(); });
  window.addEventListener('offline', () => { state.online = false; renderStatus(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncAll();
  });

  // Navegación principal Encargos / Ventas
  $('navSalesBtn').addEventListener('click', showSaleView);
  $('navEncargosBtn').addEventListener('click', showEncargosView);
  $('newEncargoBtn').addEventListener('click', () => enterEncargoMode());
  $('saveAsEncargoBtn').addEventListener('click', saveCurrentCartAsEncargo);
  $('cancelEncargoModeBtn').addEventListener('click', exitEncargoMode);
  $('printEncargosSummaryBtn').addEventListener('click', printEncargosSummaryTicketAction);

  // Subtabs de Encargos
  $('tabSummaryBtn').addEventListener('click', () => switchEncargosSubtab('summary'));
  $('tabClientsBtn').addEventListener('click', () => switchEncargosSubtab('clients'));
  $('tabDeliveredBtn').addEventListener('click', () => switchEncargosSubtab('delivered'));

  // Directorio y selector de clientes
  $('pickClientBtn').addEventListener('click', openClientPicker);
  $('closeClientPickerBtn').addEventListener('click', () => $('clientPickerDialog').close());
  $('useClientPickerBtn').addEventListener('click', () => {
    const val = $('clientPickerSearch').value.trim();
    if (val) chooseCustomer(val);
  });
  $('clientPickerSearch').addEventListener('input', () => {
    renderClientChips($('clientPickerSearch').value);
  });
  const clientInput = $('clientInput');
  const inlineSuggestions = $('inlineClientSuggestions');
  clientInput.addEventListener('focus', showInlineCustomerSuggestions);
  clientInput.addEventListener('pointerdown', showInlineCustomerSuggestions);
  clientInput.addEventListener('input', renderInlineCustomerSuggestions);
  clientInput.addEventListener('keydown', (event) => {
    if (shouldDismissCustomerSuggestions({ type: 'keydown', key: event.key })) hideInlineCustomerSuggestions();
  });
  const deferCustomerFocusDismissal = (event) => {
    const nextTarget = event.relatedTarget;
    setTimeout(() => {
      const relatedTarget = nextTarget || document.activeElement;
      if (shouldDismissCustomerSuggestions({
        type: 'focusout', relatedTarget, input: clientInput, suggestions: inlineSuggestions,
      })) hideInlineCustomerSuggestions();
    }, 0);
  };
  clientInput.addEventListener('focusout', deferCustomerFocusDismissal);
  inlineSuggestions.addEventListener('focusout', deferCustomerFocusDismissal);
  document.addEventListener('pointerdown', (event) => {
    if (shouldDismissCustomerSuggestions({
      type: 'pointerdown', target: event.target, input: clientInput, suggestions: inlineSuggestions,
    })) hideInlineCustomerSuggestions();
  });

  setQuantity(state.qty);
  renderCart();
  renderStatus();
  renderAppVersion();
  await refreshPendingCount();
  await loadCatalog();
  await loadClientsList();
  await loadEncargos();
  syncAll();
}

async function renderAppVersion() {
  const node = $('appVersion');
  let serverVersion = '';
  try {
    const res = await Api.fetchHealth();
    if (res.ok) serverVersion = res.data.version || '';
  } catch { /* sin conexión */ }
  const swVersion = 'v20';
  const parts = [];
  if (serverVersion) parts.push(`v${serverVersion}`);
  parts.push(`cache ${swVersion}`);
  node.textContent = parts.join(' · ');
}

init();
