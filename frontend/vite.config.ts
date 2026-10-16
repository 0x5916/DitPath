import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { paraglideOptions } from './scripts/paraglide-options.ts';
import { kitOptions } from './scripts/kit-options.js';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit(kitOptions), paraglideVitePlugin(paraglideOptions)]
});
