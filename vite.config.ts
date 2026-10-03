import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const devMetaPlugin: Plugin = {
  name: 'beescad-dev-meta',
  configureServer(server) {
    server.middlewares.use('/healthz', (_req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify({ ok: true }));
    });
    server.middlewares.use('/version', (_req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify({ ok: true, sha: 'dev', short: 'dev', branch: 'main' }));
    });
  },
};

export default defineConfig({
  plugins: [react(), devMetaPlugin],
  build: {
    // Разделяем библиотеки и код приложения: при обновлении версии браузер
    // загружает заново только изменившуюся часть (ассеты отдаются с
    // immutable-кэшем), а разбор идёт параллельно несколькими меньшими файлами.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/three/')) return 'three';
          if (id.includes('/react') || id.includes('/scheduler/')) return 'react';
          return 'vendor';
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: true,
  },
});
