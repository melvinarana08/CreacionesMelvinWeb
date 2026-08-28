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

test('salir de administración regresa al panel de venta y el login permite volver', () => {
  const app = readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.match(app, /adminLogoutBtn[\s\S]*showSaleView\(\)/, 'Salir debe volver a la vista de venta');
  assert.match(app, /adminBackBtn[\s\S]*showSaleView/, 'el login admin debe permitir volver a ventas');
  assert.ok(html.includes('id="adminBackBtn"'), 'falta el botón Volver a ventas');
});

test('consultar precios reemplaza el botón obsoleto y es filtrable', () => {
  assert.ok(!html.includes('refreshCatalogBtn'), 'el botón obsoleto Actualizar precios debe desaparecer');
  for (const id of ['pricesBtn', 'pricesDialog', 'pricesFilter', 'pricesList', 'closePricesBtn']) {
    assert.ok(html.includes(`id="${id}"`), `falta ${id}`);
  }
  assert.match(html, />Consultar Precios</);
});
