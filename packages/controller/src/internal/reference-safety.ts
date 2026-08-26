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
// These are the only prose/value wrappers accepted by the structural lexer.
// Keep one union so root, query, JSON, and post-authority hand-offs cannot
// drift into different eligibility grammars.
const wrappers = new Set(["(", "[", "{", "<", "\"", "'", "`", "“", "”", "‘", "’", "–", "—", ",", ";", ")", "]", "}", ">"]);
const rootWrappers = wrappers;
const postAuthorityWrappers = wrappers;
const openingValueWrappers = wrappers;

interface Atom { readonly value: string; readonly protected: boolean; }
interface Layer { readonly atoms: Atom[]; }
type CandidateScope = "root" | "query";
type ParseResult = { readonly unsafe: boolean; readonly end: number; readonly queryAt?: number; readonly bareBoundary: boolean };
type SchemeEnds = readonly number[];
type CandidateDescriptor = { readonly kind: "authority"; readonly start: number; readonly special: boolean } | { readonly kind: "opaque"; readonly start: number } | { readonly kind: "deferred"; readonly end: number };
interface ScanWork { units: number; }
function scanned(work: ScanWork | undefined): void { if (work) work.units += 1; }

function whiteSpace(value: string): boolean { return unicodeWhitespace.test(value); }
function asciiLetter(value: string | undefined): boolean { return value !== undefined && value >= "a" && value <= "z"; }
function schemeCharacter(value: string | undefined): boolean { return asciiLetter(value) || (value !== undefined && value >= "0" && value <= "9") || value === "+" || value === "-" || value === "."; }
function hex(value: string | undefined): boolean { return value !== undefined && /^[0-9a-f]$/iu.test(value); }
function hexNibble(value: string | undefined): number | undefined {
  if (value === undefined || value.length !== 1) return undefined;
  const code = value.charCodeAt(0);
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  return undefined;
}
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
function futureStructureAt(atoms: readonly Atom[], index: number, remainingDepth: number, work?: ScanWork): boolean {
  const projected = projectedScalarWithDepth(atoms, index, remainingDepth, work);
  if (projected === undefined || projected.depth === 0) return false;
  // Removing a future default-ignorable can make the next already-realized
  // slash/backslash adjacent to the authority.  Defer at the removed source
  // atom so the following layer sees the same stream as normalization.
  if (projected.values.length === 0) {
    const next = firstProjectedEmission(atoms, index, remainingDepth, work);
    return next !== undefined && (next.value === "/" || next.value === ":" || next.value === "?" || next.value === "#" || next.value === "\\" || whiteSpace(next.value));
  }
  // A materialised percent can form an independent escape one layer later;
  // all other structure is classified only after the same normalization used
  // by decodePercentLayer + normalizeAtoms.
  return projected.values.some((value) => value === "%" || value === "/" || value === ":" || value === "?" || value === "#" || value === "\\" || whiteSpace(value));
}
/**
 * Projects one scalar through the remaining bounded percent-decoding layers
 * without allocating a decoded suffix.  The span remains in this layer, so a
 * caller can continue monotonically after recognising future punctuation.
 */
function decodedScalarAt(atoms: readonly Atom[], index: number): { readonly value: string; readonly span: number } | undefined {
  const atom = atoms[index];
  if (atom === undefined) return undefined;
  // This projection deliberately avoids slices, suffixes, and arrays: every
  // inspected escape belongs to this one scalar and has a constant span.
  const projectedByteAt = (offset: number): number | undefined => {
    const start = index + offset * 3;
    if (!literal(atoms, start, "%")) return undefined;
    const high = hexNibble(atoms[start + 1]?.value);
    const low = hexNibble(atoms[start + 2]?.value);
    return high === undefined || low === undefined ? undefined : high * 16 + low;
  };
  const byte = projectedByteAt(0);
  if (byte === undefined) return { value: atom.value, span: 1 };
  if (byte < 0x80) return { value: String.fromCharCode(byte), span: 3 };
  const width = utf8Width(byte);
  if (width !== undefined) {
    const second = projectedByteAt(1);
    const third = width >= 3 ? projectedByteAt(2) : undefined;
    const fourth = width === 4 ? projectedByteAt(3) : undefined;
    const continuation = (candidate: number | undefined): candidate is number => candidate !== undefined && (candidate & 0xc0) === 0x80;
    const valid = width === 2 ? continuation(second)
      : width === 3 ? continuation(second) && continuation(third) && !(byte === 0xe0 && second < 0xa0) && !(byte === 0xed && second >= 0xa0)
        : continuation(second) && continuation(third) && continuation(fourth) && !(byte === 0xf0 && second < 0x90) && !(byte === 0xf4 && second >= 0x90);
    if (valid && second !== undefined) {
      const point = width === 2 ? ((byte & 0x1f) << 6) | (second & 0x3f)
        : width === 3 ? ((byte & 0x0f) << 12) | ((second & 0x3f) << 6) | (third! & 0x3f)
          : ((byte & 0x07) << 18) | ((second & 0x3f) << 12) | ((third! & 0x3f) << 6) | (fourth! & 0x3f);
      return { value: String.fromCodePoint(point), span: width * 3 };
    }
  }
  return { value: atom.value, span: 1 };
}
type ProjectedScalar = { readonly value: string; readonly values: readonly string[]; readonly span: number; readonly depth: 0 | 1 | 2 };
function normalizedProjectedValues(value: string): readonly string[] {
  return Array.from(value.normalize("NFKC").toLowerCase()).filter((scalar) => !defaultIgnorable.test(scalar));
}
function firstLayerScalarAt(atoms: readonly Atom[], index: number): { readonly values: readonly string[]; readonly span: number } | undefined {
  const literal = atoms[index];
  if (literal === undefined) return undefined;
  const decoded = decodedScalarAt(atoms, index)!;
  return decoded.span === 1 ? { values: [literal.value], span: 1 } : { values: normalizedProjectedValues(decoded.value), span: decoded.span };
}
function secondLayerByteAt(atoms: readonly Atom[], index: number): { readonly byte: number; readonly span: number } | undefined {
  const percent = firstLayerScalarAt(atoms, index);
  if (percent?.values.length !== 1 || percent.values[0] !== "%") return undefined;
  const high = firstLayerScalarAt(atoms, index + percent.span);
  const low = high === undefined ? undefined : firstLayerScalarAt(atoms, index + percent.span + high.span);
  if (high?.values.length !== 1 || low?.values.length !== 1) return undefined;
  const highNibble = hexNibble(high.values[0]);
  const lowNibble = hexNibble(low.values[0]);
  return highNibble === undefined || lowNibble === undefined ? undefined : { byte: highNibble * 16 + lowNibble, span: percent.span + high.span + low.span };
}
function projectedScalarWithDepth(atoms: readonly Atom[], index: number, remainingDepth: number, work?: ScanWork): ProjectedScalar | undefined {
  scanned(work);
  const literal = atoms[index];
  if (literal === undefined) return undefined;
  // The final scan layer is already normalized.  Looking through one more
  // percent escape would create a third-decode false positive.
  if (remainingDepth === 0) return { value: literal.value, values: [literal.value], span: 1, depth: 0 };
  const first = decodedScalarAt(atoms, index)!;
  if (first.span === 1) return { value: first.value, values: [first.value], span: 1, depth: 0 };
  const firstValues = normalizedProjectedValues(first.value);
  if (remainingDepth < 2 || firstValues.length !== 1 || firstValues[0] !== "%") {
    return { value: firstValues.join(""), values: firstValues, span: first.span, depth: 1 };
  }
  const firstByte = secondLayerByteAt(atoms, index);
  if (firstByte === undefined) return { value: firstValues.join(""), values: firstValues, span: first.span, depth: 1 };
  if (firstByte.byte < 0x80) {
    const values = normalizedProjectedValues(String.fromCharCode(firstByte.byte));
    return { value: values.join(""), values, span: firstByte.span, depth: 2 };
  }
  const width = utf8Width(firstByte.byte);
  const bytes = width === undefined ? undefined : Array.from({ length: width }, (_, offset) => {
    let cursor = index;
    for (let step = 0; step < offset; step += 1) {
      const previous = secondLayerByteAt(atoms, cursor);
      if (previous === undefined) return undefined;
      cursor += previous.span;
    }
    return secondLayerByteAt(atoms, cursor)?.byte;
  });
  if (width === undefined || !bytes?.every((byte): byte is number => byte !== undefined)) return { value: firstValues.join(""), values: firstValues, span: first.span, depth: 1 };
  const decoded = decodeUtf8(bytes);
  if (decoded === undefined) return { value: firstValues.join(""), values: firstValues, span: first.span, depth: 1 };
  let span = 0;
  for (let offset = 0, cursor = index; offset < width; offset += 1) {
    const item = secondLayerByteAt(atoms, cursor)!;
    span += item.span;
    cursor += item.span;
  }
  const values = normalizedProjectedValues(decoded);
  return { value: values.join(""), values, span, depth: 2 };
}
type ProjectedEmission = ProjectedScalar & { readonly start: number; readonly subscalar: number };
/**
 * Iterates the normalized scalar stream projected from the current source
 * layer.  Empty normalized emissions (for example default ignorables) are
 * skipped, while compatibility expansions retain their source span and exact
 * subscalar order for structural comparisons.
 */
function firstProjectedEmission(atoms: readonly Atom[], index: number, remainingDepth: number, work?: ScanWork): ProjectedEmission | undefined {
  for (let start = index; start < atoms.length;) {
    const scalar = projectedScalarWithDepth(atoms, start, remainingDepth, work);
    if (scalar === undefined) return undefined;
    if (scalar.values.length > 0) return { ...scalar, value: scalar.values[0]!, start, subscalar: 0 };
    if (scalar.span <= 0) return undefined;
    start += scalar.span;
  }
  return undefined;
}
function nextProjectedEmission(atoms: readonly Atom[], emission: ProjectedEmission, remainingDepth: number, work?: ScanWork): ProjectedEmission | undefined {
  const subscalar = emission.subscalar + 1;
  if (subscalar < emission.values.length) return { ...emission, value: emission.values[subscalar]!, subscalar };
  return firstProjectedEmission(atoms, emission.start + emission.span, remainingDepth, work);
}
function projectedSourceEnd(emission: ProjectedEmission): number {
  return emission.subscalar + 1 < emission.values.length ? emission.start : emission.start + emission.span;
}
function projectedAuthorityMarkerAt(atoms: readonly Atom[], index: number, remainingDepth: number, work?: ScanWork): number | undefined {
  if (remainingDepth === 0) return undefined;
  const first = firstProjectedEmission(atoms, index, remainingDepth, work);
  if (first?.value !== "/") return undefined;
  const second = nextProjectedEmission(atoms, first, remainingDepth, work);
  return second?.value === "/" ? projectedSourceEnd(second) : undefined;
}
function futureAuthorityWrapperAt(atoms: readonly Atom[], index: number, remainingDepth: number, work?: ScanWork): boolean {
  if (remainingDepth === 0) return false;
  const projected = projectedScalarWithDepth(atoms, index, remainingDepth, work);
  return projected !== undefined && projected.depth > 0 && projected.values.some((value) => postAuthorityWrappers.has(value));
}
function deferredEnd(atoms: readonly Atom[], start: number): number {
  let cursor = start;
  while (cursor < atoms.length && !whiteSpace(atoms[cursor]!.value)) cursor += 1;
  return cursor;
}
function authorityAtBeforeDelimiter(atoms: readonly Atom[], start: number, special: boolean, remainingDepth: number, work?: ScanWork): boolean {
  type Ordered = { readonly depth: number; readonly position: number; readonly subscalar: number };
  let delimiter: Ordered | undefined;
  let userinfo: Ordered | undefined;
  const before = (left: Ordered, right: Ordered): boolean => left.depth < right.depth || (left.depth === right.depth && (left.position < right.position || (left.position === right.position && left.subscalar < right.subscalar)));
  for (let projected = firstProjectedEmission(atoms, start, remainingDepth, work); projected !== undefined; projected = nextProjectedEmission(atoms, projected, remainingDepth, work)) {
    if (atoms[projected.start]?.protected) continue;
    const isDelimiter = whiteSpace(projected.value) || projected.value === "/" || projected.value === "?" || projected.value === "#" || (special && projected.value === "\\");
    const candidate: Ordered = { depth: projected.depth, position: projected.start, subscalar: projected.subscalar };
    if (isDelimiter && (delimiter === undefined || before(candidate, delimiter))) delimiter = candidate;
    if (projected.value === "@" && (userinfo === undefined || before(candidate, userinfo))) userinfo = candidate;
    // A literal delimiter cannot be displaced by any later projected token.
    if (isDelimiter && projected.depth === 0) break;
  }
  return userinfo !== undefined && (delimiter === undefined || before(userinfo, delimiter));
}
function sensitiveAuthorityAssignment(atoms: readonly Atom[], start: number, end: number): boolean {
  return authoritySensitiveAssignment.test(join(atoms, start, end));
}
/**
 * Precompute every complete label/assignment start with the same label and
 * separator grammar used by the public regex rules.  The lexer, not a source
 * predecessor shortcut, decides whether an unprotected start is an eligible
 * root, query value, or JSON value.
 */
function sensitiveColonStartMask(atoms: readonly Atom[], work?: ScanWork): Uint8Array {
  const starts = new Uint8Array(atoms.length);
  for (let start = 0; start < atoms.length;) {
    while (start < atoms.length && atoms[start]!.protected) { scanned(work); start += 1; }
    if (start >= atoms.length) break;
    let end = start;
    let text = "";
    const atomAtCodeUnit: number[] = [];
    while (end < atoms.length && !atoms[end]!.protected) {
      const atom = atoms[end]!;
      text += atom.value;
      for (let offset = 0; offset < atom.value.length; offset += 1) atomAtCodeUnit.push(end);
      scanned(work);
      end += 1;
    }
    eligibleSensitiveAssignmentSearch.lastIndex = 0;
    for (let match = eligibleSensitiveAssignmentSearch.exec(text); match !== null; match = eligibleSensitiveAssignmentSearch.exec(text)) {
      const atom = atomAtCodeUnit[match.index];
      if (atom !== undefined) starts[atom] = 1;
      // The expression always consumes a nonempty label and value.  Keep the
      // explicit guard for future grammar edits.
      if (match[0].length === 0) eligibleSensitiveAssignmentSearch.lastIndex += 1;
    }
    // The grammar engine is a second linear pass over this bounded segment;
    // account for it explicitly so the deterministic work hook includes the
    // complete mask rather than only its materialization.
    for (let index = start; index < end; index += 1) scanned(work);
    start = end;
  }
  return starts;
}
function protectOpaque(atoms: Atom[], start: number, remainingDepth: number, work?: ScanWork): { readonly end: number; readonly queryAt?: number } {
  let cursor = start;
  while (cursor < atoms.length && atoms[cursor]!.value !== "?" && atoms[cursor]!.value !== "#" && !whiteSpace(atoms[cursor]!.value) && !(remainingDepth > 0 && futureStructureAt(atoms, cursor, remainingDepth, work))) { scanned(work); cursor += 1; }
  mark(atoms, start, cursor);
  if (cursor < atoms.length && remainingDepth > 0 && futureStructureAt(atoms, cursor, remainingDepth, work)) return { end: deferredEnd(atoms, cursor) };
  return cursor < atoms.length ? { end: cursor, queryAt: cursor } : { end: cursor };
}
function scanAuthority(atoms: Atom[], start: number, special: boolean, remainingDepth: number, sourceAtomStarts: readonly boolean[] | undefined, ends: SchemeEnds, work?: ScanWork): ParseResult {
  let authorityStart = start;
  let authoritySpecial = special;
  let cursor = start;
  while (cursor < atoms.length) {
    scanned(work);
    if (cursor > authorityStart && sourceAtomStarts?.[cursor]) {
      const nested = describeCandidate(atoms, cursor, remainingDepth, ends, work);
      if (nested !== undefined && sensitiveAuthorityAssignment(atoms, authorityStart, cursor)) return { unsafe: true, end: cursor, bareBoundary: false };
      if (nested?.kind === "deferred") return { unsafe: false, end: nested.end, bareBoundary: false };
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
    // A wrapper which is only realised in a later bounded decode layer must
    // terminate this authority now.  Otherwise a following literal slash can
    // incorrectly establish an outer path and hide the later root candidate.
    if (futureAuthorityWrapperAt(atoms, cursor, remainingDepth, work)) {
      if (sensitiveAuthorityAssignment(atoms, authorityStart, cursor) || (cursor > authorityStart && authorityAtBeforeDelimiter(atoms, cursor, authoritySpecial, remainingDepth, work))) return { unsafe: true, end: cursor, bareBoundary: false };
      return { unsafe: false, end: deferredEnd(atoms, cursor), bareBoundary: false };
    }
    if (remainingDepth > 0 && futureStructureAt(atoms, cursor, remainingDepth, work)) {
      if (sensitiveAuthorityAssignment(atoms, authorityStart, cursor) || (cursor > authorityStart && authorityAtBeforeDelimiter(atoms, cursor, authoritySpecial, remainingDepth, work))) return { unsafe: true, end: cursor, bareBoundary: false };
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
      if (sensitiveAuthorityAssignment(atoms, authorityStart, cursor) || authorityAtBeforeDelimiter(atoms, cursor, authoritySpecial, remainingDepth, work)) return { unsafe: true, end: cursor, bareBoundary: false };
      return { unsafe: false, end: cursor, bareBoundary: true };
    }
    cursor += 1;
  }
  return sensitiveAuthorityAssignment(atoms, authorityStart, cursor) ? { unsafe: true, end: cursor, bareBoundary: false } : { unsafe: false, end: cursor, bareBoundary: true };
}
function describeCandidate(atoms: readonly Atom[], index: number, remainingDepth: number, ends: SchemeEnds, work?: ScanWork): CandidateDescriptor | undefined {
  const scheme = schemeAt(atoms, index, ends, work);
  if (scheme !== undefined) {
    if (scheme.special) {
      let start = scheme.afterColon;
      while (!atoms[start]?.protected && (literal(atoms, start, "/") || literal(atoms, start, "\\") || (literal(atoms, start, ":") && (literal(atoms, start + 1, "/") || literal(atoms, start + 1, "\\"))))) start += 1;
      return { kind: "authority", start, special: true };
    }
    if (protocolRelativeAt(atoms, scheme.afterColon)) return { kind: "authority", start: scheme.afterColon + 2, special: false };
    if (projectedAuthorityMarkerAt(atoms, scheme.afterColon, remainingDepth, work) !== undefined) return { kind: "deferred", end: deferredEnd(atoms, scheme.afterColon) };
    return { kind: "opaque", start: scheme.afterColon };
  }
  if (protocolRelativeAt(atoms, index)) return { kind: "authority", start: index + 2, special: false };
  const projected = projectedAuthorityMarkerAt(atoms, index, remainingDepth, work);
  return projected === undefined ? undefined : { kind: "deferred", end: deferredEnd(atoms, index) };
}
function parseCandidate(atoms: Atom[], index: number, remainingDepth: number, sourceAtomStarts: readonly boolean[] | undefined, ends: SchemeEnds, work?: ScanWork): ParseResult | undefined {
  const candidate = describeCandidate(atoms, index, remainingDepth, ends, work);
  if (candidate === undefined) return undefined;
  if (candidate.kind === "deferred") return { unsafe: false, end: candidate.end, bareBoundary: false };
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
  const sensitiveColonStarts = sensitiveColonStartMask(atoms, work);
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
        if (sensitiveColonStarts[index] === 1) return true;
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
      rootHasFutureStructure = whiteSpace(value) ? false : rootHasFutureStructure || (remainingDepth > 0 && futureStructureAt(atoms, index, remainingDepth, work));
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
          if (sensitiveColonStarts[index] === 1) return true;
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
      if (sensitiveColonStarts[index] === 1) return true;
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
