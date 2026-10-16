import { getAuthSession, isAuthSessionCurrent } from '#lib/auth.ts';

/** Fence asynchronous component work by its lifetime, account and optional request order. */
export function createSessionScope(): {
  capture(): () => boolean;
  begin(): () => boolean;
  dispose(): void;
} {
  let alive = true;
  let revision = 0;

  function capture(): () => boolean {
    const session = getAuthSession();
    return () => alive && isAuthSessionCurrent(session);
  }

  return {
    capture,
    begin() {
      const request = ++revision;
      const current = capture();
      return () => request === revision && current();
    },
    dispose() {
      alive = false;
      revision += 1;
    }
  };
}
