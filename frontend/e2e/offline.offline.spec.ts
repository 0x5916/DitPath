import { expect, test } from '@playwright/test';
import { readCopyCheckpoint, saveAndLeave, startAndType } from './helpers';

const PREVIEW_EVIDENCE_DB = 'opencw_learning_evidence_v1';

test('offline practice saves, reloads, and resumes from the cached shell', async ({
  context,
  page
}) => {
  await page.goto('/en/morse/practice');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await expect(page.getByRole('button', { name: 'Start practice' })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Start practice' })).toBeVisible();

  await startAndType(page);
  await expect
    .poll(async () => (await readCopyCheckpoint(page, PREVIEW_EVIDENCE_DB)) !== null)
    .toBe(true);
  await saveAndLeave(page);

  await page.goto('/en/morse/practice');
  await expect(page.getByRole('button', { name: 'Continue saved session' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue saved session' }).click();
  await expect(page.getByRole('textbox', { name: 'Your copy' })).toHaveValue('KM');

  await context.setOffline(false);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Continue saved session' })).toBeVisible();
  await expect
    .poll(async () => (await readCopyCheckpoint(page, PREVIEW_EVIDENCE_DB)) !== null)
    .toBe(true);
});

test('the retirement worker waits for old training tabs and keeps their browser data', async ({
  context,
  page
}) => {
  await page.goto('/en/morse/practice');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await page.evaluate(async () => {
    localStorage.setItem('learn.lesson', '8');
    await navigator.serviceWorker.register('/retire-legacy-worker.js', { scope: '/' });
  });
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await navigator.serviceWorker.getRegistration())?.waiting?.scriptURL
      )
    )
    .toContain('/retire-legacy-worker.js');
  await page.close();

  // The recovery document has no app bootstrap to re-register the trainer's worker.
  const recovery = await context.newPage();
  await recovery.goto('/recover-device.html');
  await expect
    .poll(() =>
      recovery.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration()))
    )
    .toBe(false);
  expect(await recovery.evaluate(() => localStorage.getItem('learn.lesson'))).toBe('8');
});
