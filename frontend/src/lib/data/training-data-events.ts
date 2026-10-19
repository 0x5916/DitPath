type DataChange = { ownerKey: string; local: boolean };
const listeners = new Set<(event: DataChange) => void>();
export function subscribeTrainingDataChanges(listener: (event: DataChange) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function notifyTrainingDataChange(ownerKey: string, local: boolean): void {
  for (const listener of listeners) listener({ ownerKey, local });
}
