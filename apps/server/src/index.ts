import path from 'node:path';
import { buildApp, VERSION } from './app';
import { LiftyDb } from './db';
import { lanAddresses } from './network';

export { buildApp, LiftyDb, VERSION, lanAddresses };
export { importWorkbook } from './excel';
export { exportWorkbook } from './export';

export interface StartOptions {
  /** Carpeta donde se guardan la base y las copias de seguridad. */
  dataDir: string;
  port?: number;
  /** "0.0.0.0" para aceptar al celular desde la red local. */
  host?: string;
  webDir?: string | null;
  trustLocalhost?: boolean;
  password?: string | null;
  publicUrl?: string | null;
  wasmPath?: string;
  logger?: boolean;
}

export async function startServer(opts: StartOptions) {
  const port = opts.port ?? 4321;
  const db = await LiftyDb.open(path.join(opts.dataDir, 'lifty.db'), {
    wasmPath: opts.wasmPath,
    backupDir: path.join(opts.dataDir, 'backups'),
  });
  const app = await buildApp({ ...opts, db, port });
  await app.listen({ port, host: opts.host ?? '0.0.0.0' });
  return {
    app,
    db,
    port,
    urls: { local: `http://127.0.0.1:${port}`, lan: lanAddresses().map((ip) => `http://${ip}:${port}`) },
    async close() {
      await app.close();
      db.close();
    },
  };
}
