import { describe, expect, it } from 'vitest';
import { armCheckStart, consumeCheckStart } from './check-start-intent';
describe('explicit check start intent', () => {
  it('permits only one matching navigation', () => {
    armCheckStart('/en/morse/learn/session?check=KM', 100);
    expect(consumeCheckStart('/en/morse/learn/session?check=KM', 101)).toBe(true);
    expect(consumeCheckStart('/en/morse/learn/session?check=KM', 102)).toBe(false);
  });
  it('rejects mismatched and expired navigation', () => {
    armCheckStart('/check?targets=KM', 100);
    expect(consumeCheckStart('/check?targets=K', 101)).toBe(false);
    armCheckStart('/check?targets=KM', 100);
    expect(consumeCheckStart('/check?targets=KM', 15100)).toBe(false);
  });
});
