// printer.js — impresión térmica Bluetooth ESC/POS para 58 mm (MTP-II / PT-210).
// Construye comandos ESC/POS y los envía por Web Bluetooth (GATT serial).
// Cero dependencias. Compatible con Android Chrome/Edge (Web Bluetooth).
'use strict';

// ---- Constantes ESC/POS ----

const ESC = 0x1b;
const GS = 0x1d;
const INIT = [ESC, 0x40]; // ESC @ inicializar
const LF = 0x0a;
const ALIGN_LEFT = [ESC, 0x61, 0x00];
const ALIGN_CENTER = [ESC, 0x61, 0x01];
const ALIGN_RIGHT = [ESC, 0x61, 0x02];
const BOLD_ON = [ESC, 0x45, 0x01];
const BOLD_OFF = [ESC, 0x45, 0x00];
const SIZE_NORMAL = [ESC, 0x21, 0x00];
const SIZE_DOUBLE_W = [ESC, 0x21, 0x10]; // doble ancho
const SIZE_DOUBLE_H = [ESC, 0x21, 0x01]; // doble alto
const CUT = [GS, 0x56, 0x00]; // corte parcial (GS V 0)

// 58 mm → 32 columnas en fuente normal (8 pts/punto, 384 pts/línea ÷ 12 = 32)
const COLS = 32;

// ---- Servicio Bluetooth SPP (serial) ----
// La mayoría de impresoras térmicas Bluetooth exponen este servicio.
const SPP_SERVICE = 0x1101; // Serial Port Profile
const SPP_TX = 0x1101;
const SPP_RX = 0x1101;
// Fallback: algunos fabricantes usan service UUID personalizado
const PRINTER_SERVICE_UUIDS = [
  '00001101-0000-1000-8000-00805f9b34fb', // SPP estándar
  '0000ff00-0000-1000-8000-00805f9b34fb', // genérico común
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Nordic UART (algunas impresoras)
];

// ---- Construcción de comandos (puro, testeable) ----

/**
 * Codifica un texto a bytes UTF-8 con marca ESC/POS para codificación.
 * @param {string} text
 * @returns {number[]} bytes
 */
export function encodeText(text) {
  if (typeof text !== 'string') return [];
  const encoder = new TextEncoder();
  return [...encoder.encode(text)];
}

/**
 * Centra un texto recortándolo o rellenándolo con espacios a COLS columnas.
 * @param {string} text
 * @returns {string}
 */
export function centerLine(text) {
  if (typeof text !== 'string') return ' '.repeat(COLS);
  const clean = text.trim();
  if (clean.length >= COLS) return clean.slice(0, COLS);
  const pad = Math.floor((COLS - clean.length) / 2);
  return ' '.repeat(pad) + clean + ' '.repeat(COLS - pad - clean.length);
}

/**
 * Convierte un valor en centavos a string de dólares (sin símbolo).
 * @param {number} cents
 * @returns {string}
 */
export function centsToText(cents) {
  return (cents / 100).toFixed(2);
}

/**
 * Formatea una línea de producto del ticket:
 * "Producto (Talla) x3    $12.00"
 * @param {{product:string, size:(number|string), quantity:number, unitPriceCents:number, lineTotalCents:number}} line
 * @returns {string}
 */
export function formatItemLine(line) {
  if (!line || typeof line.product !== 'string' || line.product.trim() === '') return '';
  if (line.size == null || line.quantity == null || line.lineTotalCents == null) return '';
  const desc = `${line.product} (T${line.size}) x${line.quantity}`;
  const price = `$${centsToText(line.lineTotalCents)}`;
  const space = Math.max(1, COLS - desc.length - price.length);
  if (desc.length + price.length >= COLS) {
    // Si no cabe, el precio va en la siguiente línea
    return desc + '\n' + ' '.repeat(COLS - price.length) + price;
  }
  return desc + ' '.repeat(space) + price;
}

/**
 * Construye los bytes ESC/POS del ticket completo.
 * @param {{title?:string, lines:Array, subtotalCents:number, discountCents:number, totalCents:number, folio?:number, clientName?:string, date?:string}} receipt
 * @returns {Uint8Array}
 */
export function buildTicketBytes(receipt) {
  const bytes = [];
  const push = (arr) => { for (const b of arr) bytes.push(b); };

  push(INIT);
  push(ALIGN_CENTER);
  push(BOLD_ON);
  push(encodeText('Creaciones Melvin'));
  push([LF]);
  push(BOLD_OFF);
  push(SIZE_NORMAL);

  if (receipt.title) {
    push(encodeText(receipt.title));
    push([LF]);
  }

  push([LF]);
  push(ALIGN_LEFT);

  if (receipt.folio != null) {
    push(encodeText(`Folio: ${receipt.folio}`));
    push([LF]);
  }
  if (receipt.date) {
    push(encodeText(`Fecha: ${receipt.date}`));
    push([LF]);
  }
  if (receipt.clientName) {
    push(encodeText(`Cliente: ${receipt.clientName}`));
    push([LF]);
  }

  push(encodeText('-'.repeat(COLS)));
  push([LF]);

  for (const line of receipt.lines) {
    const formatted = formatItemLine(line);
    push(encodeText(formatted));
    push([LF]);
  }

  push(encodeText('-'.repeat(COLS)));
  push([LF]);

  // Subtotal
  const subLine = `Subtotal${' '.repeat(Math.max(1, COLS - 'Subtotal'.length - receipt.subtotalCents.toString().length))}$${centsToText(receipt.subtotalCents)}`;
  push(encodeText(`Subtotal$${centsToText(receipt.subtotalCents)}`.padEnd(COLS)));
  push([LF]);

  if (receipt.discountCents > 0) {
    push(encodeText(`Descuento -$${centsToText(receipt.discountCents)}`));
    push([LF]);
  }

  // Total en doble alto + negrita
  push(BOLD_ON);
  push(SIZE_DOUBLE_H);
  push(encodeText(`TOTAL: $${centsToText(receipt.totalCents)}`));
  push([LF]);
  push(SIZE_NORMAL);
  push(BOLD_OFF);

  push([LF]);
  push(ALIGN_CENTER);
  push(encodeText('Gracias por su compra'));
  push([LF]);
  push([LF]);
  push([LF]);
  push([LF]);

  push(CUT);

  return new Uint8Array(bytes);
}

// ---- Conexión Bluetooth (runtime, no testeable en Node) ----

/**
 * Estado de la conexión a la impresora.
 * @type {{device?:BluetoothDevice, characteristic?:BluetoothRemoteGATTCharacteristic, connected:boolean, name?:string}}
 */
export const printerState = {
  device: null,
  characteristic: null,
  connected: false,
  name: null,
};

/**
 * Comprueba si Web Bluetooth está disponible en este navegador.
 * @returns {boolean}
 */
export function isWebBluetoothAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth && typeof navigator.bluetooth.requestDevice === 'function';
}

/**
 * Solicita al usuario que seleccione una impresora Bluetooth y se conecta.
 * Muestra el selector nativo del navegador (Android).
 * @returns {Promise<{ok:true, name:string}|{ok:false, reason:string}>}
 */
export async function connectPrinter() {
  if (!isWebBluetoothAvailable()) {
    return { ok: false, reason: 'Web Bluetooth no está disponible en este navegador. Usa Chrome o Edge en Android.' };
  }
  try {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: PRINTER_SERVICE_UUIDS,
    });
    printerState.device = device;
    printerState.name = device.name || 'Impresora';

    const server = await device.gatt.connect();
    // Buscar el servicio SPP o el primero disponible
    let characteristic = null;
    for (const uuid of PRINTER_SERVICE_UUIDS) {
      try {
        const service = await server.getPrimaryService(uuid);
        const characteristics = await service.getCharacteristics();
        // Usar la primera característica con propiedad write
        for (const ch of characteristics) {
          if (ch.properties.write || ch.properties.writeWithoutResponse) {
            characteristic = ch;
            break;
          }
        }
        if (characteristic) break;
      } catch {
        // servicio no disponible, probar el siguiente
      }
    }

    if (!characteristic) {
      // Fallback: intentar sin filtro de servicio (algunas impresoras usan UUID personalizado)
      const services = await server.getPrimaryServices();
      for (const svc of services) {
        const chars = await svc.getCharacteristics();
        for (const ch of chars) {
          if (ch.properties.write || ch.properties.writeWithoutResponse) {
            characteristic = ch;
            break;
          }
        }
        if (characteristic) break;
      }
    }

    if (!characteristic) {
      printerState.connected = false;
      return { ok: false, reason: 'No se encontró un canal de escritura en la impresora. Verifica que sea compatible ESC/POS.' };
    }

    printerState.characteristic = characteristic;
    printerState.connected = true;

    device.addEventListener('gattserverdisconnected', () => {
      printerState.connected = false;
      printerState.characteristic = null;
    });

    return { ok: true, name: printerState.name };
  } catch (err) {
    if (err && err.name === 'NotFoundError') {
      return { ok: false, reason: 'No se seleccionó ninguna impresora.' };
    }
    return { ok: false, reason: err && err.message ? err.message : 'Error al conectar con la impresora.' };
  }
}

/**
 * Envía bytes a la impresora conectada. Reconecta si es necesario.
 * @param {Uint8Array} data
 * @returns {Promise<{ok:true}|{ok:false, reason:string}>}
 */
export async function sendToPrinter(data) {
  if (!printerState.device || !printerState.connected) {
    return { ok: false, reason: 'No hay impresora conectada.' };
  }
  try {
    const ch = printerState.characteristic;
    if (!ch) return { ok: false, reason: 'Canal de impresión no disponible.' };
    // ESC/POS: escribir en chunks pequeños (algunas impresoras limitan a 20-180 bytes por write)
    const CHUNK = 180;
    for (let i = 0; i < data.length; i += CHUNK) {
      const slice = data.slice(i, Math.min(i + CHUNK, data.length));
      if (ch.properties.writeWithoutResponse) {
        await ch.writeValueWithoutResponse(slice);
      } else {
        await ch.writeValueWithResponse(slice);
      }
    }
    return { ok: true };
  } catch (err) {
    printerState.connected = false;
    return { ok: false, reason: err && err.message ? err.message : 'Error al enviar a la impresora.' };
  }
}

/**
 * Desconecta la impresora.
 */
export function disconnectPrinter() {
  if (printerState.device && printerState.device.gatt) {
    try { printerState.device.gatt.disconnect(); } catch { /* */ }
  }
  printerState.connected = false;
  printerState.characteristic = null;
  printerState.device = null;
}

/**
 * Imprime un ticket completo: conecta (si no lo está) y envía.
 * @param {object} receipt - mismo formato que buildTicketBytes
 * @returns {Promise<{ok:true}|{ok:false, reason:string}>}
 */
export async function printReceipt(receipt) {
  if (!printerState.connected) {
    const conn = await connectPrinter();
    if (!conn.ok) return conn;
  }
  const data = buildTicketBytes(receipt);
  return sendToPrinter(data);
}
