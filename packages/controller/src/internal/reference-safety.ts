/** Reject explicit inline sensitive-payload syntax and URL authority userinfo in otherwise opaque references. */

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
const authoritySensitiveAssignment = new RegExp("^" + sensitiveLabel + "\\b\\s*:\\s*" + nonemptyValue, "iu");
const eligibleSensitiveAssignment = new RegExp("^(?:" + formSensitiveLabel + ")\\b[\"']?\\s*(?::|=)\\s*" + nonemptyValue, "iu");
const eligibleSensitiveAssignmentSearch = new RegExp(eligibleSensitiveAssignment.source.slice(1), "giu");

export const MAX_REFERENCE_CODE_UNITS = 65_536;
const specialAuthoritySchemes = new Set(["ftp", "http", "https", "ws", "wss"]);
const defaultIgnorable = /[\0\p{Default_Ignorable_Code_Point}]/u;
const unicodeWhitespace = /\p{White_Space}/u;
const wrappers = new Set(["(", "[", "{", "<", "\"", "'", "`", "“", "”", "‘", "’", "–", "—", ",", ";", ")", "]", "}", ">"]);

/** An immutable normalized scalar, with exact parent-emission provenance. */
interface Emission { readonly value: string; readonly parentStart: number; readonly parentEnd: number; readonly ordinal: number; }
/** Retained even when NFKC/default-ignorable normalization produces no child. */
interface DecodeGroup { readonly parentStart: number; readonly parentEnd: number; readonly childStart: number; readonly childEnd: number; }
interface EmissionLayer { readonly emissions: readonly Emission[]; readonly groups: readonly DecodeGroup[]; readonly nextEmittingGroup: Int32Array; }
interface EmissionGraph { readonly layers: readonly EmissionLayer[]; }
interface ScanWork { units: number; }
interface ViewLayer { readonly layer: EmissionLayer; readonly visible: Uint8Array; readonly rootStarts: Uint8Array; readonly protected: Uint8Array; readonly nextVisible: Int32Array; }
interface ScanView { readonly layers: readonly ViewLayer[]; }
interface Tokens { readonly view: ViewLayer; readonly indexes: readonly number[]; }
type CandidateScope = "root" | "query";
type ParseResult = { readonly unsafe: boolean; readonly end: number; readonly queryAt?: number; readonly bareBoundary: boolean };
type CandidateDescriptor = { readonly kind: "authority"; readonly start: number; readonly special: boolean } | { readonly kind: "opaque"; readonly start: number } | { readonly kind: "deferred"; readonly end: number };

function scanned(work: ScanWork | undefined, amount = 1): void { if (work) work.units += amount; }
function whiteSpace(value: string): boolean { return unicodeWhitespace.test(value); }
function asciiLetter(value: string | undefined): boolean { return value !== undefined && value >= "a" && value <= "z"; }
function schemeCharacter(value: string | undefined): boolean { return asciiLetter(value) || (value !== undefined && value >= "0" && value <= "9") || value === "+" || value === "-" || value === "."; }
function hex(value: string | undefined): boolean { return value !== undefined && /^[0-9a-f]$/iu.test(value); }
function hexNibble(value: string | undefined): number | undefined { if (value === undefined || value.length !== 1) return undefined; const code = value.charCodeAt(0); return code >= 0x30 && code <= 0x39 ? code - 0x30 : code >= 0x61 && code <= 0x66 ? code - 0x61 + 10 : undefined; }
function utf8Width(byte: number): number | undefined { return byte >= 0xc2 && byte <= 0xdf ? 2 : byte >= 0xe0 && byte <= 0xef ? 3 : byte >= 0xf0 && byte <= 0xf4 ? 4 : undefined; }
function decodeUtf8(bytes: readonly number[]): string | undefined {
  const width = bytes.length;
  if (width === 2 && (bytes[1]! & 0xc0) !== 0x80) return undefined;
  if (width === 3 && ((bytes[1]! & 0xc0) !== 0x80 || (bytes[2]! & 0xc0) !== 0x80 || (bytes[0] === 0xe0 && bytes[1]! < 0xa0) || (bytes[0] === 0xed && bytes[1]! >= 0xa0))) return undefined;
  if (width === 4 && ((bytes[1]! & 0xc0) !== 0x80 || (bytes[2]! & 0xc0) !== 0x80 || (bytes[3]! & 0xc0) !== 0x80 || (bytes[0] === 0xf0 && bytes[1]! < 0x90) || (bytes[0] === 0xf4 && bytes[1]! >= 0x90))) return undefined;
  let point = width === 2 ? bytes[0]! & 0x1f : width === 3 ? bytes[0]! & 0x0f : bytes[0]! & 0x07;
  for (let index = 1; index < width; index += 1) point = (point << 6) | (bytes[index]! & 0x3f);
  return String.fromCodePoint(point);
}
function normalized(value: string): readonly string[] { return Array.from(value.normalize("NFKC").toLowerCase()).filter((scalar) => !defaultIgnorable.test(scalar)); }
function makeLayer(emissions: Emission[], groups: DecodeGroup[], parentLength: number): EmissionLayer | null {
  let units = 0;
  for (const emission of emissions) { units += emission.value.length; if (units > MAX_REFERENCE_CODE_UNITS) return null; }
  const nextEmittingGroup = new Int32Array(parentLength + 1); nextEmittingGroup.fill(-1);
  let group = groups.length - 1; let next = -1;
  for (let parent = parentLength; parent >= 0; parent -= 1) {
    while (group >= 0 && groups[group]!.parentStart >= parent) { if (groups[group]!.childStart < groups[group]!.childEnd) next = group; group -= 1; }
    nextEmittingGroup[parent] = next;
  }
  return { emissions, groups, nextEmittingGroup };
}
function appendGroup(emissions: Emission[], groups: DecodeGroup[], parentStart: number, parentEnd: number, input: string): void {
  const childStart = emissions.length; let ordinal = 0;
  for (const scalar of normalized(input)) emissions.push({ value: scalar, parentStart, parentEnd, ordinal: ordinal++ });
  groups.push({ parentStart, parentEnd, childStart, childEnd: emissions.length });
}
function initialLayer(value: string): EmissionLayer | null {
  if (value.length > MAX_REFERENCE_CODE_UNITS) return null;
  const emissions: Emission[] = []; const groups: DecodeGroup[] = []; let offset = 0;
  for (const scalar of Array.from(value)) { appendGroup(emissions, groups, offset, offset + scalar.length, scalar); offset += scalar.length; }
  return makeLayer(emissions, groups, offset);
}
function byteAt(layer: EmissionLayer, index: number): number | undefined {
  const values = layer.emissions;
  if (values[index]?.value !== "%" || !hex(values[index + 1]?.value) || !hex(values[index + 2]?.value)) return undefined;
  return Number.parseInt(`${values[index + 1]!.value}${values[index + 2]!.value}`, 16);
}
/** Exact, bounded one-percent-decode transition over normalized parent emissions. */
function decodePercentLayer(parent: EmissionLayer): EmissionLayer | null {
  const emissions: Emission[] = []; const groups: DecodeGroup[] = [];
  for (let index = 0; index < parent.emissions.length;) {
    const byte = byteAt(parent, index);
    if (byte === undefined) { appendGroup(emissions, groups, index, index + 1, parent.emissions[index]!.value); index += 1; continue; }
    if (byte < 0x80) { appendGroup(emissions, groups, index, index + 3, String.fromCharCode(byte)); index += 3; continue; }
    const width = utf8Width(byte);
    const bytes = width === undefined ? undefined : Array.from({ length: width }, (_, offset) => byteAt(parent, index + offset * 3));
    const scalar = width !== undefined && bytes?.every((candidate): candidate is number => candidate !== undefined) ? decodeUtf8(bytes) : undefined;
    if (scalar !== undefined && width !== undefined) { appendGroup(emissions, groups, index, index + width * 3, scalar); index += width * 3; continue; }
    appendGroup(emissions, groups, index, index + 3, parent.emissions.slice(index, index + 3).map((emission) => emission!.value).join("")); index += 3;
  }
  return makeLayer(emissions, groups, parent.emissions.length);
}
function buildGraph(value: string, work?: ScanWork): EmissionGraph | null {
  const l0 = initialLayer(value); if (l0 === null) return null;
  const l1 = decodePercentLayer(l0); if (l1 === null) return null;
  const l2 = decodePercentLayer(l1); if (l2 === null) return null;
  for (const layer of [l0, l1, l2]) scanned(work, layer.emissions.length + layer.groups.length);
  return { layers: [l0, l1, l2] };
}

export function stripDefaultIgnorables(value: string): string { return value.normalize("NFKC").replace(invisible, ""); }
export type ReferenceSafetyIssue = "reference-length-exceeded" | "unsafe-evidence-reference";

function createView(graph: EmissionGraph, compact: boolean, work?: ScanWork): ScanView {
  return { layers: graph.layers.map((layer) => {
    const visible = new Uint8Array(layer.emissions.length); const rootStarts = new Uint8Array(layer.emissions.length); const nextVisible = new Int32Array(layer.emissions.length + 1); nextVisible.fill(-1);
    let next = -1;
    for (let index = layer.emissions.length - 1; index >= 0; index -= 1) {
      const scalar = layer.emissions[index]!.value;
      const shown = !(compact && (scalar === "\t" || scalar === "\r" || scalar === "\n"));
      visible[index] = shown ? 1 : 0; if (shown) next = index; nextVisible[index] = next; scanned(work);
    }
    let removedUrlWhitespace = false;
    for (let index = 0; index < layer.emissions.length; index += 1) {
      if (visible[index] === 0) { removedUrlWhitespace = true; continue; }
      if (index === 0 || removedUrlWhitespace) rootStarts[index] = 1;
      removedUrlWhitespace = false;
    }
    return { layer, visible, rootStarts, protected: new Uint8Array(layer.emissions.length), nextVisible };
  }) };
}
/** Same-view-only projection through immutable parent ranges. */
function projectProtection(parent: ViewLayer, child: ViewLayer, work?: ScanWork): void {
  const prefix = new Uint32Array(parent.protected.length + 1);
  for (let index = 0; index < parent.protected.length; index += 1) { prefix[index + 1] = prefix[index]! + parent.protected[index]!; scanned(work); }
  for (const group of child.layer.groups) {
    if (prefix[group.parentEnd]! !== prefix[group.parentStart]!) for (let childIndex = group.childStart; childIndex < group.childEnd; childIndex += 1) child.protected[childIndex] = 1;
    scanned(work, 1 + group.childEnd - group.childStart);
  }
}
function tokensFor(view: ViewLayer, work?: ScanWork): Tokens { const indexes: number[] = []; for (let index = 0; index < view.layer.emissions.length; index += 1) { if (view.visible[index] === 1) indexes.push(index); scanned(work); } return { view, indexes }; }
function value(tokens: Tokens, position: number): string | undefined { const index = tokens.indexes[position]; return index === undefined ? undefined : tokens.view.layer.emissions[index]!.value; }
function protectedAt(tokens: Tokens, position: number): boolean { const index = tokens.indexes[position]; return index === undefined || tokens.view.protected[index] === 1; }
function literal(tokens: Tokens, position: number, expected: string): boolean { return value(tokens, position) === expected; }
function mark(tokens: Tokens, start: number, end: number): void { for (let position = start; position < end; position += 1) { const index = tokens.indexes[position]; if (index !== undefined) tokens.view.protected[index] = 1; } }
function join(tokens: Tokens, start = 0, end = tokens.indexes.length): string { let result = ""; for (let position = start; position < end; position += 1) result += value(tokens, position) ?? ""; return result; }
function schemeEnds(tokens: Tokens, work?: ScanWork): Int32Array {
  const ends = new Int32Array(tokens.indexes.length + 1); let end = tokens.indexes.length;
  for (let position = tokens.indexes.length - 1; position >= 0; position -= 1) {
    if (!protectedAt(tokens, position) && schemeCharacter(value(tokens, position))) { end = position + 1 < tokens.indexes.length && !protectedAt(tokens, position + 1) && schemeCharacter(value(tokens, position + 1)) ? ends[position + 1]! : position + 1; ends[position] = end; }
    else { end = position; ends[position] = position; }
    scanned(work);
  }
  return ends;
}
function protocolRelativeAt(tokens: Tokens, position: number): boolean { return !protectedAt(tokens, position) && !protectedAt(tokens, position + 1) && literal(tokens, position, "/") && literal(tokens, position + 1, "/"); }
function schemeAt(tokens: Tokens, position: number, ends: Int32Array, work?: ScanWork): { readonly special: boolean; readonly afterColon: number } | undefined {
  scanned(work); if (protectedAt(tokens, position) || !asciiLetter(value(tokens, position))) return undefined;
  const end = ends[position]!; if (protectedAt(tokens, end) || !literal(tokens, end, ":")) return undefined;
  return { special: specialAuthoritySchemes.has(join(tokens, position, end)), afterColon: end + 1 };
}
function deferredEnd(tokens: Tokens, start: number): number { let position = start; while (position < tokens.indexes.length && !whiteSpace(value(tokens, position) ?? "")) position += 1; return position; }
function firstFutureEmission(view: ScanView, depth: number, sourceIndex: number, work?: ScanWork): string | undefined {
  // Group indexes make this a constant bounded (at most two layer) lookup.
  let parentIndex = sourceIndex;
  for (let target = depth + 1; target < view.layers.length; target += 1) {
    const child = view.layers[target]!;
    const groupIndex = child.layer.nextEmittingGroup[Math.min(parentIndex, child.layer.nextEmittingGroup.length - 1)]!;
    if (groupIndex < 0) return undefined;
    const group = child.layer.groups[groupIndex]!; const childIndex = child.nextVisible[group.childStart]!;
    if (childIndex >= 0 && childIndex < group.childEnd) return child.layer.emissions[childIndex]!.value;
    parentIndex = group.childEnd; scanned(work);
  }
  return undefined;
}
function futureStructureAt(view: ScanView, depth: number, sourceIndex: number, work?: ScanWork): boolean {
  const future = firstFutureEmission(view, depth, sourceIndex, work);
  return future !== undefined && (future === "%" || future === "/" || future === ":" || future === "?" || future === "#" || future === "\\" || whiteSpace(future) || wrappers.has(future));
}
function projectedAuthorityMarkerAt(view: ScanView, depth: number, sourceIndex: number): boolean {
  const child = view.layers[depth + 1]; if (child === undefined) return false;
  const groupIndex = child.layer.nextEmittingGroup[Math.min(sourceIndex, child.layer.nextEmittingGroup.length - 1)]!; if (groupIndex < 0) return false;
  const group = child.layer.groups[groupIndex]!; const first = child.nextVisible[group.childStart]!;
  return first >= 0 && first < group.childEnd && child.layer.emissions[first]?.value === "/" && child.nextVisible[first + 1]! >= 0 && child.layer.emissions[child.nextVisible[first + 1]!]?.value === "/";
}
function sensitiveColonStartMask(tokens: Tokens, work?: ScanWork): Uint8Array {
  const starts = new Uint8Array(tokens.indexes.length);
  for (let start = 0; start < tokens.indexes.length;) {
    while (start < tokens.indexes.length && protectedAt(tokens, start)) { start += 1; scanned(work); }
    if (start >= tokens.indexes.length) break;
    let end = start; const chunks: string[] = []; const positions: number[] = [];
    while (end < tokens.indexes.length && !protectedAt(tokens, end)) { const scalar = value(tokens, end)!; chunks.push(scalar); for (let offset = 0; offset < scalar.length; offset += 1) positions.push(end); end += 1; scanned(work); }
    const text = chunks.join("");
    eligibleSensitiveAssignmentSearch.lastIndex = 0;
    for (let match = eligibleSensitiveAssignmentSearch.exec(text); match !== null; match = eligibleSensitiveAssignmentSearch.exec(text)) { const position = positions[match.index]; if (position !== undefined) starts[position] = 1; if (match[0].length === 0) eligibleSensitiveAssignmentSearch.lastIndex += 1; }
    scanned(work, end - start); start = end;
  }
  return starts;
}
function sensitiveAuthorityAssignment(tokens: Tokens, start: number, end: number): boolean { return authoritySensitiveAssignment.test(join(tokens, start, end)); }
function protectPath(tokens: Tokens, start: number, work?: ScanWork): { readonly end: number; readonly queryAt?: number } {
  let position = start;
  while (position < tokens.indexes.length) { const current = value(tokens, position)!; if (current === "?" || current === "#") { mark(tokens, start, position); return { end: position, queryAt: position }; } if (whiteSpace(current)) { mark(tokens, start, position); return { end: position }; } position += 1; scanned(work); }
  mark(tokens, start, position); return { end: position };
}
function protectOpaque(tokens: Tokens, start: number, view: ScanView, depth: number, work?: ScanWork): { readonly end: number; readonly queryAt?: number } {
  let position = start;
  while (position < tokens.indexes.length) { const current = value(tokens, position)!; if (current === "?" || current === "#" || whiteSpace(current)) break; if (current === "%" && futureStructureAt(view, depth, tokens.indexes[position]!, work)) return { end: deferredEnd(tokens, position) }; position += 1; scanned(work); }
  mark(tokens, start, position); return position < tokens.indexes.length && (literal(tokens, position, "?") || literal(tokens, position, "#")) ? { end: position, queryAt: position } : { end: position };
}
function authorityAtBeforeDelimiter(tokens: Tokens, start: number, special: boolean): boolean { for (let position = start; position < tokens.indexes.length; position += 1) { const current = value(tokens, position)!; if (current === "@") return true; if (whiteSpace(current) || current === "/" || current === "?" || current === "#" || (special && current === "\\")) return false; } return false; }
function describeCandidate(tokens: Tokens, position: number, ends: Int32Array, view: ScanView, depth: number, work?: ScanWork): CandidateDescriptor | undefined {
  const scheme = schemeAt(tokens, position, ends, work);
  if (scheme !== undefined) {
    if (scheme.special) { let start = scheme.afterColon; while (literal(tokens, start, "/") || literal(tokens, start, "\\") || (literal(tokens, start, ":") && (literal(tokens, start + 1, "/") || literal(tokens, start + 1, "\\")))) start += 1; return { kind: "authority", start, special: true }; }
    if (protocolRelativeAt(tokens, scheme.afterColon)) return { kind: "authority", start: scheme.afterColon + 2, special: false };
    const source = tokens.indexes[scheme.afterColon]; return source !== undefined && projectedAuthorityMarkerAt(view, depth, source) ? { kind: "deferred", end: deferredEnd(tokens, scheme.afterColon) } : { kind: "opaque", start: scheme.afterColon };
  }
  if (protocolRelativeAt(tokens, position)) return { kind: "authority", start: position + 2, special: false };
  const source = tokens.indexes[position]; return source !== undefined && projectedAuthorityMarkerAt(view, depth, source) ? { kind: "deferred", end: deferredEnd(tokens, position) } : undefined;
}
function scanAuthority(tokens: Tokens, start: number, special: boolean, ends: Int32Array, view: ScanView, depth: number, work?: ScanWork): ParseResult {
  let position = start;
  while (position < tokens.indexes.length) {
    const current = value(tokens, position)!; const source = tokens.indexes[position]!; scanned(work);
    if (position > start && view.layers[depth]!.rootStarts[source] === 1) {
      const nested = describeCandidate(tokens, position, ends, view, depth, work);
      if (nested?.kind === "authority") {
        if (sensitiveAuthorityAssignment(tokens, start, position)) return { unsafe: true, end: position, bareBoundary: false };
        return { unsafe: false, end: position, bareBoundary: true };
      }
    }
    if (current === "@") return { unsafe: true, end: position + 1, bareBoundary: false };
    if (current === "%" && futureStructureAt(view, depth, source, work)) return sensitiveAuthorityAssignment(tokens, start, position) || authorityAtBeforeDelimiter(tokens, position, special) ? { unsafe: true, end: position, bareBoundary: false } : { unsafe: false, end: deferredEnd(tokens, position), bareBoundary: false };
    if (current === "/" || current === "?" || current === "#" || (special && current === "\\")) { if (sensitiveAuthorityAssignment(tokens, start, position)) return { unsafe: true, end: position, bareBoundary: false }; if (current === "?" || current === "#") return { unsafe: false, end: position, queryAt: position, bareBoundary: false }; return { unsafe: false, ...protectPath(tokens, position, work), bareBoundary: false }; }
    if (whiteSpace(current)) return sensitiveAuthorityAssignment(tokens, start, position) ? { unsafe: true, end: position, bareBoundary: false } : { unsafe: false, end: position, bareBoundary: false };
    if (wrappers.has(current)) { if (sensitiveAuthorityAssignment(tokens, start, position) || authorityAtBeforeDelimiter(tokens, position + 1, special)) return { unsafe: true, end: position, bareBoundary: false }; return { unsafe: false, end: position, bareBoundary: true }; }
    position += 1;
  }
  return sensitiveAuthorityAssignment(tokens, start, position) ? { unsafe: true, end: position, bareBoundary: false } : { unsafe: false, end: position, bareBoundary: true };
}
function parseCandidate(tokens: Tokens, position: number, ends: Int32Array, view: ScanView, depth: number, work?: ScanWork): ParseResult | undefined {
  const candidate = describeCandidate(tokens, position, ends, view, depth, work); if (candidate === undefined) return undefined;
  if (candidate.kind === "deferred") return { unsafe: false, end: candidate.end, bareBoundary: false };
  if (candidate.kind === "opaque") { const opaque = protectOpaque(tokens, candidate.start, view, depth, work); return { unsafe: false, end: opaque.end, queryAt: opaque.queryAt, bareBoundary: false }; }
  return scanAuthority(tokens, candidate.start, candidate.special, ends, view, depth, work);
}
function skipQuotedJsonKey(tokens: Tokens, position: number): number | undefined {
  const quote = value(tokens, position); if (quote !== "\"" && quote !== "'") return undefined;
  let cursor = position + 1;
  while (cursor < tokens.indexes.length) { if (literal(tokens, cursor, "\\")) { cursor += 2; continue; } if (literal(tokens, cursor, quote)) { cursor += 1; while (whiteSpace(value(tokens, cursor) ?? "")) cursor += 1; return literal(tokens, cursor, ":") ? cursor + 1 : undefined; } cursor += 1; }
  return undefined;
}
function structuralScan(viewLayer: ViewLayer, view: ScanView, depth: number, work?: ScanWork): boolean {
  const tokens = tokensFor(viewLayer, work); const ends = schemeEnds(tokens, work); const sensitiveStarts = sensitiveColonStartMask(tokens, work);
  let scope: CandidateScope = "root"; let valueStart = false; let rootStart = true; let afterBareAuthority = false;
  const jsonContainers: string[] = []; let jsonQuote: string | undefined; let jsonStringStart = false; let jsonEscape = false;
  for (let position = 0; position < tokens.indexes.length;) {
    const current = value(tokens, position)!; if (protectedAt(tokens, position)) { position += 1; continue; } scanned(work);
    if (scope === "root") {
      if (rootStart || viewLayer.rootStarts[tokens.indexes[position]!] === 1 || (afterBareAuthority && wrappers.has(current))) {
        if (sensitiveStarts[position] === 1) return true;
        const parsed = parseCandidate(tokens, position, ends, view, depth, work);
        if (parsed !== undefined) { if (parsed.unsafe) return true; afterBareAuthority = parsed.bareBoundary; if (parsed.queryAt !== undefined) { scope = "query"; valueStart = true; position = parsed.queryAt + 1; continue; } position = parsed.end > position ? parsed.end : position + 1; continue; }
      }
      if (current === "%" && futureStructureAt(view, depth, tokens.indexes[position]!, work)) { position = deferredEnd(tokens, position); continue; }
      if (current === "%" && projectedAuthorityMarkerAt(view, depth, tokens.indexes[position]!)) { position = deferredEnd(tokens, position); continue; }
      if (current === "/" && !protocolRelativeAt(tokens, position) && !literal(tokens, position - 1, "/")) {
        const next = tokens.indexes[position + 1];
        if (next !== undefined && value(tokens, position + 1) === "%" && futureStructureAt(view, depth, next, work)) { position = deferredEnd(tokens, position + 1); continue; }
        const path = protectPath(tokens, position, work); position = Math.max(position + 1, path.end); continue;
      }
      if (whiteSpace(current)) { rootStart = true; afterBareAuthority = false; } else { rootStart = rootStart && wrappers.has(current); afterBareAuthority = afterBareAuthority && wrappers.has(current); }
      position += 1; continue;
    }
    if (jsonQuote !== undefined) { if (jsonEscape) jsonEscape = false; else if (current === "\\") jsonEscape = true; else if (current === jsonQuote) jsonQuote = undefined; else if (jsonStringStart) { if (sensitiveStarts[position] === 1) return true; const parsed = parseCandidate(tokens, position, ends, view, depth, work); if (parsed?.unsafe) return true; jsonStringStart = wrappers.has(current); } else if (whiteSpace(current)) jsonStringStart = true; position += 1; continue; }
    if (whiteSpace(current)) { scope = "root"; rootStart = true; valueStart = false; afterBareAuthority = false; position += 1; continue; }
    if (valueStart) {
      if (wrappers.has(current)) { if (current === "{" || current === "[") jsonContainers.push(current); const keyEnd = jsonContainers.length > 0 ? skipQuotedJsonKey(tokens, position) : undefined; if (keyEnd !== undefined) { position = keyEnd; valueStart = true; continue; } if (jsonContainers.length > 0 && (current === "\"" || current === "'")) { jsonQuote = current; jsonStringStart = true; valueStart = false; position += 1; continue; } position += 1; continue; }
      if (sensitiveStarts[position] === 1) return true;
      const parsed = parseCandidate(tokens, position, ends, view, depth, work); valueStart = false;
      if (parsed !== undefined) { if (parsed.unsafe) return true; if (parsed.queryAt !== undefined) { valueStart = true; position = parsed.queryAt + 1; continue; } position = parsed.end > position ? parsed.end : position + 1; continue; }
    }
    if (current === "?" || current === "#" || current === "&" || current === ";" || current === "=") valueStart = true;
    else if (current === "{" || current === "[") jsonContainers.push(current);
    else if ((current === "}" && jsonContainers.at(-1) === "{") || (current === "]" && jsonContainers.at(-1) === "[")) jsonContainers.pop();
    else if (current === "," && jsonContainers.length > 0) valueStart = true;
    else if (jsonContainers.length > 0) { const keyEnd = skipQuotedJsonKey(tokens, position); if (keyEnd !== undefined) { valueStart = true; position = keyEnd; continue; } }
    position += 1;
  }
  return false;
}
function hasSensitiveAssignment(viewLayer: ViewLayer, work?: ScanWork): boolean {
  const values: string[] = [];
  for (let index = 0; index < viewLayer.layer.emissions.length; index += 1) { if (viewLayer.visible[index] === 1) values.push(viewLayer.layer.emissions[index]!.value); scanned(work); }
  const text = values.join("");
  return equalsAssignment.test(text) || segmentColonAssignment.test(text) || spacedColonAssignment.test(text) || unspacedColonAssignment.test(text) || quotedColonAssignment.test(text) || formEqualsAssignment.test(text) || formColonAssignment.test(text);
}
function evaluateView(view: ScanView, work?: ScanWork): boolean { for (let depth = 0; depth < view.layers.length; depth += 1) { if (depth > 0) projectProtection(view.layers[depth - 1]!, view.layers[depth]!, work); const layer = view.layers[depth]!; if (structuralScan(layer, view, depth, work) || hasSensitiveAssignment(layer, work)) return true; } return false; }
function evaluateReferenceSafety(value: string, work?: ScanWork): ReferenceSafetyIssue | undefined {
  const graph = buildGraph(value, work); if (graph === null) return "reference-length-exceeded";
  // Views deliberately do not share protection: compact WHATWG parsing may
  // not suppress a preserved-view finding (or vice versa).
  return evaluateView(createView(graph, false, work), work) || evaluateView(createView(graph, true, work), work) ? "unsafe-evidence-reference" : undefined;
}
export function referenceSafetyIssue(value: string): ReferenceSafetyIssue | undefined { return evaluateReferenceSafety(value); }
export function referenceSafetyOperationCount(value: string): number { const work: ScanWork = { units: 0 }; evaluateReferenceSafety(value, work); return work.units; }
export function isValueSafeReference(value: string): boolean { return referenceSafetyIssue(value) === undefined; }
