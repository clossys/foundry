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

function decodePercentPass(value: string): string {
  return value.replace(/(?:%[0-9a-f]{2})+/giu, (encoded) => decoder.decode(Uint8Array.from(encoded.match(/%[0-9a-f]{2}/giu)!.map((part) => Number.parseInt(part.slice(1), 16)))));
}

export function stripDefaultIgnorables(value: string): string { return value.normalize("NFKC").replace(invisible, ""); }

function normalizeStage(value: string): string { return stripDefaultIgnorables(value).toLowerCase(); }
function normalizedStages(value: string): string[] | null {
  if (value.length > MAX_REFERENCE_CODE_UNITS) return null;
  let stage = normalizeStage(value);
  if (stage.length > MAX_REFERENCE_CODE_UNITS) return null;
  const stages = [stage];
  for (let pass = 0; pass < AUTHORITY_NORMALIZATION_PASSES; pass += 1) {
    stage = normalizeStage(decodePercentPass(stage));
    if (stage.length > MAX_REFERENCE_CODE_UNITS) return null;
    stages.push(stage);
  }
  return stages;
}

export type ReferenceSafetyIssue = "reference-length-exceeded" | "unsafe-evidence-reference";
function authorityBoundary(value: string, index: number): boolean {
  if (index === 0) return true;
  const previous = value[index - 1]!;
  // An authority may follow query assignment or prose punctuation, but not a
  // path, opaque URI, or identifier continuation.
  return !/[\p{L}\p{N}\p{M}/:._+%\\-]/u.test(previous);
}
function encodedAt(value: string, index: number, encoded: string): boolean { return value.slice(index, index + 3) === encoded; }
function consumeMarker(value: string, index: number, literal: string, encoded: string): number | null {
  if (value[index] === literal) return index + 1;
  return encodedAt(value, index, encoded) ? index + 3 : null;
}
function asciiLetter(value: string): boolean { return value >= "a" && value <= "z"; }
function schemeCharacter(value: string): boolean { return asciiLetter(value) || (value >= "0" && value <= "9") || value === "+" || value === "-" || value === "."; }
function schemeAt(value: string, index: number): { special: boolean; afterColon: number } | null {
  if (!asciiLetter(value[index] ?? "")) return null;
  const characters: string[] = [];
  let cursor = index;
  while (schemeCharacter(value[cursor] ?? "")) {
    characters.push(value[cursor]!);
    cursor += 1;
  }
  const afterColon = consumeMarker(value, cursor, ":", "%3a");
  return afterColon === null ? null : { special: specialAuthoritySchemes.has(characters.join("")), afterColon };
}
function consumeSlash(value: string, index: number, special: boolean): number | null {
  const slash = consumeMarker(value, index, "/", "%2f");
  if (slash !== null) return slash;
  return special ? consumeMarker(value, index, "\\", "%5c") : null;
}
function authorityContainsUserinfo(value: string, start: number, special: boolean): { unsafe: boolean; end: number } | null {
  let cursor = start;
  if (special) {
    while (true) {
      const slash = consumeSlash(value, cursor, true);
      if (slash === null) break;
      cursor = slash;
    }
  } else {
    const firstSlash = consumeSlash(value, cursor, false);
    if (firstSlash === null) return null;
    cursor = firstSlash;
    const secondSlash = consumeSlash(value, cursor, false);
    if (secondSlash === null) return null;
    cursor = secondSlash;
    const thirdSlash = consumeSlash(value, cursor, false);
    if (thirdSlash !== null) return { unsafe: false, end: thirdSlash };
  }
  while (cursor < value.length) {
    const at = consumeMarker(value, cursor, "@", "%40");
    if (at !== null) return { unsafe: true, end: at };
    const character = value[cursor]!;
    if (character === "/" || character === "?" || character === "#" || (special && character === "\\")) return { unsafe: false, end: cursor + 1 };
    cursor += 1;
  }
  return { unsafe: false, end: cursor };
}
function containsAuthorityUserinfoInStage(value: string): boolean {
  for (let index = 0; index < value.length;) {
    if (!authorityBoundary(value, index)) { index += 1; continue; }
    const scheme = schemeAt(value, index);
    if (scheme) {
      const authority = authorityContainsUserinfo(value, scheme.afterColon, scheme.special);
      if (authority?.unsafe) return true;
      if (authority) { index = Math.max(index + 1, authority.end); continue; }
    }
    const protocolRelative = authorityContainsUserinfo(value, index, false);
    if (protocolRelative?.unsafe) return true;
    if (protocolRelative) { index = Math.max(index + 1, protocolRelative.end); continue; }
    index += 1;
  }
  return false;
}

export function referenceSafetyIssue(value: string): ReferenceSafetyIssue | undefined {
  const stages = normalizedStages(value);
  if (stages === null) return "reference-length-exceeded";
  const normalized = stages[stages.length - 1]!;
  for (const stage of stages) {
    if (containsAuthorityUserinfoInStage(stage)) return "unsafe-evidence-reference";
    const urlWhitespaceNormalized = stage.replace(/[\t\r\n]/g, "");
    if (urlWhitespaceNormalized !== stage && containsAuthorityUserinfoInStage(urlWhitespaceNormalized)) return "unsafe-evidence-reference";
  }
  return equalsAssignment.test(normalized) || segmentColonAssignment.test(normalized) || spacedColonAssignment.test(normalized) || unspacedColonAssignment.test(normalized) || quotedColonAssignment.test(normalized) || formEqualsAssignment.test(normalized) || formColonAssignment.test(normalized)
    ? "unsafe-evidence-reference"
    : undefined;
}

export function isValueSafeReference(value: string): boolean {
  return referenceSafetyIssue(value) === undefined;
}
