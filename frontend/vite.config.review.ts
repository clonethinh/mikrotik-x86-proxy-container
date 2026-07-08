import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Local UI review — proxy API tới router thật */
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://ntpcproxy.duckdns.org:8088',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://ntpcproxy.duckdns.org:8088',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://ntpcproxy.duckdns.org:8088',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://ntpcproxy.duckdns.org:8088',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
});