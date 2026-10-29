import { createWebAudioEngine, type AudioEngine } from './audio/engine';
// Transfer only a silent, gesture-activated engine. Session entry never depends on this hint.
let pending: { href: string; audio: AudioEngine } | null = null;
let expiry: ReturnType<typeof setTimeout> | undefined;
export function armCheckStart(href: string, audio = createWebAudioEngine()) {
  clearTimeout(expiry);
  void pending?.audio.dispose();
  pending = { href, audio };
  void audio.prepare?.().catch(() => {});
  expiry = setTimeout(() => {
    void pending?.audio.dispose();
    pending = null;
  }, 15000);
}
export function consumeCheckStart(href: string): AudioEngine | undefined {
  clearTimeout(expiry);
  const intent = pending;
  pending = null;
  if (intent?.href === href) return intent.audio;
  void intent?.audio.dispose();
}
