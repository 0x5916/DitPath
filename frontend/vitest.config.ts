import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Reuse the app's resolution ($lib, $env, SvelteKit virtual modules) so
  // tested modules behave exactly as they do in the app.
  plugins: [sveltekit()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
});
