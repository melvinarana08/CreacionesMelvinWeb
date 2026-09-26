import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const css = readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8');

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

test('barra móvil flotante y layout responsivo de tablet están presentes', () => {
  for (const id of ['mobileCartBar', 'mobileCartCount', 'mobileCartTotal', 'mobileCartBtn', 'togglePasswordBtn']) {
    assert.ok(html.includes(`id="${id}"`), `falta ${id} en index.html`);
  }
  assert.match(css, /\.mobile-cart-bar/);
  assert.match(css, /@media\s*\(min-width:\s*768px\)\s*\{[\s\S]*#saleView\s*\{[\s\S]*grid-template-columns:/);
  assert.match(css, /\.qty-btn\s*\{[\s\S]*min-width:\s*48px/);
});

test('service worker y app.js están alineados en caché v18 e incluyen interacciones', () => {
  const sw = readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(sw, /cm-sales-v18/);
  assert.match(sw, /'\/ui-interactions\.js'/);
  assert.match(app, /swVersion = 'v18'/);
  assert.match(app, /from '\.\/ui-interactions\.js'/);
});

test('selector de venta presenta cantidad antes de talla y exige talla explícita', () => {
  const quantityAt = html.indexOf('id="quantityStepLabel"');
  const sizeAt = html.indexOf('id="sizeStepLabel"');
  const addAt = html.indexOf('id="addLineBtn"');
  assert.ok(quantityAt >= 0 && quantityAt < sizeAt && sizeAt < addAt);
  assert.match(html, /id="addLineBtn"[^>]*disabled/);
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(app, /state\.selectedSize = null/);
  assert.doesNotMatch(app, /state\.selectedSize = product\.sizes\[0\]\.size/);
  assert.doesNotMatch(app, /state\.selectedSize = s\.size;\s*state\.qty = 1/);
  assert.match(app, /addLineBtn'\)\.disabled = state\.selectedSize === null/);
  const chipHandler = app.match(/chip\.addEventListener\('click', \(\) => \{([\s\S]*?)\n    \}\);/)?.[1] || '';
  assert.match(chipHandler, /updateSizeChipSelection\(chips\.children, chip\)/);
  assert.doesNotMatch(chipHandler, /replaceChildren|openPicker|renderCatalog/);
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

test('comprobante permite compartir por Web Share o copiar para WhatsApp', () => {
  for (const id of ['shareReceiptBtn', 'shareStatus']) {
    assert.ok(html.includes(`id="${id}"`), `falta ${id}`);
  }
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(app, /D\.formatShareTicket\(state\.receipt\)/);
  assert.match(app, /performShare\(\{/);
  assert.match(app, /navigator\.share\(payload\)/);
  assert.match(app, /navigator\.clipboard\.writeText\(value\)/);
  assert.match(app, /result\.status === 'cancelled'/);
  assert.match(app, /result\.status === 'copied'/);
  assert.match(app, /WhatsApp/);
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
    'pickClientBtn', 'clientInput', 'clientsDatalist', 'saveAsEncargoBtn',
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
});
