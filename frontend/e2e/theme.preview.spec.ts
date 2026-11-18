import { expect, test } from '@playwright/test';

test('keyboard cycling applies the theme and remembers it on reload', async ({
  page,
  browserName
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/en', { waitUntil: 'networkidle' });
  const theme = page.getByRole('button', { name: /^Theme is / });
  const root = page.locator('html');
  await expect(theme).toHaveAccessibleName('Theme is Auto. Switch to Light.');
  await expect(theme).toHaveText('Auto', { useInnerText: true });
  await page.getByRole('button', { name: 'Guest', exact: true }).focus();
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(theme).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(theme).toHaveAccessibleName('Theme is Light. Switch to Dark.');
  await expect(theme).toHaveText('Light', { useInnerText: true });
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(root).toHaveCSS('color-scheme', 'light');
  await page.keyboard.press('Space');
  await expect(theme).toHaveText('Dark', { useInnerText: true });
  await expect(root).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');

  await page.reload({ waitUntil: 'networkidle' });
  await expect(theme).toHaveAccessibleName('Theme is Dark. Switch to Auto.');
  await expect(theme).toHaveText('Dark', { useInnerText: true });
  await theme.press('Enter');
  await expect(theme).toHaveAccessibleName('Theme is Auto. Switch to Light.');
  await expect(theme).toHaveText('Auto', { useInnerText: true });
  await expect(root).not.toHaveAttribute('data-theme');
  await expect(root).toHaveCSS('color-scheme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveCSS('color-scheme', 'light');
});

test('the header and Settings theme controls update each other immediately', async ({ page }) => {
  await page.goto('/en/settings', { waitUntil: 'networkidle' });
  const select = page.getByRole('combobox', { name: 'Theme', exact: true });
  const theme = page.getByRole('button', { name: /^Theme is / });
  await select.selectOption('dark');
  await expect(theme).toHaveAccessibleName('Theme is Dark. Switch to Auto.');
  await theme.click();
  await expect(select).toHaveValue('auto');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
});

test('the icon-only mobile theme control follows shared header visibility', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/en', { waitUntil: 'networkidle' });
  const theme = page.getByRole('button', { name: /^Theme is / });
  await expect(theme).toHaveAccessibleName('Theme is Auto. Switch to Light.');
  await expect(theme).toHaveText('', { useInnerText: true });
  await theme.click();
  await expect(theme).toHaveAccessibleName('Theme is Light. Switch to Dark.');

  await page.goto('/en/settings', { waitUntil: 'networkidle' });
  await expect(theme).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Theme', exact: true })).toHaveValue('light');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(theme).toBeVisible();
  await page.goto('/en/morse/learn/session?step=1', { waitUntil: 'networkidle' });
  await expect(theme).toHaveCount(0);
});

test('the theme icon animates on change and respects reduced motion', async ({ page }) => {
  const theme = page.getByRole('button', { name: /^Theme is / });
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion });
    await page.goto('/en', { waitUntil: 'networkidle' });
    const durations = await theme.evaluate(async (button: HTMLButtonElement) => {
      button.click();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return button
        .getAnimations({ subtree: true })
        .map((animation) => Number(animation.effect?.getTiming().duration));
    });
    if (reducedMotion === 'reduce') expect(Math.max(0, ...durations)).toBeLessThan(1);
    else expect(durations.map(Math.round)).toContain(180);
  }
});
