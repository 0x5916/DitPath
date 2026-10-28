// Deliberately memory-only: reloads and new tabs must never auto-start audio.
let pending: { href: string; expires: number } | null = null;
export function armCheckStart(href: string, now = Date.now()) {
  pending = { href, expires: now + 15000 };
}
export function consumeCheckStart(href: string, now = Date.now()) {
  const intent = pending;
  pending = null;
  return intent !== null && intent.href === href && now < intent.expires;
}
