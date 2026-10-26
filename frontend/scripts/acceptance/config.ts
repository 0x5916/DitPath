import { defineConfig, mergeConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import app from '../../vite.config.ts';
import { acceptanceTransform } from './faults.ts';

export default defineConfig(({ command }) => {
  if (command !== 'serve') throw new Error('Acceptance fixtures are development-only');
  if (process.env.PUBLIC_API_BASE !== 'http://127.0.0.1:4174/v1')
    throw new Error('Use npm run acceptance to isolate the API');
  return mergeConfig(app, {
    server: {
      host: '127.0.0.1',
      port: 4174,
      strictPort: true,
      fs: { allow: [fileURLToPath(new URL('.', import.meta.url))] }
    },
    plugins: [
      {
        name: 'ditpath-acceptance',
        enforce: 'pre',
        transform: acceptanceTransform,
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url?.startsWith('/v1/')) {
              res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '60' });
              res.end(JSON.stringify({ error: 'Synthetic API unavailable' }));
            } else if (req.url === '/__acceptance') {
              res.setHeader('Content-Type', 'text/html');
              res.end(
                '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>DitPath acceptance</title><body><main><h1>DitPath acceptance</h1><p>Synthetic data only. Selecting a scenario replaces this test database. Close other acceptance tabs first. API requests stay on this local server and return 503.</p><div id="scenarios"></div><p role="status" id="status"></p></main><script type="module" src="/scripts/acceptance/client.ts"></script></body></html>'
              );
            } else next();
          });
        }
      } satisfies Plugin
    ]
  });
});
