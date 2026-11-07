import { expect, test } from '@playwright/test';

const LOCALES = ['en', 'de', 'ja', 'zh-Hans', 'zh-Hant'] as const;
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

test.describe('DitPath public branding', () => {
  for (const locale of LOCALES) {
    test(`uses DitPath on the ${locale} home page`, async ({ page }) => {
      await page.goto(`/${locale}`);

      await expect(page).toHaveTitle(/DitPath/);
      await expect(page.getByRole('link', { name: 'DitPath', exact: true })).toBeVisible();
      await expect(page.locator('body')).not.toContainText('OpenCW');
    });
  }

  test('exposes DitPath in page metadata and the accessible brand link', async ({ page }) => {
    await page.goto('/en/about');

    await expect(page).toHaveTitle(/DitPath/);
    await expect(page.getByRole('link', { name: 'DitPath', exact: true })).toHaveAttribute(
      'href',
      '/en'
    );
    await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute(
      'content',
      'DitPath'
    );
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /DitPath/);
    await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute('content', /DitPath/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/en\/about$/);
  });

  for (const route of BRANDED_ROUTES) {
    test(`has no legacy branding on ${route}`, async ({ page }) => {
      await page.goto(`/en${route}`);

      await expect(page).toHaveTitle(/DitPath/);
      await expect(page.locator('body')).not.toContainText('OpenCW');
    });
  }
});
