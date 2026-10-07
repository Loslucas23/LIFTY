// Empaqueta el proceso principal + el servidor de Lifty en un solo archivo, y copia la app web.
import { build } from 'esbuild';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.cjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron'],
  logLevel: 'warning',
});

fs.copyFileSync(path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm'), 'dist/sql-wasm.wasm');
const web = path.resolve('../web/dist');
if (!fs.existsSync(path.join(web, 'index.html'))) {
  console.error('Falta compilar la app web: npm run build -w @lifty/web');
  process.exit(1);
}
fs.cpSync(web, 'dist/web', { recursive: true });
fs.copyFileSync('build/icon.png', 'dist/icon.png');
console.log('Escritorio empaquetado en apps/desktop/dist');
