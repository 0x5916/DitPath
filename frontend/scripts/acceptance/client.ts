import { deleteTrainingDb, openTrainingDb } from '../../src/lib/data/training-db';
import { createAttemptRepository } from '../../src/lib/data/attempt-repository';
import { createSessionRepository } from '../../src/lib/data/session-repository';
import { AUTH_STORAGE_KEYS, CW_STORAGE_KEYS } from '../../src/lib/storageKeys';
import { ACCOUNT_ID, buildFixture, SCENARIOS, type Scenario } from './fixtures';
import { resetLearningPilotFixture } from './faults';

async function selectScenario(scenario: Scenario) {
  if (location.origin !== 'http://127.0.0.1:4174') throw new Error('Wrong fixture origin');
  const status = document.getElementById('status')!;
  status.textContent = 'Preparing synthetic data…';
  sessionStorage.removeItem('acceptance.failSave');
  sessionStorage.removeItem('acceptance.loadingUntil');
  for (const key of [...Object.values(AUTH_STORAGE_KEYS), ...Object.values(CW_STORAGE_KEYS)])
    localStorage.removeItem(key);
  await deleteTrainingDb(undefined, () => {
    status.textContent = 'Close other acceptance tabs to continue.';
  });
  await resetLearningPilotFixture(indexedDB, () => {
    status.textContent = 'Close other acceptance tabs to continue.';
  });
  const signedIn = scenario === 'pending-sync' || scenario === 'account-error';
  const owner = signedIn ? `account:${ACCOUNT_ID}` : 'unclaimed';
  if (signedIn) {
    const payload = btoa(
      JSON.stringify({ sub: ACCOUNT_ID, exp: Math.floor(Date.now() / 1000) + 86400 })
    );
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, `fixture.${payload}.fixture`);
    localStorage.setItem(AUTH_STORAGE_KEYS.username, 'Synthetic learner');
  }
  const db = await openTrainingDb();
  try {
    const fixture = buildFixture(scenario, Date.now());
    await createAttemptRepository(db, owner).saveAttempts(fixture.attempts);
    for (const session of fixture.sessions)
      await createSessionRepository(db, owner).saveSession(session);
  } finally {
    db.close();
  }
  if (scenario === 'save-once') sessionStorage.setItem('acceptance.failSave', 'once');
  if (scenario === 'loading')
    sessionStorage.setItem('acceptance.loadingUntil', String(Date.now() + 10_000));
  location.assign(`/en${SCENARIOS[scenario][1]}`);
}

// This module is served only by the opt-in local chooser, never imported by the app.
if (typeof document !== 'undefined') {
  for (const [scenario, [label]] of Object.entries(SCENARIOS)) {
    const p = document.createElement('p');
    const button = document.createElement('button');
    button.textContent = label;
    button.onclick = async () => {
      document.querySelectorAll('button').forEach((b) => {
        b.disabled = true;
      });
      try {
        await selectScenario(scenario as Scenario);
      } catch (error) {
        document.getElementById('status')!.textContent = String(error);
        document.querySelectorAll('button').forEach((b) => {
          b.disabled = false;
        });
      }
    };
    p.append(button);
    document.getElementById('scenarios')!.append(p);
  }
}
