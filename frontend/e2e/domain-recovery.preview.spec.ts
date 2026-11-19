import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ serviceWorkers: 'block' });

test('recovers a guest lesson from its original top-level origin without transferring the login', async ({
  context,
  page,
  request,
  baseURL
}) => {
  // Both public origins are fulfilled locally, including the first popup navigation.
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === 'https://opencw.net') {
      if (url.pathname === '/seed')
        return route.fulfill({ contentType: 'text/html', body: '<title>Legacy fixture</title>' });
      if (url.pathname === '/recover-device.html')
        return route.fulfill({
          contentType: 'text/html',
          body: await readFile(new URL('../static/recover-device.html', import.meta.url), 'utf8')
        });
    }
    if (url.origin === 'https://morsewell.com') {
      const response = await request.get(new URL(url.pathname + url.search, baseURL).href);
      return route.fulfill({ response });
    }
    return route.abort();
  });
  await page.goto('https://opencw.net/seed');
  await page.evaluate(() => {
    document.cookie = 'learn.lesson=7; path=/';
    localStorage.setItem('refresh_token', 'legacy-fixture');
    return new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('morsestep_training_v1', 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        db.createObjectStore('meta', { keyPath: 'key' });
        db.createObjectStore('attempts', { keyPath: 'id' });
        db.createObjectStore('sessions', { keyPath: 'id' }).add({
          schemaVersion: 1,
          id: 'legacy-guest',
          mode: 'practice',
          step: 7,
          charWpm: 20,
          effWpm: 12,
          freqHz: 600,
          startedAt: '2026-10-13T12:00:00Z',
          completedAt: '2026-10-13T12:01:00Z',
          status: 'completed',
          promptCount: 1,
          completedPromptCount: 1,
          accuracy: 1,
          eventIds: []
        });
      };
      open.onsuccess = () => {
        open.result.close();
        resolve();
      };
      open.onerror = () => reject(open.error);
    });
  });
  await page.goto('https://morsewell.com/en/settings#device-recovery');
  const button = page.getByRole('button', { name: 'Copy device history' });
  await button.click();
  await expect(page.getByRole('status').filter({ hasText: 'History copied' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('refresh_token'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('learn.lesson'))).toBe('7');
  await button.click();
  await expect(page.getByRole('status').filter({ hasText: 'No new device data' })).toBeVisible();
  await page.goto('https://morsewell.com/en/morse/progress?view=history');
  await expect(page.getByText('Practice: Lesson 7', { exact: true })).toBeVisible();
  await page.goto('https://opencw.net/seed');
  expect(await page.evaluate(() => localStorage.getItem('refresh_token'))).toBe('legacy-fixture');
});
