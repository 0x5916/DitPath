import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ generation: 0, username: 'alice' }));
vi.mock('#lib/auth.ts', () => ({
  getAuthSession: () => ({ ...auth }),
  isAuthSessionCurrent: (session: { generation: number }) => session.generation === auth.generation
}));

import { createSessionScope } from '#lib/session-scope.ts';

beforeEach(() => {
  auth.generation = 0;
  auth.username = 'alice';
});

describe('component session scopes', () => {
  it('invalidates a snapshot on another session, including the same username', () => {
    const scope = createSessionScope();
    const current = scope.capture();
    expect(current()).toBe(true);
    auth.generation += 1;
    expect(current()).toBe(false);
    expect(scope.capture()()).toBe(true);
  });

  it('allows independent actions without invalidating captured work', () => {
    const scope = createSessionScope();
    const action = scope.capture();
    scope.begin();
    expect(action()).toBe(true);
  });

  it('keeps only the latest request within one scope', async () => {
    const scope = createSessionScope();
    const results: string[] = [];
    let finishOld!: () => void;
    const oldReady = new Promise<void>((resolve) => {
      finishOld = resolve;
    });
    const oldCurrent = scope.begin();
    const old = oldReady.then(() => {
      if (oldCurrent()) results.push('old');
    });
    const newCurrent = scope.begin();
    if (newCurrent()) results.push('new');
    finishOld();
    await old;
    expect(results).toEqual(['new']);
  });

  it('does not cancel requests belonging to another scope', () => {
    const first = createSessionScope();
    const second = createSessionScope();
    const current = first.begin();
    second.begin();
    expect(current()).toBe(true);
  });

  it('invalidates all pending work permanently on disposal', () => {
    const scope = createSessionScope();
    const action = scope.capture();
    const request = scope.begin();
    scope.dispose();
    expect(action()).toBe(false);
    expect(request()).toBe(false);
    expect(scope.capture()()).toBe(false);
    expect(scope.begin()()).toBe(false);
  });
});
