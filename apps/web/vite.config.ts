import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Rutas relativas: la app funciona servida desde el servidor, Electron o cualquier carpeta.
  base: './',
  server: {
    host: true,
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:4321' },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 800 },
});
