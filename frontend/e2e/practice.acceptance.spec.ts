import { expect, test } from '@playwright/test';
import {
  readCopyCheckpoint,
  readSessionCount,
  resetAcceptance,
  resetToHome,
  saveAndLeave,
  startAndType
} from './helpers';

async function createCheckpoint(page: import('@playwright/test').Page) {
  await resetToHome(page);
  await page.goto('/morse/practice');
  await startAndType(page);
  await expect.poll(async () => (await readCopyCheckpoint(page)) !== null).toBe(true);
  await saveAndLeave(page);
}

test('persists, resumes, and discards a practice checkpoint', async ({ page }) => {
  await createCheckpoint(page);

  await page.goto('/morse/practice');
  await expect(page.getByRole('button', { name: 'Continue saved session' })).toBeVisible();
  await expect
    .poll(async () => (await readCopyCheckpoint(page)) as { draft?: string })
    .toMatchObject({
      draft: 'KM'
    });

  await page.getByRole('button', { name: 'Continue saved session' }).click();
  await expect(page.getByRole('textbox', { name: 'Your copy' })).toHaveValue('KM');

  await page.getByRole('link', { name: 'Progress' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Discard and leave' }).click();
  await expect(page).toHaveURL(/\/en\/morse\/progress$/);
  await expect.poll(async () => readCopyCheckpoint(page)).toBeNull();

  await page.goto('/morse/practice');
  await expect(page.getByRole('button', { name: 'Start practice' })).toBeVisible();
});

test('rapid continue clicks do not strand the resumed session', async ({ page }) => {
  await createCheckpoint(page);
  await page.goto('/morse/practice');
  await expect(page.getByRole('button', { name: 'Continue saved session' })).toBeVisible();

  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.includes('Continue saved session')
    );
    button?.click();
    button?.click();
    button?.click();
  });

  await expect(page.getByRole('textbox', { name: 'Your copy' })).toHaveValue('KM');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a second tab cannot resume while the first tab holds the session', async ({
  context,
  page
}) => {
  await createCheckpoint(page);
  const other = await context.newPage();
  await Promise.all([page.goto('/morse/practice'), other.goto('/morse/practice')]);
  await expect(page.getByRole('button', { name: 'Continue saved session' })).toBeVisible();
  await expect(other.getByRole('button', { name: 'Continue saved session' })).toBeVisible();

  await Promise.all([
    page.getByRole('button', { name: 'Continue saved session' }).click(),
    other.getByRole('button', { name: 'Continue saved session' }).click()
  ]);
  await expect
    .poll(
      async () =>
        (await page.getByRole('textbox', { name: 'Your copy' }).count()) +
        (await other.getByRole('textbox', { name: 'Your copy' }).count())
    )
    .toBe(1);

  const winner = (await page.getByRole('textbox', { name: 'Your copy' }).count()) ? page : other;
  const loser = winner === page ? other : page;
  await expect(loser.getByRole('alert')).toContainText('active in another tab');
  await expect(loser.getByRole('button', { name: 'Try again' })).toBeVisible();

  await winner.close();
  await loser.getByRole('button', { name: 'Try again' }).click();
  await expect(loser.getByRole('button', { name: 'Continue saved session' })).toBeVisible();
  await loser.getByRole('button', { name: 'Continue saved session' }).click();
  await expect(loser.getByRole('textbox', { name: 'Your copy' })).toHaveValue('KM');
});

test('a stale card cannot resurrect a checkpoint discarded in another tab', async ({
  context,
  page
}) => {
  await createCheckpoint(page);
  const other = await context.newPage();
  await Promise.all([page.goto('/morse/practice'), other.goto('/morse/practice')]);
  await expect(page.getByRole('button', { name: 'Continue saved session' })).toBeVisible();
  await expect(other.getByRole('button', { name: 'Continue saved session' })).toBeVisible();

  await page.getByRole('button', { name: 'Continue saved session' }).click();
  await page.getByRole('link', { name: 'Progress' }).click();
  await page.getByRole('button', { name: 'Discard and leave' }).click();
  await expect.poll(async () => readCopyCheckpoint(page)).toBeNull();
  await expect(other.getByRole('button', { name: 'Continue saved session' })).toBeVisible();

  await other.getByRole('button', { name: 'Continue saved session' }).click();
  await expect(other.getByRole('button', { name: 'Start practice' })).toBeVisible();
  await expect(other.getByRole('textbox', { name: 'Your copy' })).toHaveCount(0);
  await expect.poll(async () => readCopyCheckpoint(other)).toBeNull();
});

test('a corrupt checkpoint is ignored without blocking a new practice', async ({ page }) => {
  await createCheckpoint(page);
  await page.goto('/morse/practice');
  await expect(page.getByRole('button', { name: 'Continue saved session' })).toBeVisible();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ditpath_ui_acceptance_evidence');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('meta', 'readwrite');
        tx.objectStore('meta').put({
          owner: 'unclaimed',
          key: 'checkpoint:copy',
          value: {
            version: 1,
            kind: 'copy',
            id: 'copy',
            href: '/morse/practice',
            savedAt: new Date().toISOString(),
            draft: 'KM',
            attempt: {
              id: 'corrupt',
              exercise: { lesson: 1, text: 'KM' },
              settings: {},
              session: {}
            }
          }
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });

  await page.reload();
  await expect(page.getByRole('button', { name: 'Start practice' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue saved session' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('account switching hides the guest checkpoint until sign-out', async ({ context, page }) => {
  await createCheckpoint(page);
  await page.goto('/morse/practice');
  await expect(page.getByRole('button', { name: 'Continue saved session' })).toBeVisible();

  const account = await context.newPage();
  await account.goto('/en');
  await account.evaluate(() => {
    const payload = btoa(
      JSON.stringify({
        sub: '11111111-1111-4111-8111-111111111111',
        exp: Math.floor(Date.now() / 1000) + 86_400
      })
    );
    localStorage.setItem('access_token', `fixture.${payload}.fixture`);
    localStorage.setItem('username', 'Synthetic learner');
  });
  await account.close();

  await expect(page.getByRole('button', { name: 'Start practice' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue saved session' })).toHaveCount(0);
  expect(await readCopyCheckpoint(page)).not.toBeNull();

  const guest = await context.newPage();
  await guest.goto('/en');
  await guest.evaluate(() => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('username');
    localStorage.removeItem('refresh_token');
  });
  await guest.close();

  await expect(page.getByRole('button', { name: 'Continue saved session' })).toBeVisible();
});

test('retrying a failed practice save records exactly one session', async ({ page }) => {
  await resetAcceptance(page, 'Practice save fails once, then retry', /\/morse\/practice$/);
  await startAndType(page);
  await page.getByRole('button', { name: 'Check transcription' }).click();

  await expect(page.getByRole('alert')).toContainText('has not been saved');
  expect(await readSessionCount(page)).toBe(0);

  await page.getByRole('button', { name: 'Retry saving' }).last().click();
  await expect(page.getByText('Practice result saved on this device')).toBeVisible();
  await expect.poll(async () => readSessionCount(page)).toBe(1);
  await expect.poll(async () => readCopyCheckpoint(page)).toBeNull();
});

test('browser Back preserves or discards the draft through the departure dialog', async ({
  page
}) => {
  await resetToHome(page);
  await page.evaluate(() => {
    (window as unknown as { __e2eSpaMarker: string }).__e2eSpaMarker = 'keep';
  });
  await page.getByRole('link', { name: 'Already know Morse? Practice' }).click();
  await page.waitForURL('**/en/morse/practice');
  expect(
    await page.evaluate(() => (window as unknown as { __e2eSpaMarker?: string }).__e2eSpaMarker)
  ).toBe('keep');
  await startAndType(page);
  await expect.poll(async () => (await readCopyCheckpoint(page)) !== null).toBe(true);

  await page.evaluate(() => history.back());
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Keep current copy' }).click();
  await expect(page).toHaveURL(/\/en\/morse\/practice$/);
  await expect(page.getByRole('textbox', { name: 'Your copy' })).toHaveValue('KM');

  await page.evaluate(() => history.back());
  await page.getByRole('button', { name: 'Discard and leave' }).click();
  await expect(page).toHaveURL(/\/en$/);
  await expect.poll(async () => readCopyCheckpoint(page)).toBeNull();
});
