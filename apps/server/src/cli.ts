import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './index';

/**
 * Servidor de Lifty por línea de comandos (desarrollo, Docker o una compu siempre prendida).
 *
 * Variables de entorno:
 *   LIFTY_DATA_DIR     carpeta de datos (por defecto ~/.lifty)
 *   PORT               puerto (por defecto 4321)
 *   HOST               interfaz (por defecto 0.0.0.0)
 *   LIFTY_PASSWORD     permite entrar con contraseña desde otros dispositivos
 *   LIFTY_PUBLIC_URL   URL pública para los códigos QR (Tailscale, dominio...)
 *   LIFTY_TRUST_LOCALHOST=1  esta misma compu entra sin vincular
 *   LIFTY_WEB_DIR      carpeta de la app web compilada
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [process.env.LIFTY_WEB_DIR, path.join(here, 'web'), path.join(here, '../../web/dist')].filter(
  Boolean,
) as string[];
const webDir = candidates.find((d) => fs.existsSync(path.join(d, 'index.html'))) ?? null;
const wasm = path.join(here, 'sql-wasm.wasm');

async function main() {
  const dataDir = process.env.LIFTY_DATA_DIR ?? path.join(os.homedir(), '.lifty');
  const server = await startServer({
    dataDir,
    port: Number(process.env.PORT ?? 4321),
    host: process.env.HOST ?? '0.0.0.0',
    webDir,
    trustLocalhost: process.env.LIFTY_TRUST_LOCALHOST === '1',
    password: process.env.LIFTY_PASSWORD || null,
    publicUrl: process.env.LIFTY_PUBLIC_URL || null,
    wasmPath: fs.existsSync(wasm) ? wasm : undefined,
  });

  console.log(`\n  Lifty está corriendo`);
  console.log(`  · En esta compu:   ${server.urls.local}`);
  for (const url of server.urls.lan) console.log(`  · En la red local: ${url}`);
  console.log(`  · Datos en:        ${dataDir}`);
  if (!webDir) console.log(`  (La app web no está compilada: usá "npm run dev" o "npm run build")`);
  console.log('');

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      await server.close();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
