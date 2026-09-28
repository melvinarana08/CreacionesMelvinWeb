// receipt-image.js — modelo y render PNG de comprobantes, sin dependencias.
'use strict';

import { groupReceiptLines } from './domain.js';

const DEFAULTS = Object.freeze({
  width: 720,
  minWidth: 320,
  maxWidth: 1200,
  minHeight: 480,
  maxHeight: 10000,
  margin: 48,
  fontSize: 28,
  smallFontSize: 23,
  titleFontSize: 36,
  lineGap: 12,
  sectionGap: 22,
  maxDpr: 2,
  maxPixels: 16_000_000,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const money = (cents) => `$${(Number(cents) / 100).toFixed(2)}`;

function defaultMeasure(text, fontSize) {
  return Array.from(String(text)).reduce((width, char) => width + (char === ' ' ? .33 : .57) * fontSize, 0);
}

/** Envuelve texto sin perder caracteres, incluso cuando una sola palabra excede el ancho. */
export function wrapReceiptText(text, maxWidth, measure = defaultMeasure, fontSize = DEFAULTS.fontSize) {
  const source = String(text ?? '').trim();
  if (source === '') return [''];
  const lines = [];
  let current = '';

  const appendLongWord = (word) => {
    let segment = '';
    for (const char of Array.from(word)) {
      if (segment && measure(segment + char, fontSize) > maxWidth) {
        lines.push(segment);
        segment = char;
      } else {
        segment += char;
      }
    }
    current = segment;
  };

  for (const word of source.split(/\s+/u)) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = '';
    }
    if (measure(word, fontSize) <= maxWidth) current = word;
    else appendLongWord(word);
  }
  if (current || lines.length === 0) lines.push(current);
  return lines;
}

/** Construye comandos de dibujo deterministas a partir del modelo del comprobante. */
export function buildReceiptLayout(receipt, options = {}) {
  if (!receipt || !Array.isArray(receipt.lines)) throw new TypeError('Comprobante inválido');
  const config = { ...DEFAULTS, ...options };
  const width = clamp(Math.round(config.width), config.minWidth, config.maxWidth);
  const margin = clamp(Math.round(config.margin), 20, Math.floor(width / 4));
  const contentWidth = width - margin * 2;
  const measure = typeof options.measureText === 'function' ? options.measureText : defaultMeasure;
  const commands = [];
  let y = margin;

  const addText = (text, { size = config.fontSize, weight = '400', align = 'left', gap = config.lineGap } = {}) => {
    const lineHeight = Math.ceil(size * 1.28);
    const wrapped = wrapReceiptText(text, contentWidth, measure, size);
    for (const line of wrapped) {
      commands.push({ type: 'text', text: line, x: align === 'center' ? width / 2 : margin, y, size, weight, align });
      y += lineHeight;
    }
    y += gap;
  };
  const addRule = () => {
    commands.push({ type: 'line', x1: margin, y1: y, x2: width - margin, y2: y });
    y += config.sectionGap;
  };
  const addPair = (label, value, { strong = false } = {}) => {
    const valueWidth = Math.min(contentWidth * .42, measure(value, config.fontSize));
    const labelWidth = contentWidth - valueWidth - 18;
    const labelLines = wrapReceiptText(label, labelWidth, measure, config.fontSize);
    const lineHeight = Math.ceil(config.fontSize * 1.28);
    labelLines.forEach((line, index) => commands.push({
      type: 'text', text: line, x: margin, y: y + index * lineHeight,
      size: config.fontSize, weight: strong ? '700' : '400', align: 'left',
    }));
    commands.push({
      type: 'text', text: value, x: width - margin, y,
      size: config.fontSize, weight: strong ? '700' : '400', align: 'right',
    });
    y += Math.max(1, labelLines.length) * lineHeight + config.lineGap;
  };

  addText('Creaciones Melvin', { size: config.titleFontSize, weight: '700', align: 'center' });
  addText('COMPROBANTE DE VENTA', { weight: '700', align: 'center', gap: config.sectionGap });
  addText(receipt.folio != null ? `Folio: ${receipt.folio}` : 'Estado: Pendiente de sincronizar', { weight: '700' });
  if (receipt.savedAt) addText(`Fecha: ${receipt.savedAt}`, { size: config.smallFontSize });
  if (receipt.clientName) addText(`Cliente: ${receipt.clientName}`, { size: config.smallFontSize });
  addRule();
  addText('Producto · Cantidad # Talla', { size: config.smallFontSize, weight: '700' });

  for (const { product, items } of groupReceiptLines(receipt.lines)) {
    addText(product, { weight: '700', gap: 5 });
    for (const line of items) {
      addPair(`${line.quantity} # ${line.size} · ${money(line.unitPriceCents)} c/u`, money(line.unitPriceCents * line.quantity));
    }
  }
  addRule();
  addPair('Subtotal', money(receipt.subtotalCents));
  if (receipt.discountCents > 0) addPair('Descuento', `-${money(receipt.discountCents)}`);
  addPair('TOTAL', money(receipt.totalCents), { strong: true });
  addRule();
  addText('¡Gracias por su compra!', { weight: '700', align: 'center', gap: 4 });
  addText('Conserve este comprobante.', { size: config.smallFontSize, align: 'center' });

  const naturalHeight = Math.ceil(y + margin - config.lineGap);
  const height = clamp(naturalHeight, config.minHeight, config.maxHeight);
  const clipped = naturalHeight > height;
  const drawableBottom = height - margin;
  const boundedCommands = commands.filter((command) => {
    if (command.type === 'line') return Math.max(command.y1, command.y2) <= drawableBottom;
    return command.y + command.size <= drawableBottom;
  });
  return { width, height, contentWidth, commands: boundedCommands, clipped };
}

export function boundedReceiptDpr(width, height, requestedDpr = 1, options = {}) {
  const maxDpr = options.maxDpr ?? DEFAULTS.maxDpr;
  const maxPixels = options.maxPixels ?? DEFAULTS.maxPixels;
  const requested = clamp(Number.isFinite(requestedDpr) ? requestedDpr : 1, 1, maxDpr);
  return Math.max(1, Math.min(requested, Math.sqrt(maxPixels / Math.max(1, width * height))));
}

function browserCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Dibuja el modelo en Canvas 2D y devuelve el canvas y sus decisiones de layout. */
export function drawReceiptCanvas(receipt, options = {}) {
  const layout = buildReceiptLayout(receipt, options);
  const dpr = boundedReceiptDpr(layout.width, layout.height, options.devicePixelRatio ?? globalThis.devicePixelRatio ?? 1, options);
  const createCanvas = options.createCanvas ?? browserCanvas;
  const canvas = createCanvas(Math.ceil(layout.width * dpr), Math.ceil(layout.height * dpr));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D no disponible');
  if ('setTransform' in context) context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, layout.width, layout.height);
  context.strokeStyle = '#000000';
  context.fillStyle = '#000000';
  context.lineWidth = 2;
  context.textBaseline = 'top';
  for (const command of layout.commands) {
    if (command.type === 'line') {
      context.beginPath();
      context.moveTo(command.x1, command.y1);
      context.lineTo(command.x2, command.y2);
      context.stroke();
      continue;
    }
    context.font = `${command.weight} ${command.size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    context.textAlign = command.align;
    context.fillText(command.text, command.x, command.y);
  }
  return { canvas, layout, dpr };
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('No se pudo generar el PNG')), 'image/png');
  });
}

export function receiptImageFilename(receipt) {
  const identity = receipt?.folio != null ? `folio-${receipt.folio}` : `pendiente-${String(receipt?.id || 'local').slice(0, 12)}`;
  return `ticket-creaciones-melvin-${identity}.png`;
}

/** Genera un File PNG; File y Canvas pueden inyectarse para pruebas. */
export async function createReceiptPngFile(receipt, options = {}) {
  const { canvas, layout, dpr } = drawReceiptCanvas(receipt, options);
  const blob = options.canvasToBlob ? await options.canvasToBlob(canvas) : await canvasBlob(canvas);
  const FileImpl = options.FileImpl ?? globalThis.File;
  if (typeof FileImpl !== 'function') throw new Error('File no disponible');
  return {
    file: new FileImpl([blob], receiptImageFilename(receipt), { type: 'image/png' }),
    layout,
    dpr,
  };
}
