import { spawn } from 'node:child_process';

const child = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--config', 'scripts/acceptance/config.ts'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      PUBLIC_API_BASE: 'http://127.0.0.1:4174/v1',
      PUBLIC_GOOGLE_CLIENT_ID: ''
    }
  }
);
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
