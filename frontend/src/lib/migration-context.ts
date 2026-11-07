import { createAttemptRepository } from './data/attempt-repository';
import { createLearningEvidenceRepository, openLearningEvidenceDb } from './data/learning-evidence';
import { createSessionRepository } from './data/session-repository';
import { validCheckpoint, type SessionCheckpoint } from './data/session-checkpoints';
import { openTrainingDb } from './data/training-db';
import { createTrainingSyncRepository } from './data/training-sync-repository';
import { getTrainingOwner } from './training-sync.svelte';

export interface MigrationBannerContext {
  owner: string;
  signedIn: boolean;
  hasHistory: boolean;
  hasCheckpoints: boolean;
  hasUnimportedDeviceData: boolean;
  hasUnclaimedCheckpoints: boolean;
  checkpointHref: string | null;
  error: boolean;
}

function checkpointHref(checkpoints: SessionCheckpoint[]): string | null {
  if (checkpoints.some((checkpoint) => checkpoint.kind === 'guided')) return '/morse/learn';
  if (checkpoints.some((checkpoint) => checkpoint.kind === 'copy')) return '/morse/practice';
  return null;
}

/**
 * Read only the local facts needed to choose the migration announcement.
 * Training and evidence are separate stores; a failure in one must not hide
 * facts from the other. The caller ignores stale results by owner/version.
 */
export async function loadMigrationBannerContext(): Promise<MigrationBannerContext> {
  const owner = getTrainingOwner();
  const signedIn = owner.startsWith('account:');
  let error = false;

  let guestTraining = 0;
  let accountTraining = 0;
  let unimportedTraining = 0;

  try {
    const db = await openTrainingDb();
    try {
      const guestAttempts = await createAttemptRepository(db, 'unclaimed').countAttempts();
      const guestSessions = await createSessionRepository(db, 'unclaimed').getSessions();
      guestTraining = guestAttempts + guestSessions.length;

      if (signedIn) {
        const accountAttempts = await createAttemptRepository(db, owner).countAttempts();
        const accountSessions = await createSessionRepository(db, owner).getSessions();
        accountTraining = accountAttempts + accountSessions.length;
        unimportedTraining = await createTrainingSyncRepository(db, owner).getUnclaimedCount();
      }
    } finally {
      db.close();
    }
  } catch {
    error = true;
  }

  let guestEvidenceCount = 0;
  let guestEvidenceBlocked = false;
  let accountEvidenceCount = 0;
  let currentCheckpoints: SessionCheckpoint[] = [];
  let unclaimedCheckpoints: SessionCheckpoint[] = [];

  try {
    const db = await openLearningEvidenceDb();
    try {
      const current = createLearningEvidenceRepository(db, owner);
      const unclaimed = createLearningEvidenceRepository(db, 'unclaimed');
      const importStatus = await current.getImportStatus();
      guestEvidenceCount = importStatus.count;
      guestEvidenceBlocked = importStatus.blocked;
      currentCheckpoints = (await current.checkpoints()).filter(validCheckpoint);

      if (signedIn) {
        unclaimedCheckpoints = (await unclaimed.checkpoints()).filter(validCheckpoint);
        accountEvidenceCount = (await current.all()).length;
      } else {
        unclaimedCheckpoints = currentCheckpoints;
      }
    } finally {
      db.close();
    }
  } catch {
    error = true;
  }

  const guestEvidence = guestEvidenceCount + (guestEvidenceBlocked ? 1 : 0);
  const hasUnclaimedCheckpoints = signedIn && unclaimedCheckpoints.length > 0;
  const hasUnimportedDeviceData =
    signedIn && (unimportedTraining > 0 || guestEvidenceCount > 0 || guestEvidenceBlocked);

  return {
    owner,
    signedIn,
    hasHistory: signedIn
      ? accountTraining > 0 || accountEvidenceCount > 0
      : guestTraining > 0 || guestEvidence > 0,
    hasCheckpoints: currentCheckpoints.length > 0,
    hasUnimportedDeviceData,
    hasUnclaimedCheckpoints,
    checkpointHref: checkpointHref(currentCheckpoints),
    error
  };
}
