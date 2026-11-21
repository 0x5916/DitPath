import { expect, test, type Page } from '@playwright/test';
import de from '../messages/de.json' with { type: 'json' };
import en from '../messages/en.json' with { type: 'json' };
import { readGuidedCheckpoint, resetToHome } from './helpers';

async function installDeterministicAudioClock(page: Page) {
  await page.addInitScript(() => {
    class FakeParam {
      value = 0;
      setValueAtTime() {}
      linearRampToValueAtTime() {}
    }
    class FakeGain {
      gain = new FakeParam();
      connect() {}
      disconnect() {}
    }
    class FakeOscillator {
      frequency = new FakeParam();
      onended: (() => void) | null = null;
      connect() {}
      disconnect() {}
      start() {}
      stop(when = 0) {
        setTimeout(() => this.onended?.(), Math.max(0, when * 1000));
      }
    }
    class FakeAudioContext {
      state = 'running';
      currentTime = 0;
      destination = {};
      baseLatency = 0;
      outputLatency = 0;
      createOscillator() {
        return new FakeOscillator();
      }
      createGain() {
        return new FakeGain();
      }
      async resume() {
        this.state = 'running';
      }
      async suspend() {
        this.state = 'suspended';
      }
      async close() {
        this.state = 'closed';
      }
    }
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      writable: true,
      value: FakeAudioContext
    });
  });
}

test('a locked direct lesson URL shows recovery and preserves the course gate', async ({
  page
}) => {
  await resetToHome(page);
  await page.goto('/morse/learn/session?step=2');

  await expect(
    page.getByRole('heading', { name: 'Lesson 2 is not unlocked yet', level: 1 })
  ).toBeVisible();
  await expect(page.getByText('Complete the current guided lesson requirements')).toBeVisible();

  await page.getByRole('link', { name: 'Back to Lessons' }).click();
  await expect(page).toHaveURL(/\/en\/morse\/learn$/);
  await expect(page.getByRole('heading', { name: 'Learn', level: 1 })).toBeVisible();
  await expect(page.getByText('1 of 39 lessons unlocked')).toBeVisible();
});

test.describe('guided-session phone header', () => {
  test.use({ hasTouch: true });
  for (const [locale, labels] of Object.entries({ en, de })) {
    for (const width of [320, 390]) {
      test(`fits labels and separates touch targets at ${width}px (${locale})`, async ({
        page
      }) => {
        await page.setViewportSize({ width, height: 844 });
        await resetToHome(page);
        await page.goto(`/${locale}/morse/learn/session?step=1`);
        const header = page.locator('.session-header');
        const buttons = header.getByRole('button');
        await expect(buttons).toHaveCount(3);
        const save = header.getByRole('button', { name: labels.session_save_leave, exact: true });
        const pause = header.getByRole('button', { name: labels.lesson_pause, exact: true });
        const progress = header.getByRole('progressbar');
        const readout = progress.locator('.progress-readout');
        await expect(readout).toHaveText(/^\s*1\s*\/\s*[1-9]\d*\s*$/);
        await expect(readout).toBeInViewport({ ratio: 1 });
        const countUnobscured = await readout.locator('span').evaluateAll((parts) =>
          parts.every((part) => {
            const { left, top, width, height } = part.getBoundingClientRect();
            return part.contains(document.elementFromPoint(left + width / 2, top + height / 2));
          })
        );
        expect(countUnobscured).toBe(true);

        const boxes = await buttons.evaluateAll((controls) =>
          controls.map((control) => {
            const { left, right, top, bottom, width, height } = control.getBoundingClientRect();
            return { left, right, top, bottom, width, height };
          })
        );
        for (const box of boxes) {
          expect(box.width).toBeGreaterThanOrEqual(43.99);
          expect(box.height).toBeGreaterThanOrEqual(43.99);
          expect(box.left).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(width);
        }
        const [, saveBox, pauseBox] = boxes;
        const gap = Math.max(pauseBox.left - saveBox.right, pauseBox.top - saveBox.bottom);
        expect(gap).toBeGreaterThanOrEqual(7.99);
        const labelInset = await save.evaluate((button) => {
          const box = button.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(button);
          const text = range.getBoundingClientRect();
          return Math.min(
            text.left - box.left,
            box.right - text.right,
            text.top - box.top,
            box.bottom - text.bottom
          );
        });
        expect(labelInset).toBeGreaterThanOrEqual(-0.01);

        await pause.tap();
        await expect(page.getByRole('heading', { name: labels.lesson_paused })).toBeVisible();
        await header.getByRole('button', { name: labels.lesson_resume }).tap();
        await expect(pause).toBeVisible();
        await expect(page.getByRole('heading', { name: labels.lesson_paused })).toHaveCount(0);
      });
    }
  }
});

test('an unlocked lesson starts, saves, and restores its checkpoint', async ({ page }) => {
  await installDeterministicAudioClock(page);
  await resetToHome(page);
  await page.goto('/morse/learn/session?step=1');

  await expect
    .poll(async () => (await readGuidedCheckpoint(page)) !== null, { timeout: 10_000 })
    .toBe(true);
  const started = (await readGuidedCheckpoint(page)) as {
    id: string;
    record: { step: number };
    state: { currentPromptIndex: number };
  };
  expect(started.record.step).toBe(1);

  await page.getByRole('button', { name: 'Save & leave' }).click();
  await page.waitForURL('**/en/morse/learn');
  await expect(page.getByRole('link', { name: 'Continue saved session' })).toBeVisible();

  await page.getByRole('link', { name: 'Continue saved session' }).click();
  await expect
    .poll(async () => (await readGuidedCheckpoint(page)) !== null, { timeout: 10_000 })
    .toBe(true);
  const restored = (await readGuidedCheckpoint(page)) as {
    id: string;
    record: { step: number };
    state: { currentPromptIndex: number };
  };
  expect(restored.id).toBe(started.id);
  expect(restored.record.step).toBe(started.record.step);
  expect(restored.state.currentPromptIndex).toBe(started.state.currentPromptIndex);
});

test('the returning fixture unlocks and starts Lesson 2 directly', async ({ page }) => {
  await installDeterministicAudioClock(page);
  await resetToHome(page, 'Returning learner / populated history');
  await page.goto('/morse/learn/session?step=2');

  await expect(page.getByRole('heading', { name: 'Lesson 2 is not unlocked yet' })).toHaveCount(0);
  await expect
    .poll(async () => (await readGuidedCheckpoint(page)) !== null, { timeout: 10_000 })
    .toBe(true);
  const checkpoint = (await readGuidedCheckpoint(page)) as { record: { step: number } };
  expect(checkpoint.record.step).toBe(2);
});
