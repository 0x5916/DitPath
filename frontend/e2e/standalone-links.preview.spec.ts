import { expect, test, type Locator } from '@playwright/test';

async function checkTargets(links: Locator, count: number) {
  await expect(links).toHaveCount(count);
  for (const link of await links.all()) {
    const target = await link.evaluate((node) => {
      node.scrollIntoView({ block: 'center', behavior: 'instant' });
      const box = node.getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        ownsEdges: [
          [box.left + 2, box.top + 2],
          [box.right - 2, box.bottom - 2]
        ].every(([x, y]) => node.contains(document.elementFromPoint(x, y)))
      };
    });
    expect(target.width).toBeGreaterThanOrEqual(43.99);
    expect(target.height).toBeGreaterThanOrEqual(43.99);
    expect(target.ownsEdges).toBe(true);
  }
}

test.describe('dedicated reading and recovery links', () => {
  test.use({ hasTouch: true, reducedMotion: 'reduce' });

  for (const locale of ['en', 'de']) {
    for (const width of [320, 390]) {
      test(`link edges stay tappable at ${width}px in ${locale}`, async ({ page, browserName }) => {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(`/${locale}/about`);
        const toc = page.locator('.about-toc a');
        await checkTargets(toc, 4);
        await checkTargets(page.locator('.about-links a, #your-data > a'), 2);
        await expect(page.locator('.about-section p a[href^="mailto:"]')).toHaveCSS(
          'display',
          'inline'
        );
        await toc.last().tap({ position: { x: 2, y: 2 } });
        await expect(page).toHaveURL(/#your-data$/);
        await page.locator('#your-data > a').tap({ position: { x: 2, y: 2 } });
        await expect(page).toHaveURL(`/${locale}/privacy`);
        await checkTargets(page.locator('article section a'), 4);
        const first = page.locator('article section a').first();
        await first.focus();
        await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
        const next = page.locator('article section a').nth(1);
        await expect(next).toBeFocused();
        await expect(next).toHaveCSS('outline-style', 'solid');

        const recovery = page.locator('.migration-banner .recovery-link');
        await checkTargets(recovery, 1);
        await recovery.tap({ position: { x: 2, y: 2 } });
        await expect(page).toHaveURL(`/${locale}/settings#device-recovery`);
        await checkTargets(page.locator('#device-recovery > a'), 1);
      });
    }
  }
});
