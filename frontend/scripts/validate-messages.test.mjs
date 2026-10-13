import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const project = dirname(dirname(fileURLToPath(import.meta.url)));
const cases = [
  ['TypeScript reference', 'm.greeting()', 'app.ts', 'Hello', 'Hallo', 0],
  [
    'Svelte script and template',
    '<script lang="ts">const value: string = m.greeting();</script><p>{m.greeting()}</p>',
    'App.svelte',
    'Hello',
    'Hallo',
    0
  ],
  ['TypeScript comment', '// m.greeting()', 'app.ts', 'Hello', 'Hallo', 1, /dead key/],
  [
    'Svelte comment and text',
    '<!-- {m.greeting()} --><p>m.greeting()</p>',
    'App.svelte',
    'Hello',
    'Hallo',
    1,
    /dead key/
  ],
  ['String mention', 'const text = "m.greeting()";', 'app.ts', 'Hello', 'Hallo', 1, /dead key/],
  ['Empty base value', 'm.greeting()', 'app.ts', ' ', 'Hallo', 1, /\[en\] empty value/],
  ['Empty translation', 'm.greeting()', 'app.ts', 'Hello', '', 1, /\[de\] empty value/],
  [
    'Unknown reference',
    'm.greeting(); m.missing()',
    'app.ts',
    'Hello',
    'Hallo',
    1,
    /missing from en.json/
  ],
  [
    'Placeholder drift',
    'm.greeting()',
    'app.ts',
    'Hello {name}',
    'Hallo',
    1,
    /placeholder mismatch/
  ]
];

for (const [name, source, filename, english, german, expected, diagnostic] of cases) {
  test(name, () => {
    const fixture = mkdtempSync(join(tmpdir(), 'opencw-messages-'));
    try {
      for (const folder of ['scripts', 'src', 'messages', 'project.inlang'])
        mkdirSync(join(fixture, folder));
      copyFileSync(
        join(project, 'scripts/validate-messages.ts'),
        join(fixture, 'scripts/validate-messages.ts')
      );
      symlinkSync(join(project, 'node_modules'), join(fixture, 'node_modules'), 'dir');
      writeFileSync(
        join(fixture, 'project.inlang/settings.json'),
        JSON.stringify({ baseLocale: 'en', locales: ['en', 'de'] })
      );
      writeFileSync(join(fixture, 'messages/en.json'), JSON.stringify({ greeting: english }));
      writeFileSync(join(fixture, 'messages/de.json'), JSON.stringify({ greeting: german }));
      writeFileSync(join(fixture, 'src', filename), source);
      const result = spawnSync(process.execPath, [join(fixture, 'scripts/validate-messages.ts')], {
        encoding: 'utf8'
      });
      assert.equal(result.status, expected, result.stderr);
      if (diagnostic) assert.match(result.stderr, diagnostic);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
}
