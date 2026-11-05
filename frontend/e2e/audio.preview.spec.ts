import { expect, test } from '@playwright/test';
import { startAndType } from './helpers';

type AudioStats = { created: number; closed: number };

test('rapid replay and navigation leave no open audio context', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    const stats = { created: 0, closed: 0 };
    (window as unknown as { __audioStats: AudioStats }).__audioStats = stats;
    const Native = window.AudioContext;
    if (!Native) return;
    window.AudioContext = new Proxy(Native, {
      construct(target, args) {
        stats.created += 1;
        const context = Reflect.construct(target, args) as AudioContext;
        const close = context.close.bind(context);
        context.close = () => {
          stats.closed += 1;
          return close();
        };
        return context;
      }
    });
  });

  await page.goto('/en/morse/practice', { waitUntil: 'networkidle' });
  const answer = await startAndType(page);
  await expect(answer).toBeVisible();
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Replay' })).toBeVisible();

  for (let index = 0; index < 3; index += 1) {
    await page.getByRole('button', { name: 'Replay' }).click();
    await page.waitForTimeout(80);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
  }

  await page.getByRole('link', { name: 'Progress' }).click();
  await page.getByRole('button', { name: 'Discard and leave' }).click();
  await expect(page).toHaveURL(/\/en\/morse\/progress$/);

  const stats = await page.evaluate(
    () => (window as unknown as { __audioStats: AudioStats }).__audioStats
  );
  expect(stats.created).toBeGreaterThan(0);
  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as { __audioStats: AudioStats }).__audioStats),
      { timeout: 5_000 }
    )
    .toEqual({ created: stats.created, closed: stats.created });
  expect(errors).toEqual([]);
});
