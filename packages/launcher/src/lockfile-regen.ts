// Lockfile regeneration (RFC apply-approved-plan: T1, T7, V6, D7, D25).
//
// Regenerates one repository's lockfile with install scripts off, under an
// environment built from a literal allow-list (lockfile-tool-env.ts), with the
// publishing scope forced onto the publishing registry on the command line so
// no repository or parent configuration can redirect it. The repository tree
// is snapshotted before and after: anything but the lockfile changing is a
// violation, never an exemption. The result is then checked against I1 to I5.
// Nothing here reverts, repairs or retries.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, readFile, readdir, readlink, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { compareCodeUnits, lockfilePath } from "./change-set-contract.js";
import type { LockfileName, PackageManagerKind } from "./change-set-contract.js";
import { PACKAGE_SCOPE } from "./generated/package-scope.generated.js";
import { checkLockfileInvariants } from "./lockfile-invariants.js";
import type { LockfileInvariantPackage, LockfileInvariantViolation, TransitiveCounts } from "./lockfile-invariants.js";
import type { LockfileFormat } from "./lockfile-readers.js";
import { lockfileToolEnv, prepareLockfileScratch } from "./lockfile-tool-env.js";

/** One process launch. `shell` is always false. */
export interface LockfileSpawnRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  /** Bytes kept per stream; output past it is dropped. */
  readonly maxBuffer: number;
}

export interface LockfileSpawnResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** "not-found": the command could not be launched (ENOENT); "timeout": killed with SIGKILL at timeoutMs. */
  readonly failure?: "not-found" | "timeout";
}

export type LockfileSpawn = (request: LockfileSpawnRequest) => Promise<LockfileSpawnResult>;

/** Collects at most `limit` bytes of one stream. */
function cappedSink(limit: number): { push(chunk: Buffer): void; text(): string } {
  const chunks: Buffer[] = [];
  let kept = 0;
  return {
    push(chunk) {
      if (kept >= limit) return;
      const slice = chunk.length > limit - kept ? chunk.subarray(0, limit - kept) : chunk;
      chunks.push(slice);
      kept += slice.length;
    },
    text: () => Buffer.concat(chunks).toString("utf8"),
  };
}

/** Grace period after SIGKILL before giving up on `close` and settling anyway (fix 5). */
const LOCKFILE_TOOL_KILL_GRACE_MS = 2_000;

/**
 * The default spawn port: node:child_process spawn with shell false, SIGKILL on timeout, capped capture.
 * Off Windows the child leads its own process group, so the kill reaches any grandchild holding the pipes open.
 * A descendant that leaves the process group (for example with `setsid`) and keeps stdout or stderr open can
 * still keep `close` from ever firing; a short grace timer after the SIGKILL settles the promise anyway.
 */
export function spawnLockfileTool(request: LockfileSpawnRequest): Promise<LockfileSpawnResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const stdout = cappedSink(request.maxBuffer);
    const stderr = cappedSink(request.maxBuffer);
    const group = process.platform !== "win32";
    let settled = false;
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;
    const clearTimers = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
    };
    const settle = (result: LockfileSpawnResult): void => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolvePromise(result);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(request.command, [...request.args], { cwd: request.cwd, env: { ...request.env }, shell: false, detached: group, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") settle({ status: null, stdout: "", stderr: "", failure: "not-found" });
      else rejectPromise(error);
      return;
    }
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") settle({ status: null, stdout: stdout.text(), stderr: stderr.text(), failure: "not-found" });
      else if (child.pid === undefined) settle({ status: null, stdout: stdout.text(), stderr: `${stderr.text()}${error.message}` });
    });
    child.on("close", (status: number | null) => {
      settle({ status, stdout: stdout.text(), stderr: stderr.text(), ...(timedOut ? { failure: "timeout" as const } : {}) });
    });
    timer = setTimeout(() => {
      timedOut = true;
      try {
        if (group && child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      graceTimer = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        settle({ status: null, stdout: stdout.text(), stderr: stderr.text(), failure: "timeout" });
      }, LOCKFILE_TOOL_KILL_GRACE_MS);
    }, request.timeoutMs);
  });
}

export interface LockfileRegenInput {
  /** Absolute, real (realpath-equal) directory to regenerate in. */
  readonly root: string;
  readonly packageManager: PackageManagerKind;
  /** The observed lockfile name; lockfilePath() resolves the path. */
  readonly lockfile: LockfileName;
  /** Exact tool version; required for pnpm and Yarn, optional for npm. */
  readonly toolVersion: string | null;
  /** The lockfile text at the base commit, read by the caller. */
  readonly baseLockfile: string;
  readonly packages: readonly LockfileInvariantPackage[];
  readonly now: () => Date;
}

/** Ports. Neither is reachable from a CLI. `registry` is a test-only override of PACKAGE_SCOPE.registry. */
export interface LockfileRegenPorts {
  readonly spawn?: LockfileSpawn;
  readonly registry?: string;
}

export type LockfileRegenIndeterminateReason =
  | "root-not-canonical"
  | "manifest-absent"
  | "lockfile-absent"
  | "lockfile-is-link"
  | "lockfile-unreadable"
  | "lockfile-format-unsupported"
  | "package-manager-unsupported"
  | "package-manager-version-unknown"
  | "registry-config-needs-credential"
  | "package-manager-config-unsafe"
  | "package-manager-config-unrecognized"
  | "tool-unavailable"
  | "tool-failed"
  | "tool-timeout";

export type LockfileRegenViolatedRule = "lockfile-not-at-base" | "tree-changed-outside-lockfile" | "lockfile-invariants";

export interface LockfileTooling {
  readonly tool: "npm" | "pnpm" | "yarn";
  /** `<tool> --version` output, trimmed; null when it could not be read. */
  readonly version: string | null;
}

export type LockfileRegenResult =
  | {
      readonly verdict: "satisfied";
      readonly path: string;
      readonly before: string;
      readonly after: string;
      readonly tooling: LockfileTooling;
      readonly transitive: TransitiveCounts;
    }
  | {
      readonly verdict: "violated";
      readonly rule: LockfileRegenViolatedRule;
      readonly violations: readonly LockfileInvariantViolation[];
      /** Changed paths (relative, sorted) for tree-changed-outside-lockfile; empty otherwise. */
      readonly paths: readonly string[];
      readonly tooling: LockfileTooling | null;
    }
  | {
      readonly verdict: "indeterminate";
      readonly reason: LockfileRegenIndeterminateReason;
      /** At most 4 KiB of tool output with scratch and root replaced by $SCRATCH / $ROOT; tool-failed and tool-timeout only. */
      readonly output?: string;
      readonly tooling: LockfileTooling | null;
    };

/** Per-launch limits (both the version probe and the regeneration). */
export const LOCKFILE_TOOL_TIMEOUT_MS = 180_000;
export const LOCKFILE_TOOL_MAX_BUFFER = 2_000_000;
/** Bytes of tool output kept in an indeterminate result. */
export const LOCKFILE_OUTPUT_TAIL_BYTES = 4096;

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// ---------------------------------------------------------------------------
// Repository configuration scan
// ---------------------------------------------------------------------------

/** Repository configuration files a tool reads; absent files are omitted. The caller passes only the files the tool reads. */
export interface RepositoryConfigFiles {
  readonly npmrc?: string;
  readonly pnpmWorkspace?: string;
  readonly yarnrc?: string;
}

export type RepositoryConfigRefusal = "registry-config-needs-credential" | "package-manager-config-unsafe" | "package-manager-config-unrecognized";

export type RepositoryConfigScan =
  | {
      readonly refused: false;
      /** `.npmrc` sets `min-release-age`: npm then runs with `--min-release-age=0` (D25). */
      readonly minReleaseAge: boolean;
      /** `.npmrc` sets `before`: npm then runs with `--before=<now>` (D25). */
      readonly before: boolean;
    }
  | {
      readonly refused: true;
      readonly reason: RepositoryConfigRefusal;
      /** The file and key that refused, for example `.npmrc:_authToken`. */
      readonly finding: string;
    };

// ---------------------------------------------------------------------------
// .npmrc: a strict allow-list grammar that fails closed (fix 1). The scan
// tokenises exactly the subset of npm's ini decoding this file is willing to
// accept -- not npm's own splitting -- so nothing outside the grammar below
// can reach npm at all, whatever npm's ini decoder would have made of it.
// ---------------------------------------------------------------------------

/** One line matching the allow-list grammar exactly: a bare, lowercase, hyphenated key and an unquoted value. */
const NPMRC_LINE = /^([a-z][a-z0-9-]*)[ \t]*=[ \t]*([A-Za-z0-9._:^~+-]+)$/;

/** `.npmrc` keys this runner treats as inert, each mapped to the value form it must match exactly (fix 1). */
const NPMRC_ALLOWED_KEYS: ReadonlyMap<string, RegExp> = new Map([
  ["engine-strict", /^(?:true|false)$/],
  ["save-exact", /^(?:true|false)$/],
  ["save-prefix", /^[\^~]$/],
  ["legacy-peer-deps", /^(?:true|false)$/],
  ["strict-peer-deps", /^(?:true|false)$/],
  ["auto-install-peers", /^(?:true|false)$/],
  ["strict-peer-dependencies", /^(?:true|false)$/],
  ["fund", /^(?:true|false)$/],
  ["audit", /^(?:true|false)$/],
  ["update-notifier", /^(?:true|false)$/],
  ["progress", /^(?:true|false)$/],
  ["loglevel", /^(?:silent|error|warn|notice|http|info|verbose|silly)$/],
  ["color", /^(?:true|false|always)$/],
  ["min-release-age", /^[0-9]+$/],
  ["before", /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/],
]);

/**
 * `.npmrc` keys that, when the line is otherwise inside the grammar, still refuse as a credential rather
 * than as unrecognized (today's precedence, kept). Every other credential spelling npm honours -- `_auth`,
 * `_authToken`, `_password`, and any `//host/:...` key -- starts with a character the grammar's key
 * pattern never allows, so a line naming one of those never matches NPMRC_LINE at all: the whole file is
 * simply package-manager-config-unrecognized.
 */
const NPMRC_CREDENTIAL_KEYS: ReadonlySet<string> = new Set(["username", "certfile", "keyfile"]);

/** Every byte the allow-list grammar accepts: tab, LF, and printable ASCII. No `\r`, ever. */
function isNpmrcByteSafe(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 0x09 || code === 0x0a) continue;
    if (code >= 0x20 && code <= 0x7e) continue;
    return false;
  }
  return true;
}

interface NpmrcScan {
  readonly credential: string[];
  readonly unrecognized: string[];
  readonly minReleaseAge: boolean;
  readonly before: boolean;
}

/**
 * Scans `.npmrc` against the strict allow-list grammar (fix 1). The file must be pure ASCII with no `\r`
 * anywhere and no `${`, split on `\n` only; every non-blank, non-comment line must match NPMRC_LINE
 * exactly, name an allow-listed key at most once, and hold that key's required value form. Anything else
 * is package-manager-config-unrecognized, except the three credential-bearing keys the grammar can still
 * spell (username, certfile, keyfile), which keep registry-config-needs-credential.
 */
function scanNpmrc(text: string): NpmrcScan {
  const credential: string[] = [];
  const unrecognized: string[] = [];
  let minReleaseAge = false;
  let before = false;
  if (!isNpmrcByteSafe(text) || text.includes("${")) return { credential, unrecognized: [".npmrc"], minReleaseAge, before };
  const seen = new Set<string>();
  for (const rawLine of text.split("\n")) {
    const trimmed = rawLine.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    const match = NPMRC_LINE.exec(trimmed);
    if (match === null) {
      unrecognized.push(".npmrc");
      continue;
    }
    const key = match[1] as string;
    const value = match[2] as string;
    if (key === "min-release-age") minReleaseAge = true;
    if (key === "before") before = true;
    if (seen.has(key)) {
      unrecognized.push(`.npmrc:${key}`);
      continue;
    }
    seen.add(key);
    const pattern = NPMRC_ALLOWED_KEYS.get(key);
    if (pattern === undefined) {
      if (NPMRC_CREDENTIAL_KEYS.has(key)) credential.push(`.npmrc:${key}`);
      else unrecognized.push(`.npmrc:${key}`);
      continue;
    }
    if (!pattern.test(value)) unrecognized.push(`.npmrc:${key}`);
  }
  return { credential, unrecognized, minReleaseAge, before };
}

// ---------------------------------------------------------------------------
// pnpm-workspace.yaml and .yarnrc.yml: a small, restricted line grammar (fix
// 2, reused by fix 3), never a general YAML parser. Every anchor, alias,
// tag, document marker, directive, merge key, explicit key, block scalar
// and flow collection is refused wherever it appears; a top-level key must
// be plain (never quoted) and on the caller's allow-list; nested keys and
// scalars are plain or single-quoted only. Anything outside this is
// refused. Double quotes are refused everywhere: this reader never
// interprets an escape, so it cannot tell a plain "D" from a \x44 hiding one.
// ---------------------------------------------------------------------------

/** Every byte the restricted YAML grammar accepts: LF and printable ASCII. No `\r`, no tab, ever. */
function isRestrictedYamlByteSafe(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 0x0a) continue;
    if (code >= 0x20 && code <= 0x7e) continue;
    return false;
  }
  return true;
}

/** The end index of a single-quoted scalar starting at `text[0]` (`''` decodes to one `'`), or undefined when unterminated. */
function findSingleQuoteEnd(text: string): number | undefined {
  let i = 1;
  while (i < text.length) {
    if (text[i] === "'") {
      if (text[i + 1] === "'") {
        i += 2;
        continue;
      }
      return i;
    }
    i += 1;
  }
  return undefined;
}

interface RestrictedScalar {
  readonly text: string;
  readonly quoted: boolean;
}

/** Reads a plain or single-quoted scalar filling the rest of a line (after trailing spaces are dropped). Refuses a double quote, a bare YAML-syntax bypass, or any leftover text after a quoted scalar closes. */
function readRestrictedScalar(text: string): RestrictedScalar | undefined {
  const value = text.replace(/[ \t]+$/, "");
  if (value === "") return undefined;
  if (value.startsWith("'")) {
    const end = findSingleQuoteEnd(value);
    if (end === undefined || end !== value.length - 1) return undefined;
    return { text: value.slice(1, end).replace(/''/g, "'"), quoted: true };
  }
  if (value.startsWith('"')) return undefined;
  if (/^[&*!|>]/.test(value)) return undefined;
  if (/[{}[\]]/.test(value) || value.includes("#") || value.includes("<<")) return undefined;
  return { text: value, quoted: false };
}

/** Reads a plain (`[A-Za-z0-9._-]+`) or single-quoted key at the start of `text`. Refuses a double-quoted key. */
function readRestrictedKey(text: string): (RestrictedScalar & { readonly consumed: number }) | undefined {
  if (text.startsWith("'")) {
    const end = findSingleQuoteEnd(text);
    if (end === undefined) return undefined;
    return { text: text.slice(1, end).replace(/''/g, "'"), quoted: true, consumed: end + 1 };
  }
  if (text.startsWith('"')) return undefined;
  const match = /^[A-Za-z0-9._-]+/.exec(text);
  if (match === null) return undefined;
  return { text: match[0], quoted: false, consumed: match[0].length };
}

interface RestrictedYamlLine {
  readonly indent: number;
  readonly sequence: boolean;
  readonly key?: string;
  readonly keyQuoted: boolean;
  readonly value?: RestrictedScalar;
}

/**
 * Parses one non-blank, non-full-comment line under the restricted grammar: a sequence item (`- <scalar>`),
 * a mapping entry with an inline scalar (`<key>: <scalar>`), or a mapping entry with no inline value (a
 * nested body follows). Undefined when the line holds a document marker, a directive, an explicit key, a
 * merge key, a tag, an anchor, an alias, a block scalar, a flow collection, a trailing comment, or anything
 * else outside this shape.
 */
function parseRestrictedYamlLine(line: string): RestrictedYamlLine | undefined {
  const indent = line.length - line.trimStart().length;
  let rest = line.slice(indent);
  let sequence = false;
  if (rest.startsWith("- ")) {
    sequence = true;
    rest = rest.slice(2);
  } else if (rest === "-") {
    sequence = true;
    rest = "";
  }
  if (/^(?:---|\.\.\.)(?:\s|$)/.test(rest) || rest.startsWith("%") || rest.startsWith("? ") || rest === "?" || rest.startsWith("<<")) return undefined;

  if (sequence) {
    const value = readRestrictedScalar(rest);
    if (value === undefined) return undefined;
    return { indent, sequence: true, keyQuoted: false, value };
  }

  const keyRead = readRestrictedKey(rest);
  if (keyRead === undefined) return undefined;
  const afterKey = rest.slice(keyRead.consumed);
  if (afterKey !== ":" && !afterKey.startsWith(": ")) return undefined;
  const valuePart = afterKey === ":" ? "" : afterKey.slice(2).replace(/^ +/, "");
  if (valuePart === "") return { indent, sequence: false, key: keyRead.text, keyQuoted: keyRead.quoted };
  const value = readRestrictedScalar(valuePart);
  if (value === undefined) return undefined;
  return { indent, sequence: false, key: keyRead.text, keyQuoted: keyRead.quoted, value };
}

interface RestrictedYamlEntry {
  readonly keyQuoted: boolean;
  readonly value?: RestrictedScalar;
  readonly bodyStart: number;
  readonly bodyEnd: number;
}

/** The indentation of the first non-blank, non-comment line in `lines[start, end)`, or undefined when the range holds none. */
function firstIndent(lines: readonly string[], start: number, end: number): number | undefined {
  for (let i = start; i < end; i += 1) {
    const trimmedLeft = (lines[i] as string).replace(/^ */, "");
    if (trimmedLeft !== "" && !trimmedLeft.startsWith("#")) return (lines[i] as string).length - trimmedLeft.length;
  }
  return undefined;
}

/** Parses one level of restricted-grammar mapping entries over `lines[start, end)`, all at `indent`. Undefined on a malformed line, a sequence item, a duplicate key, or an entry at the wrong indent. */
function parseRestrictedYamlLevel(lines: readonly string[], start: number, end: number, indent: number): Map<string, RestrictedYamlEntry> | undefined {
  const result = new Map<string, RestrictedYamlEntry>();
  let i = start;
  while (i < end) {
    const raw = lines[i] as string;
    const trimmedLeft = raw.replace(/^ */, "");
    if (trimmedLeft === "" || trimmedLeft.startsWith("#")) {
      i += 1;
      continue;
    }
    if (raw.length - trimmedLeft.length !== indent) return undefined;
    const parsed = parseRestrictedYamlLine(raw);
    if (parsed === undefined || parsed.sequence || parsed.key === undefined || result.has(parsed.key)) return undefined;
    let j = i + 1;
    while (j < end) {
      const nextTrimmedLeft = (lines[j] as string).replace(/^ */, "");
      if (nextTrimmedLeft !== "" && !nextTrimmedLeft.startsWith("#") && (lines[j] as string).length - nextTrimmedLeft.length <= indent) break;
      j += 1;
    }
    if (parsed.value !== undefined && firstIndent(lines, i + 1, j) !== undefined) return undefined; // both an inline value and a nested body
    result.set(parsed.key, { keyQuoted: parsed.keyQuoted, value: parsed.value, bodyStart: i + 1, bodyEnd: j });
    i = j;
  }
  return result;
}

/** Whether every item of a restricted-grammar block sequence over `lines[start, end)` is a scalar matching `pattern` (unquoted) or single-quoted (any content). An empty sequence is accepted. */
function validRestrictedSequence(lines: readonly string[], start: number, end: number, pattern: RegExp): boolean {
  const indent = firstIndent(lines, start, end);
  if (indent === undefined) return true;
  for (let i = start; i < end; i += 1) {
    const raw = lines[i] as string;
    const trimmedLeft = raw.replace(/^ */, "");
    if (trimmedLeft === "" || trimmedLeft.startsWith("#")) continue;
    if (raw.length - trimmedLeft.length !== indent) return false;
    const parsed = parseRestrictedYamlLine(raw);
    if (parsed === undefined || !parsed.sequence || parsed.value === undefined) return false;
    if (!parsed.value.quoted && !pattern.test(parsed.value.text)) return false;
  }
  return true;
}

/** Whether every entry of a restricted-grammar one-level block mapping over `lines[start, end)` has a scalar value matching `pattern` (unquoted) or single-quoted (any content). An empty mapping is accepted. */
function validRestrictedMapping(lines: readonly string[], start: number, end: number, pattern: RegExp): boolean {
  const indent = firstIndent(lines, start, end);
  if (indent === undefined) return true;
  const level = parseRestrictedYamlLevel(lines, start, end, indent);
  if (level === undefined) return false;
  for (const entry of level.values()) {
    if (entry.value === undefined || (!entry.value.quoted && !pattern.test(entry.value.text))) return false;
  }
  return true;
}

/** Whether every entry of a restricted-grammar two-level block mapping (name -> mapping of scalar values matching `pattern`) over `lines[start, end)` is well-formed. An empty mapping is accepted. */
function validRestrictedNestedMapping(lines: readonly string[], start: number, end: number, pattern: RegExp): boolean {
  const indent = firstIndent(lines, start, end);
  if (indent === undefined) return true;
  const level = parseRestrictedYamlLevel(lines, start, end, indent);
  if (level === undefined) return false;
  for (const entry of level.values()) {
    if (entry.value !== undefined) return false;
    if (!validRestrictedMapping(lines, entry.bodyStart, entry.bodyEnd, pattern)) return false;
  }
  return true;
}

type RestrictedYamlKeyShape =
  | { readonly kind: "inline"; readonly pattern: RegExp }
  | { readonly kind: "sequence"; readonly pattern: RegExp }
  | { readonly kind: "mapping"; readonly pattern: RegExp }
  | { readonly kind: "nestedMapping"; readonly pattern: RegExp };

const PLAIN_SCALAR = /^[A-Za-z0-9._/^~<>=+][A-Za-z0-9._/^~<>=+*@-]*$/;
const BOOL_SCALAR = /^(?:true|false)$/;
const DIGIT_SCALAR = /^[0-9]+$/;

/** `pnpm-workspace.yaml` top-level keys this runner treats as inert, with the shape each must hold (fix 2). None selects a source, registry, transport, hook or executable; the allow-list replaces PNPM_WORKSPACE_UNSAFE_KEYS entirely, so `configDependencies`, every pnpm setting key and `<<` are refused by omission. */
const PNPM_WORKSPACE_KEYS: Readonly<Record<string, RestrictedYamlKeyShape>> = {
  packages: { kind: "sequence", pattern: PLAIN_SCALAR },
  catalog: { kind: "mapping", pattern: PLAIN_SCALAR },
  catalogs: { kind: "nestedMapping", pattern: PLAIN_SCALAR },
  minimumReleaseAge: { kind: "inline", pattern: DIGIT_SCALAR },
  minimumReleaseAgeExclude: { kind: "sequence", pattern: PLAIN_SCALAR },
  onlyBuiltDependencies: { kind: "sequence", pattern: PLAIN_SCALAR },
  ignoredBuiltDependencies: { kind: "sequence", pattern: PLAIN_SCALAR },
};

/** `.yarnrc.yml` top-level keys this runner treats as inert (fix 3). Everything else, including `yarnPath`, `plugins` and every `npm*Registry*`/`npmAuth*`/`httpProxy`/`httpsProxy` key, is unrecognized by omission. */
const YARNRC_KEYS: Readonly<Record<string, RestrictedYamlKeyShape>> = {
  nodeLinker: { kind: "inline", pattern: PLAIN_SCALAR },
  enableTelemetry: { kind: "inline", pattern: /^false$/ },
  enableGlobalCache: { kind: "inline", pattern: BOOL_SCALAR },
  npmMinimalAgeGate: { kind: "inline", pattern: PLAIN_SCALAR },
  npmPreapprovedPackages: { kind: "sequence", pattern: PLAIN_SCALAR },
};

/** `.yarnrc.yml` keys that keep today's registry-config-needs-credential wherever in the document they appear, even nested. */
const YARNRC_CREDENTIAL_KEYS: ReadonlySet<string> = new Set(["npmAuthToken", "npmAuthIdent"]);

/** Every mapping key the restricted-grammar parser can identify anywhere in `text`, ignoring lines it cannot parse. Used only to keep the credential precedence for a key named deep inside an otherwise-refused document. */
function restrictedYamlAllKeys(text: string): string[] {
  const keys: string[] = [];
  for (const raw of text.split("\n")) {
    const trimmedLeft = raw.replace(/^ */, "");
    if (trimmedLeft === "" || trimmedLeft.startsWith("#")) continue;
    const parsed = parseRestrictedYamlLine(raw);
    if (parsed !== undefined && !parsed.sequence && parsed.key !== undefined) keys.push(parsed.key);
  }
  return keys;
}

/** Scans a restricted-grammar YAML document (`pnpm-workspace.yaml` or `.yarnrc.yml`) against `keys`: every top-level key must be plain (never quoted), on the allow-list, and hold its required shape. Returns the first offending key, or undefined when the whole document is accepted. */
function scanRestrictedYamlTopLevel(text: string, keys: Readonly<Record<string, RestrictedYamlKeyShape>>): string | undefined {
  if (!isRestrictedYamlByteSafe(text) || text.includes("${")) return "";
  const lines = text.split("\n");
  const top = parseRestrictedYamlLevel(lines, 0, lines.length, 0);
  if (top === undefined) return "";
  for (const [key, entry] of top) {
    if (key.length === 0 || entry.keyQuoted) return key.length === 0 ? "" : key;
    const shape = keys[key];
    if (shape === undefined) return key;
    if (shape.kind === "inline") {
      if (entry.value === undefined || entry.value.quoted || !shape.pattern.test(entry.value.text)) return key;
      continue;
    }
    if (entry.value !== undefined) return key;
    if (shape.kind === "sequence" && !validRestrictedSequence(lines, entry.bodyStart, entry.bodyEnd, shape.pattern)) return key;
    if (shape.kind === "mapping" && !validRestrictedMapping(lines, entry.bodyStart, entry.bodyEnd, shape.pattern)) return key;
    if (shape.kind === "nestedMapping" && !validRestrictedNestedMapping(lines, entry.bodyStart, entry.bodyEnd, shape.pattern)) return key;
  }
  return undefined;
}

/**
 * Scans repository package-manager configuration against the allow-list grammars above (fixes 1 to 3). A
 * credential finding wins over an unsafe or unrecognized one; a finding from `.npmrc` wins over one from
 * `pnpm-workspace.yaml` (the only two files ever scanned together). Pure; never throws.
 */
export function scanRepositoryConfig(files: RepositoryConfigFiles): RepositoryConfigScan {
  const credential: string[] = [];
  const other: { readonly reason: RepositoryConfigRefusal; readonly finding: string }[] = [];
  let minReleaseAge = false;
  let before = false;
  if (files.npmrc !== undefined) {
    const scan = scanNpmrc(files.npmrc);
    credential.push(...scan.credential);
    for (const finding of scan.unrecognized) other.push({ reason: "package-manager-config-unrecognized", finding });
    minReleaseAge = scan.minReleaseAge;
    before = scan.before;
  }
  if (files.pnpmWorkspace !== undefined) {
    const offending = scanRestrictedYamlTopLevel(files.pnpmWorkspace, PNPM_WORKSPACE_KEYS);
    if (offending !== undefined) other.push({ reason: "package-manager-config-unsafe", finding: offending.length > 0 ? `pnpm-workspace.yaml:${offending}` : "pnpm-workspace.yaml" });
  }
  if (files.yarnrc !== undefined) {
    for (const key of restrictedYamlAllKeys(files.yarnrc)) if (YARNRC_CREDENTIAL_KEYS.has(key)) credential.push(`.yarnrc.yml:${key}`);
    const offending = scanRestrictedYamlTopLevel(files.yarnrc, YARNRC_KEYS);
    if (offending !== undefined && credential.length === 0) other.push({ reason: "package-manager-config-unrecognized", finding: offending.length > 0 ? `.yarnrc.yml:${offending}` : ".yarnrc.yml" });
  }
  if (credential.length > 0) return { refused: true, reason: "registry-config-needs-credential", finding: credential[0] ?? "" };
  if (other.length > 0) return { refused: true, reason: other[0]!.reason, finding: other[0]!.finding };
  return { refused: false, minReleaseAge, before };
}

/** The configuration files each tool reads from the repository root. */
const CONFIG_FILES: Readonly<Record<"npm" | "pnpm" | "yarn", readonly (readonly [keyof RepositoryConfigFiles, string])[]>> = {
  npm: [["npmrc", ".npmrc"]],
  pnpm: [["npmrc", ".npmrc"], ["pnpmWorkspace", "pnpm-workspace.yaml"]],
  yarn: [["yarnrc", ".yarnrc.yml"]],
};

// ---------------------------------------------------------------------------
// Tree footprint
// ---------------------------------------------------------------------------

const sha256hex = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");

/**
 * Every entry under root by relative `/` path, without following links: type, mode, and the sha256
 * of a file or the target of a link. Top-level `.git` is left out; top-level `node_modules` is its
 * sorted entry names only.
 */
async function snapshotTree(root: string): Promise<Map<string, string>> {
  const entries = new Map<string, string>();
  const walk = async (directory: string, relative: string): Promise<void> => {
    const names = (await readdir(directory)).sort(compareCodeUnits);
    for (const name of names) {
      if (relative === "" && name === ".git") continue;
      const path = relative === "" ? name : `${relative}/${name}`;
      const absolute = join(directory, name);
      const stats = await lstat(absolute);
      const mode = (stats.mode & 0o7777).toString(8);
      if (stats.isSymbolicLink()) entries.set(path, `symlink ${mode} ${await readlink(absolute)}`);
      else if (stats.isFile()) entries.set(path, `file ${mode} ${sha256hex(await readFile(absolute))}`);
      else if (stats.isDirectory() && relative === "" && name === "node_modules") entries.set(path, `names ${mode} ${JSON.stringify((await readdir(absolute)).sort(compareCodeUnits))}`);
      else if (stats.isDirectory()) {
        entries.set(path, `dir ${mode}`);
        await walk(absolute, path);
      } else entries.set(path, `other ${mode}`);
    }
  };
  await walk(root, "");
  return entries;
}

function changedPaths(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>, lockfile: string): string[] {
  const paths = new Set<string>();
  for (const [path, entry] of before) if (after.get(path) !== entry) paths.add(path);
  for (const path of after.keys()) if (!before.has(path)) paths.add(path);
  paths.delete(lockfile);
  return [...paths].sort(compareCodeUnits);
}

// ---------------------------------------------------------------------------
// Regeneration
// ---------------------------------------------------------------------------

const LOCKFILE_FORMAT: Readonly<Record<Exclude<LockfileName, "none">, { readonly tool: "npm" | "pnpm" | "yarn"; readonly format: LockfileFormat | null }>> = {
  "package-lock.json": { tool: "npm", format: "npm" },
  "pnpm-lock.yaml": { tool: "pnpm", format: "pnpm" },
  "yarn.lock": { tool: "yarn", format: null },
};

type Tool = "npm" | "pnpm" | "yarn";

const indeterminate = (reason: LockfileRegenIndeterminateReason, tooling: LockfileTooling | null = null, output?: string): LockfileRegenResult =>
  output === undefined ? { verdict: "indeterminate", reason, tooling } : { verdict: "indeterminate", reason, output, tooling };

async function lstatOrNull(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch {
    return null;
  }
}

const nonEmptyEnv = (value: string | undefined): value is string => typeof value === "string" && value.length > 0;

/** Replaces each named path with its token (longest first), then keeps the last LOCKFILE_OUTPUT_TAIL_BYTES bytes on a UTF-8 boundary. */
function outputTail(text: string, replacements: readonly (readonly [string, string])[]): string {
  let redacted = text;
  for (const [path, token] of [...replacements].filter(([path]) => path.length > 0).sort((left, right) => right[0].length - left[0].length)) redacted = redacted.split(path).join(token);
  const bytes = Buffer.from(redacted, "utf8");
  if (bytes.length <= LOCKFILE_OUTPUT_TAIL_BYTES) return redacted;
  let start = bytes.length - LOCKFILE_OUTPUT_TAIL_BYTES;
  while (start < bytes.length && ((bytes[start] ?? 0) & 0xc0) === 0x80) start += 1;
  return bytes.subarray(start).toString("utf8");
}

/** The launcher prefix: npm from PATH, pnpm and Yarn through corepack at the exact version. */
function launcher(tool: Tool, toolVersion: string | null): { readonly command: string; readonly prefix: readonly string[] } {
  return tool === "npm" ? { command: "npm", prefix: [] } : { command: "corepack", prefix: [`${tool}@${toolVersion ?? ""}`] };
}

/**
 * The regeneration arguments. The scope registry is a command-line setting, which outranks every
 * `.npmrc`. pnpm takes it as `--config.<scope>:registry=`: pnpm 10 also accepts `--<scope>:registry=`,
 * but pnpm 12 rejects that spelling as an unknown argument. pnpm always runs with the publishing
 * scope excluded from its release-age window (D25) for this one invocation: pnpm 12's built-in
 * window is non-strict and otherwise records every scoped version it finds too young in
 * `pnpm-workspace.yaml`, a write outside the lockfile. Other packages keep the window.
 */
function regenerateArgs(tool: Tool, scope: string, registry: string, config: { readonly minReleaseAge: boolean; readonly before: boolean }, now: () => Date): string[] {
  if (tool === "npm") {
    return [
      "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund", `--${scope}:registry=${registry}/`,
      ...(config.minReleaseAge ? ["--min-release-age=0"] : []),
      ...(config.before ? [`--before=${now().toISOString()}`] : []),
    ];
  }
  if (tool === "pnpm") return ["install", "--lockfile-only", "--ignore-scripts", "--ignore-pnpmfile", `--config.${scope}:registry=${registry}/`, `--config.minimum-release-age-exclude=${scope}/*`];
  return ["install", "--mode=update-lockfile"];
}

/** Regenerates the lockfile under a sanitized environment and checks I1 to I5 against baseLockfile. Never reverts, repairs or retries. */
export async function regenerateLockfile(input: LockfileRegenInput, ports: LockfileRegenPorts = {}): Promise<LockfileRegenResult> {
  // 1. Preconditions: nothing runs until these hold.
  if (input.packageManager === "none") return indeterminate("manifest-absent");
  const { root } = input;
  if (!isAbsolute(root)) return indeterminate("root-not-canonical");
  const rootStats = await lstatOrNull(root);
  if (rootStats === null || rootStats.isSymbolicLink() || !rootStats.isDirectory()) return indeterminate("root-not-canonical");
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    return indeterminate("root-not-canonical");
  }
  if (realRoot !== root) return indeterminate("root-not-canonical");
  const manifest = await lstatOrNull(join(root, "package.json"));
  if (manifest === null || !manifest.isFile()) return indeterminate("manifest-absent");
  const lockfile = lockfilePath({ packageManager: input.packageManager, lockfile: input.lockfile });
  if (input.lockfile === "none" || lockfile === null || input.baseLockfile === "") return indeterminate("lockfile-absent");
  const { tool, format } = LOCKFILE_FORMAT[input.lockfile];
  if (tool !== input.packageManager) return indeterminate("lockfile-format-unsupported");
  const lockfileAbsolute = join(root, lockfile);
  const lockfileStats = await lstatOrNull(lockfileAbsolute);
  if (lockfileStats === null) return indeterminate("lockfile-absent");
  if (!lockfileStats.isFile()) return indeterminate("lockfile-is-link");
  let current: Buffer;
  try {
    current = await readFile(lockfileAbsolute);
  } catch {
    return indeterminate("lockfile-unreadable");
  }
  if (!current.equals(Buffer.from(input.baseLockfile, "utf8"))) return { verdict: "violated", rule: "lockfile-not-at-base", violations: [], paths: [], tooling: null };

  // 2. Tool version: exact, and never Yarn classic.
  if (input.toolVersion !== null && !EXACT_VERSION.test(input.toolVersion)) return indeterminate("package-manager-version-unknown");
  if (tool !== "npm" && input.toolVersion === null) return indeterminate("package-manager-version-unknown");
  if (tool === "yarn" && input.toolVersion?.split(".")[0] === "1") return indeterminate("package-manager-unsupported");

  // 3. Repository configuration.
  const files: { -readonly [key in keyof RepositoryConfigFiles]: string } = {};
  for (const [key, name] of CONFIG_FILES[tool]) {
    const stats = await lstatOrNull(join(root, name));
    if (stats === null) continue;
    if (!stats.isFile()) return indeterminate("package-manager-config-unsafe");
    files[key] = await readFile(join(root, name), "utf8");
  }
  const config = scanRepositoryConfig(files);
  if (config.refused) return indeterminate(config.reason);

  // 4 to 6. Scratch, environment, registry, launch.
  const registry = (ports.registry ?? PACKAGE_SCOPE.registry).replace(/\/+$/, "");
  const scope = PACKAGE_SCOPE.scope;
  const run = ports.spawn ?? spawnLockfileTool;
  const scratch = await prepareLockfileScratch();
  try {
    const env = lockfileToolEnv({ tool, scratch: scratch.path, registry, corepack: tool !== "npm", parent: process.env });
    let realScratch = scratch.path;
    try {
      realScratch = await realpath(scratch.path);
    } catch {
      // The literal path is still redacted.
    }
    const redactions: (readonly [string, string])[] = [
      [scratch.path, "$SCRATCH"],
      [realScratch, "$SCRATCH"],
      [root, "$ROOT"],
      [homedir(), "$HOME"],
      ...(nonEmptyEnv(process.env.COREPACK_HOME) ? ([[process.env.COREPACK_HOME as string, "$COREPACK_HOME"]] as const) : []),
    ];
    const { command, prefix } = launcher(tool, input.toolVersion);
    const launch = (args: readonly string[], cwd: string): Promise<LockfileSpawnResult> =>
      run({ command, args: [...prefix, ...args], cwd, env, timeoutMs: LOCKFILE_TOOL_TIMEOUT_MS, maxBuffer: LOCKFILE_TOOL_MAX_BUFFER });

    const before = await snapshotTree(root);
    // The probe runs in scratch: pnpm 10 loads the working directory's .pnpmfile.cjs even for --version.
    const probe = await launch(["--version"], scratch.path);
    if (probe.failure === "not-found") return indeterminate("tool-unavailable", { tool, version: null });
    // The first line only: a tool may append a notice after the version.
    const firstLine = probe.stdout.trim().split(/\r?\n/)[0]?.trim() ?? "";
    const version = probe.failure === undefined && probe.status === 0 && firstLine !== "" ? firstLine : null;
    const tooling: LockfileTooling = { tool, version };

    const result = await launch(regenerateArgs(tool, scope, registry, config, input.now), root);
    if (result.failure === "not-found") return indeterminate("tool-unavailable", tooling);
    if (result.failure === "timeout") return indeterminate("tool-timeout", tooling, outputTail(result.stdout + result.stderr, redactions));
    if (result.status !== 0) return indeterminate("tool-failed", tooling, outputTail(result.stdout + result.stderr, redactions));

    // 7. Bounded footprint.
    const paths = changedPaths(before, await snapshotTree(root), lockfile);
    if (paths.length > 0) return { verdict: "violated", rule: "tree-changed-outside-lockfile", violations: [], paths, tooling };
    if (format === null) return indeterminate("package-manager-unsupported", tooling);

    // 8. Invariants.
    const afterStats = await lstatOrNull(lockfileAbsolute);
    if (afterStats === null) return indeterminate("lockfile-unreadable", tooling);
    if (!afterStats.isFile()) return indeterminate("lockfile-is-link", tooling);
    let regeneratedBytes: Buffer;
    try {
      regeneratedBytes = await readFile(lockfileAbsolute);
    } catch {
      return indeterminate("lockfile-unreadable", tooling);
    }
    const regenerated = regeneratedBytes.toString("utf8");
    const checked = checkLockfileInvariants({
      format,
      base: input.baseLockfile,
      regenerated,
      packages: input.packages,
      ...(ports.registry === undefined ? {} : { publishing: { scope, registry } }),
    });
    if (checked.verdict === "indeterminate") return indeterminate(checked.reason, tooling);
    if (checked.verdict === "violated") return { verdict: "violated", rule: "lockfile-invariants", violations: checked.violations, paths: [], tooling };
    return { verdict: "satisfied", path: lockfile, before: sha256hex(input.baseLockfile), after: sha256hex(regeneratedBytes), tooling, transitive: checked.transitive };
  } finally {
    await scratch.remove();
  }
}
