type DataChange = {
  ownerKey: string;
  local: boolean;
  scope?: 'learning-pilot' | 'learning-evidence';
  /** Evidence records changed; outbox/status-only events leave this false. */
  records?: boolean;
};
const listeners = new Set<(event: DataChange) => void>();
export function subscribeTrainingDataChanges(listener: (event: DataChange) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function notifyTrainingDataChange(
  ownerKey: string,
  local: boolean,
  scope?: 'learning-pilot' | 'learning-evidence',
  records = false
): void {
  for (const listener of listeners)
    listener({ ownerKey, local, ...(scope ? { scope } : {}), ...(records ? { records } : {}) });
}
