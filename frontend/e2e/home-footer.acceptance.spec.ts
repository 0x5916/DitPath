import { expect, test } from '@playwright/test';
import { resetAcceptance, resetToHome } from './helpers';

test('the full footer follows the landing view on the same Home URL', async ({ page }) => {
  await page.setViewportSize({ width: 959, height: 844 });
  await resetToHome(page);
  await expect(page.locator('.welcome')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toBeVisible();
  await expect(page.locator('.navbar-mobile button')).toBeVisible();
  await expect(page.locator('.bottom-nav')).toBeHidden();

  await resetToHome(page, 'Returning learner / populated history');
  await expect(page.locator('.home-dashboard')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toHaveCount(0);
  await expect(page.locator('.navbar')).toBeHidden();
  const tabs = page.locator('.bottom-nav');
  await expect(tabs.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  await tabs.getByRole('link', { name: 'Practice' }).click();
  await expect(page).toHaveURL(/\/en\/morse\/practice$/);
  await expect(tabs.getByRole('link', { name: 'Practice' })).toHaveAttribute(
    'aria-current',
    'page'
  );
  await page.goBack();
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.locator('.home-dashboard')).toBeVisible();
  await expect(tabs).toBeVisible();

  await page.setViewportSize({ width: 960, height: 844 });
  await expect(page.locator('.navbar-desktop')).toBeVisible();
  await expect(tabs).toBeHidden();

  await page.goto('/de');
  await expect(page.locator('.home-dashboard')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toHaveCount(0);
});

test('signing out from More updates the navigation on an open Home tab', async ({
  page,
  context
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await resetAcceptance(page, 'Synthetic account / pending sync', /\/en\/settings$/);
  const home = await context.newPage();
  await home.setViewportSize({ width: 390, height: 844 });
  await home.goto('/en');
  await expect(home.locator('.home-dashboard')).toBeVisible();
  await expect(home.locator('.bottom-nav')).toBeVisible();
  await page.locator('.bottom-nav').getByRole('link', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Logout' }).click();
  for (const tab of [page, home]) {
    await expect(tab).toHaveURL(/\/en$/);
    await expect(
      tab.locator('.navbar-account').getByRole('button', { name: 'Guest' })
    ).toBeVisible();
    await expect(tab.locator('.navbar-mobile button')).toBeVisible();
    await expect(tab.locator('.bottom-nav')).toBeHidden();
  }
});

test('an unknown session-like URL uses the normal error navigation', async ({
  page,
  browserName
}) => {
  await page.setViewportSize({ width: 959, height: 844 });
  await page.goto('/en/morse/learn/session-missing');
  await expect(page.locator('main .error-actions')).toBeVisible();
  await expect(page.locator('.navbar')).toBeHidden();
  await expect(page.locator('.bottom-nav')).toBeVisible();
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await page.setViewportSize({ width: 960, height: 844 });
  await expect(page.locator('.navbar-desktop')).toBeVisible();
  await expect(page.locator('.bottom-nav')).toBeHidden();
});
