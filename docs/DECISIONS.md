# Decisiones de diseño — Creaciones Melvin (v0.1)

Registro de las decisiones relevantes y su justificación, para revisión independiente.

## 20. Alcance del POS y correcciones auditadas

- **Venta:** talla y precio manuales valen solo para la línea de la venta actual, sin alterar
  el catálogo. La vista previa junto a Agregar y el ajuste de cantidades en el carrito
  muestran y recalculan lo que se cobrará.
- **Corrección:** solo una venta finalizada activa se puede corregir desde administración;
  se exige sesión y CSRF, revisión esperada y clave de reintento. El esquema v3 conserva
  snapshots anterior/posterior por revisión. Una venta anulada permanece terminal.
- **Clientes y navegación:** alta manual de nombres guardados y sugerencias tolerantes a
  errores acotados sin dependencias nuevas; teléfono y dirección quedan fuera por ahora.
  Un menú lateral adaptable reúne las vistas y un único botón recorre Claro → Noche → E-ink.
- **Motivo:** mejorar la operación sin cambiar el catálogo por excepciones de caja ni
  perder la trazabilidad de correcciones.

## 19. Presentación agrupada de tickets y continuidad móvil

- **Venta:** agrupar todas las líneas de un mismo producto solo al renderizar el ticket
  térmico, PNG o texto, en orden de primera aparición. Cada línea conserva cantidad,
  talla, precio unitario e importe; no se consolidan tallas ni se recalculan snapshots.
  Si una fila excede las 32 columnas térmicas, se divide sin truncar información.
  Taller y encargos conservan sus propios formatos; API, cálculos y persistencia no cambian.
- **Selección:** atajos 3/6/9/12, ajuste −/+ entre 1 y 99 y guía inline accesible al
  intentar agregar sin talla. Confirmar un cliente cierra las sugerencias y el diálogo,
  anuncia el nombre sin enfocar inputs y desplaza al botón Finalizar venta. El nombre sigue
  siendo texto libre opcional.
- **Distribución:** incrementar en conjunto la caché del SW y la versión visible a v21.

## 17. Compartir tickets mediante PNG y capacidades del sistema (2026-09-25)

- **Decisión:** generar un PNG determinista desde el modelo de venta con Canvas 2D, sin
  capturar el DOM ni incorporar dependencias. La imagen usa tipografías del sistema,
  blanco/negro, ajuste de texto y límites de ancho, alto, DPR y memoria. Se prepara cuando
  aparece el comprobante y se regenera si el estado pendiente recibe su folio real.
- **Entrega y respaldo:** la acción sigue iniciada por el usuario. La app consulta
  `navigator.canShare({ files: [file] })` antes de compartir PNG + texto por Web Share.
  Sin soporte o ante un fallo no cancelado, descarga el PNG mediante una URL temporal y
  copia el texto; si el portapapeles no está disponible, ofrece copia manual. Una
  cancelación `AbortError` no provoca descargas, copias ni diálogos.
- **Orden legible (formato previo):** las líneas del PNG y del respaldo en texto presentan primero el nombre
  completo del producto y luego cantidad/talla (`Camisa · 4 # 5`). El ajuste conserva los
  nombres largos; la decisión 19 reemplaza la presentación de tickets de venta.
- **Identidad y privacidad:** un ticket pendiente se identifica como pendiente y nunca
  inventa un folio. La imagen se genera en el dispositivo; no se sube a un servicio, la app
  no elige destinatarios ni comparte en segundo plano, y el usuario confirma el destino.

## 18. Temas y controles móviles explícitos (2026-09-25)

- **Temas (control anterior; reemplazado por el botón de la decisión 20):** un selector nativo visible persiste `cm_theme` como `light|dark|eink` y refleja
  `cm_eink_mode` para permitir rollback. Una clave nueva válida tiene prioridad. Solo cuando
  `cm_theme` no existe, el legado `cm_eink_mode=true` migra a E-ink; si tampoco es `true`,
  cae en Claro. Una clave nueva presente pero inválida, o almacenamiento inaccesible, cae en
  Claro sin activar la migración. Noche conserva color, movimiento y háptica; solo E-ink aplica `.eink-mode`, blanco/negro,
  bordes fuertes y ausencia de sombras, transparencias, movimiento y vibración.
- **Clientes:** el campo principal sigue siendo texto libre y opcional. Al recibir foco o
  toque muestra hasta ocho nombres recientes de la fuente local/servidor, filtrados por
  subcadena, como botones de 44 px; el diálogo completo permanece para listas mayores.
  Escape, selección, foco exterior o puntero exterior cierran la región sin perder el toque.
- **Credenciales:** `autocomplete="off"` y `sale-customer-display-name` reducen que Chrome
  confunda el cliente con un usuario. La contraseña admin vive en un formulario explícito
  y conserva `current-password`. Estas pistas son heurísticas y no garantizan obediencia del
  navegador; se descartan señuelos ocultos, `new-password`, `readonly` y atributos privados.
- **Accesibilidad:** `prefers-reduced-motion` y `forced-colors` se atienden por separado. El
  control de tema, las sugerencias y los controles implicados mantienen 44 px como mínimo.

## 15. Navegación: salir de administración regresa a la venta (2026-08-28)

- **Decisión:** el botón **Salir** del panel admin cierra la sesión y regresa a la vista de
  venta (panel principal). La pantalla de login de administración incluye un botón
  **Volver a ventas**. La consulta de precios es pública desde la vista de venta
  (**Consultar Precios**), sin necesidad de login.
- **Por qué:** el terminal de venta es la pantalla principal de la app; el panel admin es
  una vista temporal. Un logout que deja al operador en el login sin salida visible se
  percibe como un callejón sin retorno. Consultar precios es una operación de solo lectura
  que no debe exigir credenciales ni interrumpir la venta.
- **Reversión:** volver a llamar `showAdminLogin()` tras el logout restaura el
  comportamiento anterior; quitar el botón de precios no afecta al backend.

## 16. Impresión térmica Bluetooth ESC/POS de 58 mm (2026-08-29)

- **Decisión:** el comprobante de venta incluye un botón **Imprimir ticket** que usa
  **Web Bluetooth API** (`navigator.bluetooth`) para conectar la impresora térmica
  MTP-II / PT-210 (ESC/POS, 58 mm, 384 puntos/línea) desde el navegador del celular
  (Chrome/Edge Android). El módulo `public/printer.js` separa la construcción de comandos
  ESC/POS (puro, testeable) de la conexión GATT (runtime del navegador).
- **Por qué:** el terminal de venta es una PWA en Android; Web Bluetooth es el camino
  nativo sin dependencias ni app adicional. ESC/POS es el lenguaje estándar de esta
  familia de impresoras (manual confirma compatibilidad). Separar la lógica pura permite
  testear el formato del ticket sin hardware.
- **Límites:** Web Bluetooth requiere HTTPS (o localhost) y gesto del usuario (clic);
  no funciona en iOS (Apple no soporta Web Bluetooth). El PIN `0000` se gestiona en el
  emparejamiento del sistema, no en la app. Si la impresora no responde, el usuario ve
  un mensaje de error pero la venta ya está guardada (offline-first).
- **Reversión:** quitar `printer.js`, el botón `printReceiptBtn` y su import; el resto
  de la app no se ve afectada.

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
  el precio vigente del catálogo, salvo una línea manual explícita de la decisión 20.
  Si difieren → `409 price_changed` (el terminal refresca y el operador reconfirma).
  El snapshot inicial se conserva en el historial si luego se corrige la venta.
- **Por qué:** garantiza que lo que el cliente vio es lo que se cobró, sin inventar precios
  en el servidor. El 409, y no un silencio, evita cobrar un precio distinto al mostrado.

## 5. Anulación inmutable
- **Decisión inicial:** `voidSale` solo actualiza `status`, `void_reason`, `voided_at`.
  En v0.1 no existía endpoint de edición/eliminación; la decisión 20 permite corregir
  ventas activas con historial, no editar anuladas ni eliminar ventas.
- **Por qué:** la anulación es terminal y el historial de correcciones conserva la auditoría.

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
