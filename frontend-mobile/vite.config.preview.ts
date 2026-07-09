import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Xem UI mobile với mock data — không cần backend / đăng nhập */
export default defineConfig({
  plugins: [react()],
  // Preview: mở thẳng http://localhost:5174/ (không cần /m/)
  base: '/',
  define: {
    'import.meta.env.VITE_UI_PREVIEW': JSON.stringify('true'),
  },
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    open: '/',
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
});