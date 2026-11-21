import { expect, test, type Page } from '@playwright/test';
import { readGuidedCheckpoint, readOwnedAttempts, readOwnedSessions, resetToHome } from './helpers';

/**
 * Headless Firefox on Linux has no audio device: AudioContext.resume() never
 * resolves and the introduction would remain on “Listening…” forever. This
 * test exercises guided session transitions, while audio.preview.spec.ts
 * keeps real Web Audio lifecycle coverage.
 */
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
        if (this.onended && document.documentElement.hasAttribute('data-hold-test-audio')) {
          window.addEventListener('finish-test-audio', () => this.onended?.(), { once: true });
        } else {
          setTimeout(() => this.onended?.(), Math.max(0, when * 1000));
        }
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

type GuidedPrompt = {
  id: string;
  spec: { kind: string; expectedText: string };
};

type GuidedCheckpoint = {
  state: {
    phase: string;
    currentPromptIndex: number;
    prompts: GuidedPrompt[];
  };
};

/** Hold the simulated tone long enough to inspect what the user sees during playback. */
async function holdAudio(page: Page) {
  await page.evaluate(() => document.documentElement.setAttribute('data-hold-test-audio', ''));
}

async function finishAudio(page: Page) {
  await page.evaluate(() => {
    document.documentElement.removeAttribute('data-hold-test-audio');
    window.dispatchEvent(new Event('finish-test-audio'));
  });
}

async function checkRecall(page: Page, expected: string, touch: boolean) {
  const prompt = page.locator('.recognition');
  const play = prompt.getByRole('button', { name: 'Play sound', exact: true });
  const replay = prompt.getByRole('button', { name: 'Replay sound', exact: true });
  const input = prompt.getByRole('textbox', { name: 'Type your answer' });
  const instruction = prompt.getByText(
    'Type one character. Your answer is submitted automatically.'
  );
  const listening = prompt.getByText('Listening…', { exact: true }).filter({ visible: true });
  const playHint = prompt.getByText('Press Space or the play button to hear the sound.');
  const replayHint = prompt.getByText('Press Space to replay.');
  await expect(play).toBeEnabled();
  await expect(prompt.getByRole('heading', { name: 'Listen', exact: true })).toBeVisible();
  await expect(instruction).toBeHidden();
  await expect(prompt.getByRole('textbox', { disabled: false })).toHaveCount(0);
  if (!touch) await expect(playHint).toBeVisible();
  await expect(replayHint).toBeHidden();
  const decoded = new RegExp(`\\b${expected}\\b|[.·•−–-]{2,}`);
  for (const control of [play, replay]) {
    await holdAudio(page);
    if (touch) await control.tap();
    else await page.keyboard.press('Space');
    await expect(listening).toHaveCount(1);
    await expect(input).toBeDisabled();
    await expect(instruction).toBeHidden();
    await expect(playHint).toBeHidden();
    await expect(replayHint).toBeHidden();
    await expect(prompt.getByRole('textbox', { disabled: false })).toHaveCount(0);
    await expect(prompt.locator('[aria-keyshortcuts~="Space"]')).toHaveCount(0);
    await expect(prompt).not.toContainText(decoded);
    await finishAudio(page);
    await expect(input).toBeEnabled();
    await expect(prompt.getByRole('heading', { name: 'Now type what you hear' })).toBeVisible();
    await expect(instruction).toBeVisible();
    await expect(replay).toBeEnabled();
    await expect(listening).toHaveCount(0);
    if (!touch) await expect(replayHint).toBeVisible();
    await expect(playHint).toBeHidden();
    await expect(prompt).not.toContainText(decoded);
    if (!touch) await expect(input).toBeFocused();
  }
  await input.fill(expected);
  const proceed = prompt.getByRole('button', { name: 'Continue', exact: true });
  await expect(proceed).toBeEnabled();
  await expect(replayHint).toBeHidden();
  await expect(proceed).toHaveAttribute('aria-keyshortcuts', 'Enter');
  if (touch) await proceed.tap();
  else await page.keyboard.press('Enter');
}

async function completeGuidedLesson(page: Page, touch: boolean) {
  test.setTimeout(120_000);
  await resetToHome(page);
  await installDeterministicAudioClock(page);
  await page.goto('/morse/learn/session?step=1');

  await expect
    .poll(async () => (await readGuidedCheckpoint(page)) !== null, { timeout: 10_000 })
    .toBe(true);
  const checkpoint = (await readGuidedCheckpoint(page)) as GuidedCheckpoint;
  const prompts = checkpoint.state.prompts;
  const firstRecall = prompts.findIndex((prompt) => prompt.spec.kind === 'recall');
  expect(firstRecall).toBeGreaterThan(0);

  for (const [index, prompt] of prompts.entries()) {
    const { kind, expectedText: expected } = prompt.spec;
    if (kind === 'introduction') {
      const listen = page.getByRole('button', { name: `Listen to ${expected}` });
      if (index === 0) {
        await holdAudio(page);
        if (touch) await listen.tap();
        else await listen.press('Enter');
        await expect(
          page.getByText('Listening…', { exact: true }).filter({ visible: true })
        ).toHaveCount(1);
        await expect(page.locator('.introduction [aria-keyshortcuts]')).toHaveCount(0);
        await finishAudio(page);
      } else if (await listen.isVisible()) await listen.click();
      const proceed = page.getByRole('button', { name: 'Continue' });
      await expect(proceed).toBeVisible({ timeout: 10_000 });
      await proceed.click();
    } else if (index === firstRecall) {
      await checkRecall(page, expected, touch);
    } else {
      const play = page.getByRole('button', { name: 'Play sound' });
      if (await play.isVisible().catch(() => false)) await play.click();

      if (kind === 'recall' || kind === 'short-group') {
        const input = page.getByRole('textbox', { name: 'Type your answer' });
        await expect(input).toBeEnabled({ timeout: 10_000 });
        await input.fill(expected);
      } else {
        const option = page.getByRole('button', { name: `Select ${expected}`, exact: true });
        await expect(option).toBeEnabled({ timeout: 10_000 });
        await option.click();
      }

      const proceed = page.getByRole('button', { name: 'Continue' });
      await expect(proceed).toBeVisible({ timeout: 10_000 });
      await proceed.click();
    }

    await expect
      .poll(
        async () => {
          const next = (await readGuidedCheckpoint(page)) as GuidedCheckpoint | null;
          return next?.state.currentPromptIndex ?? prompts.length;
        },
        { timeout: 10_000 }
      )
      .toBeGreaterThan(index);
  }

  await expect(page.getByRole('region', { name: 'Session results' })).toBeVisible({
    timeout: 10_000
  });
  await expect.poll(async () => readGuidedCheckpoint(page)).toBeNull();

  const sessions = await readOwnedSessions(page);
  const attempts = await readOwnedAttempts(page);
  const guided = sessions.filter((session) => session.mode === 'guided');
  expect(guided).toHaveLength(1);
  expect(guided[0]).toMatchObject({ status: 'completed', completedPromptCount: prompts.length });
  expect(attempts.length).toBeGreaterThan(0);
  expect(new Set(attempts.map((attempt) => attempt.id)).size).toBe(attempts.length);
  expect(attempts.every((attempt) => attempt.sessionId === guided[0].id)).toBe(true);
  expect(attempts.filter((attempt) => attempt.promptId === prompts[firstRecall].id)).toEqual([
    expect.objectContaining({ replayCount: 1, isCorrect: true })
  ]);

  await expect(page.getByRole('button', { name: 'Finish for today' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Finish for today' }).click();
  await expect(page).toHaveURL(/\/en\/morse\/learn$/);
  expect(
    (await readOwnedSessions(page)).filter((session) => session.mode === 'guided')
  ).toHaveLength(1);
}

test('a guided lesson completes once with phase-specific playback cues and keyboard replay', async ({
  page
}) => {
  await completeGuidedLesson(page, false);
});

test.describe('guided playback on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, colorScheme: 'dark' });

  test('tapping Play, Replay and Continue completes the guided lesson once', async ({ page }) => {
    await completeGuidedLesson(page, true);
  });
});
