import { expect, test, type Page } from '@playwright/test';
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
  await expect(page.getByRole('heading', { name: 'Lessons', level: 1 })).toBeVisible();
  await expect(page.getByText('1 of 39 lessons unlocked')).toBeVisible();
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
