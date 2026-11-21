import { expect, test } from '@playwright/test';
import { resetAcceptance } from './helpers';

test.describe('Morsewell migration data guidance', () => {
  test.describe('phone Lessons', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('keeps the returning guest recommendation fully visible and tappable above the tabs', async ({
      page
    }) => {
      await resetAcceptance(page, 'Returning learner / populated history', /\/en$/);
      await page.goto('/en/morse/learn');
      const banner = page.locator('.migration-banner[role="alert"]');
      await expect(banner).toBeVisible();
      await expect(banner.getByText(/will not transfer automatically/)).toBeVisible();
      await expect(banner.getByRole('link', { name: 'Create account' })).toHaveCount(0);
      const recommendation = page.getByRole('link', { name: 'Check K, M', exact: true });
      await expect(recommendation).toBeInViewport({ ratio: 1 });
      const tabs = await page.locator('nav.bottom-nav').boundingBox();
      const action = await recommendation.boundingBox();
      expect(tabs).toBeTruthy();
      expect(action).toBeTruthy();
      expect(action!.y + action!.height).toBeLessThanOrEqual(tabs!.y);
      expect(await page.evaluate(() => scrollY)).toBe(0);
      // A coordinate tap cannot scroll the target into view like locator.tap() can.
      await page.touchscreen.tap(action!.x + action!.width / 2, action!.y + action!.height / 2);
      await expect(page).toHaveURL(
        (url) =>
          url.pathname === '/en/morse/learn/session' && url.searchParams.get('check') === 'KM'
      );
    });

    test('keeps the new guest sync guidance in the notice and opens device recovery', async ({
      page
    }) => {
      await resetAcceptance(page, 'New learner / empty history', /\/en$/);
      await page.goto('/en/morse/learn');
      const banner = page.locator('.migration-banner[role="status"]');
      await expect(banner.getByText(/Progress saves in this browser/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Start lesson 1' })).toBeVisible();
      await expect(page.locator('.lessons-page a[href="/en/register"]')).toHaveCount(0);
      await banner.getByRole('link', { name: 'Recover history from the previous site' }).tap();
      await expect(page).toHaveURL(/\/en\/settings#device-recovery$/);
      await expect(
        page.getByRole('heading', { name: 'Recover history from the previous site' })
      ).toBeVisible();
    });
  });

  test('warns guests with browser-local history and keeps critical dismissal session-only', async ({
    page
  }) => {
    await resetAcceptance(page, 'Returning learner / populated history', /\/en$/);

    const banner = page.locator('.migration-banner[role="alert"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('OpenCW is now Morsewell!');
    await expect(banner).toContainText('will not transfer automatically');
    const syncOptions = banner.getByText('How to sync your history', { exact: true });
    await syncOptions.press('Enter');
    await expect(
      banner.getByText(/import your device history, and confirm synchronization/)
    ).toBeVisible();
    await expect(banner.getByRole('link', { name: 'Create account' })).toHaveAttribute(
      'href',
      '/en/register'
    );
    await expect(banner.getByRole('link', { name: 'Sync & storage' })).toHaveAttribute(
      'href',
      '/en/settings#sync-storage'
    );
    await banner.getByRole('link', { name: 'Sync & storage' }).click();
    await expect(page).toHaveURL(/\/en\/settings#sync-storage$/);
    await expect(page.getByRole('heading', { name: 'Sync & storage', exact: true })).toBeVisible();
    await page.goBack();

    await banner.getByRole('button', { name: 'Dismiss announcement' }).click();
    await expect(page.locator('.migration-banner')).toHaveCount(0);

    await page.goto('/en/about');
    await expect(page.locator('.migration-banner')).toHaveCount(0);

    const freshTab = await page.context().newPage();
    await freshTab.goto('/en/about');
    await expect(freshTab.locator('.migration-banner[role="alert"]')).toBeVisible();
  });

  test('warns guests to complete unfinished sessions before importing their history into an account', async ({
    page
  }) => {
    await resetAcceptance(page, 'Guest with saved unfinished practice', /\/en$/);

    const banner = page.locator('.migration-banner[role="alert"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('unfinished lesson or practice session');
    await expect(banner).toContainText('before importing its history into your account');
    await expect(
      banner.getByRole('link', { name: 'Recover history from the previous site' })
    ).toHaveAttribute('href', '/en/settings#device-recovery');
    await expect(banner.getByRole('link', { name: 'Complete saved session' })).toHaveAttribute(
      'href',
      '/en/morse/practice'
    );
    await banner.getByText('How to sync your history', { exact: true }).click();
    await expect(banner.getByRole('link', { name: 'Create account' })).toHaveAttribute(
      'href',
      '/en/register'
    );

    await banner.getByRole('link', { name: 'Complete saved session' }).click();
    const resume = page.getByRole('button', { name: 'Continue saved session' });
    await expect(resume).toBeVisible();
    await expect(page.locator('.migration-banner')).toHaveCount(0);
    await resume.click();
    await page.getByRole('button', { name: 'Start practice' }).click();
    await expect(page.getByRole('textbox', { name: 'Your copy' })).toBeVisible();
    await expect(page.locator('.migration-banner')).toHaveCount(0);
  });

  test('warns signed-in users about unsynchronized progress and offers retry/help', async ({
    page
  }) => {
    await resetAcceptance(page, 'Synthetic account / pending sync', /\/en\/settings$/);
    await page.goto('/en/about');

    const banner = page.locator('.migration-banner[role="alert"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(
      /Your progress is waiting to sync|Some progress could not sync/
    );
    const retry = banner.getByRole('button', { name: 'Retry sync' });
    await expect(retry).toBeVisible();
    await expect(retry).toBeEnabled();
    await expect(banner).toContainText(
      /do not clear site data|before moving or clearing browser data/
    );
    await expect(banner.getByRole('link', { name: 'Sync & storage' })).toHaveAttribute(
      'href',
      '/en/settings#sync-storage'
    );
  });
});
