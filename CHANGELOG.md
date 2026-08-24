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
- **Documentación**: README completo, `docs/DECISIONS.md`, este changelog.
- **Restore drill automatizado** (`test/backup.test.js`): respaldo → borrado →
  restauración → verificación de integridad.

### Cambiado
- Reemplazada la app estática anterior (HTML/CSS/JS + productos.json) por la PWA con backend.

### No incluido en esta versión
- Despliegue real en servidor (pendiente; autorizado para gym-node-02, riesgo aceptado).
- Edición/eliminación de ventas (prohibido por diseño).
- Restauración manual con verificación en vivo (solo drill automatizado).
