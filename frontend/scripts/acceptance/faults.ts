export const FIXTURE_DB = 'ditpath_ui_acceptance';
export const FIXTURE_LEARNING_PILOT_DB = 'ditpath_ui_acceptance_learning_pilot';
export const FIXTURE_EVIDENCE_DB = 'ditpath_ui_acceptance_evidence';

/** Fail loudly if a production seam moves instead of silently dropping fault coverage. */
function replaceOnce(source: string, needle: string, replacement: string): string {
  if (source.split(needle).length !== 2) throw new Error(`Acceptance seam changed: ${needle}`);
  return source.replace(needle, replacement);
}

export function acceptanceTransform(source: string, id: string): string | undefined {
  const path = id.split('?')[0];
  if (path.endsWith('/src/lib/data/learning-evidence.ts'))
    return replaceOnce(source, "'opencw_learning_evidence_v1'", `'${FIXTURE_EVIDENCE_DB}'`);
  if (path.endsWith('/src/lib/data/learning-pilot.ts'))
    return replaceOnce(source, "'opencw_learning_pilot_v1'", `'${FIXTURE_LEARNING_PILOT_DB}'`);
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

/** Deliberately accepts no database name: the chooser may delete only its fixture. */
export function resetLearningPilotFixture(
  factory: IDBFactory,
  onBlocked?: () => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(FIXTURE_LEARNING_PILOT_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Cannot reset learning fixture'));
    request.onblocked = () => onBlocked?.();
  });
}

export function resetEvidenceFixture(factory: IDBFactory, onBlocked?: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(FIXTURE_EVIDENCE_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Cannot reset evidence fixture'));
    request.onblocked = () => onBlocked?.();
  });
}
