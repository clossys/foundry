// Blanks declaration-shaped `prop: ... N%` regions, where a trailing `%` is a
// CSS dimension and not a claim.
//
// It returns exactly what this replace returns, with each match overwritten by
// spaces of the same length:
//
//   /\b[\w-]+\s*:\s*[^;`"'}\n]*(?<!\d)(?<!\d\.)\d+(?:\.\d+)*\s*%/g
//
// (the regex from #1680, which the package's tests keep as an oracle). The
// regex took quadratic time on a line with many declaration starts, because
// each start rescanned its whole segment. This is one forward pass over
// precomputed tables instead:
//
// - A match starts at the first word character of a `[\w-]+` run that is
//   followed by optional whitespace and a `:`.
// - Its middle cannot cross `;`, a backtick, `"`, `'`, `}` or a newline.
// - Its tail is a number (digits, then any number of `.digits` groups) that
//   starts at a number's first digit, then optional whitespace, then `%`. So
//   `a: 3% 50%` blanks through `50%`, `x: 1.2.3%` blanks, and `grid: 1fr 2 50%`
//   blanks.
// - The match ends at the last such tail before the segment ends. The tail is
//   found by table lookup, not by trying each position.

const CH_DOT = 46;
const CH_COLON = 58;
const CH_PERCENT = 37;

function isDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}

function isNameChar(c: number): boolean {
  return isWordChar(c) || c === 45;
}

function isWordChar(c: number): boolean {
  return isDigit(c) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

/** The characters the middle of a match cannot contain: `;` `` ` `` `"` `'` `}` and a newline. */
function isSegmentEnd(c: number): boolean {
  return c === 59 || c === 96 || c === 34 || c === 39 || c === 125 || c === 10;
}

/** The characters `\s` matches. */
function isSpace(c: number): boolean {
  return (
    c === 32 ||
    (c >= 9 && c <= 13) ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0xfeff
  );
}

export function blankCssDeclPercents(text: string): string {
  const n = text.length;
  if (n === 0) return text;

  // tailEnd[p] is the index just past the `%` when a valid tail starts at p,
  // else 0. lastTail[i] is the largest valid tail start below i, else -1.
  // segmentEnd[i] is the first segment-ending character at or after i, else n.
  const tailEnd = new Int32Array(n);
  const lastTail = new Int32Array(n + 1);
  const segmentEnd = new Int32Array(n + 1);

  lastTail[0] = -1;
  for (let p = 0; p < n; p++) {
    lastTail[p + 1] = lastTail[p] as number;
    if (!isDigit(text.charCodeAt(p))) continue;
    // Only a number's first digit starts a tail: not after a digit, and not
    // after `digit.` (the later groups of `1.2.3`). Each number is walked once.
    if (p >= 1 && isDigit(text.charCodeAt(p - 1))) continue;
    if (p >= 2 && text.charCodeAt(p - 1) === CH_DOT && isDigit(text.charCodeAt(p - 2))) continue;
    let j = p;
    while (j < n && isDigit(text.charCodeAt(j))) j++;
    while (j + 1 < n && text.charCodeAt(j) === CH_DOT && isDigit(text.charCodeAt(j + 1))) {
      j++;
      while (j < n && isDigit(text.charCodeAt(j))) j++;
    }
    while (j < n && isSpace(text.charCodeAt(j))) j++;
    if (j < n && text.charCodeAt(j) === CH_PERCENT) {
      tailEnd[p] = j + 1;
      lastTail[p + 1] = p;
    }
  }

  segmentEnd[n] = n;
  for (let i = n - 1; i >= 0; i--) {
    segmentEnd[i] = isSegmentEnd(text.charCodeAt(i)) ? i : (segmentEnd[i + 1] as number);
  }

  let out = "";
  let copied = 0;
  let pos = 0;
  while (pos < n) {
    while (pos < n && !isNameChar(text.charCodeAt(pos))) pos++;
    if (pos >= n) break;
    const runStart = pos;
    while (pos < n && isNameChar(text.charCodeAt(pos))) pos++;
    const runEnd = pos;

    let colon = runEnd;
    while (colon < n && isSpace(text.charCodeAt(colon))) colon++;
    if (colon >= n || text.charCodeAt(colon) !== CH_COLON) continue;

    let start = runStart;
    while (start < runEnd && !isWordChar(text.charCodeAt(start))) start++;
    if (start === runEnd) continue;

    let valueStart = colon + 1;
    while (valueStart < n && isSpace(text.charCodeAt(valueStart))) valueStart++;
    const tail = lastTail[segmentEnd[valueStart] as number] as number;
    if (tail <= colon) continue;

    const end = tailEnd[tail] as number;
    out += text.slice(copied, start) + " ".repeat(end - start);
    copied = end;
    pos = end;
  }
  return copied === 0 ? text : out + text.slice(copied);
}
