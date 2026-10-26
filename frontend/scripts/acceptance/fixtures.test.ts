import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { openTrainingDb } from '../../src/lib/data/training-db';
import { createAttemptRepository } from '../../src/lib/data/attempt-repository';
import { createSessionRepository } from '../../src/lib/data/session-repository';
import { createTrainingSyncRepository } from '../../src/lib/data/training-sync-repository';
import { deriveCourseGuidance } from '../../src/lib/training/v2/course-guidance';
import { ACCOUNT_ID, buildFixture } from './fixtures';
import { acceptanceSave, acceptanceTransform, FIXTURE_DB } from './faults';

const now = Date.parse('2026-10-26T12:00:00Z');
afterEach(() => vi.unstubAllGlobals());

describe('acceptance fixture behavior', () => {
  it('reproduces empty, returning and complete guidance with synthetic evidence', () => {
    expect(buildFixture('newcomer', now).attempts).toHaveLength(0);
    const guidance = (scenario: 'returning' | 'complete') =>
      deriveCourseGuidance(buildFixture(scenario, now).attempts, new Date(now).toISOString());
    expect(guidance('returning').currentStep).toBe(2);
    expect(guidance('complete').courseComplete).toBe(true);
    expect(buildFixture('returning', now)).toEqual(buildFixture('returning', now));
  });

  it('seeds pending uploads for one owner without leaking to another account', async () => {
    const db = await openTrainingDb(new IDBFactory());
    try {
      const owner = `account:${ACCOUNT_ID}`;
      const fixture = buildFixture('pending-sync', now);
      await createAttemptRepository(db, owner).saveAttempts(fixture.attempts);
      for (const session of fixture.sessions)
        await createSessionRepository(db, owner).saveSession(session);
      expect(await createTrainingSyncRepository(db, owner).countPending()).toBe(26);
      expect(await createSessionRepository(db, owner).getSessions()).toHaveLength(2);
      expect(await createAttemptRepository(db, 'account:other').countAttempts()).toBe(0);
      expect(await createSessionRepository(db, 'unclaimed').getSessions()).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('makes the newest unfinished lesson restartable', async () => {
    const db = await openTrainingDb(new IDBFactory());
    try {
      const repo = createSessionRepository(db);
      for (const session of buildFixture('interrupted', now).sessions)
        await repo.saveSession(session);
      expect((await repo.getLatestInProgressSession())?.id).toBe('fixture-interrupted');
    } finally {
      db.close();
    }
  });

  it('fails the first completed Practice save and permits an idempotent retry', async () => {
    const values = new Map([['acceptance.failSave', 'once']]);
    vi.stubGlobal('window', {});
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key),
      removeItem: (key: string) => values.delete(key)
    });
    const db = await openTrainingDb(new IDBFactory());
    try {
      const repo = createSessionRepository(db);
      const session = { ...buildFixture('returning', now).sessions[0], mode: 'practice' as const };
      const save = async () => {
        acceptanceSave(session.mode, session.status);
        await repo.saveSession(session);
      };
      await expect(save()).rejects.toThrow('Synthetic local save failure');
      expect(await repo.getSessions()).toHaveLength(0);
      await save();
      await save();
      expect(await repo.getSessions()).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('keeps test seams aligned with production source and rejects drift', () => {
    for (const name of ['training-schema', 'training-db', 'session-repository']) {
      const id = `/src/lib/data/${name}.ts`;
      const source = readFileSync(new URL(`../..${id}`, import.meta.url), 'utf8');
      const transformed = acceptanceTransform(source, id);
      expect(transformed).toBeDefined();
      expect(transformed).not.toEqual(source);
      if (name === 'training-schema') expect(transformed).toContain(FIXTURE_DB);
      expect(() => acceptanceTransform('', id)).toThrow('Acceptance seam changed');
    }
    expect(acceptanceTransform('ordinary app', '/src/routes/+page.svelte')).toBeUndefined();
  });
});
