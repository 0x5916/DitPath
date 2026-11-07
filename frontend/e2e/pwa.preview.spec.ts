import { expect, test } from '@playwright/test';

test.describe('DitPath PWA behavior', () => {
  test('serves the manifest, install metadata, and icon assets', async ({ page, request }) => {
    await page.goto('/en');

    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest'
    );
    await expect(page.locator('meta[name="application-name"]')).toHaveAttribute(
      'content',
      'DitPath'
    );
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
      'content',
      'DitPath'
    );
    await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      /\/apple-touch-icon\.png$/
    );
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute(
      'content',
      '1200'
    );
    await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute(
      'content',
      '630'
    );
    await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute(
      'content',
      /DitPath/
    );
    await expect(page.locator('meta[name="twitter:image:alt"]')).toHaveAttribute(
      'content',
      /DitPath/
    );

    const response = await request.get('/manifest.webmanifest');
    expect(response.ok()).toBe(true);
    const manifest = (await response.json()) as {
      name: string;
      short_name: string;
      display: string;
      icons: Array<{ src: string; sizes: string; purpose: string }>;
    };
    expect(manifest.name).toBe('DitPath');
    expect(manifest.short_name).toBe('DitPath');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: '/icon-192.png', sizes: '192x192', purpose: 'any' }),
        expect.objectContaining({ src: '/icon-512.png', sizes: '512x512', purpose: 'any' }),
        expect.objectContaining({
          src: '/icon-maskable-192.png',
          sizes: '192x192',
          purpose: 'maskable'
        }),
        expect.objectContaining({
          src: '/icon-maskable-512.png',
          sizes: '512x512',
          purpose: 'maskable'
        })
      ])
    );

    for (const icon of manifest.icons) {
      const iconResponse = await request.get(icon.src);
      expect(iconResponse.ok(), icon.src).toBe(true);
      expect(iconResponse.headers()['content-type'], icon.src).toContain('image/png');
    }
  });

  test('registers the service worker and controls the page after reload', async ({ page }) => {
    await page.goto('/en');

    const registration = await page.evaluate(async () => {
      const ready = await navigator.serviceWorker.ready;
      return {
        active: Boolean(ready.active),
        scope: ready.scope
      };
    });

    expect(registration.active).toBe(true);
    expect(new URL(registration.scope).pathname).toBe('/');

    await page.reload();
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);

    const cached = await page.evaluate(async () => {
      const cacheNames = await caches.keys();
      return cacheNames.filter((name) => name.startsWith('morsestep-cache-'));
    });
    expect(cached.length).toBeGreaterThan(0);
  });
});
