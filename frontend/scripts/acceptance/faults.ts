export const FIXTURE_DB = 'ditpath_ui_acceptance';

/** Fail loudly if a production seam moves instead of silently dropping fault coverage. */
function replaceOnce(source: string, needle: string, replacement: string): string {
  if (source.split(needle).length !== 2) throw new Error(`Acceptance seam changed: ${needle}`);
  return source.replace(needle, replacement);
}

export function acceptanceTransform(source: string, id: string): string | undefined {
  const path = id.split('?')[0];
  if (path.endsWith('/src/lib/data/training-schema.ts'))
    return replaceOnce(source, "'morsestep_training_v1'", `'${FIXTURE_DB}'`);
  if (path.endsWith('/src/lib/data/training-db.ts')) {
    source = replaceOnce(
      source,
      'export function openTrainingDb(',
      'export async function openTrainingDb('
    );
    return (
      "import { acceptanceDelay } from '/scripts/acceptance/faults.ts';\n" +
      replaceOnce(
        source,
        'Promise<IDBDatabase> {\n  const factory',
        'Promise<IDBDatabase> {\n  await acceptanceDelay();\n  const factory'
      )
    );
  }
  if (path.endsWith('/src/lib/data/session-repository.ts'))
    return (
      "import { acceptanceSave } from '/scripts/acceptance/faults.ts';\n" +
      replaceOnce(
        source,
        '    async saveSession(session) {',
        '    async saveSession(session) {\n      acceptanceSave(session.mode, session.status);'
      )
    );
}

export async function acceptanceDelay(): Promise<void> {
  if (typeof window === 'undefined') return;
  const remaining = Number(sessionStorage.getItem('acceptance.loadingUntil')) - Date.now();
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

export function acceptanceSave(mode?: string, status?: string): void {
  if (typeof window === 'undefined' || mode !== 'practice' || status !== 'completed') return;
  if (sessionStorage.getItem('acceptance.failSave') !== 'once') return;
  sessionStorage.removeItem('acceptance.failSave');
  throw new Error('Synthetic local save failure; retry is available');
}
