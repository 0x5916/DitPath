/** Keep the page and its failed write queue alive until navigation is saved or explicitly discarded. */
export interface SessionNavigationPersistence {
  abandon(): void;
  flushPersistence(): Promise<boolean>;
}

export interface PendingSessionNavigation {
  /** A cancelled Back/Forward traversal must be restored before replaying its original delta. */
  restored: Promise<void>;
  resume(): void | Promise<void>;
}

export async function saveBeforeSessionNavigation(
  controller: SessionNavigationPersistence,
  navigation: PendingSessionNavigation,
  { discard = false, isActive = () => true }: { discard?: boolean; isActive?: () => boolean } = {}
): Promise<boolean> {
  controller.abandon();
  if (!discard && !(await controller.flushPersistence())) return false;
  await navigation.restored;
  if (!isActive()) return false;
  await navigation.resume();
  return true;
}
