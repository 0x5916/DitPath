import { deleteTrainingDb, openTrainingDb } from '../../src/lib/data/training-db';
import { createAttemptRepository } from '../../src/lib/data/attempt-repository';
import { createSessionRepository } from '../../src/lib/data/session-repository';
import { AUTH_STORAGE_KEYS, CW_STORAGE_KEYS } from '../../src/lib/storageKeys';
import { ACCOUNT_ID, buildFixture, SCENARIOS, type Scenario } from './fixtures';
import { FIXTURE_EVIDENCE_DB, resetLearningPilotFixture, resetEvidenceFixture } from './faults';

/** Seed a valid copy checkpoint without importing app-env-dependent modules. */
async function seedGuestCheckpoint() {
  const now = new Date().toISOString();
  const checkpoint = {
    version: 1,
    kind: 'copy',
    id: 'copy',
    href: '/morse/practice',
    savedAt: now,
    draft: 'K',
    attempt: {
      id: 'fixture-checkpoint-attempt',
      exercise: { lesson: 1, text: 'KM' },
      settings: { charWpm: 20, effWpm: 12, freq: 600, volume: 1, startDelay: 0 },
      session: { status: 'ready', attempt: 1, recordedAttempt: null },
      duration: 0,
      startedAt: now,
      review: null
    }
  };
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(FIXTURE_EVIDENCE_DB, 1);
    request.onupgradeneeded = () => {
      for (const store of ['records', 'outbox'])
        request.result
          .createObjectStore(store, { keyPath: ['owner', 'id'] })
          .createIndex('owner', 'owner');
      request.result.createObjectStore('meta', { keyPath: ['owner', 'key'] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('meta', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore('meta').put({ owner: 'unclaimed', key: 'checkpoint:copy', value: checkpoint });
    });
  } finally {
    db.close();
  }
}

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
  await resetEvidenceFixture(indexedDB, () => {
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
  if (scenario === 'guest-checkpoint') await seedGuestCheckpoint();
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
