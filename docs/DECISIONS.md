# Decisiones de diseño — Creaciones Melvin (v0.1)

Registro de las decisiones relevantes y su justificación, para revisión independiente.

## 14. Memoria operativa y workflow ligero para agentes (2026-08-28)

- **Decisión:** usar Engram como memoria operativa por proyecto (`project_name: creaciones-melvin`) y un workflow de cuatro etapas cargado bajo demanda para cambios sustanciales. Git, `docs/DECISIONS.md` y las pruebas conservan la autoridad.
- **Por qué:** recuperar decisiones, correcciones y contexto entre sesiones sin inflar el prompt fijo, manteniendo directas las tareas pequeñas y aplicando especificación/verificación proporcional únicamente cuando reduce ambigüedad.
- **Límites:** Engram no almacenará `ADMIN_PASSWORD`, `SELLER_TOKEN`, cookies, datos de ventas reales, respaldos ni evidencia sin sanear. Una memoria nunca sustituye actualizar `CHANGELOG.md`, `docs/DECISIONS.md` ni responder al usuario.
- **Reversión:** retirar `.engram/config.json` y `.hermes/skills/creaciones-change-workflow/` elimina la integración versionada sin modificar la aplicación ni su despliegue.

## 1. Stack: Node 24 con built-ins, cero dependencias
- **Decisión:** `http` + `node:sqlite` + `crypto` + `node:test`, sin `npm install`.
- **Por qué:** la app es pequeña (un terminal de ventas + admin); cero dependencias
  elimina la superficie de ataque del supply chain, acelera el arranque en contenedor y
  simplifica el mantenimiento. `node:sqlite` es estable en Node 24 (nativo, WAL, queries
  parametrizadas por diseño).
- **Costo:** funciones (auth por sesión en memoria, rate-limit) implementadas a mano,
  pero pequeñas y testeadas.

## 2. Dinero en centavos enteros, nunca flotantes
- **Decisión:** todo precio/total se almacena y calcula como entero de centavos.
- **Por qué:** evita errores de punto flotante en sumas/multiplicaciones. La conversión
  desde dólares solo ocurre en los bordes (seed, input del descuento) con `Math.round`.
- Los precios del seed (`.25/.5/.75`) son exactos en binario, y `toCents` redondea el resto.

## 3. Idempotencia de ventas por UUID del cliente
- **Decisión:** el cliente genera el UUID; `sales.id` es `PRIMARY KEY`; reenviar el mismo
  UUID devuelve la venta existente (200) sin duplicar (201 solo la primera vez).
- **Por qué:** el patrón offline-first (guardar local → sincronizar luego, con reintentos)
  requiere que reintentar sea seguro. El folio, en cambio, es **central y secuencial**
  (asignado por el servidor dentro de la transacción), porque el cliente sin conexión no
  puede saber el folio.

## 4. Precios inmutables durante la venta: validación contra catálogo vigente
- **Decisión:** el cliente envía el precio snapshot que mostró; el servidor lo compara con
  el precio vigente del catálogo. Si difieren → `409 price_changed` (el terminal refresca
  y el operador reconfirma). La línea guardada queda como snapshot inmutable.
- **Por qué:** garantiza que lo que el cliente vio es lo que se cobró, sin inventar precios
  en el servidor. El 409, y no un silencio, evita cobrar un precio distinto al mostrado.

## 5. Anulación inmutable
- **Decisión:** `voidSale` solo actualiza `status`, `void_reason`, `voided_at`. No existe
  endpoint de edición/eliminación de ventas (DELETE → 404/405).
- **Por qué:** requisito explícito; la anulación conserva el original para auditoría.

## 6. Sesiones en SQLite + CSRF token por sesión + SameSite=Strict
- **Decisión:** sesiones persistentes en SQLite (token aleatorio de 256 bits), cookie
  `HttpOnly; SameSite=Strict; Path=/` (+`Secure` configurable). La base guarda solamente
  SHA-256 del token de sesión y elimina registros expirados. Las mutaciones admin exigen
  `X-CSRF-Token` (comparación `timingSafeEqual`) y `Origin` same-origin cuando el header
  viene (curl sin Origin funciona con el token, que un navegador externo no puede leer).
- **Por qué:** `SameSite=Strict` + token CSRF + Origin cubren el caso de navegador; SQLite
  evita que un reinicio o dos instancias que comparten la BD conviertan un login válido en
  `401 Sesión requerida`. Guardar solo el hash impide reutilizar una sesión desde una copia
  de la tabla. Costo: una escritura por login/logout y limpieza perezosa de expiradas.

## 7. Rate-limit del login en memoria
- **Decisión:** 5 fallos por IP → 429 durante 60 s (clave por IP; `TRUST_PROXY` para
  `X-Forwarded-For`). Se audita cada intento (`admin.login_fail`, `admin.login_blocked`).
- **Por qué:** mitigación razonable de fuerza bruta sin infraestructura extra. El acceso
  real se limita por red (LAN/Tailscale).

## 8. SELLER_TOKEN opcional (cabecera X-Seller-Token)
- **Decisión:** si `SELLER_TOKEN` está definido, `POST /api/sales` exige la cabecera. El
  frontend la pide una vez (prompt) y la conserva en `localStorage`.
- **Por qué:** control "a nivel de cajero" para evitar que cualquier persona en la LAN
  inyecte ventas. Se documenta como **obfuscación ligera**: `localStorage` no es secreto
  robusto; el límite real es la red. Deshabilitado por defecto para no complicar el uso.

## 9. Catálogo en BD, seed desde productos.json
- **Decisión:** `products` se siembra desde `productos.json` al primer arranque; admin
  puede reemplazarlo (validación estricta). `productos.json` queda como seed versionado.
- **Por qué:** los precios cambian sin tocar código; el seed da un punto de partida y
  permite `npm run seed` para resetear.

## 10. PWA offline-first: IndexedDB como cola, SW solo para el shell
- **Decisión:** la venta se persiste en IndexedDB (`pending_sales`, clave = UUID) **antes**
  de limpiar el carrito; el comprobante se muestra con estado de sincronización. El service
  worker cachea solo el app shell (network-first para navegación); **la API nunca se
  cachea** (el offline lo cubre la cola, no una caché HTTP que podría servir datos viejos).
- **Por qué:** el requisito central es "no perder ventas"; guardar primero y sincronizar
  después con reintentos idempotentes es el patrón correcto.

## 11. Respaldo con VACUUM INTO + drill de restauración automatizado
- **Decisión:** `scripts/backup.mjs` usa `VACUUM INTO` (snapshot consistente, incluye WAL)
  + archivo `.sha256`. `test/backup.test.js` ejecuta respaldo → borrado → restauración →
  verificación (schema, ventas, líneas, catálogo).
- **Por qué:** el requisito pide no afirmar restauración probada sin ejecutarla; el drill
  automatizado la ejecuta de verdad. La restauración manual documentada es la misma copia.

## 12. Seguridad de respuestas y HTML
- **Decisión:** CSP `default-src 'self'`, sin `unsafe-inline` (JS/CSS externos, sin
  inline scripts), `nosniff`, `no-referrer`, `X-Frame-Options DENY`, `COOP same-origin`,
  body JSON ≤ 64 KB, contenido estático servido solo de una lista blanca de rutas.
- **Por qué:** controles bloqueantes razonables sin romper la simplicidad de la UI
  (rendering con `textContent` para todos los datos libres).

## 13. Docker endurecido
- **Decisión:** usuario no root, `cap_drop: ALL`, `no-new-privileges`, `read_only` +
  `tmpfs /tmp`, volumen dedicado para `data/`, healthcheck HTTP, sin docker.sock.
- **Por qué:** despliegue en servidor propio (gym-node-02) con riesgo de disponibilidad
  aceptado; minimizar el impacto si el contenedor se compromete.
