import { expect, test } from '@playwright/test';

test.use({ hasTouch: true });
for (const theme of ['light', 'dark'] as const)
  for (const width of [1280, 1440, 320, 375, 390, 768]) {
    test(`landing hierarchy at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('/en');
      const banner = page.locator('.migration-banner');
      await expect(banner.getByRole('heading')).toHaveText('OpenCW is now Morsewell!');
      await expect(banner).toContainText('Progress saves in this browser');
      await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName(
        'Learn the code. Communicate well.'
      );
      await expect(page.locator('.welcome-lede')).toHaveText(
        'Listen to K and M in Morse code. Then type the letter you hear.'
      );
      const start = page.getByRole('link', { name: 'Start your first lesson', exact: true });
      await expect(start).toHaveAttribute('href', '/en/morse/learn/session?step=1');
      await expect(
        page.getByRole('link', { name: 'Already know Morse? Practice' })
      ).toHaveAttribute('href', '/en/morse/practice');
      await expect(page.locator('.welcome-demo')).toHaveCount(0);
      const preview = page.getByRole('region', { name: 'How the lessons build' });
      const rows = preview.getByRole('list').getByRole('listitem');
      await expect(rows.locator('strong')).toHaveText(['Lesson 1', 'Lesson 2', 'Lesson 3']);
      await expect(rows.locator('span')).toHaveText([
        'Hear the difference between K and M.',
        'Add R to the mix. Listen for K, M, or R.',
        'Add S and practice all four letters by ear.'
      ]);
      const footer = page.locator('.site-footer--full');
      await expect(footer).toBeVisible();
      await expect(
        footer.getByRole('navigation', { name: 'Explore' }).getByRole('link')
      ).toHaveText(['Learn', 'Practice', 'Progress', 'Forum']);
      await expect(
        footer.getByRole('navigation', { name: 'Morsewell' }).getByRole('link')
      ).toHaveText(['About', 'Resources & settings']);
      await expect(page.locator('.welcome').getByRole('link', { name: 'Sign in' })).toHaveCount(0);
      const languages = footer.getByRole('group', { name: 'Language' });
      await expect(languages.getByRole('button')).toHaveText([
        'English',
        'Deutsch',
        '日本語',
        '简体中文',
        '繁體中文'
      ]);
      const mobileMenu = page.locator('.navbar-mobile button');
      if (width < 960) {
        await expect(mobileMenu).toBeVisible();
        expect((await page.locator('.navbar').boundingBox())!.height).toBeLessThanOrEqual(65);
        await expect(page.locator('.bottom-nav')).toBeHidden();
      } else {
        await expect(mobileMenu).toBeHidden();
        await expect(page.locator('.navbar-links a')).toHaveText([
          'Learn',
          'Practice',
          'Progress',
          'Forum'
        ]);
      }
      if (width === 390) {
        const cta = await start.boundingBox();
        expect(cta!.y + cta!.height).toBeLessThanOrEqual(844);
        expect(
          (await page.locator('.welcome-art img').boundingBox())!.width
        ).toBeGreaterThanOrEqual(270);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false
      );
      await page.evaluate(() => window.scrollBy(0, innerHeight / 2));
      await expect(preview.getByRole('heading', { level: 2 })).toBeInViewport({ ratio: 1 });
    });
  }

for (const [name, path, heading] of [
  ['Start your first lesson', '/en/morse/learn/session?step=1', /^Meet [KM]$/],
  ['Already know Morse? Practice', '/en/morse/practice', 'Practice']
] as const) {
  test(`the landing link “${name}” opens its activity`, async ({ page }) => {
    await page.goto('/en');
    await page.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(path);
    await expect(page.getByRole('heading', { name: heading, level: 1, exact: true })).toBeVisible();
  });
}

for (const theme of ['light', 'dark'] as const)
  for (const width of [320, 375, 390])
    for (const signedIn of [false, true]) {
      test(`${width}px ${theme} menus for ${signedIn ? 'an account' : 'a guest'}`, async ({
        page,
        browserName
      }) => {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme: theme });
        const username = 'MorseOperatorWithAVeryLongUsername';
        if (signedIn) {
          await page.addInitScript((username) => {
            const payload = btoa(
              JSON.stringify({
                sub: '01900000-0000-7000-8000-000000000001',
                exp: Date.now() / 1000 + 3600
              })
            );
            localStorage.setItem('access_token', `fixture.${payload}.fixture`);
            localStorage.setItem('username', username);
          }, username);
          await page.route('**/v1/**', (route) => route.fulfill({ status: 503, body: '{}' }));
        }
        await page.goto('/en');
        if (signedIn) {
          await expect(page.locator('.home-dashboard')).toBeVisible();
          await expect(page.getByRole('contentinfo')).toHaveCount(0);
          await expect(page.locator('.navbar')).toBeHidden();
          const tabs = page.locator('.bottom-nav');
          await expect(tabs.getByRole('link', { name: 'Home' })).toHaveAttribute(
            'aria-current',
            'page'
          );
          await tabs.getByRole('link', { name: 'More' }).tap();
          await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
          await page.locator('main').getByRole('link', { name: 'Profile', exact: true }).tap();
          await expect(page).toHaveURL(/\/en\/profile$/);
          return;
        }
        const product = page
          .locator('.navbar-mobile')
          .getByRole('button', { name: 'Menu', exact: true });
        const account = page
          .locator('.navbar-account')
          .getByRole('button', { name: 'Guest', exact: true });
        const themeButton = page.getByRole('button', { name: /^Theme is / });
        await expect(account).toBeVisible();
        await expect(account.locator('.nav-chevron')).toBeVisible();
        await expect(product.locator('.nav-chevron')).toBeHidden();
        await expect(product).toHaveText('');
        const accountBox = await account.boundingBox();
        const themeBox = await themeButton.boundingBox();
        const productBox = await product.boundingBox();
        for (const target of [accountBox!, themeBox!, productBox!]) {
          expect(target.width).toBeGreaterThanOrEqual(44);
          expect(target.height).toBeGreaterThanOrEqual(44);
        }
        expect(themeBox!.x - accountBox!.x - accountBox!.width).toBeGreaterThanOrEqual(8);
        expect(productBox!.x - themeBox!.x - themeBox!.width).toBeGreaterThanOrEqual(8);
        expect(productBox!.x + productBox!.width).toBeCloseTo(width - 16, 0);
        const userIcon = (await account.locator('svg').first().boundingBox())!;
        const userCenter = userIcon.x + userIcon.width / 2;
        const themeCenter = themeBox!.x + themeBox!.width / 2;
        const menuCenter = productBox!.x + productBox!.width / 2;
        expect(themeCenter - userCenter).toBeCloseTo(menuCenter - themeCenter, 0);
        await account.focus();
        // macOS Safari uses Option-Tab when full keyboard navigation is disabled.
        const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
        await page.keyboard.press(tab);
        await expect(themeButton).toBeFocused();
        await page.keyboard.press(tab);
        await expect(product).toBeFocused();
        await product.tap();
        const menu = page.getByRole('menu', { name: 'Menu', exact: true });
        await expect(menu.getByRole('menuitem')).toHaveText([
          'Learn',
          'Practice',
          'Progress',
          'Forum'
        ]);
        const box = await menu.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        await page.keyboard.press('Escape');
        await product.focus();
        await page.keyboard.press('Enter');
        await expect(menu.getByRole('menuitem', { name: 'Learn', exact: true })).toBeFocused();
        await page.keyboard.press('End');
        await expect(menu.getByRole('menuitem', { name: 'Forum', exact: true })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(product).toBeFocused();
        await product.tap();
        await menu.getByRole('menuitem', { name: 'Practice', exact: true }).tap();
        await expect(page).toHaveURL(/\/en\/morse\/practice$/);
        await expect(product).toHaveCount(0);
        await expect(page.locator('.bottom-nav')).toBeVisible();
        await expect(page.locator('.navbar')).toBeHidden();
        await page.locator('.bottom-nav').getByRole('link', { name: 'More' }).tap();
        await expect(page.getByRole('link', { name: 'Login', exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Register', exact: true })).toBeVisible();
        await page.locator('main').getByRole('link', { name: 'Settings', exact: true }).tap();
        await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
          false
        );
      });
    }

test('mobile dropdowns clear the header and fit a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 320 });
  await page.goto('/en', { waitUntil: 'networkidle' });
  const header = page.locator('.navbar');
  const bar = (await header.boundingBox())!;
  for (const name of ['Guest', 'Menu']) {
    const trigger = header.getByRole('button', { name, exact: true });
    await trigger.press('Enter');
    const menu = header.getByRole('menu', { name, exact: true });
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.y - (bar.y + bar.height)).toBeGreaterThanOrEqual(8);
    expect(box.y + box.height).toBeLessThanOrEqual(320);
    await page.keyboard.press('End');
    const items = menu.getByRole('menuitem');
    await expect(items.last()).toBeFocused();
    await expect(items.last()).toBeInViewport({ ratio: 1 });
    await page.keyboard.press('Home');
    await expect(items.first()).toBeFocused();
    await expect(items.first()).toBeInViewport({ ratio: 1 });
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }
});

test('footer controls share rows when translated links wrap', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/de');
  await expect(page.locator('.migration-banner')).toBeVisible();
  const footer = page.getByRole('contentinfo');
  const columns = footer.getByRole('navigation');
  const explore = columns.first().getByRole('link');
  const project = columns.last();
  const rowItems = await project.getByRole('link').all();
  await expect(explore).toHaveCount(4);
  expect(rowItems).toHaveLength(2);
  for (const [row, item] of rowItems.entries()) {
    const left = await explore.nth(row).boundingBox();
    const right = await item.boundingBox();
    expect(Math.abs(left!.y + left!.height / 2 - (right!.y + right!.height / 2))).toBeLessThan(1);
  }
});

test('Home footer is reachable after the lesson preview', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto('/en');
  await expect(page.locator('.migration-banner')).toBeVisible();
  const footer = page.getByRole('contentinfo');
  await expect(footer).not.toBeInViewport();
  await page.keyboard.press('End');
  // At the document end, scroll offsets round to a pixel while the footer can end on a fraction.
  await expect(footer).toBeInViewport({ ratio: 0.99 });
  const choices = footer.getByRole('group', { name: 'Language' });
  await expect(choices).toBeInViewport({ ratio: 1 });
  const columns = footer.getByRole('navigation');
  for (const column of await columns.all()) {
    const box = (await column.boundingBox())!;
    expect((await choices.boundingBox())!.y).toBeGreaterThanOrEqual(box.y + box.height);
  }
  await page.keyboard.press('Home');
  await expect(footer).not.toBeInViewport();
});

test('footer language choices persist and the lesson button fits in every locale', async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en');
  // The announcement mounts client-side, so it also confirms hydration before input.
  await expect(page.locator('.migration-banner')).toBeVisible();
  const languages = page.getByRole('contentinfo').getByRole('group');
  for (const [locale, name] of [
    ['de', 'Deutsch'],
    ['ja', '日本語'],
    ['zh-Hans', '简体中文'],
    ['zh-Hant', '繁體中文'],
    ['en', 'English']
  ]) {
    const option = languages.getByRole('button', { name, exact: true });
    await option.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/${locale}$`));
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await page.reload();
    await expect(page.locator('.migration-banner')).toBeVisible();
    await expect(option).toHaveAttribute('aria-pressed', 'true');
    await expect(languages.getByRole('button', { pressed: true })).toHaveCount(1);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await expect(page.locator('.welcome-actions .btn-cta')).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false
    );
  }
});
