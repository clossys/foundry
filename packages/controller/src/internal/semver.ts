/**
 * Dependency-free, bounded SemVer parsing for validation surfaces.
 *
 * These helpers deliberately scan each code unit at most a constant number of
 * times. They do not use a backtracking regular expression and refuse
 * unreasonably large inputs before scanning them. Range evaluation remains the
 * responsibility of the caller; this module only recognizes exact SemVer and
 * the small range grammar used by Controller lifecycle records.
 */

export const MAX_SEMVER_TEXT_LENGTH = 65_536;

export interface ParsedExactSemver {
  readonly major: string;
  readonly minor: string;
  readonly patch: string;
  readonly prerelease?: string;
  readonly build?: string;
}

function asciiDigit(code: number): boolean { return code >= 48 && code <= 57; }
function asciiLetter(code: number): boolean { return (code >= 65 && code <= 90) || (code >= 97 && code <= 122); }
function identifierCharacter(code: number): boolean { return asciiDigit(code) || asciiLetter(code) || code === 45; }

function numericIdentifierEnd(value: string, start: number): number | undefined {
  let cursor = start;
  while (cursor < value.length && asciiDigit(value.charCodeAt(cursor))) cursor += 1;
  if (cursor === start || (cursor - start > 1 && value.charCodeAt(start) === 48)) return undefined;
  return cursor;
}

function dottedIdentifiersEnd(value: string, start: number, prerelease: boolean): number | undefined {
  let cursor = start;
  for (;;) {
    const identifierStart = cursor;
    let onlyDigits = true;
    while (cursor < value.length && identifierCharacter(value.charCodeAt(cursor))) {
      if (!asciiDigit(value.charCodeAt(cursor))) onlyDigits = false;
      cursor += 1;
    }
    if (cursor === identifierStart) return undefined;
    if (prerelease && onlyDigits && cursor - identifierStart > 1 && value.charCodeAt(identifierStart) === 48) return undefined;
    if (value[cursor] !== ".") return cursor;
    cursor += 1;
  }
}

export function parseExactSemver(value: string): ParsedExactSemver | null {
  if (value.length === 0 || value.length > MAX_SEMVER_TEXT_LENGTH) return null;
  let cursor = 0;
  const majorEnd = numericIdentifierEnd(value, cursor);
  if (majorEnd === undefined || value[majorEnd] !== ".") return null;
  const major = value.slice(cursor, majorEnd);
  cursor = majorEnd + 1;
  const minorEnd = numericIdentifierEnd(value, cursor);
  if (minorEnd === undefined || value[minorEnd] !== ".") return null;
  const minor = value.slice(cursor, minorEnd);
  cursor = minorEnd + 1;
  const patchEnd = numericIdentifierEnd(value, cursor);
  if (patchEnd === undefined) return null;
  const patch = value.slice(cursor, patchEnd);
  cursor = patchEnd;

  let prerelease: string | undefined;
  if (value[cursor] === "-") {
    const start = cursor + 1;
    const end = dottedIdentifiersEnd(value, start, true);
    if (end === undefined) return null;
    prerelease = value.slice(start, end);
    cursor = end;
  }

  let build: string | undefined;
  if (value[cursor] === "+") {
    const start = cursor + 1;
    const end = dottedIdentifiersEnd(value, start, false);
    if (end === undefined) return null;
    build = value.slice(start, end);
    cursor = end;
  }

  return cursor === value.length ? { major, minor, patch, ...(prerelease === undefined ? {} : { prerelease }), ...(build === undefined ? {} : { build }) } : null;
}

export function isExactSemver(value: string): boolean { return parseExactSemver(value) !== null; }

function skipSpaces(value: string, start: number): number {
  let cursor = start;
  while (cursor < value.length && (value[cursor] === " " || value[cursor] === "\t" || value[cursor] === "\n" || value[cursor] === "\r")) cursor += 1;
  return cursor;
}

function operatorEnd(value: string, start: number, first: boolean): number {
  if (!first && value.startsWith("||", start)) return start + 2;
  if (!first && value[start] === "-") return start + 1;
  if (value.startsWith(">=", start) || value.startsWith("<=", start)) return start + 2;
  return value[start] === "^" || value[start] === "~" || value[start] === ">" || value[start] === "<" ? start + 1 : start;
}

/** Recognizes the conservative comparator/range grammar used by lifecycle records. */
export function isConservativeSemverRange(input: string): boolean {
  if (input.length > MAX_SEMVER_TEXT_LENGTH) return false;
  const value = input.trim();
  if (value.length === 0 || value.length > MAX_SEMVER_TEXT_LENGTH) return false;
  let cursor = 0;
  let first = true;
  for (;;) {
    cursor = operatorEnd(value, cursor, first);
    cursor = skipSpaces(value, cursor);
    const versionStart = cursor;
    while (cursor < value.length && value[cursor] !== " " && value[cursor] !== "\t" && value[cursor] !== "\n" && value[cursor] !== "\r") cursor += 1;
    if (!isExactSemver(value.slice(versionStart, cursor))) return false;
    if (cursor === value.length) return true;
    const afterSpace = skipSpaces(value, cursor);
    if (afterSpace === cursor || afterSpace === value.length) return false;
    cursor = afterSpace;
    first = false;
  }
}
