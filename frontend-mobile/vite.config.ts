import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function apiTarget(env: Record<string, string>): string {
  const raw = env.VITE_DEV_API_TARGET?.trim() || 'http://127.0.0.1:8088';
  return raw.replace(/\/$/, '');
}

function redirectRootToBase(base: string): Plugin {
  const target = base.endsWith('/') ? base : `${base}/`;
  return {
    name: 'redirect-root-to-base',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (url === '/' || url === '') {
          const q = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
          res.writeHead(302, { Location: `${target}${q}` });
          res.end();
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = apiTarget(env);
  const wsTarget = target.replace(/^http/, 'ws');
  const base = '/m/';

  return {
    plugins: [react(), redirectRootToBase(base)],
    base,
    server: {
      host: true,
      port: Number(env.VITE_DEV_PORT) || 5174,
      open: '/m/',
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/ws': {
          target: wsTarget,
          ws: true,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      target: 'es2022',
    },
  };
});