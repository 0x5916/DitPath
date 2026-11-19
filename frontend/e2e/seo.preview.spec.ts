import { expect, test } from '@playwright/test';

test.describe('public privacy policy', () => {
  test.use({ javaScriptEnabled: false });

  for (const [locale, title] of Object.entries({
    en: 'Privacy policy',
    de: 'Datenschutzerklärung',
    ja: 'プライバシーポリシー',
    'zh-Hans': '隐私政策',
    'zh-Hant': '隱私權政策'
  })) {
    test(`publishes the ${locale} policy and contact without sign-in or JavaScript`, async ({
      page
    }) => {
      const path = `/${locale}/privacy`;
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
      await expect(page.getByRole('link', { name: 'privacy@morsewell.com' })).toHaveAttribute(
        'href',
        'mailto:privacy@morsewell.com'
      );
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        'href',
        new RegExp(`${path}$`)
      );
      for (const entry of ['', '/login', '/register', '/about']) {
        await page.goto(`/${locale}${entry}`);
        const link = page.getByRole('link', { name: title, exact: true });
        await expect(link).toBeVisible();
        await expect(link).toHaveAttribute('href', path);
      }
    });
  }
});

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
