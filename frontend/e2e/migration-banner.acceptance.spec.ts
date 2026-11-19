import { expect, test } from '@playwright/test';
import { resetAcceptance } from './helpers';

test.describe('Morsewell migration data guidance', () => {
  test('warns guests with browser-local history and keeps critical dismissal session-only', async ({
    page
  }) => {
    await resetAcceptance(page, 'Returning learner / populated history', /\/en$/);

    const banner = page.locator('.migration-banner[role="alert"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('OpenCW is now Morsewell!');
    await expect(banner).toContainText('will not transfer automatically');
    await expect(banner).toContainText('import your device history');
    await expect(banner).toContainText('confirm synchronization');
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
    await expect(banner.getByRole('link', { name: 'Create account' })).toHaveAttribute(
      'href',
      '/en/register'
    );

    await banner.getByRole('link', { name: 'Complete saved session' }).click();
    const resume = page.getByRole('button', { name: 'Continue saved session' });
    await expect(resume).toBeVisible();
    await expect(page.locator('.migration-banner')).toHaveCount(0);
    await resume.click();
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
