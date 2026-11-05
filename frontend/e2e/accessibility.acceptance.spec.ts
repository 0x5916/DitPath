import { expect, test } from '@playwright/test';
import { resetAcceptance, resetToHome, TRAINING_DB } from './helpers';

// Firefox can report a 48px CSS box as 47.99997px because layout is fractional.
// Keep a sub-pixel tolerance while still enforcing the intended minimum target.
const TARGET_EPSILON = 0.01;

test('keyboard-only practice starts, checks, and closes the result', async ({ page }) => {
  await resetToHome(page);
  await page.goto('/morse/practice');
  const start = page.getByRole('button', { name: 'Start practice' });
  await expect(start).toBeVisible();
  await start.focus();
  await page.keyboard.press('Space');

  const answer = page.getByRole('textbox', { name: 'Your copy' });
  await expect(answer).toBeFocused();
  await page.keyboard.type('KM');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Practice results')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(answer).toBeFocused();
});

test('the Practice title tip matches the Penpot heading and close treatment', async ({ page }) => {
  await resetToHome(page);
  await page.goto('/morse/practice', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const trigger = page.getByRole('button', { name: 'About Practice' });
  await trigger.click();

  const dialog = page.getByRole('dialog', { name: 'About Practice' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('About Practice', { exact: true })).toBeVisible();
  const close = dialog.getByRole('button', { name: 'Close' });
  await expect(close).toBeVisible();

  const triggerBox = await trigger.boundingBox();
  const closeBox = await close.boundingBox();
  const dialogBox = await dialog.boundingBox();
  expect(triggerBox?.width ?? 0).toBeGreaterThanOrEqual(48 - TARGET_EPSILON);
  expect(triggerBox?.height ?? 0).toBeGreaterThanOrEqual(48 - TARGET_EPSILON);
  expect(closeBox?.width ?? 0).toBeGreaterThanOrEqual(48 - TARGET_EPSILON);
  expect(closeBox?.height ?? 0).toBeGreaterThanOrEqual(48 - TARGET_EPSILON);
  expect(
    (dialogBox?.y ?? 0) - ((triggerBox?.y ?? 0) + (triggerBox?.height ?? 0))
  ).toBeGreaterThanOrEqual(8 - TARGET_EPSILON);

  await close.click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('Profile heatmap days meet 24px and support roving keyboard navigation', async ({ page }) => {
  await resetAcceptance(page, 'Returning learner / populated history', /\/en$/);
  await page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const existing = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
        const tx = db.transaction('owned_sessions', 'readonly');
        const request = tx.objectStore('owned_sessions').getAll();
        request.onsuccess = () => resolve(request.result[0]);
        request.onerror = () => reject(request.error);
      });
      if (!existing) return;
      const when = new Date(Date.now() - 30 * 86_400_000).toISOString();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('owned_sessions', 'readwrite');
        tx.objectStore('owned_sessions').put({
          ...existing,
          id: 'fixture-heatmap-older',
          startedAt: when,
          completedAt: when,
          status: 'completed'
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, TRAINING_DB);
  await page.goto('/profile', { waitUntil: 'networkidle' });
  const cells = page.locator('button.profile-heatmap-cell');
  await expect(cells.first()).toBeVisible();
  expect(await cells.count()).toBeGreaterThan(1);

  const sizes = await cells.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    })
  );
  expect(sizes.length).toBeGreaterThan(0);
  expect(Math.min(...sizes.map((size) => size.width))).toBeGreaterThanOrEqual(24 - TARGET_EPSILON);
  expect(Math.min(...sizes.map((size) => size.height))).toBeGreaterThanOrEqual(24 - TARGET_EPSILON);

  const tabbable = page.locator('button.profile-heatmap-cell[tabindex="0"]');
  await expect(tabbable).toHaveCount(1);
  await tabbable.focus();
  const before = await tabbable.getAttribute('data-date');
  await page.keyboard.press('ArrowLeft');
  const after = await page.evaluate(
    () => (document.activeElement as HTMLElement | null)?.dataset.date ?? null
  );
  expect(after).not.toBe(before);
  await expect(page.getByRole('tooltip')).toBeVisible();
  await expect(page.locator('button.profile-heatmap-cell[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});

test('all locales fit at 320px in dark mode', async ({ page }) => {
  await resetToHome(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const locale of ['en', 'de', 'ja', 'zh-Hans', 'zh-Hant']) {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`/${locale}/morse/practice`, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1
    );
    expect(overflow, `${locale} Practice overflows at 320px`).toBe(false);
    await expect(page.locator('main .player-play-btn').first()).toBeVisible();
  }
});

test('Practice reflows at 200% root text size on a 320px viewport', async ({ page }) => {
  await resetToHome(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/morse/practice', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '32px';
  });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  expect(overflow).toBe(false);
  await expect(page.getByRole('button', { name: 'Start practice' })).toBeVisible();
});

test('primary controls meet the 44px target and key routes do not overflow', async ({ page }) => {
  await resetToHome(page);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
    for (const path of ['/en', '/en/morse/learn', '/en/morse/practice', '/en/morse/progress']) {
      await page.goto(path, { waitUntil: 'networkidle' });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1
      );
      expect(overflow, `${path} overflows at ${width}px`).toBe(false);
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/morse/practice');
  const box = await page.getByRole('button', { name: 'Start practice' }).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44 - TARGET_EPSILON);
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44 - TARGET_EPSILON);
});
