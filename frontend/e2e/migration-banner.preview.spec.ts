import { expect, test } from '@playwright/test';

const NO_HISTORY_TITLES = {
  en: 'OpenCW is becoming DitPath',
  de: 'OpenCW wird DitPath',
  ja: 'OpenCW は DitPath になります',
  'zh-Hans': 'OpenCW 即将更名为 DitPath',
  'zh-Hant': 'OpenCW 即將更名為 DitPath'
} as const;

test.describe('DitPath migration banner', () => {
  test('localizes the short no-history announcement in all five locales', async ({ page }) => {
    for (const [locale, title] of Object.entries(NO_HISTORY_TITLES)) {
      await page.goto(`/${locale}/about`);
      const banner = page.locator('.migration-banner');
      await expect(banner).toBeVisible();
      await expect(banner.getByRole('heading', { name: title })).toBeVisible();
      await expect(banner.getByRole('link', { name: /./ })).toBeVisible();
    }
  });

  test('dismisses the no-history announcement persistently', async ({ page }) => {
    await page.goto('/en/about');
    const banner = page.locator('.migration-banner');
    await expect(banner).toBeVisible();

    await banner.getByRole('button', { name: 'Dismiss announcement' }).click();
    await expect(banner).toHaveCount(0);

    await page.reload();
    await expect(page.locator('.migration-banner')).toHaveCount(0);
  });

  test('fits mobile, works in dark mode, and dismisses from the keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('/en/about');

    const banner = page.locator('.migration-banner');
    await expect(banner).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);

    const dismiss = page.getByRole('button', { name: 'Dismiss announcement' });
    const box = await dismiss.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    await page.evaluate(() => localStorage.setItem('theme', 'dark'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.migration-banner')).toBeVisible();

    const darkDismiss = page.getByRole('button', { name: 'Dismiss announcement' });
    await darkDismiss.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.migration-banner')).toHaveCount(0);
  });

  test('stays out of the way on account and authentication pages', async ({ page }) => {
    for (const path of ['/en/settings', '/en/login', '/en/register']) {
      await page.goto(path);
      await expect(page.locator('.migration-banner')).toHaveCount(0);
    }
  });
});
