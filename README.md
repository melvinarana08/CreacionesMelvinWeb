# Creaciones Melvin — Calculadora de Ventas (PWA)

Aplicación web móvil (PWA offline-first) para registrar ventas de ropa por talla de
**Creaciones Melvin**, con backend central propio y administración protegida.

- **Idioma:** español · **Moneda:** USD, sin impuestos
- **Stack:** Node.js ≥ 24 con módulos built-in (`http`, `node:sqlite`, `crypto`, `node:test`). **Cero dependencias.**
- **Frontend:** HTML/CSS/JS vanilla + service worker (PWA instalable), mobile-first y táctil.
- **Base de datos:** SQLite (WAL) en `data/sales.db`, volúmenes persistentes en Docker.

> ⚠️ Proyecto independiente de Gym OS. Pensado para desplegarse en un servidor propio
> (gym-node-02) con acceso restringido a LAN/Tailscale. La venta no requiere login;
> el acceso se limita en el despliegue (red), no en la app.

---

## Funcionalidades

### Venta (terminal, sin login)
- Catálogo inicial desde `productos.json` (incluye **Short**), editable por admin.
- Flujo de selección **producto → cantidad → talla explícita → agregar** (interfaz de chips,
  sin tabla horizontal). Incluye cantidades exactas de un toque **3, 6, 9 y 12**, conserva
  los controles −/+ para ajuste fino entre 1 y 99, y elegir la talla no cambia la cantidad.
  Si se intenta agregar sin talla, aparece una indicación accesible junto al selector, sin popup.
  Se puede indicar talla y precio manuales para una línea de esta venta, sin modificar el catálogo;
  junto a **Agregar** aparece una vista previa de producto, talla y cantidad. El carrito permite
  ajustar la cantidad de cada línea con −/+ y recalcula los totales.
- Cada línea guarda el precio y la talla cobrados como snapshot; las correcciones posteriores
  de ventas activas conservan el historial anterior.
- **Cliente (opcional):** campo de texto libre con teclado móvil, sugerencias inline de
  hasta ocho nombres guardados y un directorio separado donde se pueden guardar clientes
  manualmente por nombre. Las sugerencias priorizan coincidencias exactas, por prefijo y
  subcadena, y toleran errores de escritura acotados; al elegir una, se cierran los selectores sin devolver el foco
  al teclado, se anuncia el nombre y la vista baja hasta Finalizar venta. `autocomplete="off"` y un nombre específico de venta reducen falsos
  avisos de credenciales en Chrome, pero sus heurísticas no se pueden controlar por completo.
  Si queda vacío o contiene solo espacios, la app pide confirmación antes de finalizar.
- Descuento manual: no negativo y ≤ subtotal.
- Comprobante sencillo al finalizar; **el carrito solo se limpia tras guardar localmente**.
  La app genera localmente un **PNG determinista** desde los datos de la venta (no captura
  el DOM), lo prepara antes del toque y lo comparte con texto por la hoja nativa solo si
  `navigator.canShare({ files })` acepta archivos. Si no hay soporte o falla sin cancelación,
  descarga el PNG y copia el texto; sin portapapeles, lo presenta para copia manual. Una
  cancelación `AbortError` no descarga ni copia nada. Las líneas del PNG y del respaldo en
  texto agrupan todas las líneas del mismo producto bajo un solo nombre (en orden de
  primera aparición), con filas `4 # 5 · unitario · importe` sin perder nombres largos. No se suben tickets a terceros ni se elige destinatario automáticamente;
  el folio real reemplaza al estado pendiente al sincronizar.
- Cada línea muestra de forma explícita **cantidad, talla, precio unitario y total de línea**
  en el carrito, el comprobante, el detalle administrativo y el ticket térmico. El
  comprobante y la impresión usan la clave **Cantidad # Talla**: `5 # 4` significa cinco
  prendas de talla 4.
- El producto activo queda resaltado; las tallas se muestran con números de menor a mayor
  antes de las tallas de letras, y **Consultar precios** usa un control visual diferenciado.
- Impresión térmica Bluetooth ESC/POS (58 mm) desde Chrome/Edge Android: comprobante de
  venta, reimpresión administrativa y reimpresión local de ventas recientes guardadas en
  el mismo dispositivo.
- El ticket térmico de venta también agrupa por producto y conserva cada cantidad, talla,
  precio unitario e importe en filas compactas; taller y encargos mantienen su formato.
- Los tickets térmicos mantienen el ancho de 32 columnas y envuelven nombres largos sin
  perder texto en ventas, resúmenes de taller, detalles por cliente y encargos individuales.
- Las líneas del carrito, la venta guardada y el comprobante se agrupan automáticamente
  por categoría/producto, aunque se hayan seleccionado intercaladas con otras categorías.
- **Offline-first:** la venta se guarda primero en IndexedDB (cola local), el último catálogo
  válido se conserva en el dispositivo, se muestra el comprobante y luego se sincroniza.
  UUID idempotente con fallback para HTTP LAN: reenviar la misma venta no la duplica.
- Indicador en línea/sin conexión + contador de pendientes + botón de sincronización.
- Un solo botón de **Tema** recorre **Claro → Noche → E-ink** y muestra el modo activo;
  la preferencia se conserva. Noche ofrece una
  presentación oscura coloreada y legible; E-ink conserva blanco/negro, bordes sólidos,
  estados no dependientes del color, sin movimiento ni vibración. La preferencia e-ink
  anterior se migra automáticamente y la interfaz sigue honrando `prefers-reduced-motion`
  y `forced-colors` de forma independiente.
- Reimpresión no admin: el botón **Reimprimir venta** lista un número acotado de ventas
  recientes guardadas en IndexedDB en ese celular/tablet; si ya sincronizaron, imprime el
  snapshot del servidor con su folio real y, si siguen pendientes, imprime la copia local
  sin inventar un folio.
- Seguridad contra duplicados: la primera impresión no pregunta; después de una impresión
  exitosa, el mismo ticket pide confirmación clara antes de sacar otra copia. Las impresiones
  fallidas no quedan marcadas como impresas.

### Administración (protegida con contraseña)
- Menú lateral adaptable para navegar entre ventas, encargos, clientes y administración.
- Listar ventas (activas/anuladas/todas) y abrir su detalle para reimprimir el ticket
  sincronizado por Bluetooth; esta reimpresión requiere sesión administrativa.
- **Corregir** únicamente ventas finalizadas activas desde su detalle: guarda revisiones con
  fecha y snapshots anterior/posterior. Las ventas anuladas son terminales y no se editan.
- **Anular** ventas con motivo obligatorio; no se eliminan ventas.
- **Editar catálogo** con UI estructurada (tarjetas por producto y fila por talla):
  actualizar precios y agregar productos nuevos desde el panel.
- Al crear un producto se eligen tallas numéricas **1–20**, tallas en letras
  (**XS, S, M, L, XL, 2XL, 3XL, Otro**) o una talla personalizada (por ejemplo 22 o 4XL).
- Confirmación visible de guardado y actualización inmediata del catálogo de ventas.
- Auditoría de acciones administrativas.

### Datos de cada venta
UUID idempotente, folio central secuencial, timestamps cliente y servidor, subtotal,
descuento, total, cliente opcional, `deviceId`, estado (`active`/`voided`), y en anulaciones
motivo y fecha. Las correcciones de ventas activas conservan revisiones y snapshots
anteriores/posteriores en el historial administrativo (esquema SQLite v3).

---

## Requisitos

- Node.js **24+** (usa `node:sqlite`, estable en 24; funciona igual en contenedor `node:24-alpine`).
- Sin `npm install` necesario: **no hay dependencias**.

## Arranque rápido (local)

```bash
cp .env.example .env        # define ADMIN_PASSWORD (obligatorio en producción)
npm start                   # servidor en http://localhost:3000
```

Si `ADMIN_PASSWORD` no está definido, el servidor genera una contraseña temporal y la
imprime **una vez** en consola (solo desarrollo).

Pruebas y verificación:

```bash
npm test        # 70+ pruebas unitarias/integración (node:test)
npm run check   # sintaxis de todos los módulos
npm run seed    # reemplaza el catálogo de la BD desde productos.json
npm run backup  # respaldo consistente (VACUUM INTO) a backups/
```

## Docker (despliegue)

```bash
cp .env.example .env        # definir ADMIN_PASSWORD
docker compose up -d --build
```

- Usuario **no root**, `cap_drop: ALL`, `no-new-privileges: true`, `read_only` + `tmpfs`,
  volumen persistente `sales-data` para SQLite, **sin docker.sock**, healthcheck en `/api/health`.
- `compose.yaml` exige `ADMIN_PASSWORD` (error al arrancar si falta).

### Despliegue en gym-node-02
Estado confirmado el 2026-08-24: desplegado en `http://192.168.1.134:3002`, contenedor
saludable, volumen SQLite persistente y acceso limitado a LAN/subnet router. Como el
endpoint vigente es HTTP directo, usa `COOKIE_SECURE=false`; debe cambiar a `true` en la
misma ventana en que se introduzca un proxy HTTPS.

1. Copiar el repo, crear `.env` con `ADMIN_PASSWORD` fuerte (y `SELLER_TOKEN` si se desea).
2. Configuración de producción vigente: `BIND_ADDRESS=192.168.1.134` y `PORT=3002`.
3. Exponer **solo** por LAN/Tailscale (p. ej. Tailscale Serve o nftables que restrinja el puerto).
4. Detrás de un reverse proxy con HTTPS, definir `COOKIE_SECURE=true` y `TRUST_PROXY=true`.
5. `docker compose up -d --build` y verificar `curl http://192.168.1.134:3002/api/health`.

> La imagen base está **pineada por digest** OCI en el `Dockerfile`
> (`node:24-alpine@sha256:d32cdf…e1ad43`, verificado en gym-node-02) para builds
> reproducibles. Al actualizarla, verificar el nuevo digest antes de desplegar.

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP |
| `BIND_ADDRESS` | `0.0.0.0` | Dirección de escucha del servidor. En producción: `192.168.1.134` (puerto `3002`). En compose, el bind del host es `127.0.0.1` salvo que se sobrescriba. |
| `DB_PATH` | `data/sales.db` | Ruta del archivo SQLite |
| `ADMIN_PASSWORD` | *(generada)* | Contraseña de administración (≥ 8 caracteres). Se deriva a **hash scrypt al arranque**; nunca se compara en texto plano. **Nunca en el repo.** |
| `SELLER_TOKEN` | *(vacío)* | **Opcional.** Si se define, `POST /api/sales` **y** `GET /api/sales/:id` exigen cabecera `X-Seller-Token`. El frontend la pide una vez y la conserva en `localStorage`. |
| `COOKIE_SECURE` | `false` | Añade `Secure` a la cookie de sesión (usar `true` con HTTPS) |
| `TRUST_PROXY` | `false` | Respeta `X-Forwarded-For` (detrás de proxy) |

## Seguridad

- Cookie de sesión: `HttpOnly`, `SameSite=Strict`, `Secure` configurable, `Path=/`.
- **Contraseña admin**: hash **scrypt** con salt aleatorio, derivado una vez al arranque;
  el login verifica contra el hash (`timingSafeEqual`). Nunca se compara texto plano.
- **CSRF**: token por sesión (`X-CSRF-Token`) exigido en toda mutación admin
  (incluido logout) + verificación de `Origin` same-origin cuando el header viene.
- **Rate-limit** del login (5 fallos → bloqueo 60 s por IP; se resetea con login exitoso).
- **CSP estricta** (sin inline scripts), `nosniff`, `no-referrer`, `X-Frame-Options DENY`.
- Queries **parametrizadas** (node:sqlite prepared statements).
- Validación estricta en servidor y cliente; body limitado a 64 KB.
- **Audit log** en BD de acciones administrativas.
- **Sin secretos en el repo**: `.env` y `data/` están en `.gitignore`; `.env.example` sin valores reales.

## API

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| GET | `/api/health` | público | Estado del servidor |
| GET | `/api/catalog` | público | Catálogo vigente (precios en centavos) |
| POST | `/api/sales` | público (+`X-Seller-Token` si está activo) | Crear venta; **idempotente por UUID** (201 nueva, 200 replay) |
| GET | `/api/sales/:id` | público (+`X-Seller-Token` si está activo) | Consultar una venta |
| POST | `/api/admin/login` | — | Inicia sesión, devuelve `csrfToken` y cookie |
| GET | `/api/admin/session` | sesión | Estado de sesión + `csrfToken` |
| POST | `/api/admin/logout` | sesión | Cierra sesión |
| GET | `/api/admin/sales` | sesión | Lista ventas (`?status=active\|voided`, `?limit=`) |
| POST | `/api/admin/sales/:id/correct` | sesión+CSRF | Corregir venta activa con revisión esperada y clave de reintento; conserva historial |
| POST | `/api/admin/sales/:id/void` | sesión+CSRF | Anular con motivo |
| PUT | `/api/admin/catalog` | sesión+CSRF | Reemplazar catálogo (validación estricta) |
| GET | `/api/admin/audit` | sesión | Auditoría |

Errores: `{ "error": { "code": "...", "message": "..." } }` con códigos estables
(`price_changed` 409, `discount_exceeds_subtotal` 400, `csrf_failed` 403, etc.).

## Respaldo y restauración

**Respaldo** (`npm run backup` o `node scripts/backup.mjs [dir]`):
- Snapshot **consistente** con `VACUUM INTO` (incluye transacciones commiteadas, sin copiar
  archivos a medias). Genera `backups/sales-<timestamp>.db` + `.sha256`.
- Recomendado programarlo con cron: `0 2 * * * cd /ruta/app && /usr/bin/node scripts/backup.mjs`.

**Restauración**:
1. Detener el servicio (`docker compose stop`).
2. Copiar el respaldo a `data/sales.db`: `cp backups/sales-<ts>.db data/sales.db`.
3. Verificar el checksum: `sha256sum -c backups/sales-<ts>.db.sha256`.
4. Arrancar de nuevo.

> La restauración **está probada de forma automatizada** por `test/backup.test.js`, que
> ejecuta respaldo → borra el original → restaura → verifica integridad (schema, ventas,
> líneas, catálogo). El procedimiento manual de arriba es la misma operación de copia.

## CI

`.github/workflows/ci.yml`: ejecuta `npm test` y `npm run check` en Node 24 por cada push/PR.

## Estructura

```
server/        Backend (http + node:sqlite): main, app (rutas/seguridad), store,
               catalog, money, auth, db, errors
public/        PWA: index.html, styles.css, app.js, domain.js (puro y testeable),
               receipt-image.js (layout/Canvas PNG), storage.js (IndexedDB/localStorage),
               ui-interactions.js, api.js, sw.js, manifest, iconos
test/          node:test — unitarias e integración HTTP real
scripts/       seed.js, backup.mjs, gen-icons.mjs
productos.json Catálogo inicial (incluye Short)
Dockerfile / compose.yaml / .env.example / .github/workflows/ci.yml
docs/DECISIONS.md   Decisiones de diseño y por qué
CHANGELOG.md        Historial de cambios
```

## Limitaciones de esta versión (v0.1)

- El panel permite agregar, renombrar y eliminar productos y tallas, además de actualizar
  precios. `productos.json` funciona únicamente como seed inicial y no se reescribe desde el panel.
- Las ventas se crean solo desde el catálogo vigente del servidor; si un precio cambió
  entre la vista del terminal y el envío, la venta se rechaza con `409 price_changed` y
  queda marcada como conflicto en la cola local (no se pierde, requiere revisión manual).
- Las sesiones admin se conservan en SQLite hasta su expiración de 8 horas y funcionan
  entre reinicios o instancias que comparten la misma base; la BD guarda solo SHA-256 del
  token de cookie, no el token reutilizable.
- La anulación es permanente (no permite "desanular"); el historial se conserva.
- `SELLER_TOKEN` se guarda en `localStorage` (obfuscación ligera para LAN; el límite real
  de acceso es la red/Tailscale y, en su caso, HTTPS).
- Auditoría: retención ilimitada (sin poda) en esta versión.

## Próxima implementación prevista

- Evaluar si hace falta búsqueda cross-device por folio. La opción actual prioriza privacidad
  y simplicidad operativa: reimpresión local por ventas recientes del mismo dispositivo, sin
  exponer un listado público de ventas.
