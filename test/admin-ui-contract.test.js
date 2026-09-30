import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import * as S from '../public/storage.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const css = readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8');

test('sync button remains accessible and announces progress and queue results without overlapping attempts', () => {
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(html, /id="syncBtn"[^>]*aria-describedby="syncStatus"[^>]*><span aria-hidden="true">↻<\/span> Sincronizar<\/button>/);
  assert.match(html, /id="syncStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(css, /\.sync-status:not\(:empty\)/);
  assert.match(app, /if \(syncing\) \{ retryAfterSync = true; return; \}/);
  assert.match(app, /button\.disabled = true;[\s\S]*button\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(app, /finally \{[\s\S]*button\.removeAttribute\('aria-busy'\)/);
  assert.match(app, /runPendingSync\(/);
  assert.match(app, /syncResultMessage\(outcome, state\.pendingCount, conflicts/);
});

test('el feedback de catálogo es visible junto a los botones de guardado', () => {
  const statusAt = html.indexOf('id="catalogStatus"');
  const editorAt = html.indexOf('id="catalogEditor"');
  assert.ok(statusAt >= 0, 'falta el estado visible de guardado');
  assert.ok(editorAt >= 0 && statusAt < editorAt, 'el feedback debe aparecer antes de la lista larga de precios');
  assert.match(html, /id="catalogStatus"[^>]*role="status"/);
  assert.match(css, /\.status-text\.success/);
});

test('el alta de producto incluye selector de tallas y talla personalizada', () => {
  for (const id of ['addProductBtn', 'productDialog', 'productNameInput', 'newProductSizeOptions', 'customSizeInput', 'createProductBtn']) {
    assert.ok(html.includes(`id="${id}"`), `falta ${id}`);
  }
});

test('el atributo hidden no puede ser anulado por estilos de vistas', () => {
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
});

test('navigation exposes desktop sidebar and mobile dismissible drawer with protected admin entry', () => {
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  for (const id of ['sideNav', 'navToggleBtn', 'navBackdrop', 'navCloseBtn', 'navSalesBtn', 'navEncargosBtn', 'navCustomersBtn', 'adminLink']) {
    assert.ok(html.includes(`id="${id}"`), `missing navigation control ${id}`);
  }
  assert.match(html, /id="navToggleBtn"[^>]*aria-controls="sideNav"[^>]*aria-expanded="false"/);
  assert.match(html, /id="sideNav"[^>]*aria-label="Navegación principal"/);
  assert.match(css, /@media \(min-width: 1100px\)[\s\S]*\.side-nav/);
  assert.match(css, /\.nav-backdrop/);
  assert.match(app, /event\.key === 'Escape'[\s\S]*closeNavigation\(true\)/);
  assert.match(app, /adminLink'\)\.addEventListener\('click', showAdminLogin\)/);
  assert.match(app, /Api\.adminSession\(\)/);
});

test('customers view creates names through public API and local cache without altering sale free text', () => {
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  for (const id of ['customersView', 'createCustomerForm', 'customerNameInput', 'customerCreateStatus', 'customerSearchInput', 'customersList']) {
    assert.ok(html.includes(`id="${id}"`), `missing customer view ${id}`);
  }
  assert.match(app, /Api\.postClient\(name\)/);
  assert.match(app, /S\.rememberClient\(res\.ok/);
  assert.match(app, /Api\.fetchClients\(\)/);
  assert.match(app, /filterCustomerSuggestions\(state\.clients, query\)/);
  assert.match(html, /id="clientInput"[^>]*type="text"/);
  assert.doesNotMatch(html, /id="customerPhoneInput"|id="customerAddressInput"/);
});

test('el login verifica que la cookie de sesión quedó activa antes de abrir administración', () => {
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(app, /Api\.adminLogin\(password\)[\s\S]*Api\.adminSession\(\)/);
  assert.match(app, /navegador no conservó la sesión/i);
});

test('carrito, comprobante y detalle muestran el precio unitario de cada línea', () => {
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const uses = app.match(/D\.formatUnitPriceSummary\(/g) || [];
  assert.ok(uses.length >= 3, `se esperaban al menos 3 usos, se encontraron ${uses.length}`);
});

test('salir de administración regresa al panel de venta y el login permite volver', () => {
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(app, /adminLogoutBtn[\s\S]*showSaleView\(\)/, 'Salir debe volver a la vista de venta');
  assert.match(app, /adminBackBtn[\s\S]*showSaleView/, 'el login admin debe permitir volver a ventas');
  assert.ok(html.includes('id="adminBackBtn"'), 'falta el botón Volver a ventas');
});

test('el producto seleccionado queda resaltado y expone su estado accesible', () => {
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(app, /state\.selectedCategory === product\.name[^\n]*selected/);
  assert.match(app, /aria-pressed[^\n]*state\.selectedCategory === product\.name/);
  assert.match(css, /\.category-list \.btn\.selected/);
});

test('consultar precios se distingue visualmente de los botones de productos', () => {
  assert.ok(!html.includes('refreshCatalogBtn'), 'el botón obsoleto Actualizar precios debe desaparecer');
  for (const id of ['pricesBtn', 'pricesDialog', 'pricesFilter', 'pricesList', 'closePricesBtn']) {
    assert.ok(html.includes(`id="${id}"`), `falta ${id}`);
  }
  assert.match(html, /id="pricesBtn"[^>]*class="[^"]*btn-price-lookup[^"]*"[^>]*>[\s\S]*Consultar precios/i);
  assert.match(css, /\.btn-price-lookup\s*\{/);
  assert.match(css, /\.btn-price-lookup[^}]*border-radius:\s*(?!999px)/s);
});

test('el comprobante tiene botón de impresión térmica Bluetooth', () => {
  for (const id of ['printReceiptBtn', 'printStatus']) {
    assert.ok(html.includes(`id="${id}"`), `falta ${id}`);
  }
  assert.match(html, /Imprimir ticket/);
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(app, /Printer\.printReceipt/);
  assert.match(app, /import \* as Printer from '\.\/printer\.js'/);
});

test('admin: diálogo de detalle con reimprimir y botones Ver/Anular', () => {
  for (const id of ['saleDetailDialog', 'saleDetailBody', 'saleDetailReprintBtn', 'saleDetailCloseBtn']) {
    assert.ok(html.includes(`id="${id}"`), `falta ${id}`);
  }
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(app, /openSaleDetail/, 'debe existir openSaleDetail');
  assert.match(app, /reprintFromDetail/, 'debe existir reprintFromDetail');
  assert.match(app, /saleDetailCache/, 'debe cachear la venta para reimprimir');
});

test('ventas: reimpresión local muestra historial del dispositivo y límite explícito', () => {
  for (const id of ['localReprintBtn', 'localSalesDialog', 'localSalesList', 'localSalesStatus', 'closeLocalSalesBtn']) {
    assert.ok(html.includes(`id="${id}"`), `falta ${id}`);
  }
  assert.match(html, /solo muestra ventas guardadas en este celular o tablet/i);
  assert.match(html, /Pendiente de sincronizar/i);
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(app, /listRecentLocalSales/);
  assert.match(app, /serverResponse/);
  assert.match(app, /runPrintWithSafety/);
  assert.match(css, /\.local-sale-button/);
});

test('impresión duplicada requiere confirmación después de un éxito y bloquea botones', () => {
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(app, /hasPrintSuccess/);
  assert.match(app, /markPrintSuccess/);
  assert.match(app, /otra copia/i);
  assert.match(app, /button\.disabled = true/);
  assert.match(app, /button\.disabled = false/);
  assert.match(app, /aria-busy/);
  assert.doesNotMatch(app, /button\.textContent = 'Imprimiendo…'/);
});

test('historial de encargos entregados usa clase que coincide con CSS existente', () => {
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(app, /encargo-card delivered/);
  assert.doesNotMatch(app, /delivered-card/);
  assert.match(css, /\.encargo-card\.delivered/);
});

test('el footer muestra la versión de la app y la caché del SW', () => {
  assert.ok(html.includes('id="appVersion"'), 'falta el span de versión en el footer');
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(app, /renderAppVersion/);
  assert.match(app, /fetchHealth.*version|data\.version/);
  assert.match(css, /\.app-version/);
});

test('barra móvil y layout tablet usan columnas seguras sin solaparse en paisaje corto', () => {
  for (const id of ['mobileCartBar', 'mobileCartCount', 'mobileCartTotal', 'mobileCartBtn', 'togglePasswordBtn']) {
    assert.ok(html.includes(`id="${id}"`), `falta ${id} en index.html`);
  }
  assert.match(css, /\.mobile-cart-bar/);
  assert.match(css, /@media\s*\(min-width:\s*768px\)\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(320px,\s*380px\)/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /@media\s*\(min-width:\s*768px\)\s*and\s*\(max-height:\s*620px\)/);
  assert.match(css, /\.qty-btn\s*\{[\s\S]*min-width:\s*48px/);
});

test('service worker y app están alineados en caché v23 y precargan el shell cambiado', () => {
  const sw = readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(sw, /cm-sales-v23/);
  assert.match(sw, /keys\.filter\(\(k\) => k !== CACHE\).*caches\.delete\(k\)/);
  for (const asset of ['/', '/index.html', '/styles.css', '/app.js']) assert.ok(sw.includes(`'${asset}'`));
  assert.match(sw, /'\/ui-interactions\.js'/);
  assert.match(sw, /'\/receipt-image\.js'/);
  assert.match(app, /swVersion = 'v23'/);
  assert.match(app, /from '\.\/ui-interactions\.js'/);
  assert.match(app, /from '\.\/receipt-image\.js'/);
});

test('correction reuses sale cart without writing offline queue or creating a sale', () => {
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const api = readFileSync(path.join(ROOT, 'public', 'api.js'), 'utf8');
  assert.match(html, /id="saleDetailEditBtn"[^>]*hidden/);
  assert.match(html, /id="cancelSaleCorrectionBtn"[^>]*hidden/);
  assert.match(app, /sale\.status !== 'active'/);
  assert.match(app, /state\.cart = sale\.items\.map/);
  assert.match(app, /if \(state\.correction\) return saveSaleCorrection\(\)/);
  assert.match(app, /if \(!state\.correction\) S\.saveCart\(state\.cart\)/);
  assert.match(app, /Api\.adminCorrectSale\(state\.admin\.csrf/);
  assert.match(api, /adminCorrectSale = \(csrf, id, correction\)/);
});

test('selector de venta presenta cantidad antes de talla y exige talla explícita', () => {
  const quantityAt = html.indexOf('id="quantityStepLabel"');
  const sizeAt = html.indexOf('id="sizeStepLabel"');
  const addAt = html.indexOf('id="addLineBtn"');
  assert.ok(quantityAt >= 0 && quantityAt < sizeAt && sizeAt < addAt);
  assert.doesNotMatch(html, /id="addLineBtn"[^>]*disabled/);
  assert.match(html, /id="sizeGuidance"[^>]*role="status"[^>]*aria-live="polite"[^>]*hidden/);
  assert.match(html, /id="sizeChips"[^>]*aria-describedby="sizeGuidance"/);
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(app, /state\.selectedSize = null/);
  assert.doesNotMatch(app, /state\.selectedSize = product\.sizes\[0\]\.size/);
  assert.doesNotMatch(app, /state\.selectedSize = s\.size;\s*state\.qty = 1/);
  assert.match(app, /if \(size === null\) \{[\s\S]*sizeGuidance'\)\.hidden = false/);
  assert.match(app, /sizeGuidance'\)\.hidden = true/);
  assert.match(app, /finishBtn'\)\.scrollIntoView/);
  const chipHandler = app.match(/chip\.addEventListener\('click', \(\) => \{([\s\S]*?)\n    \}\);/)?.[1] || '';
  assert.match(chipHandler, /updateSizeChipSelection\(chips\.children, chip\)/);
  assert.doesNotMatch(chipHandler, /replaceChildren|openPicker|renderCatalog/);
  const presets = [...html.matchAll(/class="btn qty-preset" data-quantity="(\d+)"/g)].map((match) => Number(match[1]));
  assert.deepEqual(presets, [3, 6, 9, 12]);
  assert.match(app, /function setQuantity\(value\)/);
  assert.match(app, /updateQuantityControls/);
  assert.match(css, /\.qty-preset\s*\{[^}]*min-height:\s*44px/s);
});

test('finalizar venta confirma cliente vacío antes de guardar y bloquea duplicados', () => {
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const finalizeStart = app.indexOf('async function finalizeSale()');
  const finalizeEnd = app.indexOf('// ---------------- Impresión térmica', finalizeStart);
  const finalize = app.slice(finalizeStart, finalizeEnd);
  assert.ok(finalize.indexOf('window.confirm') < finalize.indexOf('S.savePendingSale'));
  assert.match(finalize, /built\.payload\.clientName === null/);
  assert.match(finalize, /volver y agregarlo/i);
  assert.match(finalize, /if \(state\.finalizingSale\) return/);
  assert.match(finalize, /aria-busy/);
  assert.match(finalize, /finally/);
});

test('comprobante prepara PNG, evita compartir en paralelo y conserva respaldos', () => {
  for (const id of ['shareReceiptBtn', 'shareStatus']) {
    assert.ok(html.includes(`id="${id}"`), `falta ${id}`);
  }
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(app, /createReceiptPngFile\(receipt\)/);
  assert.match(app, /receiptImageToken/);
  assert.match(app, /if \(!state\.receipt \|\| state\.sharingReceipt\) return/);
  assert.match(app, /navigator\.canShare\(payload\)/);
  assert.match(app, /navigator\.share\(payload\)/);
  assert.match(app, /navigator\.clipboard\.writeText\(value\)/);
  assert.match(app, /downloadFileWithObjectUrl/);
  assert.match(app, /setTimeout\(callback, 0\)/);
  assert.match(app, /result\.status === 'cancelled'/);
  assert.match(app, /finally[\s\S]*state\.sharingReceipt = false/);
  assert.match(css, /\.receipt-actions \.btn\s*\{[^}]*min-height:\s*48px/s);
});

test('barra flotante móvil previene solapamiento con botón finalizar venta', () => {
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(app, /updateMobileCartBar/);
  assert.match(app, /finishBtnVisible/);
  assert.match(app, /IntersectionObserver/);
  assert.match(css, /#cartSection\s*\{[\s\S]*margin-bottom:/);
});

test('controles para edición completa de catálogo (borrar, renombrar, gestionar tallas) existen en CSS y JS', () => {
  assert.match(css, /\.btn-delete-product/);
  assert.match(css, /\.btn-rename-product/);
  assert.match(css, /\.btn-delete-size/);
  assert.match(css, /\.btn-add-size/);
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(app, /deleteProductFromEditor/);
  assert.match(app, /renameProductInEditor/);
  assert.match(app, /deleteSizeFromProduct/);
  assert.match(app, /addSizeToProduct/);
});

test('módulo de Encargos, Taller y Directorio de Clientes existen en HTML, CSS y JS', () => {
  for (const id of [
    'navSalesBtn', 'navEncargosBtn', 'encargosBadge',
    'cartTitle', 'cancelEncargoModeBtn', 'encargoNotesRow', 'encargoNotesInput',
    'pickClientBtn', 'clientInput', 'clientHelp', 'clientSelectionStatus', 'saveAsEncargoBtn',
    'encargosView', 'newEncargoBtn', 'printEncargosSummaryBtn',
    'tabSummaryBtn', 'tabClientsBtn', 'tabDeliveredBtn', 'encargosCountText',
    'encargosSummarySection', 'encargosClientsSection', 'encargosDeliveredSection',
    'clientPickerDialog', 'clientPickerSearch', 'clientChipsList',
    'closeClientPickerBtn', 'useClientPickerBtn'
  ]) {
    assert.ok(html.includes(`id="${id}"`), `falta ${id} en index.html`);
  }

  assert.match(css, /\.encargos-view/);
  assert.match(css, /\.workshop-summary-header/);
  assert.match(css, /\.workshop-size-grid/);
  assert.match(css, /\.client-chip/);
  assert.match(css, /\.btn-encargo/);

  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(app, /enterEncargoMode/);
  assert.match(app, /exitEncargoMode/);
  assert.match(app, /saveCurrentCartAsEncargo/);
  assert.match(app, /showEncargosView/);
  assert.match(app, /convertEncargoToSale/);
  assert.match(app, /openClientPicker/);
  assert.doesNotMatch(html, /clientsDatalist|<datalist/i);
});

test('badges y botones ámbar conservan texto oscuro accesible en todos los temas', () => {
  assert.match(css, /--amber-foreground:\s*#111827;/);
  for (const selector of ['.badge', '.btn-encargo', '.btn-encargo:active']) {
    const escapedSelector = selector.replaceAll('.', '\\.');
    const rule = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] || '';
    assert.match(rule, /color:\s*var\(--amber-foreground\)/, `${selector} debe conservar texto oscuro`);
    assert.doesNotMatch(rule, /color:\s*(?:#fff(?:fff)?|white)\b/i, `${selector} no debe usar texto blanco sobre ámbar`);
  }
});

test('cliente opcional usa hints no-login y sugerencias inline táctiles', () => {
  assert.match(html, /<label for="clientInput">Cliente \(opcional\)<\/label>/);
  const clientInputTag = html.match(/<input[^>]*id="clientInput"[^>]*>/)?.[0] || '';
  for (const attribute of [
    'name="sale-customer-display-name"', 'type="text"', 'autocomplete="off"',
    'inputmode="text"', 'autocapitalize="words"', 'maxlength="100"',
  ]) assert.ok(clientInputTag.includes(attribute), `falta ${attribute}`);
  assert.match(html, /id="inlineClientSuggestions"[^>]*aria-label="Clientes guardados recientes"/);
  assert.match(html, /id="pickClientBtn"[^>]*>Elegir cliente guardado<\/button>/);
  assert.match(html, /id="clientPickerSearch"[^>]*name="saved-customer-search"[^>]*type="search"/);
  assert.doesNotMatch(html, /id="clientInput"[^>]*(?:autocomplete="name"|name="(?:user|username|customer-name)")/);
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(app, /filterCustomerSuggestions/);
  assert.match(app, /pointerdown[\s\S]*preventDefault/);
  assert.match(app, /deferCustomerFocusDismissal[\s\S]*setTimeout\(\(\) =>/);
  assert.match(app, /clientInput\.addEventListener\('focusout', deferCustomerFocusDismissal\)/);
  assert.match(app, /inlineSuggestions\.addEventListener\('focusout', deferCustomerFocusDismissal\)/);
  assert.match(css, /\.inline-client-suggestion[\s\S]*min-height:\s*44px/);
  assert.match(css, /\.inline-client-suggestions[\s\S]*flex-wrap:\s*wrap/);
});

test('login admin tiene frontera de formulario y conserva current-password', () => {
  const adminForm = html.match(/<form id="adminLogin"[^>]*>[\s\S]*?<\/form>/)?.[0] || '';
  assert.ok(adminForm);
  assert.match(adminForm, /id="adminPasswordInput"[^>]*type="password"[^>]*autocomplete="current-password"/);
  const submitTag = adminForm.match(/<button[^>]*id="adminLoginBtn"[^>]*>/)?.[0] || '';
  assert.ok(submitTag.includes('type="submit"'));
  assert.doesNotMatch(html, /new-password|password-manager|readonly/);
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(app, /adminLogin'\)\.addEventListener\('submit'[\s\S]*event\.preventDefault\(\)/);
});

test('los botones principales conservan texto accesible junto a iconos decorativos', () => {
  for (const [id, icon, label] of [
    ['addLineBtn', '＋', 'Agregar'],
    ['syncBtn', '↻', 'Sincronizar'],
    ['finishBtn', '✓', 'Finalizar venta'],
  ]) {
    const button = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>(.*?)<\\/button>`))?.[1] || '';
    assert.match(button, new RegExp(`<span aria-hidden="true">${icon}<\\/span>`));
    assert.ok(button.includes(label), `${id} must keep its visible label`);
  }
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(app, /finishBtnLabel'\)\.textContent = state\.correction \? 'Guardar corrección' : 'Finalizar venta'/);
});

test('un botón de tema recorre los tres modos, informa el activo y conserva persistencia e-ink', () => {
  assert.match(html, /<button[^>]*id="themeButton"[^>]*aria-label="Tema actual: Claro\. Cambiar a Noche"[^>]*>☀️<\/button>/);
  assert.match(html, /id="themeStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.doesNotMatch(html, /id="themeSelect"/);
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(app, /applyTheme\(S\.loadTheme\(\)\)/);
  assert.match(app, /themeButton'\)\.addEventListener\('click', cycleTheme\)/);
  assert.match(app, /contains\('eink-mode'\)\) return/);
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /\.theme-control[^}]*min-width:\s*44px;\s*min-height:\s*44px/);
  assert.match(css, /\.eink-mode \.theme-control\s*\{[^}]*filter:\s*grayscale\(1\)/);
  assert.match(css, /\.app-header \.theme-control:focus-visible[^}]*outline:/);
  assert.match(css, /\.eink-mode \.app-header \.theme-control:focus-visible[^}]*outline-color: #000/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.status-bar \{ width: 100%/);
  assert.match(css, /\.eink-mode, \.eink-mode body/);
  assert.match(css, /\.eink-mode[\s\S]*border:\s*2px solid #000/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /@media\s*\(forced-colors:\s*active\)/);

  const themeCode = app.split('const THEME_COLORS = ')[1]?.split('async function init()')[0];
  assert.ok(themeCode, 'theme behavior must remain available before initialization');
  const button = { textContent: '', setAttribute(key, value) { this[key] = value; } };
  const status = { textContent: '' };
  const meta = { setAttribute(key, value) { this[key] = value; } };
  const classes = new Set();
  const document = {
    documentElement: { dataset: {}, classList: {
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
    } },
    querySelector() { return meta; },
  };
  const storage = new Map();
  const store = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); },
  };
  const themeStorage = { saveTheme: (theme) => S.saveTheme(theme, store), loadTheme: () => S.loadTheme(store) };
  const { applyTheme, cycleTheme } = runInNewContext(
    `const THEME_COLORS = ${themeCode}; ({ applyTheme, cycleTheme })`,
    { document, S: themeStorage, $: (id) => ({ themeButton: button, themeStatus: status })[id] },
  );
  store.setItem('cm_eink_mode', 'true');
  applyTheme(themeStorage.loadTheme());
  for (const [current, next, color, eink] of [
    ['E-ink', 'Claro', '#0f766e', false],
    ['Claro', 'Noche', '#0f172a', false],
    ['Noche', 'E-ink', '#ffffff', true],
    ['E-ink', 'Claro', '#0f766e', false],
  ]) {
    assert.equal(button.textContent, { Claro: '☀️', Noche: '🌙', 'E-ink': '📄' }[current]);
    assert.equal(button['aria-label'], `Tema actual: ${current}. Cambiar a ${next}`);
    assert.equal(status.textContent, `Tema activo: ${current}`);
    cycleTheme();
    assert.equal(button.textContent, { Claro: '☀️', Noche: '🌙', 'E-ink': '📄' }[next]);
    assert.equal(meta.content, color);
    assert.equal(classes.has('eink-mode'), eink);
    assert.equal(themeStorage.loadTheme(), document.documentElement.dataset.theme);
    assert.equal(store.getItem('cm_eink_mode'), eink ? 'true' : 'false');
  }
  applyTheme('invalid');
  assert.equal(button.textContent, '☀️');
});
