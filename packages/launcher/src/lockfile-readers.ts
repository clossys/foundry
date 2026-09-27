import { compareCodeUnits, compareTuples } from "./change-set-contract.js";

/** Lockfile formats this module can read. Yarn is not one of them (RFC section 4.3, Yarn note). */
export type LockfileFormat = "npm" | "pnpm";

/** The root placements the invariants inspect. npm's `peerDependencies` is read for npm only. */
export type RootPlacement = "dependencies" | "devDependencies" | "optionalDependencies" | "peerDependencies";

/** One direct dependency of the repository root. */
export interface RootDependency {
  readonly placement: RootPlacement;
  readonly name: string;
  /** npm: `packages[""][placement][name]`; pnpm: `importers["."][placement][name].specifier`. */
  readonly specifier: string;
  /** npm: `packages["node_modules/<name>"].version`; pnpm: the `version` text before any `(` peer suffix. Null when absent. */
  readonly version: string | null;
  /** pnpm: the full `version` field text, before any peer-suffix stripping (fix 8: a `(patch_hash=...)` group must survive here even though `version` strips it). Always equal to `version` for npm. */
  readonly rawVersion: string | null;
  /** npm: `packages["node_modules/<name>"].integrity`; pnpm: `packages["<name>@<version>"].resolution.integrity`. Null when absent. */
  readonly integrity: string | null;
  /** npm: the `node_modules/<name>` entry has `link: true`; pnpm: `version` starts `link:` or `file:`. */
  readonly link: boolean;
}

/** One resolved package entry, transitive included. */
export interface LockfileEntry {
  /** npm: the `packages` path (`node_modules/a/node_modules/b`); pnpm: the `packages` key (`name@version`). */
  readonly key: string;
  /** The package's declared identity: npm `value.name` (falling back to the installed name); pnpm the `packages` key's name. */
  readonly name: string;
  /** The name actually installed at `key` (fix 6): npm the text after the key's last `node_modules/`, regardless of a mismatched declared `name` (an alias); always equal to `name` for pnpm, which has no per-entry alias concept. */
  readonly installedName: string;
  /** Null for an npm link entry with no `version` field (fix 7: link entries are kept, not skipped). Always a string for pnpm. */
  readonly version: string | null;
  readonly integrity: string | null;
  /** npm: `resolved` (also the link target for a link entry); pnpm: `resolution.tarball`. Null when absent. */
  readonly tarball: string | null;
  /** npm: `link: true`. Always false for pnpm. */
  readonly link: boolean;
  /** pnpm: every `resolution` key other than `integrity` and `tarball` (for example `type`, `directory`, `repo`, `commit`), sorted. Always empty for npm. */
  readonly otherResolutionKeys: readonly string[];
}

/** One dependency reference inside an importer's or a snapshot's dependency map (fix 6, pnpm only). */
export interface LockfileDependencyRef {
  /** Where this reference was read, for comparing the same location between base and regenerated -- for example `importers['.'].dependencies` or `snapshots['a@1.0.0'].dependencies`. */
  readonly place: string;
  /** The dependency's installed name (the map key). */
  readonly name: string;
  /** The raw, unquoted `version` field text: a plain version (optionally with a `(...)` peer suffix) when not aliased, or `<other name>@<version>`, `link:...` or `file:...` when it is. */
  readonly value: string;
}

/** The normalized view of one lockfile. */
export interface LockfileView {
  readonly format: LockfileFormat;
  /** npm: the number; pnpm: the string. */
  readonly lockfileVersion: number | string;
  /** Root direct dependencies, sorted by (placement, name) with compareCodeUnits. */
  readonly root: readonly RootDependency[];
  /** Every package entry, sorted by key with compareCodeUnits. */
  readonly entries: readonly LockfileEntry[];
  /** Every importer's and snapshot's dependency reference (fix 6). Always empty for npm. */
  readonly dependencyRefs: readonly LockfileDependencyRef[];
}

export type LockfileUnreadableReason = "lockfile-format-unsupported" | "lockfile-unreadable";

export interface LockfileUnreadable {
  readonly unreadable: true;
  readonly reason: LockfileUnreadableReason;
}

export type LockfileReadResult = LockfileView | LockfileUnreadable;

export function isUnreadable(result: LockfileReadResult): result is LockfileUnreadable {
  return "unreadable" in result;
}

function unreadableResult(reason: LockfileUnreadableReason): LockfileUnreadable {
  return { unreadable: true, reason };
}

const ROOT_PLACEMENTS: readonly RootPlacement[] = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

// ---------------------------------------------------------------------------
// npm (package-lock.json): a strict JSON parser (JSON.parse silently accepts
// duplicate object keys, keeping the last -- this reader must refuse them),
// then a thin reading of the shape lockfileVersion 2/3 `packages` map holds.
// ---------------------------------------------------------------------------

class JsonSyntaxError extends Error {}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A JSON parser that, unlike `JSON.parse`, refuses a document with a duplicate key in any object, anywhere in the tree. Throws `JsonSyntaxError` on anything else invalid JSON too. */
function parseStrictJson(source: string): unknown {
  let i = 0;
  const n = source.length;

  function fail(message: string): never {
    throw new JsonSyntaxError(message);
  }
  const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";

  const skipWhitespace = (): void => {
    for (;;) {
      const c = source[i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") i += 1;
      else break;
    }
  };

  const parseLiteral = (literal: string, value: unknown): unknown => {
    if (source.slice(i, i + literal.length) !== literal) fail(`expected "${literal}"`);
    i += literal.length;
    return value;
  };

  const parseNumber = (): number => {
    const start = i;
    if (source[i] === "-") i += 1;
    if (source[i] === "0") {
      i += 1;
    } else if (isDigit(source[i])) {
      i += 1;
      while (isDigit(source[i])) i += 1;
    } else {
      fail("invalid number");
    }
    if (source[i] === ".") {
      i += 1;
      if (!isDigit(source[i])) fail("invalid number");
      while (isDigit(source[i])) i += 1;
    }
    if (source[i] === "e" || source[i] === "E") {
      i += 1;
      const sign = source[i];
      if (sign === "+" || sign === "-") i += 1;
      if (!isDigit(source[i])) fail("invalid number");
      while (isDigit(source[i])) i += 1;
    }
    return Number(source.slice(start, i));
  };

  const parseString = (): string => {
    if (source[i] !== '"') fail("expected a string");
    i += 1;
    let out = "";
    for (;;) {
      const c = source[i];
      if (c === undefined) fail("unterminated string");
      if (c === '"') {
        i += 1;
        return out;
      }
      if (c === "\\") {
        const esc = source[i + 1];
        if (esc === undefined) fail("unterminated escape");
        i += 2;
        switch (esc) {
          case '"':
            out += '"';
            break;
          case "\\":
            out += "\\";
            break;
          case "/":
            out += "/";
            break;
          case "b":
            out += "\b";
            break;
          case "f":
            out += "\f";
            break;
          case "n":
            out += "\n";
            break;
          case "r":
            out += "\r";
            break;
          case "t":
            out += "\t";
            break;
          case "u": {
            const hex = source.slice(i, i + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("invalid unicode escape");
            out += String.fromCharCode(Number.parseInt(hex, 16));
            i += 4;
            break;
          }
          default:
            fail("invalid escape sequence");
        }
        continue;
      }
      if (c.charCodeAt(0) < 0x20) fail("control character in string");
      out += c;
      i += 1;
    }
  };

  const parseObject = (): Record<string, unknown> => {
    i += 1; // consume "{"
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const seen = new Set<string>();
    skipWhitespace();
    if (source[i] === "}") {
      i += 1;
      return result;
    }
    for (;;) {
      skipWhitespace();
      const key = parseString();
      if (seen.has(key)) fail(`duplicate key "${key}"`);
      seen.add(key);
      skipWhitespace();
      if (source[i] !== ":") fail('expected ":"');
      i += 1;
      result[key] = parseValue();
      skipWhitespace();
      if (source[i] === ",") {
        i += 1;
        continue;
      }
      if (source[i] === "}") {
        i += 1;
        return result;
      }
      fail('expected "," or "}"');
    }
  };

  const parseArray = (): unknown[] => {
    i += 1; // consume "["
    const result: unknown[] = [];
    skipWhitespace();
    if (source[i] === "]") {
      i += 1;
      return result;
    }
    for (;;) {
      result.push(parseValue());
      skipWhitespace();
      if (source[i] === ",") {
        i += 1;
        continue;
      }
      if (source[i] === "]") {
        i += 1;
        return result;
      }
      fail('expected "," or "]"');
    }
  };

  function parseValue(): unknown {
    skipWhitespace();
    const c = source[i];
    if (c === undefined) fail("unexpected end of input");
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === '"') return parseString();
    if (c === "t") return parseLiteral("true", true);
    if (c === "f") return parseLiteral("false", false);
    if (c === "n") return parseLiteral("null", null);
    if (c === "-" || isDigit(c)) return parseNumber();
    fail(`unexpected character "${c}"`);
  }

  const value = parseValue();
  skipWhitespace();
  if (i !== n) fail("trailing content after the JSON value");
  return value;
}

/** Reads a `package-lock.json` of lockfileVersion 2 or 3. Never throws. */
export function readNpmLockfile(text: string): LockfileReadResult {
  try {
    let parsed: unknown;
    try {
      parsed = parseStrictJson(text);
    } catch {
      return unreadableResult("lockfile-unreadable");
    }
    if (!isPlainObject(parsed)) return unreadableResult("lockfile-unreadable");

    if (!("lockfileVersion" in parsed)) return unreadableResult("lockfile-unreadable");
    const lockfileVersion = parsed["lockfileVersion"];
    if (lockfileVersion !== 2 && lockfileVersion !== 3) return unreadableResult("lockfile-format-unsupported");

    const packages = parsed["packages"];
    if (!isPlainObject(packages)) return unreadableResult("lockfile-unreadable");
    const rootEntry = packages[""];
    if (!isPlainObject(rootEntry)) return unreadableResult("lockfile-unreadable");

    const root: RootDependency[] = [];
    for (const placement of ROOT_PLACEMENTS) {
      const block = rootEntry[placement];
      if (block === undefined) continue;
      if (!isPlainObject(block)) return unreadableResult("lockfile-unreadable");
      for (const name of Object.keys(block)) {
        const specifier = block[name];
        if (typeof specifier !== "string") return unreadableResult("lockfile-unreadable");
        const installed = packages[`node_modules/${name}`];
        let version: string | null = null;
        let integrity: string | null = null;
        let link = false;
        if (isPlainObject(installed)) {
          version = typeof installed["version"] === "string" ? (installed["version"] as string) : null;
          integrity = typeof installed["integrity"] === "string" ? (installed["integrity"] as string) : null;
          link = installed["link"] === true;
        }
        root.push({ placement, name, specifier, version, rawVersion: version, integrity, link });
      }
    }

    const entries: LockfileEntry[] = [];
    const marker = "node_modules/";
    for (const key of Object.keys(packages)) {
      if (key === "") continue;
      if (!key.startsWith(marker) && !key.includes(`/${marker}`)) continue; // a workspace member path, not an entry
      const value = packages[key];
      if (!isPlainObject(value)) continue;
      const rawVersion = value["version"];
      if (rawVersion !== undefined && typeof rawVersion !== "string") return unreadableResult("lockfile-unreadable");
      const link = value["link"] === true;
      const version = typeof rawVersion === "string" ? rawVersion : null;
      if (version === null && !link) continue; // fix 7: keep a link entry even with no version; skip anything else unversioned
      const installedName = key.slice(key.lastIndexOf(marker) + marker.length);
      const name = typeof value["name"] === "string" ? (value["name"] as string) : installedName;
      const integrity = typeof value["integrity"] === "string" ? (value["integrity"] as string) : null;
      const tarball = typeof value["resolved"] === "string" ? (value["resolved"] as string) : null;
      entries.push({ key, name, installedName, version, integrity, tarball, link, otherResolutionKeys: [] });
    }

    root.sort((a, b) => compareTuples([a.placement, a.name], [b.placement, b.name]));
    entries.sort((a, b) => compareCodeUnits(a.key, b.key));

    return { format: "npm", lockfileVersion, root, entries, dependencyRefs: [] };
  } catch {
    return unreadableResult("lockfile-unreadable");
  }
}

// ---------------------------------------------------------------------------
// pnpm (pnpm-lock.yaml): a restricted, purpose-built reader for exactly the
// importers/packages block-mapping shape pnpm 9/10 write for lockfileVersion
// '9.0'. Not a general YAML parser -- see the module doc comment above the
// reader for exactly what subset is supported and what makes a document
// unreadable. Precedent for style: packages/integrator's pnpm-lock.yaml
// reader, which this module does not import (a different package, and this
// module's needs -- resolution flow mappings, forbidden-construct detection
// -- are wider than that one's).
// ---------------------------------------------------------------------------

class LockfileFailure extends Error {
  constructor(readonly reason: LockfileUnreadableReason) {
    super(reason);
  }
}

function fail(reason: LockfileUnreadableReason = "lockfile-unreadable"): never {
  throw new LockfileFailure(reason);
}

function isBlankOrCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length === 0 || trimmed.startsWith("#");
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Strips one layer of single- or double-quoting. A single-quoted scalar decodes `''` to one `'`. A
 * double-quoted scalar is refused outright the moment it contains a `\` (fix 9): this reader never
 * interprets an escape (pnpm itself always writes single quotes), so it cannot tell a plain character
 * from one hidden behind an escape sequence such as `\x66` or `\"`. Leaves a plain (unquoted) scalar as is.
 */
function unquoteYamlScalar(value: string): string {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    const inner = value.slice(1, -1);
    if (inner.includes("\\")) fail();
    return inner;
  }
  return value;
}

/**
 * The index of the colon separating a (possibly quoted) mapping key from its value on one trimmed line, or
 * undefined when the line has none. For an unquoted key (fix 9), the separating colon is the first one
 * followed by a space or the end of the line -- not simply the first colon anywhere, which a key holding
 * its own colon (a URL such as `foo@https://host/path:`) would otherwise split in the wrong place.
 */
function findKeyColon(trimmedLine: string): number | undefined {
  const first = trimmedLine[0];
  if (first === "'" || first === '"') {
    const quote = first;
    let end = 1;
    while (end < trimmedLine.length) {
      if (trimmedLine[end] === quote) {
        if (quote === "'" && trimmedLine[end + 1] === "'") {
          end += 2;
          continue;
        }
        end += 1;
        break;
      }
      end += 1;
    }
    const colonRelative = trimmedLine.slice(end).indexOf(":");
    return colonRelative === -1 ? undefined : end + colonRelative;
  }
  for (let i = 0; i < trimmedLine.length; i += 1) {
    if (trimmedLine[i] === ":" && (i + 1 === trimmedLine.length || trimmedLine[i + 1] === " ")) return i;
  }
  return undefined;
}

/** Whether a value (or, on a keyless line, the whole line) begins, unquoted, with a YAML construct this reader refuses: an anchor, alias, tag, or block-scalar indicator. */
function hasForbiddenPlainStart(value: string): boolean {
  const c = value[0];
  return c === "&" || c === "*" || c === "!" || c === "|" || c === ">";
}

/**
 * Fails on any anchor (`&name`), alias (`*name`), tag (`!`/`!!`), block
 * scalar indicator (`|`/`>`), document marker (`---`/`...`), explicit key
 * (`? `), merge key (`<<`), or tab used for indentation -- wherever in the
 * file it appears, including inside sections this reader otherwise
 * tolerates and never structurally parses (`settings`, a package's
 * `engines`/`cpu`/`os`, and so on). Fix 9 widens this to a mapping *key*
 * too, not only its value: a key spelled `&a`, `!tag`, `*alias`, `? ` or
 * `<<` must refuse the file outright rather than silently fail to match
 * the structural key (`importers`, `packages`, ...) it was disguising as,
 * which would let that section read as merely absent.
 */
function scanForForbiddenYamlConstructs(lines: readonly string[]): void {
  for (const line of lines) {
    if (isBlankOrCommentLine(line)) continue;
    if (line.slice(0, indentOf(line)).includes("\t")) fail();
    let trimmed = line.trim();
    if (trimmed === "---" || trimmed === "..." || trimmed.startsWith("--- ") || trimmed.startsWith("... ")) fail();
    if (trimmed.startsWith("- ")) trimmed = trimmed.slice(2).trim();
    else if (trimmed === "-") trimmed = "";
    if (trimmed.startsWith("? ") || trimmed === "?") fail();
    const colon = findKeyColon(trimmed);
    if (colon !== undefined) {
      const rawKey = trimmed.slice(0, colon);
      if (rawKey === "<<") fail();
      const keyFirst = rawKey[0];
      if (keyFirst === "&" || keyFirst === "!" || keyFirst === "*") fail();
    }
    const value = colon === undefined ? trimmed : trimmed.slice(colon + 1).trim();
    if (value.length > 0 && hasForbiddenPlainStart(value)) fail();
  }
}

/** One key's position within a parsed block-mapping level: its inline value (when the value sat on the key's own line) and the line range of its nested body (possibly empty), left unparsed until a caller recurses into it. */
interface MappingEntry {
  readonly inlineValue: string | undefined;
  readonly bodyStart: number;
  readonly bodyEnd: number;
}

/**
 * Parses exactly one level of a block mapping over `lines[start, end)`,
 * whose entries all share `indent`. Does not recurse: a key's own nested
 * content is only located by indentation here, never interpreted -- the
 * caller parses a level's body only when it actually needs to read inside
 * it, which is how this reader tolerates arbitrarily-shaped content it does
 * not otherwise understand (a block sequence, deeper nesting, ...) in a
 * section it does not read. Fails on a key duplicated at this level, a
 * sequence item, or a line with no `key:`.
 */
function parseMappingLevel(lines: readonly string[], start: number, end: number, indent: number): Map<string, MappingEntry> {
  const result = new Map<string, MappingEntry>();
  let i = start;
  while (i < end) {
    const line = lines[i] as string;
    if (isBlankOrCommentLine(line)) {
      i += 1;
      continue;
    }
    if (indentOf(line) !== indent) fail();
    const trimmed = line.trim();
    if (trimmed.startsWith("- ") || trimmed === "-") fail();
    const colon = findKeyColon(trimmed);
    if (colon === undefined) fail();
    const key = unquoteYamlScalar(trimmed.slice(0, colon).trim());
    const rest = trimmed.slice(colon + 1).trim();
    if (result.has(key)) fail();
    let j = i + 1;
    while (j < end) {
      const next = lines[j] as string;
      if (next.trim().length > 0 && indentOf(next) <= indent) break;
      j += 1;
    }
    result.set(key, { inlineValue: rest.length > 0 ? rest : undefined, bodyStart: i + 1, bodyEnd: j });
    i = j;
  }
  return result;
}

/** The indentation of the first non-blank, non-comment line in `lines[start, end)`, or undefined when the range holds none. */
function peekIndent(lines: readonly string[], start: number, end: number): number | undefined {
  for (let i = start; i < end; i += 1) {
    const line = lines[i] as string;
    if (isBlankOrCommentLine(line)) continue;
    return indentOf(line);
  }
  return undefined;
}

/** Parses a one-level flow mapping (`{k: v, k2: v2}`) of plain or quoted scalars. Fails on nesting (`{`, `}`, `[`, `]` in a bare value) or anything else the syntax does not allow. */
function parseFlowMapping(raw: string): Map<string, string> {
  const text = raw.trim();
  if (!text.startsWith("{") || !text.endsWith("}")) fail();
  const inner = text.slice(1, -1).trim();
  const result = new Map<string, string>();
  if (inner.length === 0) return result;

  let i = 0;
  const n = inner.length;
  const skipWs = (): void => {
    while (i < n && (inner[i] === " " || inner[i] === "\t")) i += 1;
  };
  const readQuoted = (): string => {
    const quote = inner[i] as string;
    i += 1;
    let out = "";
    while (i < n) {
      const c = inner[i] as string;
      // fix 9: a double-quoted scalar (key or value) refuses outright the moment it holds a `\` --
      // this reader never interprets an escape, and pnpm never writes double quotes anyway.
      if (quote === '"' && c === "\\") fail();
      if (c === quote) {
        if (quote === "'" && inner[i + 1] === "'") {
          out += "'";
          i += 2;
          continue;
        }
        i += 1;
        return out;
      }
      out += c;
      i += 1;
    }
    return fail();
  };
  // A bare value can itself contain `:` (a URL's scheme, say), so only the
  // key reader stops there; the value reader stops only at the next `,`.
  const readBare = (stop: string): string => {
    const start = i;
    while (i < n && inner[i] !== stop) i += 1;
    const value = inner.slice(start, i).trim();
    if (/[{}[\]]/.test(value)) fail();
    return value;
  };

  for (;;) {
    skipWs();
    if (i >= n) fail();
    const kc = inner[i];
    const key = kc === "'" || kc === '"' ? readQuoted() : readBare(":");
    skipWs();
    if (inner[i] !== ":") fail();
    i += 1;
    skipWs();
    const vc = inner[i];
    const value = vc === "'" || vc === '"' ? readQuoted() : readBare(",");
    if (result.has(key)) fail();
    result.set(key, value);
    skipWs();
    if (i >= n) break;
    if (inner[i] === ",") {
      i += 1;
      continue;
    }
    fail();
  }
  return result;
}

/** Splits a `packages` key at its last `@`, the boundary pnpm uses between a (possibly scoped) name and its version. Undefined when there is no such `@` (not at index 0, so a scoped name's own leading `@` is never mistaken for it). */
function splitPackageKey(key: string): { readonly name: string; readonly version: string } | undefined {
  for (let i = key.length - 1; i > 0; i -= 1) {
    if (key[i] === "@") return { name: key.slice(0, i), version: key.slice(i + 1) };
  }
  return undefined;
}

const PNPM_ROOT_PLACEMENTS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

const SNAPSHOT_PLACEMENTS = ["dependencies", "optionalDependencies", "devDependencies"] as const;

/**
 * Refuses a structural key's inline value unless it is absent or exactly `{}` (fix 9). The structural keys
 * are `importers`, `packages`, `snapshots`, an importer such as `.`, a placement block, a root dependency,
 * and a package or snapshot entry's field block: each of these must be read as a nested block, never
 * silently skipped just because its value sat inline as a flow mapping this reader does not expect there
 * (which would otherwise let the whole section read as merely absent, switching an invariant off).
 */
function requireStructuralInline(entry: MappingEntry | undefined): void {
  if (entry !== undefined && entry.inlineValue !== undefined && entry.inlineValue !== "{}") fail();
}

function readPnpmLockfileInner(text: string): LockfileReadResult {
  const lines = text.split(/\r\n|\r|\n/);
  scanForForbiddenYamlConstructs(lines);

  const top = parseMappingLevel(lines, 0, lines.length, 0);

  const versionEntry = top.get("lockfileVersion");
  if (versionEntry === undefined || versionEntry.inlineValue === undefined) fail("lockfile-unreadable");
  const lockfileVersion = unquoteYamlScalar(versionEntry.inlineValue);
  if (lockfileVersion !== "9.0") fail("lockfile-format-unsupported");

  // `packages` first: a root dependency's integrity is looked up from it.
  const packageLookup = new Map<string, { readonly integrity: string | null }>();
  const entries: LockfileEntry[] = [];
  const packagesEntry = top.get("packages");
  requireStructuralInline(packagesEntry);
  if (packagesEntry !== undefined) {
    const packagesIndent = peekIndent(lines, packagesEntry.bodyStart, packagesEntry.bodyEnd);
    if (packagesIndent !== undefined) {
      const packagesMap = parseMappingLevel(lines, packagesEntry.bodyStart, packagesEntry.bodyEnd, packagesIndent);
      for (const [key, entry] of packagesMap) {
        requireStructuralInline(entry);
        const split = splitPackageKey(key);
        if (split === undefined) fail("lockfile-unreadable");
        let integrity: string | null = null;
        let tarball: string | null = null;
        let otherResolutionKeys: string[] = [];
        const fieldsIndent = peekIndent(lines, entry.bodyStart, entry.bodyEnd);
        if (fieldsIndent !== undefined) {
          const fields = parseMappingLevel(lines, entry.bodyStart, entry.bodyEnd, fieldsIndent);
          const resolution = fields.get("resolution");
          if (resolution !== undefined) {
            if (resolution.inlineValue === undefined) fail("lockfile-unreadable"); // a nested block, not a flow mapping
            const flow = parseFlowMapping(resolution.inlineValue);
            integrity = flow.get("integrity") ?? null;
            tarball = flow.get("tarball") ?? null;
            otherResolutionKeys = [...flow.keys()].filter((k) => k !== "integrity" && k !== "tarball").sort(compareCodeUnits);
          }
        }
        packageLookup.set(key, { integrity });
        entries.push({ key, name: split.name, installedName: split.name, version: split.version, integrity, tarball, link: false, otherResolutionKeys });
      }
    }
  }

  const root: RootDependency[] = [];
  const dependencyRefs: LockfileDependencyRef[] = [];
  const importersEntry = top.get("importers");
  requireStructuralInline(importersEntry);
  if (importersEntry !== undefined) {
    const importersIndent = peekIndent(lines, importersEntry.bodyStart, importersEntry.bodyEnd);
    if (importersIndent === undefined) fail("lockfile-unreadable"); // importers present but no "." importer
    const importersMap = parseMappingLevel(lines, importersEntry.bodyStart, importersEntry.bodyEnd, importersIndent);
    if (importersMap.get(".") === undefined) fail("lockfile-unreadable");
    for (const [importerId, importerEntry] of importersMap) {
      requireStructuralInline(importerEntry);
      const importerIndent = peekIndent(lines, importerEntry.bodyStart, importerEntry.bodyEnd);
      if (importerIndent === undefined) continue;
      const importerMap = parseMappingLevel(lines, importerEntry.bodyStart, importerEntry.bodyEnd, importerIndent);
      for (const placement of PNPM_ROOT_PLACEMENTS) {
        const block = importerMap.get(placement);
        requireStructuralInline(block);
        if (block === undefined) continue;
        const depIndent = peekIndent(lines, block.bodyStart, block.bodyEnd);
        if (depIndent === undefined) continue;
        const depMap = parseMappingLevel(lines, block.bodyStart, block.bodyEnd, depIndent);
        for (const [name, depEntry] of depMap) {
          const fieldIndent = peekIndent(lines, depEntry.bodyStart, depEntry.bodyEnd);
          if (fieldIndent === undefined) fail("lockfile-unreadable");
          const fields = parseMappingLevel(lines, depEntry.bodyStart, depEntry.bodyEnd, fieldIndent);
          const specifierField = fields.get("specifier");
          const versionField = fields.get("version");
          if (specifierField?.inlineValue === undefined || versionField?.inlineValue === undefined) fail("lockfile-unreadable");
          const specifier = unquoteYamlScalar(specifierField.inlineValue);
          const rawVersion = unquoteYamlScalar(versionField.inlineValue);
          dependencyRefs.push({ place: `importers['${importerId}'].${placement}`, name, value: rawVersion });
          if (importerId !== ".") continue;
          const link = rawVersion.startsWith("link:") || rawVersion.startsWith("file:");
          const parenIndex = rawVersion.indexOf("(");
          const version = link || parenIndex === -1 ? rawVersion : rawVersion.slice(0, parenIndex);
          const integrity = link ? null : (packageLookup.get(`${name}@${version}`)?.integrity ?? null);
          root.push({ placement, name, specifier, version, rawVersion, integrity, link });
        }
      }
    }
  }

  // `snapshots`: read only far enough to expose each dependency reference's raw value (fix 6). A
  // snapshot's own resolution is looked up from `packages` by its key, not read here.
  const snapshotsEntry = top.get("snapshots");
  requireStructuralInline(snapshotsEntry);
  if (snapshotsEntry !== undefined) {
    const snapshotsIndent = peekIndent(lines, snapshotsEntry.bodyStart, snapshotsEntry.bodyEnd);
    if (snapshotsIndent !== undefined) {
      const snapshotsMap = parseMappingLevel(lines, snapshotsEntry.bodyStart, snapshotsEntry.bodyEnd, snapshotsIndent);
      for (const [snapshotKey, snapshotEntry] of snapshotsMap) {
        requireStructuralInline(snapshotEntry);
        const fieldsIndent = peekIndent(lines, snapshotEntry.bodyStart, snapshotEntry.bodyEnd);
        if (fieldsIndent === undefined) continue;
        const fields = parseMappingLevel(lines, snapshotEntry.bodyStart, snapshotEntry.bodyEnd, fieldsIndent);
        for (const placement of SNAPSHOT_PLACEMENTS) {
          const block = fields.get(placement);
          requireStructuralInline(block);
          if (block === undefined) continue;
          const depIndent = peekIndent(lines, block.bodyStart, block.bodyEnd);
          if (depIndent === undefined) continue;
          const depMap = parseMappingLevel(lines, block.bodyStart, block.bodyEnd, depIndent);
          for (const [name, depEntry] of depMap) {
            if (depEntry.inlineValue === undefined) fail("lockfile-unreadable");
            dependencyRefs.push({ place: `snapshots['${snapshotKey}'].${placement}`, name, value: unquoteYamlScalar(depEntry.inlineValue) });
          }
        }
      }
    }
  }

  root.sort((a, b) => compareTuples([a.placement, a.name], [b.placement, b.name]));
  entries.sort((a, b) => compareCodeUnits(a.key, b.key));

  return { format: "pnpm", lockfileVersion, root, entries, dependencyRefs };
}

/** Reads a `pnpm-lock.yaml` of lockfileVersion `'9.0'`. Never throws. */
export function readPnpmLockfile(text: string): LockfileReadResult {
  try {
    return readPnpmLockfileInner(text);
  } catch (error) {
    if (error instanceof LockfileFailure) return unreadableResult(error.reason);
    return unreadableResult("lockfile-unreadable");
  }
}

/** Reads a lockfile of the given format. Never throws. */
export function readLockfile(format: LockfileFormat, text: string): LockfileReadResult {
  return format === "npm" ? readNpmLockfile(text) : readPnpmLockfile(text);
}
