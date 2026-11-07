import type { Page } from '@playwright/test';

export const EVIDENCE_DB = 'ditpath_ui_acceptance_evidence';
export const TRAINING_DB = 'ditpath_ui_acceptance';

/** Page-level alerts, excluding the intentional migration announcement. */
export function pageAlert(page: Page) {
  return page.locator('[role="alert"]:not(.migration-banner)');
}

type Scenario =
  | 'New learner / empty history'
  | 'Returning learner / populated history'
  | 'Practice save fails once, then retry'
  | 'Guest with saved unfinished practice'
  | 'Synthetic account / pending sync';

export async function resetAcceptance(page: Page, scenario: Scenario, expected: RegExp) {
  await page.goto('/__acceptance');
  await page.getByRole('button', { name: scenario }).click();
  await page.waitForURL(expected, { timeout: 15_000 });
  await page.waitForTimeout(1_200);
}

export async function resetToHome(page: Page, scenario: Scenario = 'New learner / empty history') {
  await resetAcceptance(page, scenario, /\/en$/);
}

export async function readCopyCheckpoint(page: Page, database = EVIDENCE_DB) {
  return page.evaluate(async (name) => {
    if (!(await indexedDB.databases()).some((db) => db.name === name)) return null;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction('meta', 'readonly');
        const request = tx.objectStore('meta').get(['unclaimed', 'checkpoint:copy']);
        request.onsuccess = () => resolve(request.result?.value ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, database);
}

export async function readGuidedCheckpoint(page: Page, database = EVIDENCE_DB) {
  return page.evaluate(async (name) => {
    if (!(await indexedDB.databases()).some((db) => db.name === name)) return null;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Record<string, unknown> | null>((resolve, reject) => {
        const tx = db.transaction('meta', 'readonly');
        const request = tx.objectStore('meta').getAll();
        request.onsuccess = () =>
          resolve(request.result.find((row) => row.value?.kind === 'guided')?.value ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, database);
}

export async function readOwnedSessions(page: Page) {
  return page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const tx = db.transaction('owned_sessions', 'readonly');
        const request = tx.objectStore('owned_sessions').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, TRAINING_DB);
}

export async function readOwnedAttempts(page: Page) {
  return page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const tx = db.transaction('owned_attempts', 'readonly');
        const request = tx.objectStore('owned_attempts').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, TRAINING_DB);
}

export async function readSessionCount(page: Page) {
  return page.evaluate(async (name) => {
    if (!(await indexedDB.databases()).some((db) => db.name === name)) return 0;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const tx = db.transaction('owned_sessions', 'readonly');
        const request = tx.objectStore('owned_sessions').count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, TRAINING_DB);
}

export async function startAndType(page: Page, text = 'KM') {
  await page.getByRole('button', { name: 'Start practice' }).click();
  const answer = page.getByRole('textbox', { name: 'Your copy' });
  await answer.fill(text);
  return answer;
}

export async function saveAndLeave(page: Page) {
  await page.getByRole('button', { name: 'Save & leave' }).click();
  await page.waitForURL('**/en');
}
