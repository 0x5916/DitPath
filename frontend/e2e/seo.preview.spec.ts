import { expect, test } from '@playwright/test';

test.describe('SEO metadata', () => {
  test('keeps a self-canonical and hreflang on translated pages', async ({ page }) => {
    await page.goto('/de/about');

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/de\/about$/);
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
      'href',
      /\/en\/about$/
    );
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute(
      'href',
      /\/en\/about$/
    );
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  });

  test('canonicalizes a shared forum thread to English without false translations', async ({
    page
  }) => {
    await page.goto('/zh-Hant/forum/01a163b8-d418-70ab-9d26-61f1bddc42bd');

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      /\/en\/forum\/01a163b8-d418-70ab-9d26-61f1bddc42bd$/
    );
    await expect(
      page.locator('link[rel="alternate"][hreflang]:not([hreflang="x-default"])')
    ).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant');
  });
});
