import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Xem UI local — mock data, không cần backend / đăng nhập */
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_UI_PREVIEW': JSON.stringify('true'),
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
});