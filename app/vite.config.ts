import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./web', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./core', import.meta.url))
    }
  },
  build: {
    outDir: fileURLToPath(new URL('./web/dist', import.meta.url)),
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {target: 'http://127.0.0.1:4318', changeOrigin: false}
    }
  }
});
