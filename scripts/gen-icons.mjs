// gen-icons.mjs — genera iconos PNG de la PWA (192 y 512) sin dependencias.
// Uso: node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'icons');
mkdirSync(OUT, { recursive: true });

const TEAL = [15, 118, 110, 255];     // #0f766e
const TEAL_DARK = [17, 94, 89, 255];  // #115e59
const CREAM = [253, 230, 138, 255];   // #fde68a

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** Dibuja el icono: fondo teal, rectángulo crema (etiqueta) + barra oscura. */
function render(size) {
  const rows = [];
  const barTop = Math.floor(size * 0.52);
  const barH = Math.floor(size * 0.14);
  const labelH = Math.floor(size * 0.10);
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(size * 4 + 1);
    row[0] = 0; // filtro none
    for (let x = 0; x < size; x++) {
      const inBar = y >= barTop && y < barTop + barH;
      const inLabel = y >= barTop - labelH && y < barTop;
      const inLabelW = x >= Math.floor(size * 0.18) && x < Math.floor(size * 0.82);
      const c = inBar ? TEAL_DARK : inLabel && inLabelW ? CREAM : TEAL;
      row[x * 4 + 1] = c[0];
      row[x * 4 + 2] = c[1];
      row[x * 4 + 3] = c[2];
      row[x * 4 + 4] = c[3];
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  const p = path.join(OUT, `icon-${size}.png`);
  writeFileSync(p, render(size));
  console.log('generado', p, Buffer.byteLength(render(size)), 'bytes');
}
