/**
 * Koch curriculum data and character sets.
 *
 * Pure data and pure functions only: no Svelte, DOM, storage, network or
 * audio dependencies, so this module can be unit tested (and reused by
 * future lesson formats) without a browser.
 */

export const LESSONS: string[] = [
  'KM',
  'R',
  'S',
  'U',
  'A',
  'P',
  'T',
  'L',
  'O',
  'W',
  'I',
  '.',
  'N',
  'J',
  'E',
  'F',
  '0',
  'Y',
  ',',
  'V',
  'G',
  '5',
  '/',
  'Q',
  '9',
  'Z',
  'H',
  '3',
  '8',
  'B',
  '?',
  '4',
  '2',
  '7',
  'C',
  '1',
  'D',
  '6',
  'X'
];

export const MORSE: Record<string, string> = {
  A: '.-',
  B: '-...',
  C: '-.-.',
  D: '-..',
  E: '.',
  F: '..-.',
  G: '--.',
  H: '....',
  I: '..',
  J: '.---',
  K: '-.-',
  L: '.-..',
  M: '--',
  N: '-.',
  O: '---',
  P: '.--.',
  Q: '--.-',
  R: '.-.',
  S: '...',
  T: '-',
  U: '..-',
  V: '...-',
  W: '.--',
  X: '-..-',
  Y: '-.--',
  Z: '--..',
  '0': '-----',
  '1': '.----',
  '2': '..---',
  '3': '...--',
  '4': '....-',
  '5': '.....',
  '6': '-....',
  '7': '--...',
  '8': '---..',
  '9': '----.',
  // Punctuation
  '.': '.-.-.-',
  ',': '--..--',
  '/': '-..-.',
  '?': '..--..'
};

/** The cumulative character set a lesson teaches, as a single string. */
export function getLessonChars(lesson: number): string {
  return LESSONS.slice(0, lesson).join('');
}

/** The cumulative character set a lesson teaches, as one entry per character. */
export function getLessonCharacterSet(lesson: number): string[] {
  return getLessonChars(lesson).split('').filter(Boolean);
}
