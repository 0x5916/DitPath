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
