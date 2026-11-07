import { expect, test } from '@playwright/test';
import { resetAcceptance } from './helpers';

test.describe('DitPath migration data guidance', () => {
  test('warns guests with browser-local history and keeps critical dismissal session-only', async ({
    page
  }) => {
    await resetAcceptance(page, 'Returning learner / populated history', /\/en$/);

    const banner = page.locator('.migration-banner[role="alert"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Save your progress before the move');
    await expect(banner).toContainText('will not move automatically to ditpath.com');
    await expect(banner).toContainText('import this device’s history');
    await expect(banner.getByRole('link', { name: 'Create account' })).toHaveAttribute(
      'href',
      '/en/register'
    );
    await expect(banner.getByRole('link', { name: 'Sync & storage' })).toHaveAttribute(
      'href',
      '/en/settings#sync-storage'
    );

    await banner.getByRole('button', { name: 'Dismiss announcement' }).click();
    await expect(page.locator('.migration-banner')).toHaveCount(0);

    await page.goto('/en/about');
    await expect(page.locator('.migration-banner')).toHaveCount(0);
  });

  test('warns guests that unfinished saved sessions are not included in account import', async ({
    page
  }) => {
    await resetAcceptance(page, 'Guest with saved unfinished practice', /\/en$/);

    const banner = page.locator('.migration-banner[role="alert"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('unfinished lesson or practice session');
    await expect(banner).toContainText('not included in account import');
    await expect(banner.getByRole('link', { name: 'Finish saved session' })).toHaveAttribute(
      'href',
      '/en/morse/practice'
    );
    await expect(banner.getByRole('link', { name: 'Create account' })).toHaveAttribute(
      'href',
      '/en/register'
    );
  });

  test('warns signed-in users about unsynchronized progress and offers retry/help', async ({
    page
  }) => {
    await resetAcceptance(page, 'Synthetic account / pending sync', /\/en\/settings$/);
    await page.goto('/en/about');

    const banner = page.locator('.migration-banner[role="alert"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(
      /Sync your progress before you move|Some progress could not sync/
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
