import { describe, expect, it } from 'vitest';
import { LEARNING_EVIDENCE_DB_NAME } from './data/learning-evidence';
import { LEARNING_PILOT_DB_NAME } from './data/learning-pilot';
import { TRAINING_DB_NAME, TRAINING_DB_VERSION } from './data/training-schema';
import { AUTH_STORAGE_KEYS, CW_STORAGE_KEYS, UI_STORAGE_KEYS } from './storageKeys';

// These names are user-data identities, not branding. Renaming any of them
// would make existing progress appear lost after the DitPath upgrade.
describe('legacy storage compatibility', () => {
  it('preserves IndexedDB database identities', () => {
    expect(TRAINING_DB_NAME).toBe('morsestep_training_v1');
    expect(TRAINING_DB_VERSION).toBe(2);
    expect(LEARNING_EVIDENCE_DB_NAME).toBe('opencw_learning_evidence_v1');
    expect(LEARNING_PILOT_DB_NAME).toBe('opencw_learning_pilot_v1');
  });

  it('preserves settings and authentication keys', () => {
    expect(CW_STORAGE_KEYS.lesson).toBe('learn.lesson');
    expect(CW_STORAGE_KEYS.cwSettings).toBe('cw.settings.v1');
    expect(CW_STORAGE_KEYS.cwSettingsUpdatedAt).toBe('cw.settings.updated_at.v1');
    expect(CW_STORAGE_KEYS.pageSettingsUpdatedAt).toBe('cw.page_settings.updated_at.v1');
    expect(CW_STORAGE_KEYS.progressQueue).toBe('cw.progress.queue.v1');

    expect(AUTH_STORAGE_KEYS.accessToken).toBe('access_token');
    expect(AUTH_STORAGE_KEYS.refreshToken).toBe('refresh_token');
    expect(AUTH_STORAGE_KEYS.username).toBe('username');
    expect(UI_STORAGE_KEYS.theme).toBe('theme');
  });
});
