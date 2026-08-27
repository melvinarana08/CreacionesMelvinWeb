// seed.js — reemplaza el catálogo de la base con productos.json.
// Uso: node scripts/seed.js [rutaJson]   (default: productos.json)
// Peligro: SOBRESCRIBE el catálogo actual. Las ventas guardadas no se tocan.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { replaceCatalog } from '../server/store.js';
import { loadSeed } from '../server/catalog.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const dbPath = path.resolve(ROOT, process.env.DB_PATH || 'data/sales.db');
const jsonPath = path.resolve(ROOT, process.argv[2] || 'productos.json');

const db = openDb(dbPath);
const catalog = loadSeed(jsonPath);
const clean = replaceCatalog(db, catalog);
console.log(`Catálogo actualizado en ${dbPath}: ${clean.length} productos, ${clean.reduce((a, p) => a + p.sizes.length, 0)} tallas.`);
db.close();
