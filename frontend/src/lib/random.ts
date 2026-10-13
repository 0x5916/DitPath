/** Injectable randomness: returns a float in [0, 1), like Math.random. */
export type RandomSource = () => number;

export function randomInt(min: number, max: number, random: RandomSource = Math.random): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

export function randomChar(arr: string, random: RandomSource = Math.random): string {
  return arr[Math.floor(random() * arr.length)];
}
