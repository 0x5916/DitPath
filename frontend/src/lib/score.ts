/**
 * Shared accuracy thresholds. These drive the result overlay, the lesson
 * progression buttons and the history badges, so they live in one place.
 */
export const SCORE_GOOD = 0.9;
export const SCORE_OK = 0.7;

export type ScoreGrade = 'good' | 'ok' | 'bad';

/** Upper-case and collapse whitespace; scoring and the word diff must agree. */
function normalizeText(text: string): string {
  return text.toUpperCase().trim().replace(/\s+/g, ' ');
}

export function scoreGrade(accuracy: number): ScoreGrade {
  if (accuracy >= SCORE_GOOD) return 'good';
  if (accuracy >= SCORE_OK) return 'ok';
  return 'bad';
}

export function score(reference: string, input: string): number {
  return cer(normalizeText(reference), normalizeText(input)).accuracy;
}

// ── Word-level diff ─────────────────────────────────────────────────────────

type DiffType = 'correct' | 'substitution' | 'missing' | 'extra';

export interface DiffToken {
  ref: string; // reference word (empty when type === 'extra')
  inp: string; // input word     (empty when type === 'missing')
  type: DiffType;
}

export function diffWords(reference: string, input: string): DiffToken[] {
  const ref = normalizeText(reference).split(' ').filter(Boolean);
  const inp = normalizeText(input).split(' ').filter(Boolean);

  // LCS table — flat Int16Array (~24× less memory than nested JS arrays)
  const m = ref.length,
    n = inp.length;
  const dp = new Int16Array((m + 1) * (n + 1));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i * (n + 1) + j] =
        ref[i - 1] === inp[j - 1]
          ? dp[(i - 1) * (n + 1) + (j - 1)] + 1
          : Math.max(dp[(i - 1) * (n + 1) + j], dp[i * (n + 1) + (j - 1)]);

  // Traceback
  const raw: DiffToken[] = [];
  let i = m,
    j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ref[i - 1] === inp[j - 1]) {
      raw.unshift({ ref: ref[i - 1], inp: inp[j - 1], type: 'correct' });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i * (n + 1) + (j - 1)] >= dp[(i - 1) * (n + 1) + j])) {
      raw.unshift({ ref: '', inp: inp[j - 1], type: 'extra' });
      j--;
    } else {
      raw.unshift({ ref: ref[i - 1], inp: '', type: 'missing' });
      i--;
    }
  }

  // Merge adjacent missing+extra into substitution
  const tokens: DiffToken[] = [];
  for (let k = 0; k < raw.length; k++) {
    if (raw[k].type === 'missing' && k + 1 < raw.length && raw[k + 1].type === 'extra') {
      tokens.push({ ref: raw[k].ref, inp: raw[k + 1].inp, type: 'substitution' });
      k++;
    } else {
      tokens.push(raw[k]);
    }
  }
  return tokens;
}

function cer(reference: string, input: string) {
  const editDist = levenshtein(reference, input);
  const cer = editDist / reference.length;
  const accuracy = Math.max(0, 1 - cer);
  return { accuracy, cer, editDistance: editDist };
}

function levenshtein(a: string, b: string): number {
  const m = a.length,
    n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}
