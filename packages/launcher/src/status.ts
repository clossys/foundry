// `launcher-apply-plan status`: what a stored change set's pull request is doing, derived from read-only evidence (issue #1701,
// RFC apply-approved-plan sections 4.4, 6 and T5, decisions D6 and D14). It runs after the client's agent has pushed a branch and
// opened the pull request, and answers one question: is the pull request that carries this set's marker the pull request this
// set describes?
//
// It never changes anything. Three read-only `gh api` calls (S1: GET only, see createGhPorts) say who is asking, which pull
// requests are open, and where the default branch is; every other read is git plumbing over commits that are already in the
// clone (`ls-tree`, `cat-file`, `diff-tree`, `rev-parse`). It never fetches a pull request's head (a partial clone is refused before any object is read, and every git call also runs
// with lazy fetch off and a time limit), never checks anything out and
// never writes an index, a ref, a worktree or a file. (The one exception is verify's own precondition step, which fetches the
// default branch into its remote-tracking ref exactly as `verify` does; see runPreconditions.)
//
// This is a public-safety surface, so every ambiguity refuses:
//
// - S2. It prints a fixed state token, a fixed reason token and `#<n>` for a pull request number that is a safe integer, and
//   nothing else: never a body, a title, a login, an author or repository id, a branch, a path or any tool output.
// - S3. A body that names the marker counts only when its author is the person running this and both its head and its base are
//   the change set's own repository. Any other author, a fork, a deleted fork or a missing field is `foreign-marker`.
// - S4. A carriage return, a marker that is not the whole of line 1, or a body readChangeSetMarker reads as none is
//   `marker-malformed`.
// - S5. A pull request with this set's digest is `proposed` only if its base is the default branch, its branch and title are the
//   set's, its head commit is already in the clone, and verify's own checks (verifyPrepared) pass over that commit's tree,
//   including the exact ledger bytes; otherwise `diverged`. A precondition that fails (the clone, the hub or the admission, not
//   the pull request) and any object git cannot read are `indeterminate`, and are judged first. `proposed` does not check the
//   head's ancestry to the base, and nothing in this unit does.
// - S6. A pull request with another digest this hub stored for the repository is `superseded`. A digest this hub never stored,
//   two pull requests with one digest, 100 or more open pull requests (a full page of 100 cannot show that nothing lies beyond
//   it), or a port that fails or answers malformed is `indeterminate`.
// - S7. `applied` means the default branch's tip is in the clone and holds every `after` and every key the set writes, whether
//   the set was merged by a pull request or was already there; it needs no open pull request.
//
// Precedence: indeterminate, then diverged, then superseded, then proposed, then applied, then planned. `materialized` is
// verify's, `proved` and `held` and the drift classes are not observed here.

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { contentDigest, validateRepositoryChangeSet } from "./change-set-contract.js";
import type { RepositoryChangeSet } from "./change-set-contract.js";
import { changeSetDigest } from "./change-set-digest.js";
import type { ReadinessRunner } from "./admission.js";
import { valueAtJsonPointer } from "./key-editor.js";
import { GIT_TIMEOUT_ENV, checkChangeSetShape, resolveCloneRoot, runPreconditions, verifyPrepared } from "./materialize.js";
import type { ApplyStepResult, GitPathList, TreeEntry, TreeReader } from "./materialize.js";
import { readChangeSetMarker } from "./pull-request-body.js";

export type StatusState = "proposed" | "applied" | "planned" | "diverged" | "superseded" | "indeterminate";

/** The outcome: a state, a fixed reason token, and the numbers of the pull requests it is about. Never a value read from GitHub but those numbers. */
export interface StatusResult {
  readonly exitCode: 0 | 1 | 2;
  readonly state: StatusState;
  readonly reason?: string;
  readonly pullRequests?: readonly number[];
}

/** The three read-only questions status asks GitHub. Each may return a value or a promise of one, or throw; a throw is `port-failed`. */
export interface StatusPorts {
  /** The node id of the account running this. */
  readonly viewer: () => string | Promise<string>;
  /** The open pull requests of the repository, as rows of `PullRequestRow`'s fields: only the first page of 100 is read, and a full page is refused. */
  readonly openPullRequests: (repositoryId: string) => unknown | Promise<unknown>;
  /** The commit id of the default branch's tip on the remote. */
  readonly tip: (repositoryId: string, branch: string) => string | Promise<string>;
}

export interface StatusInput {
  readonly clone: string;
  readonly hub: string;
  readonly set: RepositoryChangeSet;
  /** Every change set the hub stored, in any repository: the ones for this repository name the digests that count as older. */
  readonly heldChangeSets?: readonly RepositoryChangeSet[];
  readonly now?: () => Date;
  readonly runReadiness?: ReadinessRunner;
  /** The GitHub ports; read-only `gh api` by default. */
  readonly ports?: StatusPorts;
  /** How long one git call may run before status gives up on it as `indeterminate`; 30 seconds by default. */
  readonly gitTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// shapes

/** The page size of the open pull request listing: a listing this long may have more behind it, so the answer is `indeterminate`. */
export const MAX_OPEN_PULL_REQUESTS = 100;

const GIT_TIMEOUT_MS = 30_000;

const TOKEN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MARKER_LINE = /^<!-- clossys-change-set: (sha256:[0-9a-f]{64}) -->$/u;
const MARKER_WORD = /clossys-change-set/iu;
const COMMIT = /^[0-9a-f]{40}$/u;
const NODE_ID = /^[A-Za-z0-9_=+/-]{1,200}$/u;
const REPOSITORY_ID = /^(?!\.{1,2}\/)[A-Za-z0-9._-]{1,100}\/(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/u;
const BRANCH_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/u;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isNodeId = (value: unknown): value is string => typeof value === "string" && NODE_ID.test(value);

/** A reason that is safe to print: a fixed token or nothing else. */
export function safeReason(reason: unknown): string {
  return typeof reason === "string" && reason.length <= 64 && TOKEN.test(reason) ? reason : "refused";
}

const branchSafe = (branch: unknown): branch is string => typeof branch === "string" && branch.length <= 200 && branch.split("/").every((part) => BRANCH_SEGMENT.test(part));

const indeterminate = (reason: string, pullRequests?: readonly number[]): StatusResult =>
  pullRequests === undefined ? { exitCode: 2, state: "indeterminate", reason: safeReason(reason) } : { exitCode: 2, state: "indeterminate", reason: safeReason(reason), pullRequests };
const diverged = (reason: string, pullRequests: readonly number[]): StatusResult => ({ exitCode: 1, state: "diverged", reason: safeReason(reason), pullRequests });

/** A verify step's outcome as a status: its exit code 1 is `diverged`, 2 is `indeterminate`; its reason is passed through only as a token. */
function fromStep(step: ApplyStepResult, pullRequest: number): StatusResult {
  if (step.exitCode === 1) return diverged(step.reason ?? "refused", [pullRequest]);
  return indeterminate(step.reason ?? "refused", [pullRequest]);
}

// ---------------------------------------------------------------------------
// git, over commits only

/** Thrown when git cannot be run or does not answer in time: the answer is unknown, never "no". */
const GIT_UNAVAILABLE = "git-unavailable";

/**
 * git over the clone, with lazy fetch off (S1): an object a partial clone does not hold is reported missing, never fetched from a
 * promisor remote. Every call is bounded by `timeoutMs`; a call that cannot run or times out throws.
 */
function runGit(cwd: string, args: readonly string[], timeoutMs: number): { status: number; stdout: Buffer } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith("GIT_")) delete env[name];
  env.GIT_LITERAL_PATHSPECS = "1";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_NO_LAZY_FETCH = "1";
  env.GIT_CEILING_DIRECTORIES = dirname(cwd);
  const run = spawnSync("git", ["--no-replace-objects", ...args], { cwd, env, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, killSignal: "SIGKILL" });
  if (run.error !== undefined || run.status === null || run.stdout === null || run.stdout === undefined) throw new Error(GIT_UNAVAILABLE);
  return { status: run.status, stdout: run.stdout };
}

/**
 * Runs `run` with lazy fetch off and a time limit in this process's environment too, for the reads the shared preconditions and
 * verifyPrepared make with their own git helpers, which inherit it (verify sets neither). One status at a time per process.
 */
async function withGitLimits<T>(timeoutMs: number, run: () => T | Promise<T>): Promise<T> {
  const saved = { lazy: process.env.GIT_NO_LAZY_FETCH, limit: process.env[GIT_TIMEOUT_ENV] };
  process.env.GIT_NO_LAZY_FETCH = "1";
  process.env[GIT_TIMEOUT_ENV] = String(timeoutMs);
  try {
    return await run();
  } finally {
    if (saved.lazy === undefined) delete process.env.GIT_NO_LAZY_FETCH;
    else process.env.GIT_NO_LAZY_FETCH = saved.lazy;
    if (saved.limit === undefined) delete process.env[GIT_TIMEOUT_ENV];
    else process.env[GIT_TIMEOUT_ENV] = saved.limit;
  }
}

/**
 * Whether the clone is a partial (promisor) clone, whose missing objects git would fetch on demand. Status refuses one before it
 * reads any object, whatever version of git it has: by the configuration that makes a clone partial (`extensions.partialclone`, or a
 * remote marked `promisor`, which every filtered clone sets, blobless or treeless) and by a `.promisor` pack marker, in case the
 * configuration was edited away. Throws when git cannot say.
 */
function isPartialClone(root: string, timeoutMs: number): boolean {
  const config = runGit(root, ["config", "--get-regexp", "^(extensions\\.partialclone|remote\\..*\\.promisor)$"], timeoutMs);
  if (config.status !== 0 && config.status !== 1) throw new Error(GIT_UNAVAILABLE);
  for (const line of config.stdout.toString("utf8").split("\n")) {
    const space = line.indexOf(" ");
    const key = (space === -1 ? line : line.slice(0, space)).toLowerCase();
    const value = space === -1 ? "" : line.slice(space + 1).trim().toLowerCase();
    if (key === "extensions.partialclone") return true;
    if (key.endsWith(".promisor") && !["false", "no", "off", "0"].includes(value)) return true;
  }
  const located = runGit(root, ["rev-parse", "--git-path", "objects/pack"], timeoutMs);
  if (located.status !== 0) throw new Error(GIT_UNAVAILABLE);
  const relative = located.stdout.toString("utf8").trim();
  const packs = isAbsolute(relative) ? relative : join(root, relative);
  try {
    return readdirSync(packs).some((name) => name.endsWith(".promisor"));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw cause;
  }
}

/** Whether `commit` is a commit object already in the clone's object database. Throws when git cannot say. */
function commitIsLocal(root: string, commit: string, timeoutMs: number): boolean {
  return COMMIT.test(commit) && runGit(root, ["cat-file", "-e", `${commit}^{commit}`], timeoutMs).status === 0;
}

interface TreeRecord {
  readonly mode: string;
  readonly type: string;
  readonly oid: string;
}

/** A TreeReader over one commit's tree, and whether any read of it failed (a corrupt, missing or unreachable object, or a git that did not answer). */
interface CommitReader {
  readonly reader: TreeReader;
  readonly unreadable: () => boolean;
}

/**
 * A TreeReader over one commit's tree: git plumbing only, so the working tree, the index and every ref stay as they were. A path
 * behind a link cannot be reached by `ls-tree`, and a link above a path is reported by hasSymlinkAncestor. verifyPrepared answers a
 * failed read as a mismatch, so `unreadable` records every failure for the caller to turn into `indeterminate`.
 */
function commitReader(root: string, commit: string, timeoutMs: number): CommitReader {
  let failed = false;
  const fail = (): never => {
    failed = true;
    throw new Error("object-unreadable");
  };
  const git = (args: readonly string[]): { status: number; stdout: Buffer } => {
    try {
      return runGit(root, args, timeoutMs);
    } catch {
      return fail();
    }
  };
  /** The one tree entry at `relPath` in the commit, or null when there is none. Throws when git cannot say. */
  const treeRecord = (relPath: string): TreeRecord | null => {
    const listed = git(["ls-tree", "-z", commit, "--", relPath]);
    if (listed.status !== 0) return fail();
    const records = listed.stdout.toString("utf8").split("\0").filter((record) => record !== "");
    if (records.length === 0) return null;
    if (records.length !== 1) return fail();
    const record = records[0]!;
    const tab = record.indexOf("\t");
    if (tab === -1 || record.slice(tab + 1) !== relPath) return fail();
    const [mode, type, oid, ...rest] = record.slice(0, tab).split(" ");
    if (mode === undefined || type === undefined || oid === undefined || rest.length > 0 || !COMMIT.test(oid)) return fail();
    return { mode, type, oid };
  };
  const blobBytes = (oid: string): Buffer => {
    const blob = git(["cat-file", "blob", oid]);
    if (blob.status !== 0) return fail();
    return blob.stdout;
  };
  const reader: TreeReader = {
    onBranch: () => true,
    changedPaths(baseCommit): GitPathList {
      const diff = git(["diff-tree", "-r", "-z", "--name-only", "--no-renames", baseCommit, commit]);
      if (diff.status !== 0) return { ok: false };
      return { ok: true, paths: diff.stdout.toString("utf8").split("\0").filter((path) => path !== "") };
    },
    dirtyPaths: () => ({ ok: true, paths: [] }),
    hasSymlinkAncestor(relPath) {
      const parts = relPath.split("/");
      for (let length = 1; length < parts.length; length += 1) {
        const record = treeRecord(parts.slice(0, length).join("/"));
        if (record === null) return false;
        if (record.mode === "120000") return true;
      }
      return false;
    },
    entry(relPath): TreeEntry | null {
      const record = treeRecord(relPath);
      if (record === null) return null;
      if (record.type !== "blob") return { kind: "other" };
      if (record.mode === "120000") return { kind: "symlink", target: blobBytes(record.oid).toString("utf8") };
      if (record.mode === "100644") return { kind: "file", executable: false };
      if (record.mode === "100755") return { kind: "file", executable: true };
      return { kind: "other" };
    },
    bytes(relPath) {
      const record = treeRecord(relPath);
      if (record === null || record.type !== "blob" || (record.mode !== "100644" && record.mode !== "100755")) throw new Error("not-a-regular-file");
      return blobBytes(record.oid);
    },
  };
  return { reader, unreadable: () => failed };
}

// ---------------------------------------------------------------------------
// the GitHub ports

/** Runs `gh` with these arguments; the exit status and standard output. Injected by tests. */
export type GhRun = (args: readonly string[]) => { readonly status: number | null; readonly stdout: string };

const runGh: GhRun = (args) => {
  const run = spawnSync("gh", [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  return { status: run.error === undefined ? run.status : null, stdout: typeof run.stdout === "string" ? run.stdout : "" };
};

const PULL_REQUEST_FIELDS =
  "[.[] | {number: .number, title: .title, body: .body, author: .user.node_id, headSha: .head.sha, headRef: .head.ref, headRepo: .head.repo.node_id, baseRepo: .base.repo.node_id, baseRef: .base.ref}]";

/**
 * The default ports: GET-only `gh api` (S1). Every call is `gh api --method GET <path> [--jq <filter>]`: no field, input or body
 * option, no other method, and a path built only from a repository id and a branch that were matched against strict patterns
 * first. `run` is injectable so a test can see every argument list.
 */
export function createGhPorts(run: GhRun = runGh): StatusPorts {
  const get = (path: string, jq: string): string => {
    const result = run(["api", "--method", "GET", path, "--jq", jq]);
    if (result.status !== 0) throw new Error("gh api failed");
    return result.stdout.trim();
  };
  const repositoryPath = (id: string): string => {
    if (!REPOSITORY_ID.test(id)) throw new Error("repository-invalid");
    return `repos/${id}`;
  };
  return {
    viewer: () => get("user", ".node_id"),
    // One page of 100: a full page may have more behind it, and readRows refuses it rather than guess (S6).
    openPullRequests(id) {
      const parsed: unknown = JSON.parse(get(`${repositoryPath(id)}/pulls?state=open&per_page=${MAX_OPEN_PULL_REQUESTS}&page=1`, PULL_REQUEST_FIELDS));
      if (!Array.isArray(parsed)) throw new Error("gh api answered something else");
      return parsed;
    },
    tip(id, branch) {
      if (!branchSafe(branch)) throw new Error("branch-invalid");
      return get(`${repositoryPath(id)}/git/ref/heads/${branch}`, ".object.sha");
    },
  };
}

// ---------------------------------------------------------------------------
// the pull requests

/** The fields status reads of an open pull request; each is checked before it is trusted. */
interface PullRequestRow {
  readonly number: number;
  readonly body: string | null;
  readonly title: unknown;
  readonly author: unknown;
  readonly headRepo: unknown;
  readonly baseRepo: unknown;
  readonly headRef: unknown;
  readonly headSha: unknown;
  readonly baseRef: unknown;
}

function readRows(raw: unknown): PullRequestRow[] | "too-many-open" | "port-malformed" {
  if (!Array.isArray(raw)) return "port-malformed";
  if (raw.length >= MAX_OPEN_PULL_REQUESTS) return "too-many-open";
  const rows: PullRequestRow[] = [];
  for (const row of raw as unknown[]) {
    if (!isRecord(row)) return "port-malformed";
    const { number, body } = row;
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) return "port-malformed";
    if (body !== null && typeof body !== "string") return "port-malformed";
    rows.push({ number, body, title: row.title, author: row.author, headRepo: row.headRepo, baseRepo: row.baseRepo, headRef: row.headRef, headSha: row.headSha, baseRef: row.baseRef });
  }
  return rows.sort((left, right) => left.number - right.number);
}

/** The digest on the first and only marker line of a body (S4), or null. */
function markerOf(body: string): string | null {
  if (body.includes("\r")) return null;
  const first = MARKER_LINE.exec(body.split("\n", 1)[0]!)?.[1];
  if (first === undefined) return null;
  return readChangeSetMarker(body) === first ? first : null;
}

// ---------------------------------------------------------------------------
// applied

/**
 * Whether the tree holds every `after` and every key the set writes (S7), and writes at least one thing that was not already there,
 * so a set that changes nothing of its own is never read as applied. Throws when the tree cannot be read.
 */
function holdsTheSet(set: RepositoryChangeSet, reader: TreeReader): boolean {
  let changes = false;
  for (const file of set.files) {
    if ("derived" in file) continue;
    if (reader.hasSymlinkAncestor(file.path)) return false;
    const entry = reader.entry(file.path);
    if (file.after === null) {
      if (entry !== null && entry.kind !== "other") return false;
    } else {
      if (entry === null) return false;
      if (file.mode === "120000") {
        if (entry.kind !== "symlink" || contentDigest(entry.target) !== file.after) return false;
      } else if (entry.kind !== "file" || entry.executable || contentDigest(reader.bytes(file.path).toString("utf8")) !== file.after) return false;
    }
    if (file.before !== file.after) changes = true;
  }
  if (set.keys.length > 0) {
    if (reader.hasSymlinkAncestor("package.json")) return false;
    const manifest = reader.bytes("package.json").toString("utf8");
    for (const key of set.keys) {
      const at = valueAtJsonPointer(manifest, key.pointer);
      if (key.after === null ? at.found : !at.found || at.value !== key.after) return false;
      if (key.before !== key.after) changes = true;
    }
  }
  return changes;
}

/**
 * The one line status prints (S2): `launcher-apply-plan status: <state>[ (<reason>)][ #<n>...]`. The state comes from a closed
 * set, the reason must match the fixed-token shape or is printed as `refused`, and a pull request is printed only as `#` and a
 * safe positive integer. Nothing read from GitHub, the clone or the hub reaches it in any other form.
 */
export function formatStatus(result: { readonly state: StatusState; readonly reason?: unknown; readonly pullRequests?: readonly number[] }): string {
  const states: readonly string[] = ["proposed", "applied", "planned", "diverged", "superseded", "indeterminate"];
  const state = states.includes(result.state) ? result.state : "indeterminate";
  const reason = result.reason === undefined ? "" : ` (${safeReason(result.reason)})`;
  const numbers = (result.pullRequests ?? []).filter((n) => Number.isSafeInteger(n) && n > 0).map((n) => ` #${n}`);
  return `launcher-apply-plan status: ${state}${reason}${numbers.join("")}`;
}

// ---------------------------------------------------------------------------
// status

async function observe(input: StatusInput): Promise<StatusResult> {
  const { set } = input;
  const resolved = resolveCloneRoot(input.clone);
  if ("exitCode" in resolved) return indeterminate(resolved.reason ?? "missing-clone");
  const { root } = resolved;
  const shape = checkChangeSetShape(set);
  if (shape !== null) return indeterminate(shape.reason ?? "change-set-invalid");
  const id = set.repository.id;
  const branch = set.repository.defaultBranch;
  const nodeId = set.repository.nodeId;
  if (changeSetDigest(set) !== set.changeSetDigest) return indeterminate("change-set-invalid");
  if (!REPOSITORY_ID.test(id) || !branchSafe(branch) || !isNodeId(nodeId)) return indeterminate("repository-invalid");

  // Before any read of an object: a partial clone would have git fetch what it lacks, from the network, with the operator's credentials.
  const timeoutMs = input.gitTimeoutMs ?? GIT_TIMEOUT_MS;
  if (isPartialClone(root, timeoutMs)) return indeterminate("partial-clone");

  // The digests this hub stored for this repository: the ones a marker may name besides this set's own.
  const held = (input.heldChangeSets ?? []).filter((entry) => entry.repository.id === id);
  const known = new Set<string>();
  for (const entry of held) if (validateRepositoryChangeSet(entry).valid && changeSetDigest(entry) === entry.changeSetDigest) known.add(entry.changeSetDigest);
  known.delete(set.changeSetDigest);

  const ports = input.ports ?? createGhPorts();
  let viewer: string;
  let raw: unknown;
  try {
    viewer = await ports.viewer();
    raw = await ports.openPullRequests(id);
  } catch {
    return indeterminate("port-failed");
  }
  if (!isNodeId(viewer)) return indeterminate("port-malformed");
  const rows = readRows(raw);
  if (typeof rows === "string") return indeterminate(rows);

  const older: number[] = [];
  const seen = new Set<string>();
  let current: PullRequestRow | null = null;
  for (const row of rows) {
    if (row.body === null || !MARKER_WORD.test(row.body)) continue;
    // S3: a body that names the marker is trusted only from the person running this, between this repository and itself.
    if (!isNodeId(row.author) || row.author !== viewer || row.headRepo !== nodeId || row.baseRepo !== nodeId) return indeterminate("foreign-marker");
    // S4
    const digest = markerOf(row.body);
    if (digest === null) return indeterminate("marker-malformed");
    // S6
    if (seen.has(digest)) return indeterminate("duplicate-digest");
    seen.add(digest);
    if (digest === set.changeSetDigest) current = row;
    else if (known.has(digest)) older.push(row.number);
    else return indeterminate("unknown-digest");
  }

  let proposed: StatusResult | null = null;
  if (current !== null) {
    const number = current.number;
    if (typeof current.baseRef !== "string" || typeof current.headRef !== "string" || typeof current.title !== "string" || typeof current.headSha !== "string") return indeterminate("port-malformed", [number]);
    // The clone, the hub and the admission come first: a refusal there is about them, not about the pull request, so it is
    // `indeterminate` whatever the pull request says.
    const pre = await withGitLimits(timeoutMs, () => runPreconditions(input.clone, input.hub, set, input.heldChangeSets ?? [], { now: input.now, runReadiness: input.runReadiness }));
    if ("exitCode" in pre) return indeterminate(pre.reason ?? "refused", [number]);
    // S5
    if (current.baseRef !== branch) return diverged("base-branch-mismatch", [number]);
    if (current.headRef !== set.branch) return diverged("ref-mismatch", [number]);
    if (current.title !== set.pullRequest.title) return diverged("title-mismatch", [number]);
    if (!commitIsLocal(root, current.headSha, timeoutMs)) return diverged("head-not-local", [number]);
    const head = commitReader(root, current.headSha, timeoutMs);
    let verified: ApplyStepResult | null = null;
    try {
      verified = await withGitLimits(timeoutMs, () => verifyPrepared(set, pre, head.reader));
    } catch (cause) {
      if (!head.unreadable()) throw cause;
    }
    // A read that failed may have been answered as a mismatch: an object git cannot read is unknown, not diverged.
    if (verified === null || head.unreadable()) return indeterminate("object-unreadable", [number]);
    if (verified.exitCode !== 0) return fromStep(verified, number);
    proposed = { exitCode: 0, state: "proposed", pullRequests: [number] };
  }
  if (older.length > 0) return { exitCode: 2, state: "superseded", pullRequests: older };
  if (proposed !== null) return proposed;

  // S7: with no pull request of this set to report, the default branch's own tip decides applied or planned.
  let tip: string;
  try {
    tip = await ports.tip(id, branch);
  } catch {
    return indeterminate("port-failed");
  }
  if (!COMMIT.test(tip)) return indeterminate("port-malformed");
  if (!commitIsLocal(root, tip, timeoutMs)) return indeterminate("tip-not-local");
  const tipReader = commitReader(root, tip, timeoutMs);
  let holds: boolean;
  try {
    holds = holdsTheSet(set, tipReader.reader);
  } catch {
    return indeterminate("tip-unreadable");
  }
  if (tipReader.unreadable()) return indeterminate("tip-unreadable");
  return holds ? { exitCode: 0, state: "applied" } : { exitCode: 2, state: "planned" };
}

/**
 * The state of one stored change set's pull request. Never throws: anything unexpected is `indeterminate`. Reads the clone only
 * through git plumbing over commits, and GitHub only through `input.ports`.
 */
export async function statusRepository(input: StatusInput): Promise<StatusResult> {
  try {
    return await observe(input);
  } catch {
    return indeterminate("status-failed");
  }
}
