import { expect, test, type Locator } from '@playwright/test';

const trainingPages = [
  { path: 'learn', width: 1120 },
  { path: 'practice', width: 650 },
  { path: 'progress', width: 960 }
];

for (const theme of ['light', 'dark'] as const) {
  test(`training titles and content share the shell gutter in ${theme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    for (const dismissed of [false, true]) {
      if (dismissed) {
        await page
          .locator('.migration-banner')
          .getByRole('button', { name: 'Dismiss announcement' })
          .click();
      }
      for (const training of trainingPages) {
        await page.goto(`/en/morse/${training.path}`);
        const title = page.getByRole('heading', { level: 1 });
        const banner = page.locator('.migration-banner');
        if (!dismissed && training.path !== 'practice') await expect(banner).toBeVisible();
        else await expect(banner).toHaveCount(0);
        for (const width of [390, 959, 960, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          const size = width < 960 ? 32 : 40;
          await expect(title).toHaveCSS('font-size', `${size}px`);
          await expect(title).toHaveCSS('font-weight', '600');
          const leading = await title.evaluate((node) =>
            parseFloat(getComputedStyle(node).lineHeight)
          );
          expect(leading).toBeCloseTo(size * 1.15, 2);
          const column = await page.locator('.training-page').boundingBox();
          const left = (await title.boundingBox())!.x;
          expect(column!.width).toBeCloseTo(Math.min(width - 48, training.width), 0);
          expect(left).toBeCloseTo((width - column!.width) / 2, 0);
          if (!dismissed && training.path !== 'practice') {
            expect((await banner.boundingBox())!.x).toBeCloseTo(left, 0);
          }
        }
      }
    }
    await page.goto('/en/settings');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '28px');
  });
}

test.describe('training disclosures', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' });

  async function toggleSummary(summary: Locator, tab: string) {
    await expect(summary).toHaveCSS('display', 'list-item');
    const details = summary.locator('..');
    for (const input of ['tap', 'Enter', 'Space']) {
      if (input === 'Enter') {
        // Reach the control by keyboard after touch to trigger native focus-visible.
        await summary.press(tab);
        await summary.page().keyboard.press(`Shift+${tab}`);
        await expect(summary).toBeFocused();
      }
      for (const open of [true, false]) {
        if (input === 'tap') await summary.tap();
        else {
          await summary.press(input);
          await expect(summary).toBeFocused();
          await expect(summary).toHaveCSS('outline-style', 'solid');
        }
        await expect(details).toHaveJSProperty('open', open);
      }
    }
  }

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`native training disclosures and Settings navigation in ${colorScheme} mode`, async ({
      page,
      browserName
    }) => {
      const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
      await page.emulateMedia({ colorScheme });
      await page.goto('/en/morse/learn');
      await toggleSummary(page.locator('.unlock-checks > summary'), tab);
      await page.goto('/en/morse/practice');
      await toggleSummary(page.locator('.character-details > summary'), tab);
      const audio = page.locator('summary', { hasText: 'Audio settings' });
      await expect(audio).toHaveCSS('font-size', '22px');
      await toggleSummary(audio, tab);

      await page.goto('/en/settings');
      const row = page.locator('.section-links a[href="#preferences"]');
      await expect(row.locator('svg')).toBeVisible();
      await row.tap();
      await expect(page).toHaveURL(/\/settings#preferences$/);
      await expect(page.locator('h1#preferences-title')).toBeFocused();
      await page.goBack();
      await expect(row).toBeFocused();
    });
  }
});
