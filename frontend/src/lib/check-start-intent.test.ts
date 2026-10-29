import { afterEach, describe, expect, it, vi } from 'vitest';
import { armCheckStart, consumeCheckStart } from './check-start-intent';
import type { AudioEngine } from './audio/engine';
const engine = () =>
  ({
    prepare: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined)
  }) as unknown as AudioEngine;
afterEach(() => {
  consumeCheckStart('');
  vi.useRealTimers();
});
describe('gesture audio transfer', () => {
  it('prepares silently and transfers only once to the exact URL', () => {
    const audio = engine();
    armCheckStart('/en/session?check=KM', audio);
    expect(audio.prepare).toHaveBeenCalledOnce();
    expect(consumeCheckStart('/en/session?check=KM')).toBe(audio);
    expect(consumeCheckStart('/en/session?check=KM')).toBeUndefined();
    expect(audio.dispose).not.toHaveBeenCalled();
  });
  it('disposes mismatched and replaced engines', () => {
    const first = engine(),
      second = engine();
    armCheckStart('/check?targets=KM', first);
    armCheckStart('/check?targets=K', second);
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(consumeCheckStart('/different')).toBeUndefined();
    expect(second.dispose).toHaveBeenCalledOnce();
  });
  it('closes unused audio after fifteen seconds', () => {
    vi.useFakeTimers();
    const audio = engine();
    armCheckStart('/check', audio);
    vi.advanceTimersByTime(15000);
    expect(audio.dispose).toHaveBeenCalledOnce();
    expect(consumeCheckStart('/check')).toBeUndefined();
  });
  it('leaves entry independent of a failed gesture unlock', async () => {
    const audio = engine();
    vi.mocked(audio.prepare!).mockRejectedValue(Error('blocked'));
    armCheckStart('/check', audio);
    await Promise.resolve();
    expect(consumeCheckStart('/check')).toBe(audio);
  });
});
