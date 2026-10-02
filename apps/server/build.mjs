// Empaqueta el servidor en un solo archivo (sin node_modules) + el wasm de SQLite.
import { build } from 'esbuild';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
fs.mkdirSync('dist', { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'warning',
  // import.meta.url no existe en CommonJS: lo reemplazamos por el equivalente.
  define: { 'import.meta.url': 'importMetaUrl' },
  banner: { js: "const importMetaUrl = require('url').pathToFileURL(__filename).href;" },
};

await build({ ...common, entryPoints: ['src/cli.ts'], outfile: 'dist/lifty-server.cjs' });
await build({ ...common, entryPoints: ['src/index.ts'], outfile: 'dist/lifty-lib.cjs' });

fs.copyFileSync(path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm'), 'dist/sql-wasm.wasm');
const web = path.resolve('../web/dist');
if (fs.existsSync(web)) fs.cpSync(web, 'dist/web', { recursive: true });
console.log('Servidor empaquetado en apps/server/dist');
