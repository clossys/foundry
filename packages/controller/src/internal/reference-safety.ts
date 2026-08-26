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

export const MAX_REFERENCE_CODE_UNITS = 65_536;
const specialAuthoritySchemes = new Set(["ftp", "http", "https", "ws", "wss"]);
const defaultIgnorable = /[\0\p{Default_Ignorable_Code_Point}]/u;
const unicodeWhitespace = /\p{White_Space}/u;
const rootWrappers = new Set(["(", "[", "{", "<", "\"", "'", "`", "“", "”", "‘", "’", "–", "—"]);
const postAuthorityWrappers = new Set([...rootWrappers, ",", ";", ")", "]", "}", ">"]);
const openingValueWrappers = new Set(["(", "[", "{", "<", "\"", "'", "`", "“", "‘"]);

interface Atom { readonly value: string; readonly protected: boolean; }
interface Layer { readonly atoms: Atom[]; }
type CandidateScope = "root" | "query";
type ParseResult = { readonly unsafe: boolean; readonly end: number; readonly queryAt?: number; readonly bareBoundary: boolean };
type SchemeEnds = readonly number[];
type CandidateDescriptor = { readonly kind: "authority"; readonly start: number; readonly special: boolean } | { readonly kind: "opaque"; readonly start: number };
interface ScanWork { units: number; }
function scanned(work: ScanWork | undefined): void { if (work) work.units += 1; }

function whiteSpace(value: string): boolean { return unicodeWhitespace.test(value); }
function asciiLetter(value: string | undefined): boolean { return value !== undefined && value >= "a" && value <= "z"; }
function schemeCharacter(value: string | undefined): boolean { return asciiLetter(value) || (value !== undefined && value >= "0" && value <= "9") || value === "+" || value === "-" || value === "."; }
function hex(value: string | undefined): boolean { return value !== undefined && /^[0-9a-f]$/iu.test(value); }
function literal(atoms: readonly Atom[], index: number, value: string): boolean { return atoms[index]?.value === value; }
function join(atoms: readonly Atom[], start = 0, end = atoms.length): string { return atoms.slice(start, end).map((atom) => atom.value).join(""); }

/** NFKC/case/default-ignorable normalization with one exact parent mark for each emitted scalar. */
function normalizeAtoms(atoms: readonly Atom[]): Layer | null {
  const normalized: Atom[] = [];
  let codeUnits = 0;
  for (const atom of atoms) for (const scalar of Array.from(atom.value.normalize("NFKC").toLowerCase())) {
    if (defaultIgnorable.test(scalar)) continue;
    normalized.push({ value: scalar, protected: atom.protected });
    codeUnits += scalar.length;
    if (codeUnits > MAX_REFERENCE_CODE_UNITS) return null;
  }
  return { atoms: normalized };
}
function initialLayer(value: string): Layer | null {
  if (value.length > MAX_REFERENCE_CODE_UNITS) return null;
  return normalizeAtoms(Array.from(value).map((scalar) => ({ value: scalar, protected: false })));
}
function byteAt(atoms: readonly Atom[], index: number): number | undefined {
  if (!literal(atoms, index, "%") || !hex(atoms[index + 1]?.value) || !hex(atoms[index + 2]?.value)) return undefined;
  return Number.parseInt(`${atoms[index + 1]!.value}${atoms[index + 2]!.value}`, 16);
}
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
/** Decodes ASCII escapes independently and a multibyte scalar only from an exact 2–4-escape sequence. */
function decodePercentLayer(layer: Layer): Layer | null {
  const decoded: Atom[] = [];
  for (let index = 0; index < layer.atoms.length;) {
    const byte = byteAt(layer.atoms, index);
    if (byte === undefined) { decoded.push(layer.atoms[index]!); index += 1; continue; }
    const escaped = layer.atoms.slice(index, index + 3);
    const protectedParent = escaped.some((atom) => atom!.protected);
    if (byte < 0x80) { decoded.push({ value: String.fromCharCode(byte), protected: protectedParent }); index += 3; continue; }
    const width = utf8Width(byte);
    const bytes = width === undefined ? undefined : Array.from({ length: width }, (_, offset) => byteAt(layer.atoms, index + offset * 3));
    if (width !== undefined && bytes?.every((candidate): candidate is number => candidate !== undefined)) {
      const scalar = decodeUtf8(bytes);
      if (scalar !== undefined) { decoded.push({ value: scalar, protected: layer.atoms.slice(index, index + width * 3).some((atom) => atom!.protected) }); index += width * 3; continue; }
    }
    decoded.push(...escaped); index += 3;
  }
  return normalizeAtoms(decoded);
}

export function stripDefaultIgnorables(value: string): string { return value.normalize("NFKC").replace(invisible, ""); }
export type ReferenceSafetyIssue = "reference-length-exceeded" | "unsafe-evidence-reference";
function rootStart(atoms: readonly Atom[], index: number, rootAtomStart: boolean, afterBareAuthority: boolean): boolean {
  if (atoms[index]?.protected) return false;
  if (index === 0 || rootAtomStart) return true;
  const previous = atoms[index - 1]?.value;
  return previous !== undefined && afterBareAuthority && postAuthorityWrappers.has(previous);
}
function schemeEnds(atoms: readonly Atom[], work?: ScanWork): SchemeEnds {
  const ends = new Array<number>(atoms.length);
  let end = atoms.length;
  for (let index = atoms.length - 1; index >= 0; index -= 1) {
    scanned(work);
    if (!atoms[index]!.protected && schemeCharacter(atoms[index]!.value)) {
      end = index + 1 < atoms.length && !atoms[index + 1]!.protected && schemeCharacter(atoms[index + 1]!.value) ? ends[index + 1]! : index + 1;
      ends[index] = end;
    } else {
      end = index;
      ends[index] = index;
    }
  }
  return ends;
}
function specialSchemeAt(atoms: readonly Atom[], start: number, end: number): boolean {
  for (const name of specialAuthoritySchemes) {
    if (name.length !== end - start) continue;
    let matches = true;
    for (let offset = 0; offset < name.length; offset += 1) if (atoms[start + offset]!.value !== name[offset]) { matches = false; break; }
    if (matches) return true;
  }
  return false;
}
function schemeAt(atoms: readonly Atom[], index: number, ends: SchemeEnds, work?: ScanWork): { readonly special: boolean; readonly afterColon: number } | undefined {
  scanned(work);
  if (atoms[index]?.protected || !asciiLetter(atoms[index]?.value)) return undefined;
  const end = ends[index]!;
  return !atoms[end]?.protected && literal(atoms, end, ":") ? { special: specialSchemeAt(atoms, index, end), afterColon: end + 1 } : undefined;
}
function protocolRelativeAt(atoms: readonly Atom[], index: number): boolean { return !atoms[index]?.protected && !atoms[index + 1]?.protected && literal(atoms, index, "/") && literal(atoms, index + 1, "/"); }
function mark(atoms: Atom[], start: number, end: number): void { for (let index = start; index < end; index += 1) { const atom = atoms[index]!; if (!atom.protected) atoms[index] = { value: atom.value, protected: true }; } }
function protectPath(atoms: Atom[], start: number, work?: ScanWork): { readonly end: number; readonly queryAt?: number } {
  let cursor = start;
  while (cursor < atoms.length) {
    scanned(work);
    const atom = atoms[cursor]!;
    const value = atom.value;
    if (atom.protected) { cursor += 1; continue; }
    if (value === "?" || value === "#") { mark(atoms, start, cursor); return { end: cursor, queryAt: cursor }; }
    if (whiteSpace(value)) { mark(atoms, start, cursor); return { end: cursor }; }
    cursor += 1;
  }
  mark(atoms, start, cursor); return { end: cursor };
}
function whitespaceByte(byte: number): boolean { return byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === 0x20; }
function structuralByte(byte: number): boolean { return whitespaceByte(byte) || byte === 0x2f || byte === 0x3a || byte === 0x3f || byte === 0x23 || byte === 0x5c; }
/** An unprotected source atom that becomes URL structure in either remaining decode layer. */
function futureStructureAt(atoms: readonly Atom[], index: number): boolean {
  const byte = byteAt(atoms, index);
  if (byte !== undefined) {
    // A valid %25 can join independently decoded following atoms into a new
    // escape on the last layer, so it is structurally unstable by itself.
    if (byte === 0x25) return true;
    if (structuralByte(byte)) return true;
    const width = utf8Width(byte);
    const bytes = width === undefined ? undefined : Array.from({ length: width }, (_, offset) => byteAt(atoms, index + offset * 3));
    if (width !== undefined && bytes?.every((candidate): candidate is number => candidate !== undefined)) {
      const scalar = decodeUtf8(bytes);
      if (scalar !== undefined && whiteSpace(scalar)) return true;
    }
  }
  // A %25 escape followed by hex digits materializes a percent escape one
  // layer later.  Check only the at-most-four exact UTF-8 parent escapes.
  if (byteAt(atoms, index) !== 0x25) return false;
  const doubleByte = (offset: number): number | undefined => {
    const start = index + offset * 5;
    return byteAt(atoms, start) === 0x25 && hex(atoms[start + 3]?.value) && hex(atoms[start + 4]?.value)
      ? Number.parseInt(`${atoms[start + 3]!.value}${atoms[start + 4]!.value}`, 16)
      : undefined;
  };
  const first = doubleByte(0);
  if (first === undefined) return false;
  if (structuralByte(first)) return true;
  const width = utf8Width(first);
  const bytes = width === undefined ? undefined : Array.from({ length: width }, (_, offset) => doubleByte(offset));
  return Boolean(width !== undefined && bytes?.every((candidate): candidate is number => candidate !== undefined) && (() => {
    const scalar = decodeUtf8(bytes);
    return scalar !== undefined && whiteSpace(scalar);
  })());
}
function deferredEnd(atoms: readonly Atom[], start: number): number {
  let cursor = start;
  while (cursor < atoms.length && !whiteSpace(atoms[cursor]!.value)) cursor += 1;
  return cursor;
}
function actualAtBeforeDelimiter(atoms: readonly Atom[], start: number, special: boolean): boolean {
  for (let cursor = start; cursor < atoms.length && !whiteSpace(atoms[cursor]!.value); cursor += 1) {
    const value = atoms[cursor]!.value;
    if (value === "/" || value === "?" || value === "#" || (special && value === "\\")) return false;
    if (!atoms[cursor]!.protected && value === "@") return true;
  }
  return false;
}
function sensitiveAuthorityAssignment(atoms: readonly Atom[], start: number, end: number): boolean {
  return authoritySensitiveAssignment.test(join(atoms, start, end));
}
function protectOpaque(atoms: Atom[], start: number, remainingDepth: number, work?: ScanWork): { readonly end: number; readonly queryAt?: number } {
  let cursor = start;
  while (cursor < atoms.length && atoms[cursor]!.value !== "?" && atoms[cursor]!.value !== "#" && !whiteSpace(atoms[cursor]!.value) && !(remainingDepth > 0 && futureStructureAt(atoms, cursor))) { scanned(work); cursor += 1; }
  mark(atoms, start, cursor);
  if (cursor < atoms.length && remainingDepth > 0 && futureStructureAt(atoms, cursor)) return { end: deferredEnd(atoms, cursor) };
  return cursor < atoms.length ? { end: cursor, queryAt: cursor } : { end: cursor };
}
function scanAuthority(atoms: Atom[], start: number, special: boolean, remainingDepth: number, sourceAtomStarts: readonly boolean[] | undefined, ends: SchemeEnds, work?: ScanWork): ParseResult {
  let authorityStart = start;
  let authoritySpecial = special;
  let cursor = start;
  while (cursor < atoms.length) {
    scanned(work);
    if (cursor > authorityStart && sourceAtomStarts?.[cursor]) {
      const nested = describeCandidate(atoms, cursor, ends, work);
      if (nested !== undefined && sensitiveAuthorityAssignment(atoms, authorityStart, cursor)) return { unsafe: true, end: cursor, bareBoundary: false };
      if (nested?.kind === "opaque") {
        const opaque = protectOpaque(atoms, nested.start, remainingDepth, work);
        return { unsafe: false, end: opaque.end, queryAt: opaque.queryAt, bareBoundary: false };
      }
      if (nested?.kind === "authority") {
        if (nested.start <= cursor) return { unsafe: true, end: cursor, bareBoundary: false };
        authorityStart = nested.start;
        authoritySpecial = nested.special;
        cursor = nested.start;
        continue;
      }
    }
    const atom = atoms[cursor]!;
    const value = atom.value;
    if (atom.protected) { cursor += 1; continue; }
    if (remainingDepth > 0 && futureStructureAt(atoms, cursor)) {
      if (sensitiveAuthorityAssignment(atoms, authorityStart, cursor) || (cursor > authorityStart && actualAtBeforeDelimiter(atoms, cursor, authoritySpecial))) return { unsafe: true, end: cursor, bareBoundary: false };
      return { unsafe: false, end: deferredEnd(atoms, cursor), bareBoundary: false };
    }
    if (value === "@") return { unsafe: true, end: cursor + 1, bareBoundary: false };
    if (value === "/" || value === "?" || value === "#" || (authoritySpecial && value === "\\")) {
      if (sensitiveAuthorityAssignment(atoms, authorityStart, cursor)) return { unsafe: true, end: cursor, bareBoundary: false };
      if (value === "?" || value === "#") return { unsafe: false, end: cursor, queryAt: cursor, bareBoundary: false };
      const path = protectPath(atoms, cursor, work); return { unsafe: false, end: path.end, queryAt: path.queryAt, bareBoundary: false };
    }
    if (whiteSpace(value)) return sensitiveAuthorityAssignment(atoms, authorityStart, cursor) ? { unsafe: true, end: cursor, bareBoundary: false } : { unsafe: false, end: cursor, bareBoundary: false };
    if (postAuthorityWrappers.has(value)) {
      if (sensitiveAuthorityAssignment(atoms, authorityStart, cursor) || actualAtBeforeDelimiter(atoms, cursor, authoritySpecial)) return { unsafe: true, end: cursor, bareBoundary: false };
      return { unsafe: false, end: cursor, bareBoundary: true };
    }
    cursor += 1;
  }
  return sensitiveAuthorityAssignment(atoms, authorityStart, cursor) ? { unsafe: true, end: cursor, bareBoundary: false } : { unsafe: false, end: cursor, bareBoundary: true };
}
function describeCandidate(atoms: readonly Atom[], index: number, ends: SchemeEnds, work?: ScanWork): CandidateDescriptor | undefined {
  const scheme = schemeAt(atoms, index, ends, work);
  if (scheme !== undefined) {
    if (scheme.special) {
      let start = scheme.afterColon;
      while (!atoms[start]?.protected && (literal(atoms, start, "/") || literal(atoms, start, "\\") || (literal(atoms, start, ":") && (literal(atoms, start + 1, "/") || literal(atoms, start + 1, "\\"))))) start += 1;
      return { kind: "authority", start, special: true };
    }
    if (protocolRelativeAt(atoms, scheme.afterColon)) return { kind: "authority", start: scheme.afterColon + 2, special: false };
    return { kind: "opaque", start: scheme.afterColon };
  }
  return protocolRelativeAt(atoms, index) ? { kind: "authority", start: index + 2, special: false } : undefined;
}
function parseCandidate(atoms: Atom[], index: number, remainingDepth: number, sourceAtomStarts: readonly boolean[] | undefined, ends: SchemeEnds, work?: ScanWork): ParseResult | undefined {
  const candidate = describeCandidate(atoms, index, ends, work);
  if (candidate === undefined) return undefined;
  if (candidate.kind === "opaque") {
    const opaque = protectOpaque(atoms, candidate.start, remainingDepth, work);
    return { unsafe: false, end: opaque.end, queryAt: opaque.queryAt, bareBoundary: false };
  }
  return scanAuthority(atoms, candidate.start, candidate.special, remainingDepth, sourceAtomStarts, ends, work);
}
function skipQuotedJsonKey(atoms: readonly Atom[], index: number): number | undefined {
  const quote = atoms[index]?.value;
  if (quote !== "\"" && quote !== "'") return undefined;
  let cursor = index + 1;
  while (cursor < atoms.length) {
    if (atoms[cursor]!.value === "\\") { cursor += 2; continue; }
    if (atoms[cursor]!.value === quote) { cursor += 1; while (whiteSpace(atoms[cursor]?.value ?? "")) cursor += 1; return atoms[cursor]?.value === ":" ? cursor + 1 : undefined; }
    cursor += 1;
  }
  return undefined;
}
/** Marks literal path/opaque regions while looking for authority candidates in one structural view. */
function structuralScan(layer: Layer, stripUrlWhitespace: boolean, remainingDepth: number, work?: ScanWork): boolean {
  const source = layer.atoms;
  const indexes: number[] = [];
  const sourceAtomStarts: boolean[] = [];
  let removedWhitespace = false;
  for (let index = 0; index < source.length; index += 1) {
    scanned(work);
    const atom = source[index]!;
    if (stripUrlWhitespace && (atom.value === "\t" || atom.value === "\r" || atom.value === "\n")) { removedWhitespace ||= whiteSpace(atom.value); continue; }
    indexes.push(index);
    sourceAtomStarts.push(index === 0 || removedWhitespace);
    removedWhitespace = false;
  }
  // A removed URL-style whitespace atom still begins the next source atom for
  // candidate extraction; only its delimiter role is removed from this view.
  // The view has its own contiguous atoms.  Its marks are mapped back below,
  // rather than letting a removed TAB/CR/LF remain structural by accident.
  const atoms = indexes.map((index) => ({ ...source[index]! }));
  const ends = schemeEnds(atoms, work);
  let scope: CandidateScope = "root";
  let valueStart = false;
  let rootAtomStart = true;
  let rootHasFutureStructure = false;
  let rootHasPercentEscape = false;
  let afterBareAuthority = false;
  const jsonContainers: string[] = [];
  let jsonQuote: string | undefined;
  let jsonEscape = false;
  let jsonStringAtomStart = false;
  for (let position = 0; position < indexes.length;) {
    scanned(work);
    const index = position;
    const value = atoms[index]!.value;
    if (scope === "root") {
      if (rootStart(atoms, index, rootAtomStart || sourceAtomStarts[position]!, afterBareAuthority)) {
        const parsed = parseCandidate(atoms, index, remainingDepth, sourceAtomStarts, ends, work);
        if (parsed !== undefined) {
          if (parsed.unsafe) return true;
          afterBareAuthority = parsed.bareBoundary;
          if (parsed.queryAt !== undefined) { scope = "query"; valueStart = true; position = parsed.queryAt + 1; continue; }
          while (position < atoms.length && position < parsed.end) position += 1;
          continue;
        }
      }
      // A literal relative-path slash establishes path context for the rest
      // of this atom. Its later-decoded whitespace or scheme text is data.
      if (!atoms[index]!.protected && value === "/" && !protocolRelativeAt(atoms, index) && !literal(atoms, index - 1, "/") && !rootHasFutureStructure && !rootHasPercentEscape) {
        const path = protectPath(atoms, index, work);
        while (position < atoms.length && position < path.end) position += 1;
        continue;
      }
      if (value === "/" && rootHasPercentEscape) { position = deferredEnd(atoms, index); continue; }
      afterBareAuthority = afterBareAuthority && postAuthorityWrappers.has(value);
      rootAtomStart = whiteSpace(value) || (rootAtomStart && rootWrappers.has(value));
      rootHasFutureStructure = whiteSpace(value) ? false : rootHasFutureStructure || (remainingDepth > 0 && futureStructureAt(atoms, index));
      rootHasPercentEscape = whiteSpace(value) ? false : rootHasPercentEscape || (remainingDepth > 0 && byteAt(atoms, index) !== undefined);
      position += 1;
      continue;
    }
    if (jsonQuote !== undefined) {
      if (jsonEscape) jsonEscape = false;
      else if (value === "\\") jsonEscape = true;
      else if (value === jsonQuote) jsonQuote = undefined;
      else {
        if (jsonStringAtomStart) {
          const parsed = parseCandidate(atoms, index, remainingDepth, sourceAtomStarts, ends, work);
          if (parsed?.unsafe) return true;
        }
        jsonStringAtomStart = whiteSpace(value) || (jsonStringAtomStart && rootWrappers.has(value));
      }
      position += 1;
      continue;
    }
    if (whiteSpace(value)) { scope = "root"; valueStart = false; rootAtomStart = true; rootHasFutureStructure = false; afterBareAuthority = false; position += 1; continue; }
    if (valueStart) {
      if (openingValueWrappers.has(value)) {
        if (value === "{" || value === "[") jsonContainers.push(value);
        const keyEnd = jsonContainers.length > 0 ? skipQuotedJsonKey(atoms, index) : undefined;
        if (keyEnd !== undefined) { valueStart = true; while (position < atoms.length && position < keyEnd) position += 1; continue; }
        if (jsonContainers.length > 0 && (value === "\"" || value === "'")) {
          const quoted = parseCandidate(atoms, index + 1, remainingDepth, sourceAtomStarts, ends, work);
          if (quoted?.unsafe) return true;
          jsonQuote = value;
          jsonStringAtomStart = true;
          valueStart = false;
          position += 1;
          continue;
        }
        position += 1; continue;
      }
      const parsed = parseCandidate(atoms, index, remainingDepth, sourceAtomStarts, ends, work);
      valueStart = false;
      if (parsed !== undefined) {
        if (parsed.unsafe) return true;
        if (parsed.queryAt !== undefined) { valueStart = true; position = parsed.queryAt + 1; continue; }
        while (position < atoms.length && position < parsed.end) position += 1;
        continue;
      }
    }
    if (value === "?" || value === "#" || value === "&" || value === ";" || value === "=") valueStart = true;
    else if (value === "{" || value === "[") jsonContainers.push(value);
    else if ((value === "}" && jsonContainers.at(-1) === "{") || (value === "]" && jsonContainers.at(-1) === "[")) jsonContainers.pop();
    else if (value === "," && jsonContainers.length > 0) valueStart = true;
    else if (jsonContainers.length > 0) { const keyEnd = skipQuotedJsonKey(atoms, index); if (keyEnd !== undefined) { valueStart = true; while (position < atoms.length && position < keyEnd) position += 1; continue; } }
    position += 1;
  }
  for (let index = 0; index < atoms.length; index += 1) if (atoms[index]!.protected && !source[indexes[index]!]!.protected) source[indexes[index]!] = { value: source[indexes[index]!]!.value, protected: true };
  return false;
}
function hasAuthorityUserinfo(layer: Layer, remainingDepth: number, work?: ScanWork): boolean { return structuralScan(layer, false, remainingDepth, work) || structuralScan(layer, true, remainingDepth, work); }
function hasSensitiveAssignment(layer: Layer): boolean {
  const value = join(layer.atoms);
  return equalsAssignment.test(value) || segmentColonAssignment.test(value) || spacedColonAssignment.test(value) || unspacedColonAssignment.test(value) || quotedColonAssignment.test(value) || formEqualsAssignment.test(value) || formColonAssignment.test(value);
}
function evaluateReferenceSafety(value: string, work?: ScanWork): ReferenceSafetyIssue | undefined {
  let layer = initialLayer(value);
  if (layer === null) return "reference-length-exceeded";
  for (let depth = 0; depth <= 2; depth += 1) {
    if (hasAuthorityUserinfo(layer, 2 - depth, work) || hasSensitiveAssignment(layer)) return "unsafe-evidence-reference";
    if (depth === 2) break;
    layer = decodePercentLayer(layer);
    if (layer === null) return "reference-length-exceeded";
  }
  return undefined;
}
export function referenceSafetyIssue(value: string): ReferenceSafetyIssue | undefined { return evaluateReferenceSafety(value); }
/** Internal deterministic scanner-work observation for bounded-input regression tests. */
export function referenceSafetyOperationCount(value: string): number {
  const work: ScanWork = { units: 0 };
  evaluateReferenceSafety(value, work);
  return work.units;
}
export function isValueSafeReference(value: string): boolean { return referenceSafetyIssue(value) === undefined; }
