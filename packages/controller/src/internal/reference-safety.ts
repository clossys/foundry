/** Reject explicit inline sensitive-payload syntax and URL authority userinfo in otherwise opaque references. */
import { TextDecoder } from "node:util";

const invisible = /[\0\p{Default_Ignorable_Code_Point}]/gu;
const sensitiveLabel = "(?:credentials?(?:[-_. ]?value)?|secrets?(?:[-_. ]?value)?|access[-_. ]?token|auth[-_. ]?token|bearer[-_. ]?token|refresh[-_. ]?token|id[-_. ]?token|tokens?|api[-_. ]?keys?|client[-_. ]?secret|passwords?|passcode|authorization|private[-_. ]?key|connection[-_. ]?string|database[-_. ]?url|provider[-_. ]?value|central[-_. ]?adoption[-_. ]?decision|approve[-_. ]?all[-_. ]?consumers)";
const formSensitiveLabel = "(?:credentials?(?:[-_. +]?value)?|secrets?(?:[-_. +]?value)?|access[-_. +]?token|auth[-_. +]?token|bearer[-_. +]?token|refresh[-_. +]?token|id[-_. +]?token|tokens?|api[-_. +]?keys?|client[-_. +]?secret|passwords?|passcode|authorization|private[-_. +]?key|connection[-_. +]?string|database[-_. +]?url|provider[-_. +]?value|central[-_. +]?adoption[-_. +]?decision|approve[-_. +]?all[-_. +]?consumers)";
const nonemptyValue = "(?:[\"']\\s*)?[^\\s\"'&#,}\\]]";
const equalsAssignment = new RegExp("(?:^|[^a-z0-9])" + sensitiveLabel + "\\b[\"']?\\s*=\\s*" + nonemptyValue, "iu");
const segmentColonAssignment = new RegExp("(?:^|[?&#])" + sensitiveLabel + "\\b\\s*:\\s*" + nonemptyValue, "iu");
const spacedColonAssignment = new RegExp("(?:^|[^a-z0-9])" + sensitiveLabel + "\\b\\s*:\\s+" + nonemptyValue, "iu");
const unspacedColonAssignment = new RegExp("(?:^|[\\s?&#])" + sensitiveLabel + "\\b\\s*:\\s*" + nonemptyValue, "iu");
const quotedColonAssignment = new RegExp("(?:^|[^a-z0-9])[\"']" + sensitiveLabel + "[\"']\\s*:\\s*" + nonemptyValue, "iu");
const formEqualsAssignment = new RegExp("(?:^|[?&#])" + formSensitiveLabel + "\\b[\"']?\\s*=\\s*" + nonemptyValue, "iu");
const formColonAssignment = new RegExp("(?:^|[?&#])" + formSensitiveLabel + "\\b\\s*:\\s*" + nonemptyValue, "iu");
const decoder = new TextDecoder("utf-8", { fatal: false });
export const MAX_REFERENCE_CODE_UNITS = 65_536;
const AUTHORITY_NORMALIZATION_PASSES = 2;
const specialAuthoritySchemes = new Set(["ftp", "http", "https", "ws", "wss"]);
const defaultIgnorable = /[\0\p{Default_Ignorable_Code_Point}]/u;

interface ReferenceStage {
  readonly value: string;
  /** True means the character came from a path or opaque URI atom. */
  readonly protected: boolean[];
}

function normalizedStage(value: string, protectedCharacters: readonly boolean[]): ReferenceStage | null {
  let normalized = "";
  const marks: boolean[] = [];
  for (let index = 0; index < value.length;) {
    const codePoint = String.fromCodePoint(value.codePointAt(index)!);
    const mark = protectedCharacters[index] ?? false;
    for (const character of codePoint.normalize("NFKC").toLowerCase()) {
      if (defaultIgnorable.test(character)) continue;
      normalized += character;
      marks.push(...Array(character.length).fill(mark));
      if (normalized.length > MAX_REFERENCE_CODE_UNITS) return null;
    }
    index += codePoint.length;
  }
  return { value: normalized, protected: marks };
}

export function stripDefaultIgnorables(value: string): string { return value.normalize("NFKC").replace(invisible, ""); }

function decodePercentPass(stage: ReferenceStage): ReferenceStage | null {
  let decoded = "";
  const marks: boolean[] = [];
  for (let index = 0; index < stage.value.length;) {
    if (stage.value[index] !== "%" || !/^[0-9a-f]{2}$/iu.test(stage.value.slice(index + 1, index + 3))) {
      decoded += stage.value[index]!;
      marks.push(stage.protected[index] ?? false);
      index += 1;
      continue;
    }
    const bytes: number[] = [];
    let protectedCharacter = false;
    do {
      bytes.push(Number.parseInt(stage.value.slice(index + 1, index + 3), 16));
      protectedCharacter ||= stage.protected[index] ?? false;
      index += 3;
    } while (stage.value[index] === "%" && /^[0-9a-f]{2}$/iu.test(stage.value.slice(index + 1, index + 3)));
    const value = decoder.decode(Uint8Array.from(bytes));
    decoded += value;
    marks.push(...Array(value.length).fill(protectedCharacter));
    if (decoded.length > MAX_REFERENCE_CODE_UNITS) return null;
  }
  return normalizedStage(decoded, marks);
}

function initialStage(value: string): ReferenceStage | null {
  if (value.length > MAX_REFERENCE_CODE_UNITS) return null;
  return normalizedStage(value, Array(value.length).fill(false));
}

export type ReferenceSafetyIssue = "reference-length-exceeded" | "unsafe-evidence-reference";
function authorityBoundary(stage: ReferenceStage, index: number): boolean {
  if (index === 0) return true;
  if (stage.protected[index - 1]) return false;
  const previous = stage.value[index - 1]!;
  return !/[\p{L}\p{N}\p{M}/:._+%\\-]/u.test(previous);
}
function encodedAt(stage: ReferenceStage, index: number, encoded: string): boolean { return !stage.protected[index] && stage.value.slice(index, index + 3) === encoded; }
function consumeMarker(stage: ReferenceStage, index: number, literal: string, encoded: string): number | null {
  if (!stage.protected[index] && stage.value[index] === literal) return index + 1;
  return encodedAt(stage, index, encoded) ? index + 3 : null;
}
function asciiLetter(value: string): boolean { return value >= "a" && value <= "z"; }
function schemeCharacter(value: string): boolean { return asciiLetter(value) || (value >= "0" && value <= "9") || value === "+" || value === "-" || value === "."; }
function schemeAt(stage: ReferenceStage, index: number): { special: boolean; afterColon: number } | null {
  if (stage.protected[index] || !asciiLetter(stage.value[index] ?? "")) return null;
  const characters: string[] = [];
  let cursor = index;
  while (!stage.protected[cursor] && schemeCharacter(stage.value[cursor] ?? "")) {
    characters.push(stage.value[cursor]!);
    cursor += 1;
  }
  const afterColon = consumeMarker(stage, cursor, ":", "%3a");
  return afterColon === null ? null : { special: specialAuthoritySchemes.has(characters.join("")), afterColon };
}
function consumeSlash(stage: ReferenceStage, index: number, special: boolean): number | null {
  const slash = consumeMarker(stage, index, "/", "%2f");
  if (slash !== null) return slash;
  return special ? consumeMarker(stage, index, "\\", "%5c") : null;
}
function protocolRelativeAt(stage: ReferenceStage, index: number): boolean {
  const firstSlash = consumeSlash(stage, index, false);
  return firstSlash !== null && consumeSlash(stage, firstSlash, false) !== null;
}
function authorityCandidateAt(stage: ReferenceStage, index: number): boolean {
  return authorityBoundary(stage, index) && (schemeAt(stage, index) !== null || protocolRelativeAt(stage, index));
}
function protectUntilWhitespace(stage: ReferenceStage, start: number): number {
  let cursor = start;
  while (cursor < stage.value.length && !/[\t\r\n ]/.test(stage.value[cursor]!)) {
    stage.protected[cursor] = true;
    cursor += 1;
  }
  return cursor;
}
function protectPath(stage: ReferenceStage, start: number): number {
  let cursor = start;
  while (cursor < stage.value.length) {
    const character = stage.value[cursor]!;
    if (character === "?" || character === "#") return cursor + 1;
    if (/[\t\r\n ]/.test(character)) return cursor + 1;
    stage.protected[cursor] = true;
    cursor += 1;
  }
  return cursor;
}
function authorityContainsUserinfo(stage: ReferenceStage, start: number, special: boolean): { unsafe: boolean; end: number } {
  let cursor = start;
  if (special) {
    while (true) {
      const slash = consumeSlash(stage, cursor, true);
      if (slash === null) break;
      cursor = slash;
    }
  } else {
    const firstSlash = consumeSlash(stage, cursor, false);
    if (firstSlash === null) return { unsafe: false, end: cursor };
    cursor = firstSlash;
    const secondSlash = consumeSlash(stage, cursor, false);
    if (secondSlash === null) return { unsafe: false, end: cursor };
    cursor = secondSlash;
    if (consumeSlash(stage, cursor, false) !== null) return { unsafe: false, end: protectPath(stage, cursor) };
  }
  while (cursor < stage.value.length) {
    if (cursor > start && authorityCandidateAt(stage, cursor)) return { unsafe: false, end: cursor };
    const at = consumeMarker(stage, cursor, "@", "%40");
    if (at !== null) return { unsafe: true, end: at };
    const character = stage.value[cursor]!;
    if (character === "/" || character === "?" || character === "#" || (special && character === "\\")) return { unsafe: false, end: protectPath(stage, cursor) };
    cursor += 1;
  }
  return { unsafe: false, end: cursor };
}
function containsAuthorityUserinfoInStage(stage: ReferenceStage): boolean {
  for (let index = 0; index < stage.value.length;) {
    if (stage.protected[index]) { index += 1; continue; }
    if (!authorityBoundary(stage, index)) {
      if (stage.value[index] === "/") { index = protectPath(stage, index); continue; }
      index += 1;
      continue;
    }
    const scheme = schemeAt(stage, index);
    if (scheme) {
      if (!scheme.special && !protocolRelativeAt(stage, scheme.afterColon)) { index = protectUntilWhitespace(stage, index); continue; }
      const authority = authorityContainsUserinfo(stage, scheme.afterColon, scheme.special);
      if (authority.unsafe) return true;
      index = Math.max(index + 1, authority.end);
      continue;
    }
    if (protocolRelativeAt(stage, index)) {
      const authority = authorityContainsUserinfo(stage, index, false);
      if (authority.unsafe) return true;
      index = Math.max(index + 1, authority.end);
      continue;
    }
    if (stage.value[index] === "/") { index = protectPath(stage, index); continue; }
    index += 1;
  }
  return false;
}
function withoutUrlWhitespace(stage: ReferenceStage): ReferenceStage {
  let value = "";
  const protectedCharacters: boolean[] = [];
  for (let index = 0; index < stage.value.length; index += 1) {
    if (/[\t\r\n]/.test(stage.value[index]!)) continue;
    value += stage.value[index]!;
    protectedCharacters.push(stage.protected[index] ?? false);
  }
  return { value, protected: protectedCharacters };
}

export function referenceSafetyIssue(value: string): ReferenceSafetyIssue | undefined {
  let stage = initialStage(value);
  if (stage === null) return "reference-length-exceeded";
  for (let pass = 0; pass <= AUTHORITY_NORMALIZATION_PASSES; pass += 1) {
    if (containsAuthorityUserinfoInStage(stage)) return "unsafe-evidence-reference";
    const compact = withoutUrlWhitespace(stage);
    if (compact.value !== stage.value && containsAuthorityUserinfoInStage(compact)) return "unsafe-evidence-reference";
    if (pass === AUTHORITY_NORMALIZATION_PASSES) break;
    stage = decodePercentPass(stage);
    if (stage === null) return "reference-length-exceeded";
  }
  return equalsAssignment.test(stage.value) || segmentColonAssignment.test(stage.value) || spacedColonAssignment.test(stage.value) || unspacedColonAssignment.test(stage.value) || quotedColonAssignment.test(stage.value) || formEqualsAssignment.test(stage.value) || formColonAssignment.test(stage.value)
    ? "unsafe-evidence-reference"
    : undefined;
}

export function isValueSafeReference(value: string): boolean {
  return referenceSafetyIssue(value) === undefined;
}
