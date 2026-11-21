import { expect, test, type Locator } from '@playwright/test';
import de from '../messages/de.json' with { type: 'json' };
import en from '../messages/en.json' with { type: 'json' };
import { resetToHome, startAndType } from './helpers';

// Firefox can report a 48px CSS box as 47.99997px because layout is fractional.
// Keep a sub-pixel tolerance while still enforcing the intended minimum target.
const TARGET_EPSILON = 0.01;

test('keyboard-only practice starts, checks, and closes the result', async ({ page }) => {
  await resetToHome(page);
  await page.goto('/morse/practice');
  const start = page.getByRole('button', { name: 'Start practice' });
  await expect(start).toBeVisible();
  await start.focus();
  await page.keyboard.press('Space');

  const answer = page.getByRole('textbox', { name: 'Your copy' });
  await expect(answer).toBeFocused();
  await page.keyboard.type('KM');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Practice results' });
  const close = dialog.getByRole('button', { name: 'Close', exact: true });
  const finish = dialog.getByRole('button', { name: 'Finish for today' });
  await expect(finish).toBeEnabled();
  await page.keyboard.press('Shift+Tab');
  await expect(finish).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(finish).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(answer).toBeFocused();

  const review = page.getByRole('button', { name: 'Review', exact: true });
  await review.press('Enter');
  await close.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(review).toBeFocused();
});

for (const { input, viewport, colorScheme } of [
  { input: 'mouse', viewport: { width: 1440, height: 900 }, colorScheme: 'light' },
  { input: 'touch', viewport: { width: 390, height: 844 }, colorScheme: 'dark' }
] as const) {
  test.describe(`Practice results with ${input}`, () => {
    test.use({ viewport, colorScheme, hasTouch: input === 'touch', reducedMotion: 'reduce' });

    test('the backdrop intercepts activation over the Progress link', async ({ page }) => {
      await resetToHome(page);
      await page.goto('/en/morse/practice');
      const progress = page.getByRole('navigation', { name: 'Primary' }).getByRole('link', {
        name: 'Progress',
        exact: true
      });
      await expect(progress).toBeInViewport();
      const { x, y } = await progress.evaluate((link) => {
        const box = link.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      });

      const answer = await startAndType(page);
      await answer.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Practice results' });
      await expect(dialog.getByText('Practice result saved on this device')).toBeVisible();

      // Hit the overlapping coordinates through the browser's real pointer dispatch.
      if (input === 'touch') await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);

      await expect(dialog).toHaveCount(0);
      await expect(page).toHaveURL(/\/en\/morse\/practice$/);
      await expect(answer).toBeFocused();
    });
  });
}

test('the Practice title tip matches the Penpot heading and close treatment', async ({ page }) => {
  await resetToHome(page);
  await page.goto('/morse/practice', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const trigger = page.getByRole('button', { name: 'About Practice' });
  await trigger.click();

  const dialog = page.getByRole('dialog', { name: 'About Practice' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('About Practice', { exact: true })).toBeVisible();
  const close = dialog.getByRole('button', { name: 'Close' });
  await expect(close).toBeVisible();

  const triggerBox = await trigger.boundingBox();
  const closeBox = await close.boundingBox();
  const dialogBox = await dialog.boundingBox();
  expect(triggerBox?.width ?? 0).toBeGreaterThanOrEqual(48 - TARGET_EPSILON);
  expect(triggerBox?.height ?? 0).toBeGreaterThanOrEqual(48 - TARGET_EPSILON);
  expect(closeBox?.width ?? 0).toBeGreaterThanOrEqual(48 - TARGET_EPSILON);
  expect(closeBox?.height ?? 0).toBeGreaterThanOrEqual(48 - TARGET_EPSILON);
  expect(
    (dialogBox?.y ?? 0) - ((triggerBox?.y ?? 0) + (triggerBox?.height ?? 0))
  ).toBeGreaterThanOrEqual(8 - TARGET_EPSILON);

  await close.click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('all locales fit at 320px in dark mode', async ({ page }) => {
  await resetToHome(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const locale of ['en', 'de', 'ja', 'zh-Hans', 'zh-Hant']) {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`/${locale}/morse/practice`, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1
    );
    expect(overflow, `${locale} Practice overflows at 320px`).toBe(false);
    await expect(page.locator('main .player-play-btn').first()).toBeVisible();
  }
});

async function measure(locator: Locator) {
  return locator.evaluate((element) => {
    const { left, right, width, height } = element.getBoundingClientRect();
    return {
      left,
      right,
      width,
      height,
      fontSize: getComputedStyle(element).fontSize
    };
  });
}

test('Start practice matches Start lesson on mobile and desktop', async ({ page }) => {
  await resetToHome(page);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/en/morse/learn');
    const lesson = await measure(page.getByRole('button', { name: 'Start lesson 1', exact: true }));
    if (width === 390) {
      const column = await measure(page.locator('.current-content'));
      expect(lesson.left).toBeCloseTo(column.left);
      expect(lesson.right).toBeCloseTo(column.right);
    }

    await page.goto('/en/morse/practice');
    const start = await measure(page.getByRole('button', { name: 'Start practice' }));
    expect(start.fontSize).toBe(lesson.fontSize);
    expect(start.height).toBeCloseTo(lesson.height);
    if (width === 390) {
      const field = await measure(page.getByRole('combobox', { name: 'Practice content' }));
      expect(start.left).toBeCloseTo(field.left);
      expect(start.right).toBeCloseTo(field.right);
    } else {
      expect(start.width).toBeCloseTo(lesson.width);
    }
  }
});

for (const [width, textPercent, locale] of [
  [390, 100, 'en'],
  [390, 100, 'de'],
  [320, 100, 'en'],
  [320, 200, 'en']
] as const) {
  test(`Practice transport reflows at ${width}px with ${textPercent}% text (${locale})`, async ({
    page
  }) => {
    const labels = locale === 'de' ? de : en;
    await page.setViewportSize({ width, height: 844 });
    await resetToHome(page);
    await page.goto(`/${locale}/morse/practice`, { waitUntil: 'networkidle' });
    await page.evaluate((percent) => {
      document.documentElement.style.fontSize = `${percent}%`;
    }, textPercent);
    await expect(page.locator('html')).toHaveCSS(
      'font-size',
      textPercent === 200 ? '32px' : '16px'
    );
    const button = (name: string) => page.getByRole('button', { name, exact: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width + 1
    );
    await button(labels.practice_start).click();
    const answer = page.getByRole('textbox', { name: labels.trainer_answer_label });
    await expect(answer).toBeFocused();
    for (const label of [labels.player_pause, labels.player_resume]) {
      await expect(button(label)).toBeEnabled();
      // Playback focuses the copy field, which can scroll the page between browser calls.
      const controls = await page.locator('.player-media-controls button').evaluateAll((buttons) =>
        buttons.map((element) => {
          const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
          return { left, right, top, bottom, width, height };
        })
      );
      expect(controls).toHaveLength(3);
      for (const [index, box] of controls.entries()) {
        expect(box.width).toBeGreaterThanOrEqual(44 - TARGET_EPSILON);
        expect(box.height).toBeGreaterThanOrEqual(44 - TARGET_EPSILON);
        expect(box.left).toBeGreaterThanOrEqual(-TARGET_EPSILON);
        expect(box.right).toBeLessThanOrEqual(width + TARGET_EPSILON);
        if (index === 0) continue;
        const previous = controls[index - 1];
        const sameRow = box.top < previous.bottom && box.bottom > previous.top;
        if (width === 390) expect(sameRow).toBe(true);
        const gap = sameRow ? box.left - previous.right : box.top - previous.bottom;
        expect(gap).toBeGreaterThanOrEqual(8 - TARGET_EPSILON);
      }
      const timer = await measure(page.locator('.player-inline-timer'));
      expect(timer.right).toBeLessThanOrEqual(width + TARGET_EPSILON);
      await button(label).click();
    }
    await button(labels.player_skip_next).click();
    await button(labels.player_stop).click();
    await expect(button(labels.trainer_replay)).toBeEnabled();
    await answer.fill('KM');
    await expect(answer).toHaveValue('KM');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width + 1
    );
  });
}

for (const width of [320, 390, 1280]) {
  test(`key routes fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
    await resetToHome(page);
    const routes = [
      ['/en', page.getByRole('link', { name: 'Start your first lesson', exact: true })],
      ['/en/morse/learn', page.getByText(/lessons unlocked$/)],
      ['/en/morse/practice', page.getByRole('button', { name: 'Start practice', exact: true })],
      ['/en/morse/progress', page.getByRole('heading', { name: 'No training history yet' })]
    ] as const;

    for (const [path, ready] of routes) {
      if (path !== '/en') await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(ready).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1
      );
      expect(overflow, `${path} overflows at ${width}px`).toBe(false);

      if (width === 390 && path === '/en/morse/practice') {
        const box = await ready.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44 - TARGET_EPSILON);
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(44 - TARGET_EPSILON);
      }
    }
  });
}
