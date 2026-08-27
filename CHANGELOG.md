# Changelog

Todas las fechas en hora local del autor. Formato inspirado en [Keep a Changelog](https://keepachangelog.com/).

## [0.1.0] — 2026-08-24

Primera versión completa y pequeña de la calculadora de ventas de Creaciones Melvin
(rama `feat/mobile-sales-pwa`). Reemplaza la app estática anterior.

### Añadido
- **Backend Node 24 sin dependencias** (`http`, `node:sqlite`, `crypto`, `node:test`).
  - Venta idempotente por UUID, folio central secuencial, snapshots por línea
    (nombre/talla/precio), timestamps cliente/servidor, `deviceId`, estado.
  - Descuento manual validado (no negativo, ≤ subtotal).
  - Catálogo en SQLite, seed desde `productos.json` (incluye Short), reemplazo admin.
  - Anulación con motivo; la venta original nunca se edita ni elimina.
  - Login admin con scrypt + sesiones + CSRF token + `Origin` check + rate-limit.
  - Cookie `HttpOnly; SameSite=Strict; Secure` configurable.
  - `SELLER_TOKEN` opcional para el endpoint de ventas (`X-Seller-Token`).
  - Audit log de acciones administrativas.
  - CSP estricta (sin inline), `nosniff`, `no-referrer`, body ≤ 64 KB, queries parametrizadas.
- **PWA frontend mobile-first en español**: producto → talla → cantidad, carrito,
  descuento, cliente opcional, comprobante, modo offline (IndexedDB), indicador de
  conexión y pendientes, sincronización automática, panel admin (ventas/catálogo/auditoría).
  - `domain.js` con lógica pura testeada por separado.
- **Operaciones**: `Dockerfile` (no root, cap_drop ALL, healthcheck), `compose.yaml`
  (volumen persistente, sin docker.sock), `.env.example`, `scripts/backup.mjs`
  (respaldo consistente VACUUM INTO + sha256), `scripts/seed.js`, `scripts/gen-icons.mjs`.
- **CI** GitHub Actions (`npm test` + `npm run check` en Node 24).
- **Despliegue:** versión activa en `gym-node-02` por `192.168.1.134:3002`, limitada a
  LAN/subnet router, con volumen SQLite persistente, respaldo verificado e imagen de rollback.
- **Documentación**: README completo, `docs/DECISIONS.md`, este changelog.
- **Restore drill automatizado** (`test/backup.test.js`): respaldo → borrado →
  restauración → verificación de integridad.

### Cambiado
- Reemplazada la app estática anterior (HTML/CSS/JS + productos.json) por la PWA con backend.
- El panel de catálogo ahora permite agregar productos con tallas numéricas, tallas en
  letras y tallas personalizadas, además de editar precios.
- El carrito, el payload de venta y el comprobante agrupan automáticamente las líneas por
  categoría/producto aunque se seleccionen intercaladas.

### Corregido
- El guardado del catálogo muestra estado de progreso, éxito o error junto al botón y
  actualiza inmediatamente la vista de ventas y la caché local.
- Las vistas con el atributo `hidden` se ocultan correctamente aunque tengan estilos
  `display`, evitando que venta y administración aparezcan al mismo tiempo.
- La caché PWA sube a `cm-sales-v3` para entregar la interfaz corregida.
- El login admin comprueba inmediatamente que el navegador conservó la cookie de sesión;
  las llamadas API envían credenciales same-origin de forma explícita y un 401 obliga a
  volver a identificarse con un mensaje claro, sin afirmar que el catálogo fue guardado.
- Las sesiones admin ahora persisten en SQLite (solo se guarda SHA-256 del token) y siguen
  siendo válidas después de reiniciar el servidor o al compartir la BD entre instancias.
- La caché PWA sube a `cm-sales-v4` para distribuir estos cambios.

### No incluido en esta versión
- Edición/eliminación de ventas (prohibido por diseño).
- Restauración manual con verificación en vivo (solo drill automatizado).
- Impresión térmica Bluetooth de tickets de 53 mm u 80 mm (próxima implementación de este
  proyecto; independiente de la Epson TM usada por Gym OS).
