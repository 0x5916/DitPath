import { getAuthAccountId } from './auth';

const prefix = 'morsewell.training-epoch.';
const changedEvent = 'morsewell:training-epoch';

export function trainingEpoch(owner: string): number {
  return Number(owner.split(':')[2] ?? 1);
}

export function trainingEpochKey(accountId: string) {
  return prefix + accountId;
}

// Generation one retains the existing IndexedDB partition for legacy records.
// A writer holding an older owner key can never populate the new partition.
export function getTrainingOwner(): string {
  const id = getAuthAccountId();
  if (!id || typeof window === 'undefined') return 'unclaimed';
  const epoch = Number(window.localStorage?.getItem(trainingEpochKey(id)) ?? 1);
  if (!Number.isSafeInteger(epoch) || epoch < 1)
    throw new Error('Invalid stored training generation');
  return epoch === 1 ? `account:${id}` : `account:${id}:${epoch}`;
}

export function publishTrainingEpoch(accountId: string, epoch: number) {
  localStorage.setItem(trainingEpochKey(accountId), String(epoch));
  window.dispatchEvent(new Event(changedEvent));
}

export function subscribeTrainingEpoch(changed: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(prefix)) changed();
  };
  window.addEventListener(changedEvent, changed);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(changedEvent, changed);
    window.removeEventListener('storage', storage);
  };
}
