import { defineConfig, devices } from '@playwright/test';

const acceptance = {
  command: 'npm run acceptance',
  url: 'http://127.0.0.1:4174/__acceptance',
  reuseExistingServer: !process.env.CI,
  timeout: 120_000
};

const preview = {
  command: process.env.PLAYWRIGHT_SKIP_BUILD
    ? 'npm run preview -- --host 127.0.0.1 --port 4177'
    : 'npm run build && npm run preview -- --host 127.0.0.1 --port 4177',
  url: 'http://127.0.0.1:4177/en',
  reuseExistingServer: !process.env.CI,
  timeout: 240_000
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 7_000 },
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    ...(
      [
        ['chromium', devices['Desktop Chrome']],
        ['firefox', devices['Desktop Firefox']],
        ['webkit', devices['Desktop Safari']]
      ] as const
    ).flatMap(([id, device]) => [
      {
        name: `acceptance-${id}`,
        testMatch: '**/*.acceptance.spec.ts',
        use: { ...device, baseURL: 'http://127.0.0.1:4174' }
      },
      {
        name: `preview-${id}`,
        testMatch: ['**/*.offline.spec.ts', '**/*.preview.spec.ts'],
        use: { ...device, baseURL: 'http://127.0.0.1:4177' }
      }
    ])
  ],
  webServer: [acceptance, preview]
});
