import { expect, test, type Locator } from '@playwright/test';
import { resetAcceptance, resetToHome } from './helpers';

test('Profile, Progress and Morse table keep their destination icons across navigation', async ({
  page
}) => {
  async function expectDestination(link: Locator, path: string, icon: string) {
    await expect(link).toHaveAttribute('href', `/en${path}`);
    await expect(link.locator(`svg.lucide-${icon}[aria-hidden="true"]`)).toBeVisible();
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await resetToHome(page, 'Returning learner / populated history');
  const table = page.getByRole('main').getByRole('link', { name: 'Morse table', exact: true });
  await expectDestination(table, '/morse', 'book-open');
  const profileItem = page.getByRole('menuitem', { name: 'Profile', exact: true });
  await page.getByRole('button', { name: 'Guest', exact: true }).press('ArrowDown');
  await expectDestination(profileItem, '/profile', 'user');
  await expect(profileItem).toBeFocused();
  await profileItem.press('Enter');
  await expect(page).toHaveURL(/\/en\/profile$/);

  await page.setViewportSize({ width: 390, height: 844 });
  const tabs = page.locator('.bottom-nav');
  const more = tabs.getByRole('link', { name: 'More', exact: true });
  await expect(more).toHaveAttribute('aria-current', 'location');
  await more.click();
  await expectDestination(table, '/morse', 'book-open');
  await expectDestination(
    page.getByRole('main').getByRole('link', { name: 'Profile', exact: true }),
    '/profile',
    'user'
  );
  await table.click();
  await expect(page).toHaveURL(/\/en\/morse$/);
  const progress = tabs.getByRole('link', { name: 'Progress', exact: true });
  await expectDestination(progress, '/morse/progress', 'layout-dashboard');
  await progress.click();
  await expect(progress).toHaveAttribute('aria-current', 'page');
  await more.click();
  await page.getByRole('main').getByRole('link', { name: 'Learn', exact: true }).click();
  await expect(tabs.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute(
    'aria-current',
    'location'
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await resetAcceptance(page, 'Synthetic account / pending sync', /\/en\/settings$/);
  await page.getByRole('button', { name: 'Synthetic learner', exact: true }).press('ArrowDown');
  await expectDestination(profileItem, '/profile', 'user');
});

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
