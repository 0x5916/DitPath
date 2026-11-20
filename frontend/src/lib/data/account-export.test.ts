import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { downloadAccountData } from './account-export';
import { openTrainingDb, reqToPromise, withTransaction } from './training-db';
import { OWNED_STORES } from './training-schema';
import { apiFetch, assertAuthSessionCurrent } from '../auth';
import { getTrainingOwner } from '../training-owner';
import { emptyCopyAttempt } from '../practice/copy-attempt';
import { buildReviewPlan } from '../training/targeted-review';
import { createLearningEvidenceRepository, openLearningEvidenceDb } from './learning-evidence';
import { createLearningPilotRepositories, openLearningPilotDb } from './learning-pilot';
import { saveCheckpoint } from './session-checkpoints';

vi.mock('../auth', () => ({
  getAuthAccountId: () => 'alice-id',
  getAuthSession: () => ({ username: 'alice', generation: 1 }),
  assertAuthSessionCurrent: vi.fn(),
  apiFetch: vi.fn()
}));
vi.mock('../api', () => ({
  getUserInfo: async () => ({
    username: 'alice',
    email: 'alice@example.test',
    password_hash: 'private-secret'
  }),
  getSettings: async () => ({
    cw_settings: { freq: 700, target_daily_minutes: 10 },
    page_settings: { language: 'en' }
  }),
  getEmailPreferences: async () => ({
    support: true,
    product: false,
    unsubscribe_token: 'private-secret'
  })
}));
vi.mock('../training-owner', () => ({ getTrainingOwner: vi.fn(), trainingEpoch: () => 1 }));
const owner = 'account:alice-id';
const anchor = { click: vi.fn(), download: '' };
const page = (kind?: string, record?: object, more = false) =>
  Response.json({
    changes: kind ? [{ revision: '1', kind, record }] : [],
    next_cursor: 'opaque+/=',
    has_more: more
  });
const observed = {
  id: 'seen',
  kind: 'observation',
  recorded_at: '2026-10-20T00:00:00Z',
  policy_version: 'learning-policy-1.0'
};
let archive: Blob | undefined;
beforeEach(() => {
  vi.mocked(getTrainingOwner).mockReturnValue(owner);
  vi.mocked(assertAuthSessionCurrent).mockReset();
  const localStorage = { getItem: (key: string) => (key === 'theme' ? 'dark' : null) };
  vi.stubGlobal('localStorage', localStorage);
  vi.stubGlobal('window', { localStorage, indexedDB: new IDBFactory() });
  vi.stubGlobal('document', { createElement: () => anchor });
  vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
    if (!(value instanceof Blob)) throw Error('Expected a JSON download');
    archive = value;
    return 'blob:test';
  });
  vi.mocked(apiFetch).mockImplementation(async (path) => {
    if (path === '/training/snapshot') return Response.json({ character_masteries: [] });
    if (path.includes('learning-evidence')) return page('observation', observed);
    if (path.includes('cursor=opaque%2B%2F%3D'))
      return page('session', { session_id: 's', lesson: 2 });
    return page('attempt', { id: 'synced', entered_text: 'K', api_key: 'private-secret' }, true);
  });
  archive = undefined;
  anchor.click.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('downloads every cloud page and only this account’s additional local records', async () => {
  const db = await openTrainingDb();
  const name = OWNED_STORES.attempts;
  await withTransaction(db, name, 'readwrite', async (s) => {
    for (const [ownerKey, id] of [
      [owner, 'synced'],
      [owner, 'pending'],
      ['account:bob', 'foreign'],
      ['unclaimed', 'guest']
    ]) {
      await reqToPromise(s[name].put({ ownerKey, id, enteredText: id }));
    }
  });
  db.close();
  await downloadAccountData(new AbortController().signal);
  expect(anchor.click).toHaveBeenCalledOnce();
  expect(anchor.download).toMatch(/^morsewell-account-\d{4}-\d{2}-\d{2}\.json$/);
  expect(archive?.type).toBe('application/json');
  const data = await archive!.text();
  expect(data).not.toMatch(/private-secret|password_hash|foreign|guest/);
  expect(JSON.parse(data)).toMatchObject({
    account: { username: 'alice' },
    preferences: {
      sound: { target_daily_minutes: 10 },
      email: { support: true },
      device: { theme: 'dark' }
    },
    learning_progress: {
      attempts: [{ id: 'synced' }],
      sessions: [{ session_id: 's' }],
      evidence: [observed],
      this_device: { attempts: [{ id: 'pending' }] }
    }
  });
});

it('exports only the signed-in learner’s offline evidence, copy draft and review history', async () => {
  const startedAt = '2026-10-28T00:00:00.000Z';
  const settings = { charWpm: 20, effWpm: 12, freqHz: 600 };
  const targets = ['K', 'M'];
  const plan = buildReviewPlan({ purpose: 'coaching', targets }, ['K', 'M', 'R', 'S'], settings);
  const evidenceDb = await openLearningEvidenceDb();
  const pilotDb = await openLearningPilotDb();
  try {
    for (const [ownerKey, marker] of [
      [owner, 'alice'],
      ['account:bob', 'other-learner'],
      ['unclaimed', 'guest-learner']
    ]) {
      await createLearningEvidenceRepository(evidenceDb, ownerKey).append([
        {
          id: `exposure-${marker}`,
          kind: 'exposure-open',
          policy_version: 'learning-policy-1.0',
          recorded_at: startedAt,
          session_id: null,
          characters: ['K'],
          source: 'reference',
          presentation_id: `prompt-${marker}`,
          started_at: null
        }
      ]);
      await saveCheckpoint(ownerKey, {
        version: 1,
        kind: 'copy',
        id: 'copy',
        href: '/morse/practice',
        savedAt: startedAt,
        draft: `draft-${marker}`,
        attempt: {
          ...emptyCopyAttempt(),
          id: `practice-${marker}`,
          exercise: { text: 'KM', lesson: 1 },
          session: { status: 'awaiting-check', attempt: 1, recordedAttempt: null }
        }
      });
      await createLearningPilotRepositories(pilotDb, ownerKey, plan).sessionRepo.saveSession({
        schemaVersion: 1,
        id: `review-${marker}`,
        step: 1,
        ...settings,
        startedAt,
        status: 'in-progress',
        promptCount: plan.prompts.length,
        completedPromptCount: 0
      });
    }
  } finally {
    evidenceDb.close();
    pilotDb.close();
  }
  await downloadAccountData(new AbortController().signal);
  const json = await archive!.text();
  expect(JSON.parse(json).learning_progress.this_device).toMatchObject({
    evidence: [{ id: 'exposure-alice' }],
    saved_sessions: [{ kind: 'copy', draft: 'draft-alice' }],
    pilot_history: [{ id: 'review-alice', targets }]
  });
  expect(json).not.toMatch(/other-learner|guest-learner/);
});

it.each(['abort', 'session', 'partition', 'epoch', 'http', 'invalid', 'stalled'] as const)(
  'discards incomplete exports on %s',
  async (fault) => {
    const controller = new AbortController();
    const original = vi.mocked(apiFetch).getMockImplementation()!;
    vi.mocked(apiFetch).mockImplementation(async (path, init) => {
      if (!path.includes('cursor=')) return original(path, init);
      if (fault === 'epoch') return Response.json({}, { headers: { 'X-Training-Epoch': '2' } });
      if (fault === 'http') return new Response(null, { status: 503 });
      if (fault === 'invalid') return Response.json({ has_more: false });
      if (fault === 'stalled') return page('attempt', { id: 'repeated' }, true);
      if (fault === 'abort') controller.abort();
      if (fault === 'session')
        vi.mocked(assertAuthSessionCurrent).mockImplementation(() => {
          throw Error('session changed');
        });
      if (fault === 'partition') vi.mocked(getTrainingOwner).mockReturnValue(owner + ':2');
      return page();
    });
    await expect(downloadAccountData(controller.signal)).rejects.toThrow();
    expect(anchor.click).not.toHaveBeenCalled();
  }
);
