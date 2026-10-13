/**
 * Stable, collision-resistant identifier generators for DitPath V2.
 *
 * Supports injected `random` and `now` functions so all domain tests and
 * replay reducers are 100% deterministic without side effects.
 */

export interface IdGeneratorOptions {
  now?: () => number;
  random?: () => number;
}

const BASE36_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

function generateRandomSuffix(length: number, random: () => number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(random() * BASE36_CHARS.length);
    result += BASE36_CHARS[idx];
  }
  return result;
}

/**
 * Creates a prefixed, timestamp-ordered, URL-safe random string ID.
 * Format: `<prefix>_<timestampBase36>_<randomBase36>`
 */
export function createEntityId(prefix: string, options: IdGeneratorOptions = {}): string {
  const now = options.now ? options.now() : Date.now();
  const random = options.random ?? Math.random;

  const timePart = now.toString(36);
  const randomPart = generateRandomSuffix(8, random);

  return `${prefix}_${timePart}_${randomPart}`;
}

export function createSessionId(options: IdGeneratorOptions = {}): string {
  return createEntityId('sess', options);
}

export function createPromptId(options: IdGeneratorOptions = {}): string {
  return createEntityId('prm', options);
}

export function createAttemptId(options: IdGeneratorOptions = {}): string {
  return createEntityId('att', options);
}
