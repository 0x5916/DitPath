import { apiFetch, getAuthSession, assertAuthSessionCurrent } from './auth';
import { clearLearningPartition } from './data/clear-account';
import { CW_STORAGE_KEYS } from './storageKeys';
import {
  getTrainingOwner,
  publishTrainingEpoch,
  trainingEpoch,
  trainingEpochKey
} from './training-owner';

const header = 'X-Training-Epoch';

async function adoptEpoch(owner: string, next: number) {
  if (next <= trainingEpoch(owner) || !Number.isSafeInteger(next))
    throw new Error('Invalid training generation');
  // Publish only after all three databases have been cleared. A storage failure
  // leaves the previous generation fenced at the server and can safely retry.
  await clearLearningPartition(owner);
  if (getTrainingOwner() === owner) {
    publishTrainingEpoch(owner.split(':')[1], next);
  }
}

export async function requestTrainingData(owner: string, path: string, init: RequestInit = {}) {
  if (getTrainingOwner() !== owner) throw new DOMException('Training owner changed', 'AbortError');
  const headers = new Headers(init.headers);
  if (init.method && init.method !== 'GET' && trainingEpoch(owner) > 1)
    headers.set(header, String(trainingEpoch(owner)));
  const res = await apiFetch(path, { ...init, headers });
  const next = Number(res.headers.get(header));
  if ((res.ok || res.status === 409 || res.status === 410) && next > trainingEpoch(owner)) {
    await adoptEpoch(owner, next);
    throw new DOMException('Training history changed', 'AbortError');
  }
  return res;
}

export async function resetAccountProgress(signal: AbortSignal) {
  const owner = getTrainingOwner();
  if (!owner.startsWith('account:')) throw new Error('Sign in required');
  const session = getAuthSession();
  const res = await apiFetch('/user/progress', {
    method: 'DELETE',
    headers: { [header]: String(trainingEpoch(owner)) },
    signal
  });
  // A lost response may have committed the previous reset. Adopt the server's
  // generation without issuing a second deletion against newly recorded work.
  if (res.status !== 204 && res.status !== 409) throw new Error('Progress reset failed');
  await adoptEpoch(owner, Number(res.headers.get(header)));
  assertAuthSessionCurrent(session);
  if (res.status === 409) throw new Error('Progress changed, confirm the reset again');
}

export async function clearDeletedAccountData(owner: string) {
  try {
    await clearLearningPartition(owner, true);
  } finally {
    const id = owner.split(':')[1];
    for (const key of [CW_STORAGE_KEYS.cwSettings, CW_STORAGE_KEYS.cwSettingsUpdatedAt])
      localStorage.removeItem(`${key}.account.${id}`);
    // Training position is generation-scoped after a reset.
    const base = `account:${id}:`;
    for (const key of Object.keys(localStorage))
      if (
        [CW_STORAGE_KEYS.lesson, CW_STORAGE_KEYS.pageSettingsUpdatedAt].some((name) =>
          key.startsWith(`${name}.${base}`)
        )
      )
        localStorage.removeItem(key);
    localStorage.removeItem(trainingEpochKey(id));
  }
}
