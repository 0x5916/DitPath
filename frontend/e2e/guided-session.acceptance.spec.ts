import { expect, test } from '@playwright/test';
import { readGuidedCheckpoint, readOwnedAttempts, readOwnedSessions, resetToHome } from './helpers';

type GuidedPrompt = {
  spec: { kind: string; expectedText: string };
};

type GuidedCheckpoint = {
  state: {
    phase: string;
    currentPromptIndex: number;
    prompts: GuidedPrompt[];
  };
};

test('a guided lesson completes once and records one completed session', async ({ page }) => {
  test.setTimeout(120_000);
  await resetToHome(page);
  await page.goto('/morse/learn/session?step=1');

  await expect
    .poll(async () => (await readGuidedCheckpoint(page)) !== null, { timeout: 10_000 })
    .toBe(true);
  const checkpoint = (await readGuidedCheckpoint(page)) as GuidedCheckpoint;
  const prompts = checkpoint.state.prompts;
  expect(prompts.length).toBeGreaterThan(0);

  for (const [index, prompt] of prompts.entries()) {
    const { kind, expectedText: expected } = prompt.spec;
    if (kind === 'introduction') {
      const listen = page.getByRole('button', { name: `Listen to ${expected}` });
      if (await listen.isVisible().catch(() => false)) await listen.click();
      const proceed = page.getByRole('button', { name: 'Continue' });
      await expect(proceed).toBeVisible({ timeout: 10_000 });
      await proceed.click();
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

  await expect(page.getByRole('button', { name: 'Finish for today' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Finish for today' }).click();
  await expect(page).toHaveURL(/\/en\/morse\/learn$/);
  expect(
    (await readOwnedSessions(page)).filter((session) => session.mode === 'guided')
  ).toHaveLength(1);
});
