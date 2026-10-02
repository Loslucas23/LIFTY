import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LiftyDb } from './db';
import { importWorkbook } from './excel';

/** Uso: npm run import-excel -- ruta/a/finanzas.xlsm */
const file = process.argv[2];
if (!file) {
  console.error('Uso: npm run import-excel -- ruta/a/finanzas.xlsm');
  process.exit(1);
}
async function main(file: string) {
  const dataDir = process.env.LIFTY_DATA_DIR ?? path.join(os.homedir(), '.lifty');
  const result = await importWorkbook(fs.readFileSync(path.resolve(file)));
  const db = await LiftyDb.open(path.join(dataDir, 'lifty.db'), { backupDir: path.join(dataDir, 'backups') });
  const current = db.changesSince(0).find((r) => r.entity === 'settings' && r.id === 'main')?.record ?? {};
  const updatedAt = new Date().toISOString();
  db.applyMutations([
    ...result.records.map((r) => ({ entity: r.entity, op: 'upsert' as const, id: r.record.id, updatedAt, record: r.record })),
    { entity: 'settings', op: 'upsert', id: 'main', updatedAt, record: { ...current, ...result.settings } },
  ]);
  db.close();
  for (const s of result.summary) console.log(`  ${s.label}: ${s.count}`);
  for (const w of result.warnings) console.log(`  ⚠ ${w}`);
  console.log(`\nListo. Datos en ${dataDir}`);
}

main(file).catch((err) => {
  console.error(err);
  process.exit(1);
});
