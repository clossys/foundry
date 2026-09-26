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

/**
 * The default spawn port: node:child_process spawn with shell false, SIGKILL on timeout, capped capture.
 * Off Windows the child leads its own process group, so the kill reaches any grandchild holding the pipes open.
 */
export function spawnLockfileTool(request: LockfileSpawnRequest): Promise<LockfileSpawnResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const stdout = cappedSink(request.maxBuffer);
    const stderr = cappedSink(request.maxBuffer);
    const group = process.platform !== "win32";
    let settled = false;
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    const settle = (result: LockfileSpawnResult): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
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

export type RepositoryConfigRefusal = "registry-config-needs-credential" | "package-manager-config-unsafe";

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

/** `.npmrc` keys (lowercase, bare) that carry or select a credential. */
const NPMRC_CREDENTIAL_KEYS: ReadonlySet<string> = new Set(["_auth", "_authtoken", "_password", "username", "certfile", "keyfile"]);
/** `.npmrc` keys (lowercase, `_` read as `-`) that run code, change transport trust, or load a pnpm hook. */
const NPMRC_UNSAFE_KEYS: ReadonlySet<string> = new Set(["git", "script-shell", "shell", "node-options", "onload-script", "pnpmfile", "global-pnpmfile", "ca", "cafile", "proxy", "https-proxy"]);
const PNPM_WORKSPACE_UNSAFE_KEYS: ReadonlySet<string> = new Set(["configDependencies", "<<"]);
const YARNRC_CREDENTIAL_KEYS = ["npmAuthToken", "npmAuthIdent"] as const;
const YARNRC_UNSAFE_KEYS: ReadonlySet<string> = new Set(["yarnPath", "plugins", "<<"]);

interface NpmrcLine {
  /** Lowercase, surrounding quotes and a trailing `[]` removed. */
  readonly key: string;
  readonly value: string;
}

const unquote = (text: string): string => (text.length >= 2 && (text[0] === '"' || text[0] === "'") && text.at(-1) === text[0] ? text.slice(1, -1) : text);

/** Reads `.npmrc` as npm's ini does: full-line `#`/`;` comments, `key = value`, a bare key is `true`. Section headers are skipped; their keys are still read. */
function npmrcLines(text: string): NpmrcLine[] {
  const lines: NpmrcLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
    if (line.startsWith("[") && line.endsWith("]")) continue;
    const equals = line.indexOf("=");
    const rawKey = (equals === -1 ? line : line.slice(0, equals)).trim();
    const value = equals === -1 ? "true" : unquote(line.slice(equals + 1).trim());
    lines.push({ key: unquote(rawKey).replace(/\[\]$/, "").toLowerCase(), value });
  }
  return lines;
}

/** YAML lines with full-line comments and document markers dropped. */
function yamlContentLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => !/^\s*#/.test(line) && line.trim() !== "" && !/^(?:---|\.\.\.)\s*$/.test(line));
}

/**
 * Top-level mapping keys of a YAML document, read without a parser: block keys at column 0
 * (plain, quoted or `? ` explicit). A flow-mapping document (`{...}`) yields every `key:` it holds,
 * which over-reads rather than under-reads.
 */
function yamlTopLevelKeys(text: string): string[] {
  const lines = yamlContentLines(text);
  const keys: string[] = [];
  if (lines[0]?.trimStart().startsWith("{") === true) {
    for (const match of lines.join("\n").matchAll(/["']?([^\s"',{}:]+|<<)["']?\s*:/g)) keys.push(match[1] ?? "");
    return keys;
  }
  for (const line of lines) {
    if (/^\s/.test(line) || line.startsWith("-")) continue;
    const explicit = /^\?\s+(.*)$/.exec(line);
    if (explicit !== null) { keys.push(unquote((explicit[1] ?? "").trim())); continue; }
    const quoted = /^(["'])(.*?)\1\s*:/.exec(line);
    if (quoted !== null) { keys.push(quoted[2] ?? ""); continue; }
    const plain = /^([^:#]+?)\s*:(?:\s|$)/.exec(line);
    if (plain !== null) keys.push(plain[1] ?? "");
  }
  return keys;
}

/**
 * Scans repository package-manager configuration against closed key lists. A credential finding
 * wins over an unsafe one. Pure; never throws.
 */
export function scanRepositoryConfig(files: RepositoryConfigFiles): RepositoryConfigScan {
  const credential: string[] = [];
  const unsafe: string[] = [];
  let minReleaseAge = false;
  let before = false;
  if (files.npmrc !== undefined) {
    if (files.npmrc.includes("${")) credential.push(".npmrc:${");
    for (const { key, value } of npmrcLines(files.npmrc)) {
      const bare = key.slice(key.lastIndexOf(":") + 1);
      const normalized = key.replace(/_/g, "-");
      if (key.startsWith("//") || NPMRC_CREDENTIAL_KEYS.has(bare)) credential.push(`.npmrc:${key}`);
      if (NPMRC_UNSAFE_KEYS.has(normalized) || (normalized === "strict-ssl" && value.toLowerCase() === "false")) unsafe.push(`.npmrc:${key}`);
      if (normalized === "min-release-age") minReleaseAge = true;
      if (normalized === "before") before = true;
    }
  }
  if (files.pnpmWorkspace !== undefined) {
    for (const key of yamlTopLevelKeys(files.pnpmWorkspace)) if (PNPM_WORKSPACE_UNSAFE_KEYS.has(key)) unsafe.push(`pnpm-workspace.yaml:${key}`);
  }
  if (files.yarnrc !== undefined) {
    if (files.yarnrc.includes("${")) credential.push(".yarnrc.yml:${");
    const content = yamlContentLines(files.yarnrc).join("\n");
    for (const key of YARNRC_CREDENTIAL_KEYS) if (content.includes(key)) credential.push(`.yarnrc.yml:${key}`);
    for (const key of yamlTopLevelKeys(files.yarnrc)) if (YARNRC_UNSAFE_KEYS.has(key)) unsafe.push(`.yarnrc.yml:${key}`);
  }
  if (credential.length > 0) return { refused: true, reason: "registry-config-needs-credential", finding: credential[0] ?? "" };
  if (unsafe.length > 0) return { refused: true, reason: "package-manager-config-unsafe", finding: unsafe[0] ?? "" };
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
    const redactions: (readonly [string, string])[] = [[scratch.path, "$SCRATCH"], [realScratch, "$SCRATCH"], [root, "$ROOT"]];
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
