import { expect, test } from '@playwright/test';

test('the full footer uses the same type and row sizes on phone and desktop', async ({ page }) => {
  await page.goto('/en');
  const footer = page.getByRole('contentinfo');
  const link = footer.getByRole('link', { name: 'Learn', exact: true });
  const language = footer.getByRole('button', { name: 'English', exact: true });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const item of [link, language]) {
      await expect(item).toHaveCSS('font-size', '14px');
      await expect(item).toHaveCSS('min-height', '32px');
    }
  }
});

const internalRoutes = [
  '/login',
  '/register',
  '/morse/learn',
  '/morse/practice',
  '/morse/progress',
  '/forum',
  '/settings'
];
for (const theme of ['light', 'dark'] as const)
  for (const width of [320, 375, 390, 768, 1280, 1440]) {
    test(`${width}px ${theme} internal navigation and footer variants`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      for (const path of internalRoutes) {
        await page.goto(`/en${path}`, { waitUntil: 'networkidle' });
        await expect(page.locator('.navbar-mobile')).toHaveCount(0);
        await expect(page.locator('.site-footer--full')).toHaveCount(0);
        const footer = page.locator('.site-footer--minimal');
        if (width < 960) {
          await expect(page.locator('.navbar')).toBeHidden();
          await expect(footer).toBeHidden();
          const bottom = page.locator('.bottom-nav');
          await expect(bottom).toBeVisible();
          await expect(bottom.getByRole('link')).toHaveText([
            'Home',
            'Practice',
            'Progress',
            'More'
          ]);
          await page.evaluate(() =>
            window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
          );
          // Routes can end with an unmounted/hidden dialog shell. Measure rendered content.
          const contentBottom = await page.locator('main').evaluate((main) =>
            Math.max(
              ...Array.from(main.querySelectorAll('*'))
                .filter((element) =>
                  element.checkVisibility({ visibilityProperty: true, opacityProperty: true })
                )
                .map((element) => element.getBoundingClientRect())
                .filter((rect) => rect.width > 0 && rect.height > 0)
                .map((rect) => rect.bottom)
            )
          );
          const bar = await bottom.boundingBox();
          expect(contentBottom, `${path} content clears bottom bar`).toBeLessThanOrEqual(
            bar!.y + 1
          );
        } else {
          await expect(page.locator('.navbar-brand')).toBeVisible();
          await expect(footer).toBeVisible();
          await expect(footer.getByRole('link')).toHaveText(['About', 'GitHub']);
          await expect(footer).not.toContainText('Learn Morse code the smart way');
          await expect(page.locator('.bottom-nav')).toBeHidden();
          if (path === '/login') {
            const box = await footer.boundingBox();
            expect(box!.y + box!.height).toBeGreaterThanOrEqual(899);
          }
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          path
        ).toBe(false);
      }
    });
  }

test('localized Home routes update the shell during client navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const locale of ['en', 'de', 'ja', 'zh-Hans', 'zh-Hant']) {
    await page.goto(`/${locale}`, { waitUntil: 'networkidle' });
    await expect(page.locator('.navbar-mobile button')).toBeVisible();
    await expect(page.locator('.bottom-nav')).toBeHidden();
    const footer = page.locator('.site-footer--full');
    for (const path of [
      '/morse/learn',
      '/morse/practice',
      '/morse/progress',
      '/forum',
      '/about',
      '/more'
    ]) {
      await expect(footer.locator(`a[href="/${locale}${path}"]`)).toHaveCount(1);
    }
    await footer.locator(`a[href="/${locale}/morse/practice"]`).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/morse/practice$`));
    await expect(page.locator('.navbar-mobile')).toHaveCount(0);
    await expect(page.locator('.site-footer--full')).toHaveCount(0);
    const home = page.locator(`.bottom-nav a[href="/${locale}"]`);
    await expect(home).toBeVisible();
    await home.click();
    await expect(page).toHaveURL(new RegExp(`/${locale}$`));
    await expect(page.locator('.navbar-mobile button')).toBeVisible();
    await expect(footer).toBeVisible();
  }
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.navbar-mobile button')).toBeVisible();
  await expect(page.locator('.site-footer--full')).toBeVisible();
});

test('internal More navigation still reaches Learn, Forum and account settings', async ({
  page
}) => {
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto('/en/morse/practice', { waitUntil: 'networkidle' });
  for (const [label, path] of [
    ['Learn', '/morse/learn'],
    ['Forum', '/forum'],
    ['Settings', '/settings']
  ]) {
    await page.locator('.bottom-nav').getByRole('link', { name: 'More', exact: true }).click();
    await page.locator('main').getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/en${path}$`));
    await expect(page.locator('.navbar-mobile')).toHaveCount(0);
    await expect(page.locator('.bottom-nav')).toBeVisible();
  }
});

test('guided sessions keep their own controls without shared navigation or footer', async ({
  page
}) => {
  await page.goto('/en/morse/learn/session?step=1', { waitUntil: 'networkidle' });
  await expect(page.locator('.navbar, .site-footer, .bottom-nav')).toHaveCount(0);
});

test('resizing across 960px closes a landing menu whose trigger is hidden', async ({ page }) => {
  await page.setViewportSize({ width: 959, height: 844 });
  await page.goto('/en');
  await expect(page.locator('.migration-banner')).toBeVisible();
  const trigger = page.locator('.navbar-mobile button');
  await trigger.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Learn' })).toBeFocused();
  await page.setViewportSize({ width: 960, height: 844 });
  await expect(page.locator('.navbar-desktop')).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await page.setViewportSize({ width: 959, height: 844 });
  await expect(trigger).toBeVisible();
  await expect(page.getByRole('menu')).toHaveCount(0);
});
