import type { RandomSource } from './exercise';
export type PracticeContext = 'groups' | 'words' | 'callsigns' | 'contact';
const words = [
  'RADIO',
  'SIGNAL',
  'MORNING',
  'RIVER',
  'THANKS',
  'CLEAR',
  'LISTEN',
  'STATION',
  'WEATHER',
  'NORTH',
  'SOUTH',
  'HOME',
  'GOOD',
  'NIGHT',
  'READY',
  'SOUND',
  'GREEN',
  'FIELD',
  'COPY',
  'ANTENNA'
];
const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function contextualPassage(
  context: Exclude<PracticeContext, 'groups'>,
  random: RandomSource = Math.random
): string {
  const pick = <T>(items: readonly T[] | string): T | string => {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new RangeError('Random source must return a number in [0, 1)');
    return items[Math.floor(value * items.length)];
  };
  const call = () =>
    `${pick(['K', 'W', 'N', 'G', 'F', 'DL', 'JA', 'VK'])}${pick('123456789')}${pick(letters)}${pick(letters)}${pick(letters)}`;
  if (context === 'words') return Array.from({ length: 12 }, () => pick(words)).join(' ');
  if (context === 'callsigns') return Array.from({ length: 6 }, call).join(' ');
  if (context === 'contact') {
    const a = call(),
      b = call();
    return `CQ CQ DE ${a} ${a} K ${a} DE ${b} GM UR RST 579 QTH YORK NAME SAM HW CPY K ${b} DE ${a} R TU UR RST 599 QTH ROME NAME LEE 73 SK`;
  }
  throw new RangeError('Unknown practice context');
}
