// app.js — UI de la PWA de ventas de Creaciones Melvin.
// Flujo offline-first: guardar en IndexedDB (cola) → mostrar comprobante →
// limpiar carrito → sincronizar con el servidor (idempotente por UUID).
'use strict';

import * as D from './domain.js';
import * as S from './storage.js';
import * as Api from './api.js';

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
  for (const [i, line] of state.cart.entries()) {
    const li = el('li', 'cart-item');
    const info = el('div', 'cart-item-info');
    info.append(el('div', 'cart-item-name', line.product), el('div', 'cart-item-sub', `Talla ${line.size} · ${line.quantity} × ${D.formatUSD(line.unitPriceCents)}`));
    const price = el('div', 'cart-item-price', D.formatUSD(D.computeLineTotal(line.unitPriceCents, line.quantity)));
    const rm = el('button', 'remove-btn', '✕');
    rm.setAttribute('aria-label', `Quitar ${line.product} talla ${line.size}`);
    rm.addEventListener('click', () => {
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
}

function showError(id, message) {
  const node = $(id);
  node.hidden = !message;
  if (message) node.textContent = message;
}

function renderCatalog() {
  const list = $('categoryList');
  list.replaceChildren();
  for (const product of state.catalog) {
    const btn = el('button', 'btn', product.name);
    btn.type = 'button';
    btn.addEventListener('click', () => openPicker(product));
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

function showReceipt() {
  $('saleView').hidden = true;
  $('adminView').hidden = true;
  $('receiptView').hidden = false;
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
    const desc = el('span', null, `${line.product} (talla ${line.size}) × ${line.quantity}`);
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
      line.textContent = `${item.productName} (talla ${item.size}) × ${item.quantity} — ${D.formatUSD(item.unitPriceCents)} c/u`;
      li.append(line);
    }
    if (sale.status === 'voided') {
      const vr = el('div', 'void-reason', `Anulada: ${sale.voidReason || 'sin motivo'}`);
      li.append(vr);
    } else if (state.pendingVoidId === sale.id) {
      const form = el('div', 'meta-row');
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
      li.append(voidBtn);
    }
    list.append(li);
  }
}

// ---- Editor de precios (UI estructurada, sin textarea JSON) ----

/** Modelo editable en memoria: [{name, sizes:[{size, priceCents, priceInput}]}] */
let priceEditor = [];

function loadCatalogEditor() {
  Api.fetchCatalog().then((res) => {
    if (!res.ok) {
      showError('catalogError', 'No se pudo cargar el catálogo.');
      return;
    }
    priceEditor = D.priceEditorFromCatalog(res.data.catalog);
    renderCatalogEditor();
    showError('catalogError', null);
  });
}

function renderCatalogEditor() {
  const container = $('catalogEditor');
  container.replaceChildren();
  for (const product of priceEditor) {
    const card = el('div', 'price-card');
    card.append(el('h4', 'price-card-title', product.name));
    const rows = el('div', 'price-rows');
    for (const size of product.sizes) {
      const row = el('div', 'price-row');
      const label = el('label', null, `Talla ${size.size}`);
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.value = size.priceInput;
      input.setAttribute('aria-label', `Precio talla ${size.size} de ${product.name}`);
      input.addEventListener('input', () => {
        size.priceInput = input.value;
      });
      row.append(label, input);
      rows.append(row);
    }
    card.append(rows);
    container.append(card);
  }
}

function saveCatalog() {
  showError('catalogError', null);
  const converted = D.priceEditorToCatalog(priceEditor);
  if (!converted.ok) {
    showError('catalogError', converted.reason);
    return;
  }
  Api.adminPutCatalog(state.admin.csrf, converted.catalog).then((res) => {
    if (res.ok) {
      showError('catalogError', 'Precios guardados.');
      loadCatalog();
    } else {
      showError('catalogError', res.error.message);
    }
  });
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

  // Eventos
  $('qtyMinus').addEventListener('click', () => { state.qty = Math.max(1, state.qty - 1); $('qtyValue').textContent = String(state.qty); });
  $('qtyPlus').addEventListener('click', () => { state.qty = Math.min(99, state.qty + 1); $('qtyValue').textContent = String(state.qty); });
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
    renderCart();
  });
  $('discountInput').addEventListener('input', () => {
    const cents = D.parseDiscountInput($('discountInput').value);
    state.discountCents = cents === null ? 0 : cents;
    renderCart();
  });
  $('finishBtn').addEventListener('click', finalizeSale);
  $('newSaleBtn').addEventListener('click', () => {
    state.receipt = null;
    $('receiptView').hidden = true;
    $('saleView').hidden = false;
    renderCart();
  });
  $('syncBtn').addEventListener('click', () => { state.online = navigator.onLine; renderStatus(); syncAll(); });
  $('refreshCatalogBtn').addEventListener('click', loadCatalog);

  // Admin
  $('adminLink').addEventListener('click', showAdminLogin);
  $('adminLoginBtn').addEventListener('click', async () => {
    const password = $('adminPasswordInput').value;
    if (!password) return;
    const res = await Api.adminLogin(password);
    if (res.ok) {
      state.admin.csrf = res.data.csrfToken;
      await enterAdminPanel();
    } else {
      showError('adminLoginError', res.error.message);
    }
  });
  $('adminLogoutBtn').addEventListener('click', async () => {
    await Api.adminLogout(state.admin.csrf);
    state.admin.csrf = null;
    showAdminLogin();
  });
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

  // Estado de conexión
  window.addEventListener('online', () => { state.online = true; renderStatus(); syncAll(); });
  window.addEventListener('offline', () => { state.online = false; renderStatus(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncAll();
  });

  renderCart();
  renderStatus();
  await refreshPendingCount();
  await loadCatalog();
  syncAll();
}

init();
