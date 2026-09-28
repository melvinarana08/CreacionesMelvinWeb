# Changelog

Todas las fechas en hora local del autor. Formato inspirado en [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Ajustes de tickets y venta
- Los tickets de venta térmicos, PNG y de texto agrupan productos intercalados en orden de primera aparición, con nombre único y cada fila de cantidad/talla, unitario e importe conservada. No cambia el formato de taller/encargos ni los datos guardados.
- Atajos de cantidad 3, 6, 9 y 12; −/+ mantienen el rango 1–99. Intentar agregar sin talla muestra una guía inline accesible junto al selector.
- Confirmar un cliente cierra selector/sugerencias sin volver a enfocar el teclado, anuncia el nombre y desplaza hacia Finalizar venta; el campo sigue siendo libre y opcional.
- Caché del frontend actualizada a `cm-sales-v21` y regresiones ejecutables para los tres tickets y los controles.

### Añadido
- **Selector de tema Claro/Noche/E-ink**: persiste una única preferencia `light|dark|eink`, migra el legado e-ink, actualiza el color del navegador y mantiene Noche coloreado e independiente de las restricciones monocromas, hápticas y de movimiento de E-ink.
- **Clientes recientes inline**: foco o toque en el cliente opcional muestra hasta ocho nombres recientes como botones táctiles, con filtro por subcadena, selección anunciada y cierres seguros por Escape, foco o interacción exterior; el directorio completo sigue disponible.
- **Ticket visual PNG sin dependencias**: el comprobante se compone de forma determinista desde el modelo de venta y se dibuja con Canvas 2D en blanco y negro, con texto Unicode, nombres largos, tallas personalizadas, cantidades hasta 99, alto dinámico y límites de tamaño/DPR.
- **Compartir imagen primero con respaldo privado**: el PNG se prepara antes del toque y solo se entrega a Web Share cuando `navigator.canShare({ files })` lo admite. Sin soporte o ante un fallo no cancelado, se descarga la imagen y se copia el texto; sin portapapeles se ofrece copia manual. `AbortError` no dispara descarga, copia ni diálogo.
- **Cantidades rápidas anteriores 1, 3, 5 y 12**: selección de un toque, además de −/+ y el límite existente de 1–99; elegir talla no modifica la cantidad.
- **Modo e-ink persistido**: control visible con blanco/negro, bordes sólidos, estados no dependientes del color y movimiento desactivado; también se respetan reducción de movimiento y colores forzados del sistema.
- **Cliente opcional optimizado para móvil**: semántica de nombre, ayuda breve, búsqueda separada de clientes guardados, objetivos táctiles de 44 px, anuncio accesible de la selección (sin retorno de foco tras confirmar).
- **Flujo de venta cantidad primero**: la selección sigue producto → cantidad → talla explícita → agregar, y elegir una talla conserva la cantidad indicada.
- **Confirmación de venta anónima**: finalizar con el cliente vacío o compuesto solo por espacios exige confirmación; cancelar conserva el carrito y no guarda ni sincroniza la venta.
- **Compartir ticket digital**: el comprobante terminado abre la hoja nativa de Web Share (con WhatsApp como posible destino del sistema) y, si no está disponible o falla sin cancelación del usuario, copia el texto para compartirlo manualmente; sin API de portapapeles, lo presenta para copia manual. Los tickets pendientes se identifican como tales y los sincronizados usan su folio real.
- **Módulo `public/ui-interactions.js`**: concentra y permite probar las interacciones de selección de talla y el flujo Web Share/portapapeles.
- **Reimpresión local para vendedores sin admin**: botón *Reimprimir venta* en ventas, con diálogo de ventas recientes guardadas en el dispositivo. Imprime el snapshot del servidor cuando existe y la copia local cuando aún está pendiente de sincronizar.
- **Seguridad contra duplicados de impresión**: después de una impresión exitosa, el mismo ticket pide confirmación antes de imprimir otra copia; los controles se bloquean mientras la impresión está en curso.
- **Módulo de Encargos (Pedidos a futuro) y Gestión de Taller**:
  - **Navegación principal de cabecera**: selector rápido entre *🛒 Ventas* y *📦 Encargos* con insignia numérica de pedidos pendientes.
  - **Toma de pedidos ágil**: botón *"📦 Guardar como Encargo"* integrado directamente en el carrito móvil de venta para registrar prendas y tallas sin duplicar pantallas.
  - **Modo Encargo**: soporte para notas especiales (ej. "Para el viernes / tela azul"), folio secuencial asignado y vinculación automática con el cliente.
  - **Resumen consolidado de taller**: pestaña *🧵 Resumen de Taller* con agrupación automática por prenda y desglose ordenado por tallas para corte, costura y alistado.
  - **Ticket térmico físico para taller (58 mm Bluetooth)**: comando de impresión de hoja de ruta con casillas de verificación `[ ]` tanto para el consolidado de confección como para el desglose por cliente.
  - **Conversión de encargo a venta en 1 toque**: al entregar pedidos en la siguiente ruta semanal, *"🛒 Convertir a Venta"* carga todas las prendas al carrito, permitiendo ajustes rápidos y cerrando el encargo como entregado al cobrar.
  - **Directorio y selector táctil de clientes**:
    - Memoria local (`cm_clients`) y tabla SQLite (`clients`) para recordar clientes frecuentes.
    - Campo principal con autocompletado semántico de nombre y botón **Elegir cliente guardado** con diálogo de búsqueda y chips táctiles; el selector propio es autoritativo y evita el `datalist` duplicado en móviles.
  - **Migración de esquema SQLite a versión 2**: tablas `clients`, `encargos` y `encargo_items` con soporte de migración automática sin pérdida de datos.
  - **Caché PWA actualizada a `cm-sales-v15`** para propagación instantánea a dispositivos móviles.
- **Prevención de solapamiento en botón "Finalizar venta"**: la barra flotante móvil (`#mobileCartBar`) ahora se oculta de forma dinámica e instantánea con `IntersectionObserver` cuando el botón *"Finalizar venta"* entra en el campo de visión del usuario, evitando cualquier interferencia táctil al momento de cobrar. Si el usuario sube a revisar productos, la barra reaparece automáticamente.
- **Margen inferior ampliado en `#cartSection` y `body`**: mayor separación física contra el footer para garantizar que *"Finalizar venta"* tenga espacio libre completo y nunca se corte ni quede tapado.
- **Caché PWA actualizada a `cm-sales-v14`** para actualización inmediata en todos los celulares y tablets conectados.
- **Edición completa del catálogo en administración**:
  - **Borrado de productos**: botón *"🗑️ Borrar"* por producto con confirmación segura para eliminar prendas creadas por error.
  - **Renombrado de productos**: botón *"✏️ Renombrar"* para corregir nombres de productos directamente en la interfaz.
  - **Gestión individual de tallas**: botón *"✕"* en cada fila de talla para quitar tallas no deseadas (garantizando que el producto conserve al menos una talla).
  - **Agregar talla a producto existente**: botón *"+ Talla"* en cada tarjeta de producto para incorporar tallas adicionales fácilmente.
- **Rediseño del ticket térmico ESC/POS (58 mm)**:
  - Nueva función de alineación a 2 columnas `formatTwoCols` para alinear limpiamente subtotales, descuentos y total a la derecha.
  - Título `Creaciones Melvin` centrado y en doble ancho (`SIZE_DOUBLE_W` + `BOLD_ON`).
  - Cabecera de columnas `DESCRIPCION` y `TOTAL` con separadores estructurados.
  - Resumen explícito de volumen: `Prendas vendidas: N` antes de los totales monetarios.
  - Cierre con `¡Gracias por su compra!` y `Conserve este comprobante`.
- **Layout adaptativo para tablets y pantallas medianas (≥ 768px)**: diseño de 2 columnas estilo estación POS de mostrador, manteniendo el catálogo y selector a la izquierda y el carrito con totales anclado de forma fija (*sticky*) a la derecha.
- **Barra flotante inferior en celulares**: resumen rápido visible cuando hay prendas en el carrito, con contador de prendas, monto total y botón de desplazamiento suave directo al cobro.
- **Micro-interacciones y ergonomía táctil**: zonas de toque mínimas de 48×48px en selector de cantidad, vibración háptica sutil en dispositivos compatibles y animación visual de pulso al agregar prendas al carrito.
- **Reset automático de cantidad a 1** tras presionar *Agregar*, evitando compras accidentales con cantidades previas.
- **Auto-selección en campo de descuento**: enfocar el input de descuento selecciona todo el texto para escribir un nuevo monto sin borrar dígito a dígito en teclado móvil.
- **Alternar visibilidad de contraseña**: botón con icono (ojo) para mostrar u ocultar la clave en el login de administración.
- Memoria operativa por proyecto con Engram: `.engram/config.json` fija la identidad `creaciones-melvin` para consultas, decisiones y contexto recuperable entre sesiones.
- Workflow de agentes `creaciones-change-workflow` (`.hermes/skills/`): routing orgánico y cuatro etapas (propuesta, contrato, tareas/implementación, verificación/cierre) con carga bajo demanda. Inspirado en Organic Routing y SDD de Gentle AI; no incorpora la persona, RDD ni el orquestador completo.
- Regla documentada en `docs/DECISIONS.md`: Git, decisiones y pruebas siguen siendo la fuente durable; Engram no guarda secretos, `.env` reales ni datos de ventas.
- Botón **Consultar Precios** en la vista de venta (reemplaza al obsoleto "Actualizar precios"): abre un diálogo con la lista de precios vigentes y un filtro sencillo por producto o "Todos los productos". Refresca el catálogo desde el servidor cuando hay conexión; sin conexión muestra la caché local.
- Botón **Volver a ventas** en la pantalla de login de administración, para salir del login sin recargar la página.
- **Impresión térmica Bluetooth de tickets (58 mm ESC/POS)**: botón "Imprimir ticket" en el comprobante de venta. Usa Web Bluetooth API (Chrome/Edge Android) para conectar la impresora (MTP-II / PT-210) y enviar comandos ESC/POS directamente. Módulo `public/printer.js` con funciones puras testeables (`encodeText`, `formatItemLine`, `buildTicketBytes`) y conexión GATT.
- **Diálogo de detalle de venta en administración**: botón "Ver" en cada venta abre un diálogo con el detalle completo (folio, fecha, cliente, líneas, totales) y un botón "🖨️ Reimprimir" que reimprime el ticket por Bluetooth. Las ventas anuladas muestran el motivo pero no permiten anular de nuevo.
- **Web Bluetooth requiere HTTPS**: `isWebBluetoothAvailable` verifica `window.isSecureContext` y el mensaje de error guía a la URL HTTPS de Tailscale Serve (`gym-node-02.tail4a98b6.ts.net`), que es el secure context necesario.

### Cambiado
- **Compartir con producto primero (formato anterior)**: las líneas del PNG y del respaldo en texto usaban `Producto · Cantidad # Talla`; el nuevo formato de venta agrupa bajo una cabecera única.
- **Mitigación de autocompletado de credenciales**: el cliente opcional usa `autocomplete="off"` y un nombre específico de venta; el password admin queda dentro de un formulario de login con `current-password`. Son indicaciones estándar y no garantizan que Chrome ignore sus propias heurísticas.
- **Formato térmico sin pérdida**: los nombres largos se envuelven dentro de las 32 columnas en tickets de venta, resúmenes de taller, detalles por cliente y encargos individuales.
- **Caché PWA `cm-sales-v20`**: distribuye de forma alineada los tres temas, el orden de compartición y las sugerencias inline dentro del shell offline.

### Corregido
- `createSale` devuelve una venta existente por UUID antes de revalidar precios contra el catálogo vigente, para que un replay idempotente siga funcionando tras cambios de precio.
- El historial de encargos entregados usa la clase `.encargo-card.delivered`, alineada con el CSS existente.
- La documentación ya no presenta la impresión térmica Bluetooth como pendiente; ahora describe la implementación actual.
- El producto seleccionado ahora queda resaltado y anuncia su estado con `aria-pressed`.
- Dentro de cada producto, las tallas numéricas se ordenan de menor a mayor y aparecen antes
  que las tallas de letras, sin mutar el carrito original.
- **Consultar precios** usa un botón rectangular con icono y estilo propio para no confundirse
  con los botones redondos de productos.
- El ticket térmico separa el prefijo de las tallas de letras (`T M` en vez de `TM`).
- Carrito, comprobante, detalle administrativo y ticket térmico muestran explícitamente el
  precio unitario (`c/u`) además del total de cada línea.
- Al pulsar **Salir** en el panel de administración, la sesión se cierra y la app regresa al panel principal de venta. Antes quedaba atrapada en la pantalla de login del admin, sin forma de volver a la venta.
- La caché PWA sube a `cm-sales-v5` para distribuir los cambios del frontend (el service worker es cache-first para los assets; sin el bump, los clientes ejecutan el `app.js` anterior).
- La caché PWA sube a `cm-sales-v6` para distribuir el módulo de impresión y el botón del comprobante.
- La caché PWA sube a `cm-sales-v10` para distribuir la presentación explícita del precio unitario.
- La caché PWA sube a `cm-sales-v11` para distribuir las mejoras de selección, orden y presentación.

### Compatibilidad de datos
- No se modificaron los contratos de API, el esquema SQLite ni el catálogo persistido. El ajuste de backend se limita a conservar la idempotencia de reintentos por UUID frente a cambios posteriores de precio.

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
