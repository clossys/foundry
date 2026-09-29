// Editing a repository's release-age exemption file to add the publishing
// scope (issue #1178, code rule C12). The surface is pnpm's
// `minimumReleaseAgeExclude` in pnpm-workspace.yaml or Yarn's
// `npmPreapprovedPackages` in .yarnrc.yml. This edits a client's file, so every
// ambiguity refuses: the editor adds exactly one quoted entry under the
// surface's key, keeps every other byte, and refuses any shape its restricted
// reader does not fully recognise. The reader is not a YAML parser; it is
// modelled on the launcher's lockfile reader (same idea, no shared code). It
// performs no I/O.

import { EXEMPTION_SURFACES, type ExemptionSurfaceKind } from "./change-set-contract.js";
import { PACKAGE_SCOPE } from "./generated/package-scope.generated.js";

export type ReleaseAgeEditRefusalReason = "release-age-surface-unparseable" | "release-age-surface-conflict";

/** The outcome of editing: the new text, nothing to do, or a refusal that leaves the file alone. */
export type ReleaseAgeEdit =
  | { readonly kind: "edited"; readonly text: string }
  | { readonly kind: "unchanged" }
  | { readonly kind: "refused"; readonly reason: ReleaseAgeEditRefusalReason };

export interface ReleaseAgeEditInput {
  readonly surface: ExemptionSurfaceKind;
  /** The surface file's text, or null when the file does not exist. */
  readonly text: string | null;
  /** The repository's .npmrc text (null or absent: none); read for the pnpm surface only. */
  readonly npmrc?: string | null;
}

export interface ReleaseAgeVerifyInput {
  readonly surface: ExemptionSurfaceKind;
  readonly before: string | null;
  readonly after: string;
  readonly npmrc?: string | null;
}

/** Verified only when `after` is `before` plus exactly the one scope entry; `value` is the ledger entries row value. */
export type ReleaseAgeVerdict = { readonly verified: true; readonly value: string } | { readonly verified: false };

const UNPARSEABLE: ReleaseAgeEdit = { kind: "refused", reason: "release-age-surface-unparseable" };
const CONFLICT: ReleaseAgeEdit = { kind: "refused", reason: "release-age-surface-conflict" };
const NOT_VERIFIED: ReleaseAgeVerdict = { verified: false };

const scopeValue = (): string => `${PACKAGE_SCOPE.scope}/*`;
/** pnpm writes single quotes, Yarn double. A plain `@...` scalar is invalid YAML, so an inserted entry is always quoted. */
const quotedEntry = (surface: ExemptionSurfaceKind): string => (surface === "pnpm-workspace" ? `'${scopeValue()}'` : `"${scopeValue()}"`);
/** The key block appended (or created) when the key is absent, with its final newline. */
const keyBlock = (key: string, entry: string): string => `${key}:\n  - ${entry}\n`;

// ---------------------------------------------------------------------------
// .npmrc conflict (pnpm only): the same setting spelled in .npmrc.
// ---------------------------------------------------------------------------

/** Whether the pnpm surface's .npmrc already sets the same exclusion list, in any spelling npm's ini reader accepts. */
function hasNpmrcConflict(surface: ExemptionSurfaceKind, npmrc: string | null | undefined): boolean {
  if (surface !== "pnpm-workspace" || npmrc === null || npmrc === undefined) return false;
  const text = npmrc.startsWith("\uFEFF") ? npmrc.slice(1) : npmrc;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith(";") || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    let name = (eq === -1 ? line : line.slice(0, eq)).trim().toLowerCase().replace(/_/g, "-");
    if (name.endsWith("[]")) name = name.slice(0, -2);
    if (name === "minimum-release-age-exclude") return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The restricted reader: refuses everything it does not fully recognise.
// ---------------------------------------------------------------------------

class Refusal extends Error {}

function refuse(): never {
  throw new Refusal();
}

/** A tab, CR, byte order mark anywhere, a Unicode line break other than LF, or another control character. */
const FORBIDDEN_CHARACTERS = /[\t\r\uFEFF\u0085\u2028\u2029\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const KEY_NAME = "[A-Za-z_][A-Za-z0-9_.-]*";
/** A top-level key line: bare, or wrapped in matching quotes (no backslash), then `:` and the end of the line or a space. */
const KEY_LINE = new RegExp(`^(?:(${KEY_NAME})|'(${KEY_NAME})'|"(${KEY_NAME})"):( .*)?$`);

const isBlankLine = (line: string): boolean => /^ *$/.test(line);
const isCommentLine = (line: string): boolean => /^ *#/.test(line);

/** Where the spaces around `value[from, to)` end: the bounds of the same text without its leading and trailing spaces. One pass, no backtracking. */
function trimmedBounds(value: string, from: number, to: number): readonly [number, number] {
  let start = from;
  while (start < to && value[start] === " ") start += 1;
  let end = to;
  while (end > start && value[end - 1] === " ") end -= 1;
  return [start, end];
}

/** The text without its leading and trailing spaces (only U+0020). */
function trimSpaces(value: string): string {
  const [start, end] = trimmedBounds(value, 0, value.length);
  return value.slice(start, end);
}

/** End index (exclusive) of the single-quoted scalar starting at `start`; `''` is an escaped quote. */
function endOfSingleQuoted(line: string, start: number): number {
  let i = start + 1;
  while (i < line.length) {
    if (line[i] === "'") {
      if (line[i + 1] === "'") {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return refuse();
}

/** End index (exclusive) of the double-quoted scalar starting at `start`; a backslash anywhere in it refuses, as no escape is interpreted. */
function endOfDoubleQuoted(line: string, start: number): number {
  for (let i = start + 1; i < line.length; i += 1) {
    if (line[i] === "\\") return refuse();
    if (line[i] === '"') return i + 1;
  }
  return refuse();
}

/** The index of the colon ending a (possibly quoted) mapping key in a trimmed line, or undefined. */
function findKeyColon(content: string): number | undefined {
  const first = content[0];
  if (first === "'" || first === '"') {
    const end = first === "'" ? endOfSingleQuoted(content, 0) : endOfDoubleQuoted(content, 0);
    return content[end] === ":" ? end : undefined;
  }
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === ":" && (i + 1 === content.length || content[i + 1] === " ")) return i;
  }
  return undefined;
}

/**
 * Refuses an anchor, alias, tag, block scalar, explicit key, or unterminated
 * quote on one line, wherever in the file the line sits. Text inside quotes
 * and after a comment start is not scanned for them.
 */
function scanForForbiddenConstructs(line: string): void {
  let afterSpace = true;
  let tokenStart = true;
  let i = 0;
  while (i < line.length) {
    const c = line[i]!;
    if (c === " ") {
      afterSpace = true;
      tokenStart = true;
      i += 1;
      continue;
    }
    if (c === "#" && afterSpace) return;
    if (tokenStart) {
      if (c === "&" || c === "*" || c === "!") refuse();
      if (c === "'" || c === '"') {
        i = c === "'" ? endOfSingleQuoted(line, i) : endOfDoubleQuoted(line, i);
        afterSpace = false;
        tokenStart = false;
        continue;
      }
    }
    afterSpace = false;
    tokenStart = c === "[" || c === "{" || c === ",";
    i += 1;
  }
  // The trimmed line with every leading "- " marker (and the spaces after it) skipped, by index so a long run of markers is not re-copied.
  const [trimmedStart, end] = trimmedBounds(line, 0, line.length);
  let start = trimmedStart;
  while (start < end && line[start] === "-" && (start + 1 === end || line[start + 1] === " ")) {
    start += 1;
    while (start < end && line[start] === " ") start += 1;
  }
  const content = line.slice(start, end);
  if (content === "?" || content.startsWith("? ")) refuse();
  if (content.startsWith("|") || content.startsWith(">")) refuse();
  const colon = findKeyColon(content);
  if (colon !== undefined) {
    const value = content.slice(colon + 1).replace(/^ +/, "");
    if (value.startsWith("|") || value.startsWith(">")) refuse();
  }
}

interface ListItem {
  /** The item's line index (lines split on LF, final terminator dropped). */
  readonly index: number;
  readonly value: string;
}

interface TargetList {
  readonly indent: number;
  readonly items: readonly ListItem[];
}

interface Reading {
  /** The surface key's block sequence, or null when the file has no such key. */
  readonly target: TargetList | null;
}

/** The decoded scalar of one list item's text after its "- ": a whole single- or double-quoted scalar, or a conservative plain one. */
function decodeItemScalar(rest: string): string {
  if (rest === "") return refuse();
  if (rest.startsWith("'")) {
    let out = "";
    let i = 1;
    for (;;) {
      if (i >= rest.length) return refuse();
      if (rest[i] === "'") {
        if (rest[i + 1] === "'") {
          out += "'";
          i += 2;
          continue;
        }
        return i === rest.length - 1 ? out : refuse();
      }
      out += rest[i];
      i += 1;
    }
  }
  if (rest.startsWith('"')) {
    const end = rest.indexOf('"', 1);
    if (end !== rest.length - 1) return refuse();
    const inner = rest.slice(1, -1);
    return inner.includes("\\") ? refuse() : inner;
  }
  if (/^[[\]{},&*!|>'"%@#?`-]/.test(rest)) return refuse();
  if (rest.includes(": ") || rest.endsWith(":") || rest.includes(" #")) return refuse();
  if (rest.startsWith(" ") || rest.endsWith(" ")) return refuse();
  return rest;
}

/**
 * The block sequence under the target key at `keyIndex`: items of one indent,
 * each `- ` and one scalar, contiguous from the line after the key. After the
 * last item only blank lines and column-0 comments may precede the next key.
 */
function readTargetList(lines: readonly string[], keyIndex: number): TargetList {
  const first = lines[keyIndex + 1];
  const opener = first === undefined ? null : /^( *)- /.exec(first);
  if (opener === null) return refuse();
  const indent = opener[1]!.length;
  const prefix = `${" ".repeat(indent)}- `;
  const items: ListItem[] = [];
  let j = keyIndex + 1;
  while (j < lines.length && lines[j]!.startsWith(prefix)) {
    items.push({ index: j, value: decodeItemScalar(lines[j]!.slice(prefix.length)) });
    j += 1;
  }
  for (; j < lines.length; j += 1) {
    const line = lines[j]!;
    if (isBlankLine(line) || line.startsWith("#")) continue;
    if (line.startsWith(" ") || line.startsWith("-")) return refuse();
    break;
  }
  return { indent, items };
}

type Mode = "none" | "open" | "inline" | "map" | "seq";

function read(text: string, key: string): Reading {
  if (FORBIDDEN_CHARACTERS.test(text)) refuse();
  const lines = text === "" ? [] : (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
  const seen = new Set<string>();
  // What the latest top-level key holds so far: nothing yet ("open"), an inline value, an indented body, or column-0 items.
  let mode: Mode = "none";
  let keyIndex = -1;
  lines.forEach((line, index) => {
    if (/^(---|\.\.\.)(\s|$)/.test(line) || line.startsWith("%")) refuse();
    scanForForbiddenConstructs(line);
    if (isBlankLine(line) || isCommentLine(line)) return;
    if (line.startsWith(" ")) {
      if (mode === "none") refuse();
      if (mode === "open") mode = "map";
      return;
    }
    if (/^-( |$)/.test(line)) {
      if (mode !== "open" && mode !== "seq") refuse();
      mode = "seq";
      return;
    }
    const match = KEY_LINE.exec(line);
    if (match === null) return refuse();
    const name = match[1] ?? match[2] ?? match[3]!;
    if (seen.has(name)) refuse();
    seen.add(name);
    const rest = trimSpaces(match[4] ?? "");
    mode = rest === "" || rest.startsWith("#") ? "open" : "inline";
    if (name === key) {
      if (match[4] !== undefined) refuse();
      keyIndex = index;
    }
  });
  return { target: keyIndex === -1 ? null : readTargetList(lines, keyIndex) };
}

/** Reads `text` under the restricted reader; null is a refusal. */
function readSurface(text: string, key: string): Reading | null {
  try {
    return read(text, key);
  } catch (error) {
    if (error instanceof Refusal) return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Edit and verify.
// ---------------------------------------------------------------------------

/**
 * Adds the scope entry to the surface's exemption list. A missing file or key
 * is created or appended with a two-space list; an existing block sequence
 * gains one line after its last item, in its own indent, and nothing else
 * changes. An already-present entry is unchanged. Refuses a pnpm `.npmrc`
 * that sets the same list, and any file the restricted reader does not fully
 * recognise (flow lists, comments inside the list, anchors, aliases, tags,
 * block scalars, multiple documents, tabs, CRLF, repeated keys, and more).
 */
export function editReleaseAgeExemption(input: ReleaseAgeEditInput): ReleaseAgeEdit {
  const { surface, text } = input;
  if (hasNpmrcConflict(surface, input.npmrc)) return CONFLICT;
  const { key } = EXEMPTION_SURFACES[surface];
  const entry = quotedEntry(surface);
  const block = keyBlock(key, entry);
  if (text === null || text === "") return { kind: "edited", text: block };
  const reading = readSurface(text, key);
  if (reading === null) return UNPARSEABLE;
  const { target } = reading;
  if (target === null) return { kind: "edited", text: text.endsWith("\n") ? text + block : `${text}\n${block.slice(0, -1)}` };
  if (target.items.some((item) => item.value === scopeValue())) return { kind: "unchanged" };
  const last = target.items[target.items.length - 1]!;
  const out = text.split("\n");
  out.splice(last.index + 1, 0, `${" ".repeat(target.indent)}- ${entry}`);
  return { kind: "edited", text: out.join("\n") };
}

/**
 * Whether `after` is `before` plus exactly the one scope entry, judged by its
 * own structural comparison of the two texts (and, as a second check, by the
 * edit function reproducing `after`). The entry must sit after the last
 * existing item, in the list's indent and the surface's quoting, with every
 * other byte, including the final newline, unchanged.
 */
export function verifyReleaseAgeExemption(input: ReleaseAgeVerifyInput): ReleaseAgeVerdict {
  const { surface, before, after } = input;
  if (hasNpmrcConflict(surface, input.npmrc) || before === after) return NOT_VERIFIED;
  const { key } = EXEMPTION_SURFACES[surface];
  const entry = quotedEntry(surface);
  const value = scopeValue();
  const afterReading = readSurface(after, key);
  const beforeReading: Reading | null = before === null ? { target: null } : readSurface(before, key);
  if (afterReading === null || beforeReading === null) return NOT_VERIFIED;

  const beforeValues = beforeReading.target?.items.map((item) => item.value) ?? [];
  const afterValues = afterReading.target?.items.map((item) => item.value) ?? [];
  if (beforeValues.includes(value)) return NOT_VERIFIED;
  if (afterValues.length !== beforeValues.length + 1 || afterValues[afterValues.length - 1] !== value) return NOT_VERIFIED;
  if (!beforeValues.every((existing, i) => existing === afterValues[i])) return NOT_VERIFIED;

  const target = beforeReading.target;
  if (target === null) {
    const block = keyBlock(key, entry);
    const expected = before === null || before === "" ? block : before.endsWith("\n") ? before + block : `${before}\n${block.slice(0, -1)}`;
    if (after !== expected) return NOT_VERIFIED;
  } else {
    const b = before!.split("\n");
    const a = after.split("\n");
    const at = target.items[target.items.length - 1]!.index + 1;
    if (a.length !== b.length + 1) return NOT_VERIFIED;
    if (a[at] !== `${" ".repeat(target.indent)}- ${entry}`) return NOT_VERIFIED;
    if (!b.every((line, i) => a[i < at ? i : i + 1] === line)) return NOT_VERIFIED;
  }

  const edited = editReleaseAgeExemption(input.npmrc === undefined ? { surface, text: before } : { surface, text: before, npmrc: input.npmrc });
  return edited.kind === "edited" && edited.text === after ? { verified: true, value } : NOT_VERIFIED;
}
