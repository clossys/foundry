// Observing one local clone as a RepositoryObservation (RFC apply-approved-plan
// §7 V4 and V7, issue #1178): the read side of the apply planner. It reports
// the committed head of a clean clone, as the clone's object database stores
// it, whose origin is the repository the inventory id names, and nothing else. The clone's working tree is never
// read: every byte comes from a git object at the head commit, so an edit that
// is not committed, or a file that is ignored, is not observed.
//
// The clone is untrusted content, and the rule is: this repository's own object
// database and refs are read through git plumbing, never the working tree and
// never an alternate object store, `commondir` or submodule repository;
// anything unusual is refused, not interpreted. Its `.git/config` is read as
// data, never executed, and refused unless every key is one a plain clone
// carries; a clone that names an alternate object store, or holds a split
// index's shared file (git rewrites its mtime on every index read), is refused;
// only then does a git command run inside it, with every hook, filesystem
// monitor and pager switched off. git inside the clone reads no configuration but the
// vetted `.git/config` and fixed `-c` overrides: the system and global
// configuration and the environment's configuration variables are pinned or
// removed. What the object database holds is trusted to match its ids, as the
// clone's object database stores it. The committed
// tree is listed, and a submodule refused, before any command that reads the
// working tree runs, and none of those considers a submodule. The origin's tip
// is asked with `git ls-remote`, which writes no ref and no object, from a
// directory outside the clone. It performs no write to the clone, and none
// anywhere except one empty scratch directory under the system temporary
// directory, removed before it returns. The clone is not locked, and the checks
// are not repeated after the reads: a process that changes the clone in
// between goes unnoticed, which changes nothing reported, since every byte is
// an object at the remote tip's commit (see the README's declared limits).
//
// Anything that cannot be established is a skip with a reason id, never a
// guess. A skip is `violated` when the clone is what it must not be (dirty,
// on another branch, behind or ahead of the origin, hostile), and
// `indeterminate` when this module could not tell. It never throws for what a
// repository contains; a port that throws is a skip too.

import { spawnSync } from "node:child_process";
import { accessSync, constants, lstatSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import type { Stats } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { PACKAGE_SCOPE } from "./generated/package-scope.generated.js";
import { LEDGER_PATH, SKILLS_MANIFEST_PATH, TEMPLATE_PATHS, compareCodeUnits, compareTuples, contentDigest, matchesPathPattern } from "./change-set-contract.js";
import type {
  DependencyPlacement, DiscoveryRoot, LockfileName, PackageManagerKind, PinnedPackage, ReleaseAgeSurfaceKind, RepositoryProfileObservation, RepositoryVisibility,
} from "./change-set-contract.js";
import { parseGitHubRemote } from "./core.js";
import { sameRepository } from "./identity.js";
import { readInstalledLedger } from "./ledger-contract.js";
import { isUnreadable, readLockfile } from "./lockfile-readers.js";
import type { LockfileFormat, LockfileView, RootDependency } from "./lockfile-readers.js";
import type { RepositoryObservation, SkippedRepositoryObservation } from "./plan-bundle.js";
import { loadContract } from "./plan-contract.js";
import { wouldViolateRootEntries } from "./root-entries.js";
import { editReleaseAgeExemption } from "./release-age-edit.js";
import { isSupportedStarterVersion } from "./setup-templates.js";

export interface RepositoryObservationPorts {
  /** GitHub's immutable node id for the repository `id` names. May throw or reject. */
  readonly nodeId: (id: string) => string | Promise<string>;
  readonly visibility: (id: string) => RepositoryVisibility | Promise<RepositoryVisibility>;
  /**
   * An origin URL as `owner/name`, or null. Defaults to a parser of exactly the
   * https and ssh GitHub URLs, with which only those two transports fetch; a
   * mapper given here is what lets a local path be fetched, so tests use one for
   * local bare origins.
   */
  readonly originId?: (url: string) => string | null;
}

export interface ObserveRepositoryInput {
  /** The inventory id, `owner/name` or a bare name. */
  readonly id: string;
  /** The path of the local clone. */
  readonly clone: string;
  /** Qualifies a bare id; a bare id without it is skipped. */
  readonly hubOwner?: string;
  readonly ports: RepositoryObservationPorts;
}

/** Every reason an observation is skipped, with the verdict it carries. */
const SKIPS = {
  "clone-missing": "indeterminate",
  "clone-unreadable": "indeterminate",
  "id-owner-unknown": "indeterminate",
  "remote-tip-unreadable": "indeterminate",
  "node-id-unavailable": "indeterminate",
  "visibility-unavailable": "indeterminate",
  "tree-too-large": "indeterminate",
  "submodule-present": "indeterminate",
  "manifest-unreadable": "indeterminate",
  "lockfile-ambiguous": "indeterminate",
  "package-manager-unknown": "indeterminate",
  "lockfile-unreadable": "indeterminate",
  "release-age-surface-invalid": "indeterminate",
  "agents-link-unreportable": "indeterminate",
  "observation-too-large": "indeterminate",
  "case-variant-owned-path": "indeterminate",
  "ledger-unreadable": "indeterminate",
  "profile-ambiguous": "indeterminate",
  "invalid-id": "violated",
  "clone-config-unsafe": "violated",
  "origin-mismatch": "violated",
  "not-on-default-branch": "violated",
  "remote-tip-mismatch": "violated",
  "working-tree-dirty": "violated",
  "package-manager-conflict": "violated",
} as const satisfies Record<string, "violated" | "indeterminate">;

type SkipReason = keyof typeof SKIPS;

/** Ends the observation with a skip; caught in observeRepository() and nowhere else. */
class Refusal extends Error {
  constructor(readonly reason: SkipReason) {
    super(reason);
  }
}

function refuse(reason: SkipReason): never {
  throw new Refusal(reason);
}

const KIB = 1024;
const MIB = 1024 * KIB;
const GIT_TIMEOUT_MS = 60_000;
const SMALL_OUTPUT = MIB;
const MAX_TREE_BYTES = 64 * MIB;
const MAX_TREE_ENTRIES = 200_000;
const MAX_BLOB_BYTES = 4 * MIB;
const MAX_LOCKFILE_BYTES = 32 * MIB;
const MAX_READ_BYTES = 64 * MIB;
const MAX_OWNED_FILES = 5000;
const MAX_JSON_DEPTH = 256;

const ID_PATTERN = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/)?(?!\.\.?$)[A-Za-z0-9._-]+$/u;
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const NODE_ID_PATTERN = /^[A-Za-z0-9_=+/-]+$/u;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const BRANCH_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
const INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/u;
const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const PACKAGE_MANAGER_FIELD = /^(npm|pnpm|yarn)@\S+$/u;
const AGENTS_LINK = /^\.agents(?:\/skills(?:\/clossys-[^/\\\u0000-\u001f]+)?)?$/u;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;

const LOCKFILES: readonly { readonly name: Exclude<LockfileName, "none">; readonly manager: Exclude<PackageManagerKind, "none"> }[] = [
  { name: "package-lock.json", manager: "npm" },
  { name: "pnpm-lock.yaml", manager: "pnpm" },
  { name: "yarn.lock", manager: "yarn" },
];
/** Lockfiles of managers this module does not read: their presence makes the package manager ambiguous. */
const OTHER_LOCKFILES: readonly string[] = ["npm-shrinkwrap.json", "bun.lock", "bun.lockb"];
const RELEASE_AGE_SURFACES: readonly { readonly surface: ReleaseAgeSurfaceKind; readonly path: string }[] = [
  { surface: "pnpm-workspace", path: "pnpm-workspace.yaml" },
  { surface: "yarnrc", path: ".yarnrc.yml" },
  { surface: "npmrc", path: ".npmrc" },
];
const DISCOVERY: readonly DiscoveryRoot[] = [".claude/skills", ".cursor/skills"];
const PROFILE_ROOTS: readonly string[] = ["clossys", ".agents", ".claude", ".cursor"];
/** The roots a setup set adds beside them: its workflows and scripts, and its Starter request. */
const SETUP_PROFILE_ROOTS: readonly string[] = [".github", ".starter"];
const NPMRC_PATH = ".npmrc";
const PNPM_WORKSPACE_PATH = "pnpm-workspace.yaml";
const PROFILE_NAMES: ReadonlySet<string> = new Set(["repository-profile.json", "repository-declaration.json"]);
const PROFILE_FIRST = "governance/repository-profile.json";
const PROFILE_SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([".git", "node_modules", "dist", "build", ".next", "coverage", ".turbo", ".cache"]);
const STARTER = `${PACKAGE_SCOPE.scope}/starter`;

// ---- git ------------------------------------------------------------------

const GIT_OPTIONS: readonly string[] = [
  "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "core.pager=cat", "-c", "core.untrackedCache=false", "-c", "protocol.ext.allow=never", "--no-pager",
];
/** Variables that would point git at another repository, object store or configuration than the clone's own. */
const GIT_REMOVED_ENV: readonly string[] = [
  "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_NAMESPACE", "GIT_REPLACE_REF_BASE", "GIT_GRAFT_FILE",
  "GIT_SHALLOW_FILE", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_SYSTEM", "GIT_ATTR_SOURCE", "GIT_EXTERNAL_DIFF",
];
/**
 * The configuration variables `git ls-remote` alone receives: `GIT_CONFIG_COUNT`
 * and the numbered key and value variables it reads. They are the operator's own
 * environment, the same trust as the global git config file `ls-remote` keeps,
 * and they cannot loosen a fixed `-c` override or `GIT_ALLOW_PROTOCOL`, which
 * both win over them.
 */
const GIT_COUNTED_CONFIG_ENV = /^GIT_CONFIG_(?:COUNT|(?:KEY|VALUE)_.*)$/iu;
/** git's own test switches (`GIT_TEST_SPLIT_INDEX` forces a split index on an index write, for one): never passed on to any git command. */
const GIT_TEST_ENV = /^GIT_TEST_/iu;
/** The transports a fetch may use when the default origin parser named the origin: exactly the two GitHub serves. */
const REMOTE_PROTOCOLS = "https:ssh";

interface GitRun {
  /** The exit status, or -1 when git did not run to completion (no git, a timeout, output over the bound). */
  readonly status: number;
  readonly stdout: Buffer;
  /** Whether the output was cut off at the bound. */
  readonly overflow: boolean;
}

/**
 * The git executable as an absolute path, found once per PATH value among the
 * entries that are absolute and not empty. An empty entry, or a relative one,
 * would search the directory git runs in, and for a command run inside the
 * clone that directory is the repository's own content.
 */
let resolvedGit: { readonly searched: string; readonly binary: string | null } | null = null;

function gitBinary(): string | null {
  const searched = process.env.PATH ?? process.env.Path ?? "";
  if (resolvedGit !== null && resolvedGit.searched === searched) return resolvedGit.binary;
  const name = process.platform === "win32" ? "git.exe" : "git";
  let binary: string | null = null;
  for (const directory of searched.split(delimiter)) {
    if (directory === "" || !isAbsolute(directory)) continue;
    const candidate = join(directory, name);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      binary = candidate;
      break;
    } catch {
      continue;
    }
  }
  resolvedGit = { searched, binary };
  return binary;
}

/**
 * git inside the clone reads no configuration but the vetted `.git/config` and
 * fixed `-c` overrides: the system and global configuration are switched off,
 * and every other source the environment names is removed
 * (`GIT_CONFIG_COUNT` and its numbered key and value variables,
 * `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_SYSTEM`). `ls-remote`, which runs outside
 * the clone, keeps the operator's global and system git config files
 * (credential helpers, proxy) and is given `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_n`
 * and `GIT_CONFIG_VALUE_n`, so an origin that needs credentials supplied through
 * them is observed; `GIT_CONFIG_PARAMETERS` (git's own encoding of `-c` for its
 * children, not an interface) and `GIT_CONFIG_SYSTEM` are not forwarded to it,
 * and an origin that needs either is skipped as `remote-tip-unreadable`. git's
 * `GIT_TEST_*` switches reach no command.
 */
function gitEnvironment(cwd: string, protocols: string, remote: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of GIT_REMOVED_ENV) delete env[name];
  for (const name of Object.keys(env)) {
    if (GIT_TEST_ENV.test(name) || (!remote && GIT_COUNTED_CONFIG_ENV.test(name))) delete env[name];
  }
  return {
    ...env,
    ...(remote ? {} : { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }),
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_PAGER: "cat",
    GIT_ALLOW_PROTOCOL: protocols,
    // A repository above `cwd` is never discovered: a directory beside the clone cannot stand in for it.
    GIT_CEILING_DIRECTORIES: dirname(cwd),
    LC_ALL: "C",
  };
}

function git(cwd: string, args: readonly string[], maxBuffer: number = SMALL_OUTPUT, protocols: string = REMOTE_PROTOCOLS, remote = false): GitRun {
  const binary = gitBinary();
  if (binary === null) return { status: -1, stdout: Buffer.alloc(0), overflow: false };
  const run = spawnSync(binary, [...GIT_OPTIONS, ...args], {
    cwd,
    env: gitEnvironment(cwd, protocols, remote),
    shell: false,
    stdio: ["ignore", "pipe", "ignore"],
    timeout: GIT_TIMEOUT_MS,
    maxBuffer,
    encoding: "buffer",
    windowsHide: true,
  });
  const overflow = (run.error as NodeJS.ErrnoException | undefined)?.code === "ENOBUFS";
  return { status: run.error === undefined ? (run.status ?? -1) : -1, stdout: run.stdout ?? Buffer.alloc(0), overflow };
}

function gitText(cwd: string, args: readonly string[]): string | null {
  const run = git(cwd, args);
  return run.status === 0 && !run.overflow ? run.stdout.toString("utf8") : null;
}

// ---- the id and the clone ---------------------------------------------------

function checkId(id: string, hubOwner: string | undefined): void {
  if (!ID_PATTERN.test(id)) refuse("invalid-id");
  if (!id.includes("/") && (hubOwner === undefined || !OWNER_PATTERN.test(hubOwner))) refuse("id-owner-unknown");
}

/** The clone's real path, once it is a real directory holding a real `.git` directory of its own, with an object database of its own. */
function locateClone(clone: string): string {
  const stat = statOf(clone, "clone-missing");
  if (!stat.isDirectory()) refuse("clone-unreadable");
  const gitDir = join(clone, ".git");
  if (!statOf(gitDir, "clone-unreadable").isDirectory()) refuse("clone-unreadable");
  // A regular config file, and no `commondir` redirecting git to another directory's configuration.
  if (!statOf(join(gitDir, "config"), "clone-unreadable").isFile()) refuse("clone-unreadable");
  if (isPresent(join(gitDir, "commondir"))) refuse("clone-unreadable");
  // Objects that are the clone's own: a real directory, and no list of other stores to read from.
  if (!statOf(join(gitDir, "objects"), "clone-unreadable").isDirectory()) refuse("clone-unreadable");
  for (const name of ["alternates", "http-alternates"]) if (isPresent(join(gitDir, "objects", "info", name))) refuse("clone-config-unsafe");
  // A split index: git freshens the shared file's mtime on every index read, which would be a write to the clone.
  if (holdsSharedIndex(gitDir)) refuse("clone-config-unsafe");
  try {
    return realpathSync(clone);
  } catch {
    return refuse("clone-unreadable");
  }
}

/** Whether the git directory holds a `sharedindex.*` entry of any type, by listing it: no shell glob, and no git command. */
function holdsSharedIndex(gitDir: string): boolean {
  try {
    return readdirSync(gitDir).some((name) => name.toLowerCase().startsWith("sharedindex."));
  } catch {
    return refuse("clone-unreadable");
  }
}

/** Whether anything, of any type, is at `path`; an error other than absence is a refusal. */
function isPresent(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    return refuse("clone-unreadable");
  }
}

function statOf(path: string, absent: SkipReason): Stats {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) refuse("clone-unreadable");
    return stat;
  } catch (cause) {
    if (cause instanceof Refusal) throw cause;
    const code = (cause as NodeJS.ErrnoException).code;
    return refuse(code === "ENOENT" || code === "ENOTDIR" ? absent : "clone-unreadable");
  }
}

// ---- .git/config, read as data -------------------------------------------------

interface ConfigEntry {
  readonly key: string;
  /** Null for a key written without a value. */
  readonly value: string | null;
}

const CONFIG_CORE: ReadonlySet<string> = new Set(["repositoryformatversion", "filemode", "bare", "logallrefupdates", "ignorecase", "precomposeunicode", "symlinks"]);
const CONFIG_REMOTE: ReadonlySet<string> = new Set(["url", "fetch", "gh-resolved"]);
const CONFIG_BRANCH: ReadonlySet<string> = new Set(["remote", "merge", "rebase", "vscode-merge-base", "github-pr-owner-number"]);
const CONFIG_USER: ReadonlySet<string> = new Set(["name", "email"]);

function readConfig(clone: string, neutral: string): ConfigEntry[] {
  const run = git(neutral, ["config", "--file", join(clone, ".git", "config"), "--no-includes", "--list", "-z"]);
  if (run.status !== 0 || run.overflow) return refuse("clone-unreadable");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(run.stdout);
  } catch {
    return refuse("clone-config-unsafe");
  }
  const records = text.split("\0");
  if (records.pop() !== "") return refuse("clone-unreadable");
  return records.map((record) => {
    const newline = record.indexOf("\n");
    return newline === -1 ? { key: record, value: null } : { key: record.slice(0, newline), value: record.slice(newline + 1) };
  });
}

/** Whether a key is one a plain clone carries. What is not recognised is refused: the set of keys that run something is unbounded. */
function isPlainCloneKey({ key, value }: ConfigEntry): boolean {
  const first = key.indexOf(".");
  const last = key.lastIndexOf(".");
  if (first < 1 || last === key.length - 1) return false;
  const section = key.slice(0, first).toLowerCase();
  const variable = key.slice(last + 1).toLowerCase();
  const subsection = first === last ? null : key.slice(first + 1, last);
  if (section === "core") {
    if (subsection !== null || !CONFIG_CORE.has(variable)) return false;
    if (variable === "repositoryformatversion") return value === "0";
    if (variable === "bare") return value === "false";
    return true;
  }
  if (section === "user") return subsection === null && CONFIG_USER.has(variable);
  if (subsection === null || subsection === "") return false;
  if (section === "remote") return CONFIG_REMOTE.has(variable);
  if (section === "branch") return CONFIG_BRANCH.has(variable);
  return false;
}

function checkConfig(entries: readonly ConfigEntry[]): void {
  if (!entries.every(isPlainCloneKey)) refuse("clone-config-unsafe");
}

// ---- origin and the remote tip -------------------------------------------------

function originUrl(entries: readonly ConfigEntry[]): string {
  const urls = entries.filter((entry) => entry.key === "remote.origin.url");
  const only = urls.length === 1 ? urls[0]!.value : null;
  // git would read a value that is padded or holds a control character as a different URL than the mapper judged.
  if (only === null || only === "" || only !== only.trim() || CONTROL.test(only)) return refuse("origin-mismatch");
  return only;
}

/** The exact forms of a GitHub origin: https, scp-style ssh and `ssh://`, with an owner and a name and nothing more. */
const GITHUB_HTTPS = /^https:\/\/github\.com\/([^/?#@:\s]+)\/([^/?#@:\s]+)$/u;
const GITHUB_SSH = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/)([^/?#@:\s]+)\/([^/?#@:\s]+)$/u;

/** An origin URL as `owner/name` when it is exactly an https or ssh GitHub URL; any other scheme, host, port, user, extra path, query or fragment is null. */
export function defaultOriginId(url: string): string | null {
  const match = GITHUB_HTTPS.exec(url) ?? GITHUB_SSH.exec(url);
  if (match === null) return null;
  const parsed = parseGitHubRemote(`https://github.com/${match[1]}/${match[2]}`);
  return parsed === null ? null : `${parsed.owner}/${parsed.repository}`;
}

function checkOrigin(url: string, id: string, hubOwner: string | undefined, originId: (url: string) => string | null): void {
  let named: string | null;
  try {
    named = originId(url);
  } catch {
    return refuse("origin-mismatch");
  }
  if (typeof named !== "string" || !ID_PATTERN.test(named) || !named.includes("/") || !sameRepository(named, id, hubOwner)) refuse("origin-mismatch");
}

function safeBranch(branch: string): boolean {
  if (!BRANCH_SHAPE.test(branch) || /[:+*]/u.test(branch)) return false;
  return !branch.includes("..") && !branch.includes("//") && !branch.endsWith("/") && !branch.includes(".lock");
}

/** The origin's default branch and its tip, from `git ls-remote`: it writes no ref and no object anywhere. */
function remoteTip(url: string, neutral: string, protocols: string): { readonly branch: string; readonly oid: string } {
  const run = git(neutral, ["ls-remote", "--symref", "--", url, "HEAD"], SMALL_OUTPUT, protocols, true);
  if (run.status !== 0 || run.overflow) return refuse("remote-tip-unreadable");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(run.stdout);
  } catch {
    return refuse("remote-tip-unreadable");
  }
  const symrefs: string[] = [];
  const oids: string[] = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const symref = /^ref: (\S+)\t(\S+)$/u.exec(line);
    const oid = /^([0-9a-f]+)\t(\S+)$/u.exec(line);
    if (symref !== null) {
      if (symref[2] === "HEAD") symrefs.push(symref[1]!);
    } else if (oid !== null) {
      if (oid[2] === "HEAD") oids.push(oid[1]!);
    } else return refuse("remote-tip-unreadable");
  }
  const target = symrefs.length === 1 ? symrefs[0]! : "";
  const branch = target.startsWith("refs/heads/") ? target.slice("refs/heads/".length) : "";
  const tip = oids.length === 1 ? oids[0]! : "";
  if (!safeBranch(branch) || !OBJECT_ID.test(tip)) return refuse("remote-tip-unreadable");
  return { branch, oid: tip };
}

// ---- the local clone against the remote tip ----------------------------------------

/** git's own view of the clone: its work tree is `clone`, its git directory is `clone/.git`, and it is not bare. Runs only after the configuration passed. */
function checkRepositoryShape(clone: string): void {
  const text = gitText(clone, ["rev-parse", "--show-toplevel", "--is-bare-repository", "--absolute-git-dir"]);
  const lines = text === null ? [] : text.split("\n");
  if (lines.length !== 4 || lines[3] !== "") return refuse("clone-unreadable");
  try {
    if (realpathSync(lines[0]!) !== clone || lines[1] !== "false" || realpathSync(lines[2]!) !== join(clone, ".git")) refuse("clone-unreadable");
  } catch (cause) {
    if (cause instanceof Refusal) throw cause;
    refuse("clone-unreadable");
  }
}

function checkHead(clone: string, tip: { readonly branch: string; readonly oid: string }): void {
  const symbolic = git(clone, ["symbolic-ref", "-q", "HEAD"]);
  if (symbolic.status === 1) refuse("not-on-default-branch");
  if (symbolic.status !== 0 || symbolic.overflow) refuse("clone-unreadable");
  if (symbolic.stdout.toString("utf8").trim() !== `refs/heads/${tip.branch}`) refuse("not-on-default-branch");
  const head = git(clone, ["rev-parse", "--verify", "-q", `refs/heads/${tip.branch}^{commit}`]);
  const local = head.status === 0 && !head.overflow ? head.stdout.toString("utf8").trim() : "";
  if (!OBJECT_ID.test(local)) refuse("clone-unreadable");
  if (local !== tip.oid) refuse("remote-tip-mismatch");
}

/**
 * The index, read as data: no entry is a submodule, and none carries a flag
 * that hides an edit from `git status` (skip-worktree, assume-unchanged) or is
 * unmerged. Reads the index file only, and neither the working tree nor a
 * submodule.
 */
function checkIndex(clone: string): void {
  const run = git(clone, ["ls-files", "-v", "-s", "-z"], MAX_TREE_BYTES);
  if (run.overflow) refuse("tree-too-large");
  if (run.status !== 0) refuse("clone-unreadable");
  let submodule = false;
  let hidden = false;
  let position = 0;
  while (position < run.stdout.length) {
    let end = run.stdout.indexOf(0, position);
    if (end === -1) end = run.stdout.length;
    const record = run.stdout.subarray(position, end);
    position = end + 1;
    const tab = record.indexOf(9);
    const header = tab === -1 ? null : INDEX_HEADER.exec(record.subarray(0, tab).toString("latin1"));
    if (header === null) return refuse("clone-unreadable");
    const [, tag, mode, stage] = header as unknown as [string, string, string, string];
    if (mode === "160000") submodule = true;
    // `H` is a cached entry with nothing hidden; anything else is a flag that keeps status from looking.
    if (tag !== "H" || stage !== "0") hidden = true;
  }
  if (submodule) refuse("submodule-present");
  if (hidden) refuse("working-tree-dirty");
}

const INDEX_HEADER = /^(\S) (\d{6}) (?:[0-9a-f]{40}|[0-9a-f]{64}) (\d)$/u;

/** Runs after the tree was listed and checkIndex refused a submodule: it never considers one, since git would open its own repository and read its configuration. */
function checkClean(clone: string): void {
  const run = git(clone, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=all"], 16 * MIB);
  // Output past the bound is output: a status that long is not clean.
  if (run.overflow || (run.status === 0 && run.stdout.length > 0)) refuse("working-tree-dirty");
  if (run.status !== 0) refuse("clone-unreadable");
}

// ---- ports ---------------------------------------------------------------------------

async function readPorts(id: string, ports: RepositoryObservationPorts): Promise<{ readonly nodeId: string; readonly visibility: RepositoryVisibility }> {
  let nodeId: unknown;
  try {
    nodeId = await ports.nodeId(id);
  } catch {
    return refuse("node-id-unavailable");
  }
  if (typeof nodeId !== "string" || !NODE_ID_PATTERN.test(nodeId)) return refuse("node-id-unavailable");
  let visibility: unknown;
  try {
    visibility = await ports.visibility(id);
  } catch {
    return refuse("visibility-unavailable");
  }
  if (visibility !== "private" && visibility !== "internal" && visibility !== "public") return refuse("visibility-unavailable");
  return { nodeId, visibility };
}

// ---- the committed tree ---------------------------------------------------------------------

interface TreeEntry {
  readonly path: string;
  /** 100644, 100755 or 120000: a submodule is refused before a tree is returned. */
  readonly mode: string;
  readonly oid: string;
  readonly size: number;
}

interface TreeNode {
  readonly children: Map<string, TreeNode>;
  entry: TreeEntry | null;
}

interface Tree {
  readonly entries: readonly TreeEntry[];
  readonly root: TreeNode;
}

const LS_TREE_HEADER = /^(\d{6}) (blob|commit) ([0-9a-f]{40}|[0-9a-f]{64}) +(\d+|-)$/u;
const REGULAR_MODES: ReadonlySet<string> = new Set(["100644", "100755"]);

function isRegular(entry: TreeEntry | null): entry is TreeEntry {
  return entry !== null && REGULAR_MODES.has(entry.mode);
}

function listTree(clone: string, commit: string): Tree {
  const run = git(clone, ["ls-tree", "-r", "-z", "-l", "--full-tree", commit], MAX_TREE_BYTES);
  if (run.overflow) return refuse("tree-too-large");
  if (run.status !== 0) return refuse("clone-unreadable");
  const entries: TreeEntry[] = [];
  const root: TreeNode = { children: new Map(), entry: null };
  const out = run.stdout;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let submodule = false;
  let position = 0;
  while (position < out.length) {
    let end = out.indexOf(0, position);
    if (end === -1) end = out.length;
    if (entries.length >= MAX_TREE_ENTRIES) return refuse("tree-too-large");
    const record = out.subarray(position, end);
    position = end + 1;
    const tab = record.indexOf(9);
    const header = tab === -1 ? null : LS_TREE_HEADER.exec(record.subarray(0, tab).toString("latin1"));
    if (header === null) return refuse("clone-unreadable");
    const [, mode, type, oid, size] = header as unknown as [string, string, string, string, string];
    let path: string;
    try {
      path = decoder.decode(record.subarray(tab + 1));
    } catch {
      return refuse("clone-unreadable");
    }
    if (mode === "160000" && type === "commit") {
      submodule = true;
      entries.push({ path, mode, oid, size: 0 });
      continue;
    }
    if (type !== "blob" || size === "-" || (mode !== "100644" && mode !== "100755" && mode !== "120000")) return refuse("clone-unreadable");
    const entry: TreeEntry = { path, mode, oid, size: Number(size) };
    insertEntry(root, entry);
    entries.push(entry);
  }
  if (submodule) return refuse("submodule-present");
  return { entries, root };
}

function insertEntry(root: TreeNode, entry: TreeEntry): void {
  let node = root;
  for (const segment of entry.path.split("/")) {
    // A file and a directory at one path, or one path twice, is a tree git would not have written.
    if (node.entry !== null) refuse("clone-unreadable");
    let child = node.children.get(segment);
    if (child === undefined) {
      child = { children: new Map(), entry: null };
      node.children.set(segment, child);
    }
    node = child;
  }
  if (node.entry !== null || node.children.size > 0) refuse("clone-unreadable");
  node.entry = entry;
}

/** The node at exactly `path`, or null. */
function nodeAt(tree: Tree, path: string): TreeNode | null {
  let node: TreeNode | undefined = tree.root;
  for (const segment of path.split("/")) {
    node = node.children.get(segment);
    if (node === undefined) return null;
  }
  return node;
}

/** What is at exactly `path`: nothing, a regular blob, or anything else (a symbolic link or a directory). */
type Lookup = { readonly kind: "absent" } | { readonly kind: "regular"; readonly entry: TreeEntry } | { readonly kind: "other" };

function lookup(tree: Tree, path: string): Lookup {
  const node = nodeAt(tree, path);
  if (node === null) return { kind: "absent" };
  return isRegular(node.entry) ? { kind: "regular", entry: node.entry } : { kind: "other" };
}

// ---- letter case ------------------------------------------------------------------------------

/**
 * How a case-insensitive or normalising file system may read a name: each
 * segment decomposed, case-folded through both cases, decomposed again, and
 * without trailing dots and spaces.
 */
export function fold(path: string): string {
  return path
    .split("/")
    .map((segment) => {
      const folded = segment.normalize("NFD").toLowerCase().toUpperCase().toLowerCase().normalize("NFD");
      // A loop, not a pattern: `/[. ]+$/` retries from every dot or space of a long run.
      let end = folded.length;
      while (end > 0 && (folded[end - 1] === "." || folded[end - 1] === " ")) end -= 1;
      return folded.slice(0, end);
    })
    .join("/");
}

/** The read of the packed contract that INTRODUCIBLE_ROOTS makes, kept whole: every path the apply flow may own. */
const OWNED_PATTERNS: readonly string[] = (() => {
  const definitions = loadContract("repository-change-set.json").definitions as Record<string, { allOf?: { enum?: unknown }[] }> | undefined;
  const patterns = definitions?.ownedPattern?.allOf?.[1]?.enum;
  if (!Array.isArray(patterns) || !patterns.every((entry) => typeof entry === "string")) throw new Error("the packed change-set contract has no ownedPattern list");
  return patterns as string[];
})();

interface PatternSet {
  readonly patterns: readonly { readonly pattern: string; readonly first: string; readonly last: string }[];
}

function patternSet(patterns: readonly string[]): PatternSet {
  return {
    patterns: patterns.map((pattern) => {
      const segments = pattern.split("/");
      return { pattern, first: segments[0]!, last: segments[segments.length - 1]! };
    }),
  };
}

const OWNED = patternSet(OWNED_PATTERNS);
const OWNED_FOLDED = patternSet(OWNED_PATTERNS.map(fold));

/** Whether `path` matches any pattern; a literal first or last segment of a pattern is checked first, only to avoid matching every path against every pattern. */
function matchesAny(path: string, set: PatternSet): boolean {
  const segments = path.split("/");
  const last = segments[segments.length - 1]!;
  return set.patterns.some(({ pattern, first, last: tail }) => {
    if (first !== "**" && !first.includes("*") && first !== segments[0]) return false;
    if (tail !== "**" && !tail.includes("*") && tail !== last) return false;
    return matchesPathPattern(path, pattern);
  });
}

/** Whether `entry` is a link `linkedAgentsPaths` reports under its folded name, so it is reported there rather than refused here. */
function isReportedAgentsLink(entry: TreeEntry): boolean {
  if (entry.mode !== "120000") return false;
  const parts = fold(entry.path).split("/");
  return parts.length === 3 && parts[0] === ".agents" && parts[1] === "skills" && parts[2]!.startsWith("clossys-");
}

/** Every file, link and (through its files) directory beneath `node`, and the node's own entry. */
function entriesUnder(node: TreeNode): TreeEntry[] {
  const found: TreeEntry[] = [];
  const stack: TreeNode[] = [node];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    if (next.entry !== null) found.push(next.entry);
    stack.push(...next.children.values());
  }
  return found;
}

/**
 * What the head holds at the flow's own paths, by exact spelling, whatever its
 * type: a file or a link is listed, and a directory is listed by every file
 * under it, so that the path reads as occupied and is never planned over. A path
 * that is not the flow's own, but reads as one where letter case or a trailing
 * dot is not told apart, is refused: a write to one could land on the other.
 */
function ownedEntries(tree: Tree): TreeEntry[] {
  const owned = new Map<string, TreeEntry>();
  const folded = new Set<string>();
  const stack: { readonly path: string; readonly node: TreeNode; readonly covered: boolean }[] = [];
  for (const [name, node] of tree.root.children) stack.push({ path: name, node, covered: false });
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const { path, node } = item;
    let covered = item.covered;
    if (matchesAny(path, OWNED)) {
      const key = fold(path);
      if (folded.has(key)) refuse("case-variant-owned-path");
      folded.add(key);
      if (!covered) for (const entry of entriesUnder(node)) owned.set(entry.path, entry);
      covered = true;
    } else if (matchesAny(fold(path), OWNED_FOLDED) && !(node.entry !== null && isReportedAgentsLink(node.entry))) refuse("case-variant-owned-path");
    for (const [name, child] of node.children) stack.push({ path: `${path}/${name}`, node: child, covered });
  }
  return [...owned.values()].sort((left, right) => compareCodeUnits(left.path, right.path));
}

/** Root names whose case variants are refused: the roots the flow adds, and the two it writes into. */
const CASE_GUARDED_ROOTS: readonly string[] = [...PROFILE_ROOTS, ".github", ".starter"];

/**
 * Two root entries that differ only by letter case (or by normalisation form or a
 * trailing dot) are one name on a file system that does not tell them apart, and
 * a variant of a root the flow adds stands in for it in every check that looks
 * for the root by name. The roots the flow adds are refused for any spelling but
 * their own; `.github` and `.starter` only when two spellings are present.
 */
function checkRootNames(tree: Tree): void {
  const spellings = new Map<string, string[]>();
  for (const name of tree.root.children.keys()) {
    const key = fold(name);
    const held = spellings.get(key);
    if (held === undefined) spellings.set(key, [name]);
    else held.push(name);
  }
  for (const root of CASE_GUARDED_ROOTS) {
    const names = spellings.get(fold(root)) ?? [];
    if (names.length > 1 || (PROFILE_ROOTS.includes(root) && names.length === 1 && names[0] !== root)) refuse("case-variant-owned-path");
  }
}

/** Every node whose path is `segments` when each name is folded, with the spelling it has: a directory may have several spellings at once. */
function variantsAt(tree: Tree, segments: readonly string[]): { readonly name: string; readonly node: TreeNode }[] {
  let level: { readonly name: string; readonly node: TreeNode }[] = [{ name: "", node: tree.root }];
  for (const segment of segments) {
    const wanted = fold(segment);
    const next: { readonly name: string; readonly node: TreeNode }[] = [];
    for (const { node } of level) for (const [name, child] of node.children) if (fold(name) === wanted) next.push({ name, node: child });
    level = next;
  }
  return level;
}

/** Whether a node, or a node above it along `segments` under any spelling, is a symbolic link. */
function anySymlinkOnPath(tree: Tree, segments: readonly string[]): boolean {
  for (let length = 1; length <= segments.length; length += 1) {
    if (variantsAt(tree, segments.slice(0, length)).some(({ node }) => node.entry?.mode === "120000")) return true;
  }
  return false;
}

// ---- blobs ------------------------------------------------------------------------------------

/** Reads blobs of the committed tree by object id, each path once, within the total the observation may read. */
class BlobReader {
  private readonly cache = new Map<string, Buffer>();
  private total = 0;

  constructor(private readonly clone: string) {}

  /** The blob's exact bytes; `over` is the skip when it is larger than `cap`. */
  read(entry: TreeEntry, cap: number, over: SkipReason): Buffer {
    const cached = this.cache.get(entry.path);
    if (cached !== undefined) return cached;
    if (entry.size > cap) refuse(over);
    if (this.total + entry.size > MAX_READ_BYTES) refuse("observation-too-large");
    const run = git(this.clone, ["cat-file", "blob", entry.oid], entry.size + 1);
    // The listed size and the bytes must agree, or the object is not the one the tree named.
    if (run.status !== 0 || run.overflow || run.stdout.length !== entry.size) refuse("clone-unreadable");
    this.total += entry.size;
    this.cache.set(entry.path, run.stdout);
    return run.stdout;
  }
}

/**
 * The digest of a file's bytes exactly as materialize computes one: the bytes
 * are read as UTF-8 text, a sequence that is not UTF-8 becoming U+FFFD, and that
 * text is hashed (`readFileSync(path, "utf8")` on disk, `git show` decoded as
 * UTF-8 on a ref, and the same for a link's target). Hashing the raw bytes would
 * give a different digest for a file that is not UTF-8.
 */
function digestOf(bytes: Buffer): string {
  return contentDigest(bytes.toString("utf8"));
}

// ---- strict JSON ------------------------------------------------------------------------------

/** UTF-8 text, or null. A byte order mark is kept as U+FEFF, which strict JSON refuses. */
function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Whether `text` is JSON with no object that repeats a key, at any depth
 * (keys compared after decoding their escapes). JSON.parse takes the last of
 * two equal keys, so it alone would read a document another reader reads
 * differently.
 */
function isStrictJson(text: string): boolean {
  let at = 0;
  const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/uy;
  const space = (): void => {
    while (at < text.length && (text[at] === " " || text[at] === "\t" || text[at] === "\n" || text[at] === "\r")) at += 1;
  };
  const string = (): string | null => {
    if (text[at] !== '"') return null;
    const start = at;
    at += 1;
    while (at < text.length) {
      const code = text.charCodeAt(at);
      if (code === 0x22) {
        at += 1;
        return JSON.parse(text.slice(start, at)) as string;
      }
      if (code < 0x20) return null;
      if (code !== 0x5c) {
        at += 1;
        continue;
      }
      const escape = text[at + 1];
      if (escape === "u") {
        if (!/^[0-9a-fA-F]{4}$/u.test(text.slice(at + 2, at + 6))) return null;
        at += 6;
      } else if (escape !== undefined && '"\\/bfnrt'.includes(escape)) at += 2;
      else return null;
    }
    return null;
  };
  const value = (depth: number): boolean => {
    if (depth > MAX_JSON_DEPTH) return false;
    space();
    const start = text[at];
    if (start === "{") {
      at += 1;
      space();
      if (text[at] === "}") {
        at += 1;
        return true;
      }
      const seen = new Set<string>();
      for (;;) {
        space();
        const key = string();
        if (key === null || seen.has(key)) return false;
        seen.add(key);
        space();
        if (text[at] !== ":") return false;
        at += 1;
        if (!value(depth + 1)) return false;
        space();
        if (text[at] === ",") at += 1;
        else if (text[at] === "}") {
          at += 1;
          return true;
        } else return false;
      }
    }
    if (start === "[") {
      at += 1;
      space();
      if (text[at] === "]") {
        at += 1;
        return true;
      }
      for (;;) {
        if (!value(depth + 1)) return false;
        space();
        if (text[at] === ",") at += 1;
        else if (text[at] === "]") {
          at += 1;
          return true;
        } else return false;
      }
    }
    if (start === '"') return string() !== null;
    for (const literal of ["true", "false", "null"]) {
      if (text.startsWith(literal, at)) {
        at += literal.length;
        return true;
      }
    }
    number.lastIndex = at;
    const match = number.exec(text);
    if (match === null) return false;
    at += match[0].length;
    return true;
  };
  if (!value(0)) return false;
  space();
  return at === text.length;
}

/** The JSON a file holds, or null when it is not UTF-8 text without a byte order mark, holds a repeated key, or is not JSON. */
function parseStrictJson(bytes: Uint8Array): { readonly text: string; readonly value: unknown } | null {
  const text = decodeUtf8(bytes);
  if (text === null || !isStrictJson(text)) return null;
  try {
    return { text, value: JSON.parse(text) as unknown };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---- manifest, package manager and lockfile ------------------------------------------------------

interface ManifestEntry {
  readonly placement: DependencyPlacement;
  readonly name: string;
  readonly value: string;
}

interface Manifest {
  readonly entries: readonly ManifestEntry[];
  /** The `packageManager` field: undefined when absent, null when present but not text this module recognises. */
  readonly declared: PackageManagerKind | null | undefined;
}

const PLACEMENTS: readonly DependencyPlacement[] = ["dependencies", "devDependencies"];

function readManifest(entry: TreeEntry, reader: BlobReader): Manifest {
  const parsed = parseStrictJson(reader.read(entry, MAX_BLOB_BYTES, "manifest-unreadable"));
  if (parsed === null || !isRecord(parsed.value)) return refuse("manifest-unreadable");
  const manifest = parsed.value;
  const entries: ManifestEntry[] = [];
  for (const placement of PLACEMENTS) {
    if (!Object.hasOwn(manifest, placement)) continue;
    const map = manifest[placement];
    if (!isRecord(map)) return refuse("manifest-unreadable");
    const rows: ManifestEntry[] = [];
    for (const [name, value] of Object.entries(map)) {
      if (typeof value !== "string") return refuse("manifest-unreadable");
      rows.push({ placement, name, value });
    }
    entries.push(...rows.sort((left, right) => compareCodeUnits(left.name, right.name)));
  }
  let declared: Manifest["declared"];
  if (Object.hasOwn(manifest, "packageManager")) {
    const field = manifest.packageManager;
    const match = typeof field === "string" ? PACKAGE_MANAGER_FIELD.exec(field) : null;
    declared = match === null ? null : (match[1] as Exclude<PackageManagerKind, "none">);
  }
  return { entries, declared };
}

interface PackageState {
  readonly packageManager: PackageManagerKind;
  readonly lockfile: LockfileName;
  readonly lockedPackages: readonly PinnedPackage[];
}

/** The lockfile files present at the root, in any spelling, and whether a lockfile of a manager this module does not read is. */
function rootLockfiles(tree: Tree): { readonly known: readonly (typeof LOCKFILES)[number][]; readonly other: boolean } {
  return {
    known: LOCKFILES.filter((lockfile) => variantsAt(tree, [lockfile.name]).length > 0),
    other: OTHER_LOCKFILES.some((name) => variantsAt(tree, [name]).length > 0),
  };
}

/**
 * The Starter the lockfile locks must have a lockfile row of that name and
 * version: not an `npm:` alias, not another package installed under its name,
 * and not a tarball of another package. Anything else is a lockfile this module
 * does not interpret. The host and the integrity are the planner's to check.
 */
function checkStarterIdentity(view: LockfileView, row: RootDependency, manifest: Manifest | null): void {
  const locked = view.entries.find((candidate) => candidate.key === (view.format === "npm" ? `node_modules/${STARTER}` : `${STARTER}@${row.version}`));
  const written = manifest?.entries.find((candidate) => candidate.placement === row.placement && candidate.name === row.name);
  const named = locked !== undefined && !locked.link && locked.name === STARTER && locked.installedName === STARTER && locked.version === row.version;
  const fetched = locked?.tarball == null || locked.tarball.endsWith(`/${STARTER}/-/starter-${row.version}.tgz`);
  const aliased = row.specifier.startsWith("npm:") || (written !== undefined && written.value !== row.specifier);
  if (!named || !fetched || aliased) refuse("lockfile-unreadable");
}

function lockedPackagesOf(entry: TreeEntry, format: LockfileFormat, reader: BlobReader, manifest: Manifest | null): PinnedPackage[] {
  const text = decodeUtf8(reader.read(entry, MAX_LOCKFILE_BYTES, "lockfile-unreadable"));
  if (text === null) return refuse("lockfile-unreadable");
  let view: ReturnType<typeof readLockfile>;
  try {
    view = readLockfile(format, text);
  } catch {
    return refuse("lockfile-unreadable");
  }
  if (isUnreadable(view)) return refuse("lockfile-unreadable");
  const seen = new Map<string, PinnedPackage>();
  for (const row of view.root) {
    if ((row.placement !== "dependencies" && row.placement !== "devDependencies") || row.version === null || row.link) continue;
    if (row.integrity === null || !INTEGRITY.test(row.integrity)) continue;
    if (row.name === STARTER) checkStarterIdentity(view, row, manifest);
    const key = `${row.name}\0${row.version}`;
    const held = seen.get(key);
    // One name and version with two integrity values is a lockfile that says two things.
    if (held !== undefined && held.integrity !== row.integrity) return refuse("lockfile-unreadable");
    seen.set(key, { name: row.name, version: row.version, integrity: row.integrity });
  }
  return [...seen.values()].sort((left, right) => compareTuples([left.name, left.version], [right.name, right.version]));
}

function readPackageState(tree: Tree, manifest: Manifest | null, reader: BlobReader): PackageState {
  const { known, other } = rootLockfiles(tree);
  if (manifest === null) {
    if (known.length > 0 || other) return refuse("package-manager-conflict");
    return { packageManager: "none", lockfile: "none", lockedPackages: [] };
  }
  if (known.length > 1 || other) return refuse("lockfile-ambiguous");
  const lockfile = known[0];
  if (lockfile === undefined) {
    // Nothing but the package.json field decides, and it is not guessed.
    if (manifest.declared === undefined || manifest.declared === null) return refuse("package-manager-unknown");
    return { packageManager: manifest.declared, lockfile: "none", lockedPackages: [] };
  }
  if (manifest.declared === null) return refuse("package-manager-unknown");
  if (manifest.declared !== undefined && manifest.declared !== lockfile.manager) return refuse("package-manager-conflict");
  const found = lookup(tree, lockfile.name);
  if (found.kind !== "regular" || lockfile.manager === "yarn") return refuse("lockfile-unreadable");
  return { packageManager: lockfile.manager, lockfile: lockfile.name, lockedPackages: lockedPackagesOf(found.entry, lockfile.manager, reader, manifest) };
}

// ---- the other fields ----------------------------------------------------------------------------

function readReleaseAgeSurfaces(tree: Tree): { readonly surface: ReleaseAgeSurfaceKind; readonly path: string }[] {
  const found: { surface: ReleaseAgeSurfaceKind; path: string }[] = [];
  for (const { surface, path } of RELEASE_AGE_SURFACES) {
    const variants = variantsAt(tree, [path]);
    if (variants.length === 0) continue;
    const only = variants[0]!;
    if (variants.length > 1 || only.name !== path || !isRegular(only.node.entry)) refuse("release-age-surface-invalid");
    found.push({ surface, path });
  }
  return found.sort((left, right) => compareTuples([left.surface, left.path], [right.surface, right.path]));
}

/**
 * Whether a workflow of the repository's own is at the head: a regular file
 * directly in `.github/workflows`, spelled exactly so (GitHub reads no other
 * spelling), that is not a `clossys-` file.
 */
function hasConsumerCi(tree: Tree): boolean {
  const workflows = nodeAt(tree, ".github/workflows");
  if (workflows === null) return false;
  for (const [name, child] of workflows.children) {
    if (isRegular(child.entry) && /\.ya?ml$/iu.test(name) && !fold(name).startsWith("clossys-")) return true;
  }
  return false;
}

function readSymlinkedSkillRoots(tree: Tree): DiscoveryRoot[] {
  return DISCOVERY.filter((root) => anySymlinkOnPath(tree, root.split("/")));
}

function readLinkedAgentsPaths(tree: Tree): string[] {
  const linked = new Set<string>();
  if (anySymlinkOnPath(tree, [".agents"])) linked.add(".agents");
  if (variantsAt(tree, [".agents", "skills"]).some(({ node }) => node.entry?.mode === "120000")) linked.add(".agents/skills");
  for (const { node } of variantsAt(tree, [".agents", "skills"])) {
    for (const [name, child] of node.children) {
      const folded = fold(name);
      if (child.entry?.mode === "120000" && folded.startsWith("clossys-")) linked.add(`.agents/skills/${folded}`);
    }
  }
  const paths = [...linked].sort(compareCodeUnits);
  if (!paths.every((path) => AGENTS_LINK.test(path))) refuse("agents-link-unreportable");
  return paths;
}

function readOwnedFiles(owned: readonly TreeEntry[], reader: BlobReader): { readonly path: string; readonly sha256: string }[] {
  if (owned.length > MAX_OWNED_FILES) refuse("observation-too-large");
  const lockfileNames = new Set<string>(LOCKFILES.map((lockfile) => lockfile.name));
  return owned.map((entry) => ({ path: entry.path, sha256: digestOf(reader.read(entry, lockfileNames.has(entry.path) ? MAX_LOCKFILE_BYTES : MAX_BLOB_BYTES, "observation-too-large")) }));
}

function readLedger(tree: Tree, reader: BlobReader): Uint8Array | null {
  const found = lookup(tree, LEDGER_PATH);
  if (found.kind === "absent") return null;
  if (found.kind === "other") return refuse("ledger-unreadable");
  return new Uint8Array(reader.read(found.entry, MAX_BLOB_BYTES, "observation-too-large"));
}

/** The composed-skill manifest's entries, or null when it is absent or is not exactly the shape the flow writes. */
function readSkillsManifest(tree: Tree, reader: BlobReader): { readonly name: string; readonly sha256: string }[] | null {
  const found = lookup(tree, SKILLS_MANIFEST_PATH);
  if (found.kind !== "regular") return null;
  const parsed = parseStrictJson(reader.read(found.entry, MAX_BLOB_BYTES, "observation-too-large"));
  const document = parsed?.value;
  if (!isRecord(document) || Object.keys(document).length !== 2 || document.schemaVersion !== 1 || !Array.isArray(document.skills)) return null;
  const skills: { name: string; sha256: string }[] = [];
  for (const skill of document.skills as unknown[]) {
    if (!isRecord(skill) || !hasExactKeys(skill, ["name", "source", "sha256", "version"])) return null;
    const { name, source, sha256, version } = skill;
    if (typeof name !== "string" || !SKILL_NAME.test(name) || typeof source !== "string" || typeof version !== "string") return null;
    if (typeof sha256 !== "string" || !SHA256_HEX.test(sha256) || skills.some((held) => held.name === name)) return null;
    skills.push({ name, sha256 });
  }
  return skills.sort((left, right) => compareCodeUnits(left.name, right.name));
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(record);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(record, key));
}

/**
 * The Controller repository profile: the one Controller would locate, its path, and what a set that adds the four roots would break in
 * it. `setupRoots` are the roots a setup set adds beside them, when the repository is in its setup phase.
 */
function readProfile(tree: Tree, reader: BlobReader, setupRoots: readonly string[]): { readonly profile: RepositoryProfileObservation | null; readonly text: string | null } {
  const path = locateProfile(tree);
  if (path === null) return { profile: null, text: null };
  const unparseable = { profile: { path, rootVocabulary: "unparseable", undeclaredRoots: [], prohibitedRoots: [] } as RepositoryProfileObservation, text: null };
  const entry = nodeAt(tree, path)!.entry!;
  if (entry.size > MAX_BLOB_BYTES) return unparseable;
  const parsed = parseStrictJson(reader.read(entry, MAX_BLOB_BYTES, "observation-too-large"));
  if (parsed === null) return unparseable;
  // checkRootNames() refused every spelling but the exact one, so exact presence is presence.
  const introduced = [...PROFILE_ROOTS, ...setupRoots].filter((root) => !tree.root.children.has(root));
  const verdict = wouldViolateRootEntries(parsed.value, introduced);
  if (verdict.verdict === "indeterminate") return unparseable;
  if (verdict.verdict === "satisfied") return { profile: { path, rootVocabulary: verdict.vocabulary, undeclaredRoots: [], prohibitedRoots: [] }, text: null };
  return {
    profile: { path, rootVocabulary: "checked", undeclaredRoots: [...verdict.undeclared], prohibitedRoots: [...verdict.prohibited] },
    text: verdict.undeclared.length > 0 ? parsed.text : null,
  };
}

/** The path of the profile Controller would locate: `governance/` first, otherwise the one candidate in the tree; null for none. */
function locateProfile(tree: Tree): string | null {
  const first = lookup(tree, PROFILE_FIRST);
  if (first.kind === "regular") return PROFILE_FIRST;
  if (first.kind === "other") return refuse("profile-ambiguous");
  const candidates = tree.entries.filter((entry) => {
    const segments = entry.path.split("/");
    if (!PROFILE_NAMES.has(segments[segments.length - 1]!)) return false;
    if (segments.slice(0, -1).some((directory) => PROFILE_SKIPPED_DIRECTORIES.has(directory))) return false;
    return !entry.path.startsWith(".github/workflows/");
  });
  if (candidates.length > 1 || (candidates.length === 1 && !isRegular(candidates[0]!))) return refuse("profile-ambiguous");
  return candidates[0]?.path ?? null;
}

/** `apply` only when the base carries every proof of an earlier set; any doubt is `setup`. */
function readPhase(tree: Tree, ledger: Uint8Array | null, manifest: readonly ManifestEntry[], locked: readonly PinnedPackage[]): "setup" | "apply" {
  if (ledger === null) return "setup";
  let readable: boolean;
  try {
    readable = readInstalledLedger(ledger) !== null;
  } catch {
    readable = false;
  }
  if (!readable) return "setup";
  if (!Object.values(TEMPLATE_PATHS).every((paths) => paths.every((path) => lookup(tree, path).kind === "regular"))) return "setup";
  const starters = manifest.filter((entry) => entry.name === STARTER);
  const version = starters.length === 1 ? starters[0]!.value : "";
  // The pin must also be one the setup templates support, or the request they wrote could not have named it.
  if (!EXACT_VERSION.test(version) || !isSupportedStarterVersion(version)) return "setup";
  return locked.some((pkg) => pkg.name === STARTER && pkg.version === version) ? "apply" : "setup";
}

/** The exact text of a regular file at the root, or null when it is absent, not a regular file, or not UTF-8. */
function readSurfaceText(tree: Tree, reader: BlobReader, path: string): string | null {
  const found = lookup(tree, path);
  return found.kind === "regular" ? decodeUtf8(reader.read(found.entry, MAX_BLOB_BYTES, "observation-too-large")) : null;
}

/** `files` with the .npmrc's digest added when it is there: a pnpm setup reads it, though the flow never writes it. */
function withNpmrc(files: { readonly path: string; readonly sha256: string }[], tree: Tree, reader: BlobReader): { readonly path: string; readonly sha256: string }[] {
  const found = lookup(tree, NPMRC_PATH);
  if (found.kind !== "regular") return files;
  return [...files, { path: NPMRC_PATH, sha256: digestOf(reader.read(found.entry, MAX_BLOB_BYTES, "observation-too-large")) }].sort((left, right) => compareCodeUnits(left.path, right.path));
}

/**
 * The root names a setup set adds beyond the four every set adds: the two directories its templates go in, and, for a pnpm
 * repository with no workspace file, that file when the exemption edit will create it (a conflicting .npmrc refuses the edit, and
 * then nothing creates it).
 */
function setupRoots(tree: Tree, packageManager: PackageManagerKind, npmrcText: string | null): string[] {
  const roots = [...SETUP_PROFILE_ROOTS];
  if (packageManager === "pnpm" && !tree.root.children.has(PNPM_WORKSPACE_PATH) && editReleaseAgeExemption({ surface: "pnpm-workspace", text: null, npmrc: npmrcText }).kind === "edited") {
    roots.push(PNPM_WORKSPACE_PATH);
  }
  return roots;
}

/** Everything read from the committed tree, which is the tree at the head commit. */
function readCommittedHead(clone: string, tree: Tree): Omit<RepositoryObservation, "id" | "nodeId" | "visibility" | "defaultBranch" | "baseCommit"> {
  checkRootNames(tree);
  const owned = ownedEntries(tree);
  const reader = new BlobReader(clone);
  const packageJson = lookup(tree, "package.json");
  if (packageJson.kind === "other") refuse("manifest-unreadable");
  const manifest = packageJson.kind === "regular" ? readManifest(packageJson.entry, reader) : null;
  const packages = readPackageState(tree, manifest, reader);
  const releaseAgeSurfaces = readReleaseAgeSurfaces(tree);
  const linkedAgentsPaths = readLinkedAgentsPaths(tree);
  const files = withNpmrc(readOwnedFiles(owned, reader), tree, reader);
  const ledger = readLedger(tree, reader);
  const skillsManifest = readSkillsManifest(tree, reader);
  const manifestEntries = manifest?.entries ?? [];
  const phase = readPhase(tree, ledger, manifestEntries, packages.lockedPackages);
  const pnpmWorkspaceText = readSurfaceText(tree, reader, PNPM_WORKSPACE_PATH);
  const npmrcText = readSurfaceText(tree, reader, NPMRC_PATH);
  const { profile, text } = readProfile(tree, reader, phase === "setup" ? setupRoots(tree, packages.packageManager, npmrcText) : []);
  return {
    phase,
    packageManager: packages.packageManager,
    lockfile: packages.lockfile,
    releaseAgeSurfaces,
    consumerCi: hasConsumerCi(tree),
    symlinkedSkillRoots: readSymlinkedSkillRoots(tree),
    repositoryProfile: profile,
    linkedAgentsPaths,
    files,
    manifestEntries,
    lockedPackages: packages.lockedPackages,
    ledger,
    skillsManifest,
    repositoryProfileText: text,
    pnpmWorkspaceText,
    npmrcText,
  };
}

/**
 * Observes one clone: the committed head of a clean clone whose origin is the
 * repository `id` names, or the reason it cannot be observed. Nothing in the
 * clone is written or executed, and its working tree is not read.
 */
export async function observeRepository(input: ObserveRepositoryInput): Promise<RepositoryObservation | SkippedRepositoryObservation> {
  const { id, hubOwner, ports } = input;
  let neutral: string | null = null;
  try {
    checkId(id, hubOwner);
    // Objects from a store the clone does not own are refused, as the alternates file that names one is.
    if ((process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES ?? "") !== "") refuse("clone-unreadable");
    const clone = locateClone(input.clone);
    // A directory of its own, outside the clone, for the commands that must not see any repository's configuration.
    neutral = mkdtempSync(join(tmpdir(), "observe-repository-"));
    const config = readConfig(clone, neutral);
    checkConfig(config);
    checkRepositoryShape(clone);
    const url = originUrl(config);
    checkOrigin(url, id, hubOwner, ports.originId ?? defaultOriginId);
    // The file transport is only for an origin the caller's own mapper named: a local path is never what the default parser names.
    const tip = remoteTip(url, neutral, ports.originId === undefined ? REMOTE_PROTOCOLS : `${REMOTE_PROTOCOLS}:file`);
    checkHead(clone, tip);
    // The object database first: the head tree is listed, and a submodule refused, before any command reads the working tree.
    const tree = listTree(clone, tip.oid);
    checkIndex(clone);
    checkClean(clone);
    const { nodeId, visibility } = await readPorts(id, ports);
    const head = readCommittedHead(clone, tree);
    return { id, nodeId, visibility, defaultBranch: tip.branch, baseCommit: tip.oid, ...head };
  } catch (cause) {
    // Anything that is not a named refusal is still not an observation.
    const reason: SkipReason = cause instanceof Refusal ? cause.reason : "clone-unreadable";
    return { id, skipped: reason, verdict: SKIPS[reason] };
  } finally {
    if (neutral !== null) rmSync(neutral, { recursive: true, force: true });
  }
}

// ---- the committed files, for a caller that writes them elsewhere -------------------------------

/** The most files a caller may be handed; a tree with more is refused as `tree-too-large`. */
const MAX_COMMITTED_FILES = 20_000;

/** One file of the committed tree: its git mode, and its exact bytes (a symbolic link's bytes are its target). */
export interface CommittedFile {
  readonly path: string;
  readonly mode: "100644" | "100755" | "120000";
  readonly bytes: Buffer;
}

/** A skip reason as an id; the same fixed set an observation is skipped with. */
export type CommittedFilesReason = SkipReason;

export type CommittedFilesResult = { readonly ok: true; readonly files: readonly CommittedFile[] } | { readonly ok: false; readonly reason: CommittedFilesReason };

/**
 * Every file of the tree at `commit`, read as observeRepository() reads a tree: the clone is vetted the same way (a real
 * `.git` of its own, a `.git/config` of plain keys only, no alternate object store), and then only `ls-tree` and `cat-file` run,
 * at that commit. Nothing is checked out and no index, ref or worktree is written; the working tree is never read. A submodule,
 * more than a fixed number of files, or more than the observation's read total is refused, and the reason is one fixed id.
 */
export function readCommittedFiles(cloneInput: string, commit: string): CommittedFilesResult {
  let neutral: string | null = null;
  try {
    if (!OBJECT_ID.test(commit)) refuse("clone-unreadable");
    if ((process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES ?? "") !== "") refuse("clone-unreadable");
    const clone = locateClone(cloneInput);
    neutral = mkdtempSync(join(tmpdir(), "observe-repository-"));
    checkConfig(readConfig(clone, neutral));
    checkRepositoryShape(clone);
    const named = git(clone, ["rev-parse", "--verify", "-q", `${commit}^{commit}`]);
    if (named.status !== 0 || named.overflow || named.stdout.toString("utf8").trim() !== commit) refuse("clone-unreadable");
    const tree = listTree(clone, commit);
    if (tree.entries.length > MAX_COMMITTED_FILES) refuse("tree-too-large");
    if (tree.entries.reduce((sum, entry) => sum + entry.size, 0) > MAX_READ_BYTES) refuse("tree-too-large");
    const reader = new BlobReader(clone);
    const files = tree.entries.map((entry): CommittedFile => ({ path: entry.path, mode: entry.mode as CommittedFile["mode"], bytes: reader.read(entry, MAX_READ_BYTES, "tree-too-large") }));
    return { ok: true, files };
  } catch (cause) {
    return { ok: false, reason: cause instanceof Refusal ? cause.reason : "clone-unreadable" };
  } finally {
    if (neutral !== null) rmSync(neutral, { recursive: true, force: true });
  }
}
