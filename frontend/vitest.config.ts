import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { kitOptions } from './scripts/kit-options.js';

export default defineConfig({
  // Reuse the app's resolution (#lib, $app/env, SvelteKit virtual modules) so
  // tested modules behave exactly as they do in the app.
  plugins: [sveltekit(kitOptions)],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/acceptance/**/*.test.ts']
  }
});
