import { readFileSync } from 'node:fs';
import type { ParaglideVitePluginOptions } from '@inlang/paraglide-js';

const { locales } = JSON.parse(
  readFileSync(new URL('../project.inlang/settings.json', import.meta.url), 'utf8')
) as { locales: string[] };

export const paraglideOptions = {
  project: './project.inlang',
  outdir: './src/lib/paraglide',
  strategy: ['url', 'preferredLanguage', 'globalVariable', 'baseLocale'],
  urlPatterns: [
    {
      pattern: ':protocol://:domain(.*)::port?/:path(.*)?',
      localized: locales.map((locale): [string, string] => [
        locale,
        `:protocol://:domain(.*)::port?/${locale}/:path(.*)?`
      ])
    }
  ]
} satisfies ParaglideVitePluginOptions;
