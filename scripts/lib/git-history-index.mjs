// git-history-index — one batched Git history read shared by the retained
// qualification and later-publication evidence checks.
//
// Those checks ask the same few path-limited history questions once per
// retained record: "which commits ADDED this path", "which commits in
// base..HEAD are not TREESAME for this path", "does this path have any
// history from this ref", plus cheap blob, parent and ancestry lookups. Each
// question used to be its own `git` process walking the whole history, so the
// gate's cost grew with records x commits.
//
// This module answers them from ONE `git log` over the indexed scope:
//
//   --sparse        every commit reachable from HEAD is printed, so the index
//                   holds the full topology (true parents: no parent
//                   rewriting is requested);
//   -m --raw        a merge is diffed against EACH parent, so for every
//                   commit the index knows exactly which indexed paths differ
//                   from at least one parent, and the commit's own blob;
//   --no-renames    a single-path pathspec can never pair a rename, so the
//                   per-path questions always saw plain A/D; the batched
//                   pathspec must not start pairing them;
//   --root          the root commit's additions are visible regardless of
//                   `log.showRoot`.
//
// Each answer reproduces Git's own `--full-history` (no parent rewriting)
// TREESAME rule from revision.c, including the range rule that only
// "relevant" parents (interesting, or the range bottom itself) decide a
// merge. Anything the index cannot answer exactly — a path outside the scope,
// a pathspec with magic or glob characters, a path that is ever a directory,
// a ref that is not a full commit id in the indexed graph, a mutable alias
// other than the head the index was built for — falls back to the exact
// per-record `git` command the callers always ran. A NEGATIVE ancestry answer
// also falls back, so a failing command still fails with Git's own error.
//
// The index is opt-in and scoped: it is only consulted inside
// `withGitHistoryIndex(root, fn)`, for that repository root, so a caller that
// mutates a fixture repository between validations never reads a stale view.

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

const SHA1 = /^[a-f0-9]{40}$/;
const ZERO = "0000000000000000000000000000000000000000";
// A literal, magic-free, glob-free relative file path.
const LITERAL_PATH = /^[A-Za-z0-9._@+-]+(\/[A-Za-z0-9._@+-]+)*$/;
export const GIT_HISTORY_INDEX_SCOPE = "governance";

export const GIT_HISTORY_INDEX_ARGS = Object.freeze([
  "log", "--full-history", "--sparse", "-m", "--raw", "--no-renames", "--root",
  "--no-abbrev", "--no-color", "--no-show-signature", "--no-relative",
  "--format=%x01%H %P",
]);

function parseIndex(output, scope) {
  const order = [];
  const parents = new Map();
  const changed = new Map();
  const byPath = new Map();
  const dirs = new Set();
  let current = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("\x01")) {
      const [sha, ...ps] = line.slice(1).trim().split(" ").filter(Boolean);
      if (!SHA1.test(sha) || ps.some((p) => !SHA1.test(p))) throw new Error("unparseable history header");
      current = sha;
      // `-m` repeats a merge's header once per parent diff.
      if (!parents.has(sha)) { order.push(sha); parents.set(sha, ps); changed.set(sha, new Map()); }
      continue;
    }
    if (line === "") continue;
    if (!line.startsWith(":") || current === null) throw new Error("unparseable history line");
    const tab = line.indexOf("\t");
    const fields = line.slice(1, tab).split(" ");
    const path = line.slice(tab + 1);
    if (tab < 0 || fields.length !== 5 || path.startsWith('"') || !path.startsWith(scope + "/")) throw new Error("unparseable history entry");
    const [, newMode, , newOid, status] = fields;
    const entries = changed.get(current);
    if (!entries.has(path)) {
      entries.set(path, { key: newOid === ZERO ? null : `${newMode} ${newOid}`, oid: newOid === ZERO ? null : newOid, status });
      if (!byPath.has(path)) byPath.set(path, []);
      byPath.get(path).push(current);
    }
    for (let i = path.indexOf("/"); i >= 0; i = path.indexOf("/", i + 1)) dirs.add(path.slice(0, i));
  }
  if (order.length === 0) throw new Error("empty history");
  for (const ps of parents.values()) for (const p of ps) if (!parents.has(p)) throw new Error("incomplete history topology");
  const children = new Set();
  for (const ps of parents.values()) for (const p of ps) children.add(p);
  const tips = order.filter((sha) => !children.has(sha));
  if (tips.length !== 1) throw new Error("history index must have one tip");
  return { order, parents, changed, byPath, dirs, head: tips[0] };
}

export class GitHistoryIndex {
  #scope; #order; #parents; #changed; #byPath; #dirs; #head;
  #keys = new Map();
  #reach = new Map();
  constructor(output, { scope = GIT_HISTORY_INDEX_SCOPE } = {}) {
    const parsed = parseIndex(output, scope);
    this.#scope = scope;
    this.#order = parsed.order;
    this.#parents = parsed.parents;
    this.#changed = parsed.changed;
    this.#byPath = parsed.byPath;
    this.#dirs = parsed.dirs;
    this.#head = parsed.head;
  }
  get head() { return this.#head; }
  get size() { return this.#order.length; }
  covers(path) {
    return typeof path === "string" && LITERAL_PATH.test(path) && path.startsWith(this.#scope + "/") &&
      !path.split("/").some((segment) => segment === "." || segment === "..") && !this.#dirs.has(path);
  }
  /** The exact commit id for `ref` when it names a commit in this graph. */
  commit(ref) {
    if (ref === "HEAD") return this.#head;
    return typeof ref === "string" && SHA1.test(ref) && this.#parents.has(ref) ? ref : null;
  }
  parents(commit) { return this.#parents.has(commit) ? [...this.#parents.get(commit)] : null; }
  #key(commit, path) {
    let memo = this.#keys.get(path);
    if (!memo) { memo = new Map(); this.#keys.set(path, memo); }
    const walked = [];
    let at = commit, key = null;
    for (;;) {
      if (memo.has(at)) { key = memo.get(at); break; }
      walked.push(at);
      const entry = this.#changed.get(at).get(path);
      if (entry) { key = entry.key; break; }
      // Absent from every parent diff: identical to every parent, so the
      // first parent's entry is this commit's entry.
      const first = this.#parents.get(at)[0];
      if (first === undefined) { key = null; break; }
      at = first;
    }
    for (const sha of walked) memo.set(sha, key);
    return key;
  }
  /** `git rev-parse --verify <commit>:<path>` — the blob id, or null. */
  blobOid(commit, path) {
    const key = this.#key(commit, path);
    return key === null ? null : key.slice(key.indexOf(" ") + 1);
  }
  reachable(commit) {
    let set = this.#reach.get(commit);
    if (set) return set;
    set = new Set();
    const stack = [commit];
    while (stack.length) {
      const sha = stack.pop();
      if (set.has(sha)) continue;
      set.add(sha);
      for (const p of this.#parents.get(sha)) if (!set.has(p)) stack.push(p);
    }
    this.#reach.set(commit, set);
    return set;
  }
  isAncestor(ancestor, descendant) { return this.reachable(descendant).has(ancestor); }
  /** `git log --full-history --diff-filter=A --format=%H HEAD -- <path>`. */
  introductions(path) {
    // Log shows no diff for a merge unless asked, so --diff-filter=A never
    // selects one; a root or single-parent commit is selected by its own A.
    return (this.#byPath.get(path) ?? []).filter((sha) => this.#parents.get(sha).length <= 1 && this.#changed.get(sha).get(path).status === "A");
  }
  /** `git rev-list --full-history <base>..HEAD -- <path>` (same set as `git log --format=%H`). */
  rangeTouches(base, path) {
    const uninteresting = this.reachable(base);
    const result = [];
    for (const sha of this.#byPath.get(path) ?? []) {
      if (uninteresting.has(sha)) continue;
      const ps = this.#parents.get(sha);
      if (ps.length === 0) { result.push(sha); continue; }
      const own = this.#key(sha, path);
      // revision.c try_to_simplify_commit: with any relevant parent, only
      // relevant parents decide TREESAME; otherwise every parent does.
      const relevant = ps.filter((p) => !uninteresting.has(p) || p === base);
      const deciding = relevant.length > 0 ? relevant : ps;
      if (deciding.some((p) => this.#key(p, path) !== own)) result.push(sha);
    }
    return result;
  }
  /** Whether `git log --full-history -1 --format=%H <ref> -- <path>` prints a commit. */
  hasPathHistory(commit, path) {
    const reach = this.reachable(commit);
    return (this.#byPath.get(path) ?? []).some((sha) => reach.has(sha));
  }
}

export function buildGitHistoryIndex(root, { scope = GIT_HISTORY_INDEX_SCOPE } = {}) {
  const output = execFileSync("git", [...GIT_HISTORY_INDEX_ARGS, "HEAD", "--", scope], { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 });
  return new GitHistoryIndex(output, { scope });
}

let active = null;

/**
 * Run `fn` with one batched history index for `root`'s HEAD. Built lazily on
 * the first question; if it cannot be built or parsed, every question falls
 * back to its per-record `git` command.
 */
export function withGitHistoryIndex(root, fn, { build = buildGitHistoryIndex } = {}) {
  const previous = active;
  active = { root: realpathSync(root), originalRoot: root, state: "pending", index: null, build, contents: new Map() };
  try { return fn(); } finally { active = previous; }
}

function indexFor(root, head) {
  if (active === null || (head !== "HEAD" && !SHA1.test(head ?? ""))) return null;
  let real;
  try { real = realpathSync(root); } catch { return null; }
  if (real !== active.root) return null;
  if (active.state === "pending") {
    try { active.index = active.build(active.originalRoot); active.state = "ready"; }
    catch { active.state = "unavailable"; }
  }
  if (active.state !== "ready") return null;
  if (head !== "HEAD" && head !== active.index.head) return null;
  return active.index;
}

const git = (root, args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

/** Exactly `git log --full-history --diff-filter=A --format=%H <head> -- <path>`, split into ids. */
export function pathIntroductions(root, head, path) {
  const index = indexFor(root, head);
  if (index?.covers(path)) return index.introductions(path);
  return git(root, ["log", "--full-history", "--diff-filter=A", "--format=%H", head, "--", path]).split("\n").filter(Boolean);
}

/** Exactly `git log --full-history --format=%H <base>..<head> -- <path>`, split into ids. */
export function pathRangeTouches(root, base, head, path, { command = "log" } = {}) {
  const index = indexFor(root, head);
  const bottom = index?.commit(base);
  if (bottom && index.covers(path)) return index.rangeTouches(bottom, path);
  const args = command === "rev-list"
    ? ["rev-list", "--full-history", `${base}..${head}`, "--", path]
    : ["log", "--full-history", "--format=%H", `${base}..${head}`, "--", path];
  return git(root, args).split("\n").filter(Boolean);
}

/** Exactly whether `git log --full-history -1 --format=%H <ref> -- <path>` is non-empty. */
export function pathHasHistory(root, ref, path) {
  const index = indexFor(root, "HEAD");
  const commit = index?.commit(ref);
  if (commit && index.covers(path)) return index.hasPathHistory(commit, path);
  return git(root, ["log", "--full-history", "-1", "--format=%H", ref, "--", path]) !== "";
}

/** Exactly `git rev-parse --verify <ref>:<path>` with stderr ignored; null when it fails. */
export function pathBlobOid(root, ref, path) {
  const index = indexFor(root, "HEAD");
  const commit = index?.commit(ref);
  if (commit && index.covers(path)) return index.blobOid(commit, path);
  try { return execFileSync("git", ["rev-parse", "--verify", `${ref}:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

/** `git rev-list --parents -n 1 <commit>` split as [resolved, ...parents]. */
export function commitParentLine(root, commit) {
  const index = indexFor(root, "HEAD");
  const exact = index?.commit(commit);
  if (exact && exact === commit) return [commit, ...index.parents(commit)];
  return execFileSync("git", ["rev-list", "--parents", "-n", "1", commit], { cwd: root, encoding: "utf8" }).trim().split(/\s+/);
}

/** `git merge-base --is-ancestor <a> <b>` with stdio ignored: returns on success, throws Git's own error otherwise. */
export function assertAncestor(root, ancestor, descendant) {
  const index = indexFor(root, "HEAD");
  const a = index?.commit(ancestor), b = index?.commit(descendant);
  if (a && b && index.isAncestor(a, b)) return;
  execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd: root, stdio: "ignore" });
}

// Blob bytes at an exact commit never change, so one successful read is
// reused for the rest of the scope. Failures are never memoized: they rerun
// the command so Git reports them exactly as before. Large blobs (the root
// lockfile) are not retained.
const CONTENT_MEMO_MAX_BYTES = 256 * 1024;

/** Exactly `git show <ref>:<path>` decoded as UTF-8. */
export function pathContent(root, ref, path) {
  const index = indexFor(root, "HEAD");
  const key = index && SHA1.test(ref ?? "") && index.commit(ref) === ref ? `${ref}:${path}` : null;
  if (key !== null && active.contents.has(key)) return active.contents.get(key);
  const bytes = execFileSync("git", ["show", `${ref}:${path}`], { cwd: root, encoding: "utf8" });
  if (key !== null && bytes.length <= CONTENT_MEMO_MAX_BYTES) active.contents.set(key, bytes);
  return bytes;
}
