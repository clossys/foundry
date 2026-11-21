/**
 * Process and git plumbing for `clossys review` and `clossys receipt`: one blocking runner with a timeout, the
 * output-tail digest a receipt records, and the temporary detached trees the review runs in.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface RunResult {
  readonly exit: number;
  readonly ms: number;
  /** stdout then stderr. */
  readonly output: string;
  readonly stdout: string;
  /** The command ran out of its timeout (exit 124). */
  readonly timedOut: boolean;
}

/** Lines of normalized output a receipt digests (the tail). */
export const TAIL_LINES = 40;
/** Default per-command timeout when a caller names none: ten minutes. */
export const COMMAND_TIMEOUT_MS = 600_000;

/** Run argv (or a shell line when argv is a string) in cwd, blocking; a timeout or spawn error is exit 124 or 127. */
export function run(command: readonly string[] | string, cwd: string, options: { env?: NodeJS.ProcessEnv; timeoutMs?: number; input?: string } = {}): RunResult {
  const start = Date.now();
  const [file, args] = typeof command === "string" ? ["/bin/sh", ["-c", command]] as const : [command[0]!, command.slice(1)] as const;
  const result = spawnSync(file, args, {
    cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
    env: { ...process.env, ...options.env }, stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    ...(options.input === undefined ? {} : { input: options.input }),
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  const exit = result.error ? (timedOut ? 124 : 127) : result.status ?? 128;
  return { exit, ms: Date.now() - start, output, stdout: result.stdout ?? "", timedOut };
}

/** How a finding reports a run: its exit code, and the timeout when it ran out of it. */
export function exitText(result: Pick<RunResult, "exit" | "ms" | "timedOut">): string {
  return `exit ${result.exit}${result.timedOut ? ` (timed out after ${Math.round(result.ms / 1000)}s)` : ""}`;
}

/** git in repo; throws with git's message on a non-zero exit. */
export function git(repo: string, args: readonly string[]): string {
  const result = run(["git", ...args], repo);
  if (result.exit !== 0) throw new Error(`git ${args.join(" ")}: ${result.output.trim().split("\n").slice(-1)[0] ?? `exit ${result.exit}`}`);
  return result.output.replace(/\n$/, "");
}

/**
 * What normalizing replaces, in order (docs/review.md): only machine state and wall-clock readings. Every other
 * number, a count of failed tests among them, is digested as printed.
 */
export const NORMALIZED: readonly { readonly as: string; readonly pattern: RegExp; readonly what: string }[] = [
  { as: "<date>", pattern: /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, what: "an ISO date and time" },
  { as: "<clock>", pattern: /\b\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\b/g, what: "a clock time hh:mm:ss" },
  { as: "<duration>", pattern: /\b\d+(?:\.\d+)?\s?(?:ms|s|sec|secs|seconds?|m|min|mins|minutes?|h)(?![\w])/g, what: "a number with a time unit (ms, s, m, min, h)" },
  { as: "<size>", pattern: /\b\d+(?:\.\d+)?\s?(?:[KMGTPE]i?B?|kB|k|B|bytes?)(?![\w])/g, what: "a number with a size unit (B, k, K, Ki, KB, M, Mi, G, Gi, ...)" },
  { as: "<percent>", pattern: /\b\d+(?:\.\d+)?%/g, what: "a percentage" },
];

/** The output a receipt digests: no colour codes or carriage returns, the tree and temp roots as `<root>`, NORMALIZED applied. */
export function normalizeOutput(output: string, roots: readonly string[] = []): string {
  let text = output.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
  for (const root of [...roots, tmpRoot()].filter(Boolean).sort((a, b) => b.length - a.length)) text = text.split(root).join("<root>");
  for (const item of NORMALIZED) text = text.replace(item.pattern, item.as);
  return text;
}

/** sha256 of the last TAIL_LINES non-empty normalized lines. */
export function tailSha(output: string, roots: readonly string[] = []): string {
  const lines = normalizeOutput(output, roots).split("\n").map(line => line.trimEnd()).filter(line => line.length > 0);
  return createHash("sha256").update(lines.slice(-TAIL_LINES).join("\n")).digest("hex");
}

/** The resolved temp root (macOS /var is a symlink). */
export function tmpRoot(): string {
  try { return realpathSync(tmpdir()); } catch { return tmpdir(); }
}

export function scratch(prefix: string): string {
  return mkdtempSync(join(tmpRoot(), prefix));
}

export interface Worktree { readonly dir: string; remove(): void }

/** The refs a review tree mirrors from the repository, so a command naming a branch or tag resolves as in the checkout. */
export const MIRRORED_REFS = ["refs/heads", "refs/remotes", "refs/tags"] as const;

/** `git update-ref --no-deref --stdin` in dir; throws with git's message. */
function updateRefs(dir: string, lines: readonly string[]): void {
  if (!lines.length) return;
  const result = run(["git", "update-ref", "--no-deref", "--stdin"], dir, { input: `${lines.join("\n")}\n` });
  if (result.exit !== 0) throw new Error(`git update-ref: ${result.output.trim().split("\n").slice(-1)[0] ?? exitText(result)}`);
}

/**
 * A temporary detached working tree of rev: a `git clone --shared` of repo (objects borrowed, nothing copied) checked
 * out detached at rev, in a temp folder, whose refs are then made exactly repo's own (MIRRORED_REFS: the clone's
 * `origin/*` view of repo's branches is dropped, repo's branches, remote-tracking branches and tags are written as
 * they are in repo). It registers nothing in repo, so remove() is deleting the temp folder.
 */
export function addWorktree(repo: string, rev: string, label: string): Worktree {
  const parent = scratch(`clossys-review-${label}-`);
  const dir = join(parent, "tree");
  try {
    const sha = git(repo, ["rev-parse", "--verify", `${rev}^{commit}`]);
    git(parent, ["clone", "--quiet", "--shared", "--no-checkout", repo, dir]);
    git(dir, ["-c", "advice.detachedHead=false", "checkout", "--quiet", "--detach", sha]);
    const listed = git(repo, ["for-each-ref", "--format=%(objectname) %(refname) %(symref)", ...MIRRORED_REFS]).split("\n").filter(Boolean).map(line => line.split(" "));
    const own = git(dir, ["for-each-ref", "--format=%(refname)", ...MIRRORED_REFS]).split("\n").filter(Boolean);
    updateRefs(dir, own.map(ref => `delete ${ref}`));
    updateRefs(dir, listed.filter(([, , symref]) => !symref).map(([object, ref]) => `update ${ref} ${object}`));
    for (const [, ref, symref] of listed) if (symref) git(dir, ["symbolic-ref", ref!, symref]);
  } catch (error) {
    rmSync(parent, { recursive: true, force: true });
    throw error;
  }
  return { dir, remove() { rmSync(parent, { recursive: true, force: true }); } };
}
