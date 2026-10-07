import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Identifica cada compilación: si el celular tiene una vieja, la app avisa que hay una nueva. */
const BUILD_ID = new Date().toISOString();

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'lifty-version',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
      },
    },
  ],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  // Rutas relativas: la app funciona servida desde el servidor, Electron o cualquier carpeta.
  base: './',
  server: {
    host: true,
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:4321' },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 800 },
});
