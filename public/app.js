// app.js — UI de la PWA de ventas de Creaciones Melvin.
// Flujo offline-first: guardar en IndexedDB (cola) → mostrar comprobante →
// limpiar carrito → sincronizar con el servidor (idempotente por UUID).
'use strict';

import * as D from './domain.js';
import * as S from './storage.js';
import * as Api from './api.js';
import * as Printer from './printer.js';

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
  online: navigator.onLine,
  pendingCount: 0,
  admin: { csrf: null, authenticated: false },
  pendingVoidId: null,
};

// ---------------- Utilidades de render (siempre textContent) ----------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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
  $('finishBtn').disabled = state.cart.length === 0 || !discountValid.ok;
  showError('cartError', discountValid.ok ? null : discountValid.reason);

  const bar = $('mobileCartBar');
  if (bar) {
    const isSaleVisible = !$('saleView').hidden;
    bar.hidden = !isSaleVisible || state.cart.length === 0;
    const totalQty = state.cart.reduce((sum, l) => sum + l.quantity, 0);
    $('mobileCartCount').textContent = `${totalQty} prenda${totalQty === 1 ? '' : 's'}`;
    $('mobileCartTotal').textContent = D.formatUSD(total);
  }
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
  state.selectedCategory = product.name;
  if (!keepSelection || !product.sizes.some((s) => s.size === state.selectedSize)) {
    state.selectedSize = product.sizes[0].size;
  }
  state.qty = 1;
  $('pickerTitle').textContent = `${product.name} — elige talla`;
  const chips = $('sizeChips');
  chips.replaceChildren();
  for (const s of product.sizes) {
    const chip = el('button', 'btn' + (s.size === state.selectedSize ? ' selected' : ''), String(s.size));
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(s.size === state.selectedSize));
    chip.addEventListener('click', () => {
      state.selectedSize = s.size;
      state.qty = 1;
      renderCatalog();
    });
    chips.append(chip);
  }
  $('qtyValue').textContent = String(state.qty);
  $('sizePicker').hidden = false;
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

function finalizeSale() {
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
  // 1) Guardar local PRIMERO (offline-first). Solo si se guarda se limpia el carrito.
  S.savePendingSale(built.payload)
    .then(() => {
      state.receipt = {
        id: built.payload.id,
        lines: built.payload.lines.map((l) => ({ ...l })),
        subtotalCents: D.computeSubtotal(built.payload.lines),
        discountCents: built.payload.discountCents,
        totalCents: D.computeTotal(D.computeSubtotal(built.payload.lines), built.payload.discountCents),
        clientName: built.payload.clientName,
        folio: null,
        savedAt: new Date().toLocaleString('es'),
      };
      state.cart = [];
      state.discountCents = 0;
      $('clientInput').value = '';
      S.clearCart();
      renderCart();
      showReceipt();
      refreshPendingCount();
      syncAll(); // intento inmediato; si falla, queda en cola
    })
    .catch((e) => {
      console.error('Fallo al guardar localmente:', e);
      showError('cartError', 'No se pudo guardar la venta en este dispositivo. Intenta de nuevo.');
    });
}

// ---------------- Impresión térmica Bluetooth ----------------

function showPrintStatus(message, type = 'saving') {
  const node = $('printStatus');
  node.hidden = !message;
  node.className = `status-text ${type}`;
  node.textContent = message || '';
}

async function printCurrentReceipt() {
  if (!state.receipt) return;
  showPrintStatus('Conectando con la impresora…', 'saving');
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
  const result = await Printer.printReceipt(ticketData);
  if (result.ok) {
    showPrintStatus('✅ Ticket impreso correctamente.', 'success');
  } else {
    showPrintStatus(`No se pudo imprimir: ${result.reason}`, 'failure');
  }
}

function showReceipt() {
  $('saleView').hidden = true;
  $('adminView').hidden = true;
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
  for (const line of r.lines) {
    const row = el('div', 'receipt-line');
    const desc = el('span', null, `${line.product} · ${D.formatUnitPriceSummary(line)}`);
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
}

// ---------------- Administración ----------------

function showAdminLogin() {
  state.admin.authenticated = false;
  $('saleView').hidden = true;
  $('receiptView').hidden = true;
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
  $('saleView').hidden = false;
  renderCart();
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

async function reprintFromDetail() {
  if (!saleDetailCache) return;
  showSaleDetailStatus('Conectando con la impresora…', 'saving');
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
  const result = await Printer.printReceipt(ticketData);
  if (result.ok) {
    showSaleDetailStatus('✅ Ticket reimpreso correctamente.', 'success');
  } else {
    showSaleDetailStatus(`No se pudo imprimir: ${result.reason}`, 'failure');
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

async function init() {
  // Service worker (PWA)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.error('SW:', e));
  }

  // Micro-interacción háptica sutil para dispositivos táctiles
  const triggerHaptic = (ms = 12) => {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(ms);
      }
    } catch { /* soporte opcional */ }
  };

  // Eventos
  $('qtyMinus').addEventListener('click', () => {
    state.qty = Math.max(1, state.qty - 1);
    $('qtyValue').textContent = String(state.qty);
    triggerHaptic(10);
  });
  $('qtyPlus').addEventListener('click', () => {
    state.qty = Math.min(99, state.qty + 1);
    $('qtyValue').textContent = String(state.qty);
    triggerHaptic(10);
  });
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
    state.qty = 1;
    $('qtyValue').textContent = '1';
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
  $('newSaleBtn').addEventListener('click', () => {
    state.receipt = null;
    showPrintStatus(null);
    $('receiptView').hidden = true;
    $('saleView').hidden = false;
    renderCart();
  });
  $('mobileCartBtn')?.addEventListener('click', () => {
    $('cartSection').scrollIntoView({ behavior: 'smooth' });
  });
  $('togglePasswordBtn')?.addEventListener('click', () => {
    const input = $('adminPasswordInput');
    const btn = $('togglePasswordBtn');
    if (!input || !btn) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    btn.textContent = isPassword ? '🙈' : '👁️';
  });
  $('syncBtn').addEventListener('click', () => { state.online = navigator.onLine; renderStatus(); syncAll(); });
  $('pricesBtn').addEventListener('click', openPricesDialog);
  $('pricesFilter').addEventListener('change', renderPricesList);
  $('closePricesBtn').addEventListener('click', () => $('pricesDialog').close());

  // Admin
  $('adminLink').addEventListener('click', showAdminLogin);
  $('adminLoginBtn').addEventListener('click', async () => {
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

  renderCart();
  renderStatus();
  renderAppVersion();
  await refreshPendingCount();
  await loadCatalog();
  syncAll();
}

async function renderAppVersion() {
  const node = $('appVersion');
  let serverVersion = '';
  try {
    const res = await Api.fetchHealth();
    if (res.ok) serverVersion = res.data.version || '';
  } catch { /* sin conexión */ }
  const swVersion = 'v13';
  const parts = [];
  if (serverVersion) parts.push(`v${serverVersion}`);
  parts.push(`cache ${swVersion}`);
  node.textContent = parts.join(' · ');
}

init();
