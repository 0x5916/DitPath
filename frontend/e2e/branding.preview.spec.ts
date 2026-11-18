import { expect, test, type Page } from '@playwright/test';

const LOCALES = ['en', 'de', 'ja', 'zh-Hans', 'zh-Hant'] as const;

/**
 * The migration banner deliberately names the former product. Branding belongs
 * to every other visible element on the page.
 */
async function expectNoLegacyBrandOutsideBanner(page: Page) {
  const text = await page.locator('body').evaluate((body) => {
    const clone = body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.migration-banner').forEach((banner) => banner.remove());
    return clone.textContent ?? '';
  });
  expect(text).not.toMatch(/DitPath|OpenCW/);
}
const BRANDED_ROUTES = [
  '/about',
  '/morse/learn',
  '/morse/practice',
  '/morse/progress',
  '/forum',
  '/settings',
  '/login',
  '/register'
] as const;

test.describe('Morsewell public branding', () => {
  for (const locale of LOCALES) {
    test(`uses Morsewell on the ${locale} home page`, async ({ page }) => {
      await page.goto(`/${locale}`);

      await expect(page).toHaveTitle(/Morsewell/);
      await expect(page.getByRole('link', { name: 'Morsewell', exact: true })).toBeVisible();
      await expectNoLegacyBrandOutsideBanner(page);
    });
  }

  test('exposes Morsewell in page metadata and the accessible brand link', async ({ page }) => {
    await page.goto('/en/about');

    await expect(page).toHaveTitle(/Morsewell/);
    await expect(page.getByRole('link', { name: 'Morsewell', exact: true })).toHaveAttribute(
      'href',
      '/en'
    );
    await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute(
      'content',
      'Morsewell'
    );
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /Morsewell/);
    await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute(
      'content',
      /Morsewell/
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/en\/about$/);
  });

  for (const route of BRANDED_ROUTES) {
    test(`has no legacy branding on ${route}`, async ({ page }) => {
      await page.goto(`/en${route}`);

      await expect(page).toHaveTitle(/Morsewell/);
      await expectNoLegacyBrandOutsideBanner(page);
    });
  }
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1280, 960]) {
    test(`${theme} account navigation at ${width}px uses the session username`, async ({
      page
    }) => {
      const username = 'MorseOperatorWithAVeryLongUsername';
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme === 'dark' ? 'light' : 'dark' });
      await page.addInitScript(
        ({ theme, username }) => {
          localStorage.setItem('theme', theme);
          const payload = btoa(
            JSON.stringify({
              sub: '01900000-0000-7000-8000-000000000001',
              exp: Math.floor(Date.now() / 1000) + 3600
            })
          );
          localStorage.setItem('access_token', `fixture.${payload}.fixture`);
          localStorage.setItem('username', username);
        },
        { theme, username }
      );
      // Exercise the real session state without a live account or API dependency.
      await page.route('**/v1/**', (route) => route.fulfill({ status: 503, body: '{}' }));
      await page.goto('/en/morse/practice');
      const navbar = page.locator('.navbar');
      const account = navbar.getByRole('button', { name: username, exact: true });
      await expect(account).toBeVisible();
      await expect(account.locator('.nav-account-label')).toHaveText(username);
      await expect(navbar.getByRole('link', { name: 'Morsewell', exact: true })).toBeVisible();
      await expect(navbar.locator('img')).toHaveCount(0);
      await expect(page.locator('body')).toHaveCSS(
        'background-color',
        theme === 'dark' ? 'rgb(21, 25, 27)' : 'rgb(247, 248, 243)'
      );
      await expect(page.locator('body')).toHaveCSS(
        'color',
        theme === 'dark' ? 'rgb(237, 241, 240)' : 'rgb(28, 50, 40)'
      );
      const brand = await navbar.locator('.navbar-brand').boundingBox();
      const learn = await navbar.getByRole('link', { name: 'Learn', exact: true }).boundingBox();
      const forum = await navbar.getByRole('link', { name: 'Forum', exact: true }).boundingBox();
      const control = await account.boundingBox();
      expect(learn!.x - (brand!.x + brand!.width)).toBeLessThan(40);
      expect(control!.x).toBeGreaterThan(forum!.x + forum!.width);

      await account.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('menuitem', { name: 'Profile' })).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeFocused();
      await page.keyboard.press('End');
      await expect(page.getByRole('menuitem', { name: 'Logout' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(account).toBeFocused();
      await expect(account).toHaveAttribute('aria-expanded', 'false');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      const bounds = await account.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    });
  }
}

test('guest account menu and system theme remain available on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/en');
  const account = page.locator('.navbar-account .navbar-user-btn');
  await expect(account).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(21, 25, 27)');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(247, 248, 243)');
  await account.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('menuitem', { name: 'Login', exact: true })).toHaveAttribute(
    'href',
    '/en/login'
  );
  await expect(page.getByRole('menuitem', { name: 'Register', exact: true })).toHaveAttribute(
    'href',
    '/en/register'
  );
  await page.keyboard.press('Escape');
  await expect(account).toBeFocused();
  await expect(page.locator('.welcome-art img')).toHaveAttribute('src', /ditpath-icon-material/);
});
