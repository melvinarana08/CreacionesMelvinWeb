// backup.mjs — respaldo consistente de SQLite mediante VACUUM INTO.
// VACUUM INTO produce un snapshot consistente del archivo principal
// (incluye WAL), sin bloquear escrituras de forma apreciable.
// Uso: node scripts/backup.mjs [directorioDestino]   (default: backups/)
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Ejecuta un respaldo consistente de la base SQLite.
 * @param {object} opts
 * @param {string} opts.dbPath    Ruta del archivo SQLite en producción
 * @param {string} [opts.destDir] Carpeta destino (default: <repo>/backups)
 * @returns {{backupPath:string, sha256Path:string, sales:number, bytes:number}}
 */
export function runBackup({ dbPath, destDir }) {
  if (!dbPath) throw new Error('dbPath es obligatorio');
  const absDb = path.resolve(dbPath);
  if (!statSync(absDb, { throwIfNoEntry: false })) {
    throw new Error(`No existe la base de datos: ${absDb}`);
  }

  const targetDir = path.resolve(destDir || path.join(ROOT, 'backups'));
  mkdirSync(targetDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(targetDir, `sales-${stamp}.db`);
  const sqlPath = backupPath.replace(/\\/g, '/');

  // Snapshot consistente; la conexión se cierra inmediatamente.
  const db = new DatabaseSync(absDb);
  try {
    db.exec(`VACUUM INTO '${sqlPath}'`);
  } finally {
    db.close();
  }

  // Metadatos + checksum para verificación de integridad
  const bytes = statSync(backupPath).size;
  const hash = createHash('sha256').update(readFileSync(backupPath)).digest('hex');
  const sha256Path = backupPath + '.sha256';
  writeFileSync(sha256Path, `${hash}  ${path.basename(backupPath)}\n`);

  // Cuenta de ventas para el registro del operador (conexión de solo lectura)
  let sales = 0;
  try {
    const check = new DatabaseSync(backupPath, { readOnly: true });
    try {
      const row = check.prepare('SELECT COUNT(*) AS n FROM sales').get();
      sales = row ? row.n : 0;
    } finally {
      check.close();
    }
  } catch {
    sales = 0;
  }

  return { backupPath, sha256Path, sales, bytes };
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dbPath = process.env.DB_PATH || path.join(ROOT, 'data', 'sales.db');
  const destDir = process.argv[2] || path.join(ROOT, 'backups');
  try {
    const r = runBackup({ dbPath, destDir });
    console.log(`Respaldo creado: ${r.backupPath}`);
    console.log(`Ventas en el respaldo: ${r.sales} · ${r.bytes} bytes`);
    console.log(`Checksum: ${path.basename(r.sha256Path)}`);
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
}
