import { expect, test, type Page } from '@playwright/test';
import en from '../messages/en.json' with { type: 'json' };
import { readOwnedSessions, resetToHome, TRAINING_DB } from './helpers';

test.use({ timezoneId: 'America/Los_Angeles' });

test('a new learner sees a compact explanation before their first completed session', async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await resetToHome(page);
  await page.goto('/en/profile');
  const heading = page.getByRole('heading', { name: en.profile_heatmap_title });
  await expect(heading).toBeVisible();
  await expect(page.getByText(en.profile_heatmap_empty)).toBeVisible();
  await expect(page.getByRole('group', { name: en.profile_heatmap_year_aria })).toHaveCount(0);
  await expect(page.locator('.profile-heatmap-cell')).toHaveCount(0);
  expect(await heading.evaluate((node) => node.closest('section')!.clientHeight)).toBeLessThan(145);
});

async function seedActivityInTwoYears(page: Page) {
  await page.clock.setFixedTime(new Date('2026-08-10T12:00:00Z'));
  await resetToHome(page, 'Returning learner / populated history');
  const [session] = await readOwnedSessions(page);
  await page.evaluate(
    async ({ database, session }) => {
      const when = '2024-01-01T12:00:00Z';
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(database);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('owned_sessions', 'readwrite');
          tx.objectStore('owned_sessions').put({
            ...session,
            id: 'fixture-older-year',
            startedAt: when,
            completedAt: when,
            occurredAt: when
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
    { database: TRAINING_DB, session }
  );
}

test('changing the year at UTC midnight focuses the correct day in each calendar', async ({
  page
}) => {
  // The two returning-learner sessions are one and two hours ago, on opposite UTC dates.
  await page.clock.setFixedTime(new Date('2026-01-01T01:30:00Z'));
  await resetToHome(page, 'Returning learner / populated history');
  await page.goto('/en/profile');
  const years = page.getByRole('group', { name: en.profile_heatmap_year_aria });
  const tabbable = page.locator('.profile-heatmap-cell[tabindex="0"]');
  await expect(tabbable).toHaveAccessibleName('1 session on Jan 1, 2026');
  await years.getByRole('button', { name: '2025' }).press('Enter');
  await page.keyboard.press('Tab');
  const calendar = page.getByRole('region', { name: 'Training activity heatmap for 2025' });
  // Firefox gives the scroll region its own native tab stop before the active day.
  if (await calendar.evaluate((node) => node === document.activeElement))
    await page.keyboard.press('Tab');
  await expect(tabbable).toBeFocused();
  await expect(tabbable).toHaveAccessibleName('1 session on Dec 31, 2025');
  await page.keyboard.press('ArrowRight');
  await expect(tabbable).toHaveAccessibleName('1 session on Dec 31, 2025');
  await years.getByRole('button', { name: '2026' }).press('Enter');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(tabbable).toHaveCount(1);
  await expect(tabbable).toHaveAccessibleName('1 session on Jan 1, 2026');
});

for (const { viewport, colorScheme } of [
  { viewport: { width: 390, height: 844 }, colorScheme: 'dark' },
  { viewport: { width: 1440, height: 900 }, colorScheme: 'light' }
] as const) {
  test.describe(`Profile calendar at ${viewport.width}px`, () => {
    test.use({ viewport, colorScheme, reducedMotion: 'reduce' });

    test('year switching, keyboard navigation and weekday labels work through horizontal scrolling', async ({
      page
    }) => {
      await seedActivityInTwoYears(page);
      await page.goto('/en/profile');
      await expect(page.getByRole('heading', { name: '2 sessions in 2026' })).toBeVisible();
      const years = page.getByRole('group', { name: en.profile_heatmap_year_aria });
      await years.getByRole('button', { name: '2025' }).press('Enter');
      await expect(page.getByRole('heading', { name: '0 sessions in 2025' })).toBeVisible();
      await expect(page.getByText(en.profile_heatmap_empty_year)).toBeVisible();
      await expect(page.locator('.profile-heatmap-cell')).toHaveCount(0);
      await years.getByRole('button', { name: '2024' }).press('Enter');
      await expect(page.getByRole('heading', { name: '1 session in 2024' })).toBeVisible();
      const calendar = page.getByRole('region', { name: 'Training activity heatmap for 2024' });
      const hint = page.getByText(en.profile_heatmap_scroll_hint);
      await expect(hint).toBeVisible();
      expect(await calendar.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
      const tabbable = calendar.locator('button[tabindex="0"]');
      await expect(tabbable).toHaveCount(1);
      await tabbable.focus();
      await page.keyboard.press('Home');
      await expect(tabbable).toHaveAccessibleName('1 session on Jan 1, 2024');
      const weekday = page.getByText(en.profile_heatmap_weekday_mon, { exact: true });
      const monday = await weekday.boundingBox();
      const firstDay = await tabbable.boundingBox();
      expect(
        Math.abs(monday!.y + monday!.height / 2 - (firstDay!.y + firstDay!.height / 2))
      ).toBeLessThan(1);
      const minDaySize = await calendar.evaluate((node) =>
        Math.min(
          ...Array.from(node.querySelectorAll('button'), (cell) => {
            const rect = cell.getBoundingClientRect();
            return Math.min(rect.width, rect.height);
          })
        )
      );
      expect(minDaySize).toBeGreaterThanOrEqual(23.99);
      await page.keyboard.press('End');
      await expect(tabbable).toBeFocused();
      await expect(tabbable).toHaveAccessibleName('0 sessions on Dec 31, 2024');
      await expect(tabbable).toBeInViewport();
      expect(await calendar.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
      expect((await weekday.boundingBox())!.x).toBeCloseTo(monday!.x, 1);
      await expect(weekday).toBeInViewport();
      await page.keyboard.press('ArrowLeft');
      await expect(tabbable).toHaveAccessibleName('0 sessions on Dec 24, 2024');
      await expect(page.getByRole('tooltip')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      await page.keyboard.press('Tab');
      await expect(tabbable).not.toBeFocused();
      const previousWidth = await calendar.evaluate((node) => node.clientWidth);
      await page.setViewportSize({ width: viewport.width === 390 ? 1440 : 390, height: 900 });
      await expect
        .poll(() => calendar.evaluate((node) => node.clientWidth))
        .not.toBe(previousWidth);
      await calendar.scrollIntoViewIfNeeded();
      await expect(hint).toBeVisible();
      expect(await calendar.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
      await expect(weekday).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
    });
  });
}
