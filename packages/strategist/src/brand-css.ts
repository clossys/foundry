/**
 * `extractBrandCssSlots` — the brandable slot names a stylesheet declares.
 * `strategist-check brand-coverage` reads `brand/brand.css` by default and
 * proves every custom property declared there has a brand derivation.
 *
 * PURE, no I/O, dependency-free: comments are blanked and quoted strings
 * are emptied in one pass (so a comment marker inside a string, or a
 * `--name:` inside a string, never counts), then every `--name:`
 * declaration at any nesting depth (including inside `@media`) is
 * collected once, in source order. `var(--name)` uses are not
 * declarations and are not collected.
 *
 * Deliberately lenient at the edges, so a slot is over-collected rather than
 * silently dropped:
 * - An unterminated comment (`/*` with no closing marker) is not blanked, so
 *   declarations after it are still collected, although a browser would treat
 *   the rest of the file as comment.
 * - An unterminated string is not emptied, so declarations after it are still
 *   collected. A stray quote can also pair with a later quote and empty the
 *   text between them, which hides any declaration in that span.
 * - A name that follows `(`, with or without whitespace, is a feature or
 *   style-query test (`@supports (--a: 1)`, `style( --a: x )`), not a
 *   declaration, and is not collected.
 */

/** Location, relative to the working directory, of the single Designer overlay stylesheet. */
export const BRAND_CSS_SEGMENTS = ["brand", "brand.css"] as const;

export function extractBrandCssSlots(css: string): string[] {
  const stripped = stripCommentsAndStrings(css);
  const slots: string[] = [];
  const seen = new Set<string>();
  // Each pass either consumes a declaration or skips a whole failed name, so
  // the scan is a single left-to-right walk.
  let resume = 0;
  let i = 0;
  while (i < stripped.length) {
    if (stripped.charCodeAt(i) !== DASH || stripped.charCodeAt(i + 1) !== DASH) {
      i += 1;
      continue;
    }
    // A declaration starts at the beginning of the text or after a delimiter
    // that is not part of the previous declaration.
    if (i > 0 && (i - 1 < resume || !isDelimiter(stripped.charAt(i - 1)))) {
      i += 1;
      continue;
    }
    const end = nameEnd(stripped, i + 2);
    if (end === i + 2) {
      i += 1;
      continue;
    }
    let colon = end;
    while (colon < stripped.length && isSpace(stripped.charAt(colon))) colon += 1;
    if (stripped.charAt(colon) !== ":") {
      // No start inside this name can succeed: each would read to the same end.
      i = end;
      continue;
    }
    const name = stripped.slice(i, end);
    if (!follows(stripped, i, "(") && !seen.has(name)) {
      seen.add(name);
      slots.push(name);
    }
    resume = colon + 1;
    i = resume;
  }
  return slots;
}

const DASH = 0x2d;

/**
 * Blank every comment to one space and empty every quoted string to `""`, in one
 * left-to-right pass. A comment or string that never closes is copied through
 * unchanged, one character at a time, so scanning continues inside it. Once a
 * closer is known to be missing it is missing for every later opener too, so
 * each kind of closer is searched for to the end of the text at most once.
 */
function stripCommentsAndStrings(css: string): string {
  const out: string[] = [];
  const n = css.length;
  let commentCloserMissing = false;
  let doubleCloserMissing = false;
  let singleCloserMissing = false;
  let i = 0;
  while (i < n) {
    const c = css.charAt(i);
    if (c === "/" && css.charAt(i + 1) === "*" && !commentCloserMissing) {
      const close = css.indexOf("*/", i + 2);
      if (close === -1) commentCloserMissing = true;
      else {
        out.push(" ");
        i = close + 2;
        continue;
      }
    } else if ((c === '"' && !doubleCloserMissing) || (c === "'" && !singleCloserMissing)) {
      const close = stringEnd(css, i);
      if (close === -1) {
        if (c === '"') doubleCloserMissing = true;
        else singleCloserMissing = true;
      } else {
        out.push('""');
        i = close + 1;
        continue;
      }
    }
    out.push(c);
    i += 1;
  }
  return out.join("");
}

/** Index of the quote that closes the string opened at `open`, or -1. A backslash escapes the next character. */
function stringEnd(text: string, open: number): number {
  const quote = text.charAt(open);
  let i = open + 1;
  while (i < text.length) {
    const c = text.charAt(i);
    if (c === quote) return i;
    i += c === "\\" ? 2 : 1;
  }
  return -1;
}

/** End of the custom-property name whose body starts at `from`: name characters, non-ASCII, or a backslash escape. */
function nameEnd(text: string, from: number): number {
  let i = from;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code === 0x5c) {
      const next = text.charAt(i + 1);
      if (next === "" || next === "\n" || next === "\r" || next === "\u2028" || next === "\u2029") break;
      i += 2;
      if (isHexCode(next.charCodeAt(0))) {
        let digits = 1;
        while (digits < 6 && isHexCode(text.charCodeAt(i))) {
          i += 1;
          digits += 1;
        }
        // One optional whitespace character ends the escape (CSS Syntax: hex escape).
        const after = text.charAt(i);
        if (after === " " || after === "\t" || after === "\n" || after === "\r" || after === "\f") {
          i += after === "\r" && text.charAt(i + 1) === "\n" ? 2 : 1;
        }
      }
    } else if (code > 0x7f || code === DASH || isWordCode(code)) i += 1;
    else break;
  }
  return i;
}

function isHexCode(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x46) || (code >= 0x61 && code <= 0x66);
}

function isWordCode(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || code === 0x5f;
}

function isSpace(char: string): boolean {
  return /\s/.test(char);
}

function isDelimiter(char: string): boolean {
  return char === ";" || char === "{" || isSpace(char);
}

/** True when the nearest non-whitespace character before `index` is `char`. */
function follows(text: string, index: number, char: string): boolean {
  let i = index - 1;
  while (i >= 0 && isSpace(text.charAt(i))) i -= 1;
  return i >= 0 && text[i] === char;
}
