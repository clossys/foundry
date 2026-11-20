/**
 * Process and git plumbing for `clossys review` and `clossys receipt`: one blocking runner with a timeout, the
 * output-tail digest a receipt records, and the temporary detached worktrees the review runs in.
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
}

/** Lines of normalized output a receipt digests (the tail). */
export const TAIL_LINES = 40;
/** Default per-command timeout when a caller names none: ten minutes. */
export const COMMAND_TIMEOUT_MS = 600_000;

/** Run argv (or a shell line when argv is a string) in cwd, blocking; a timeout or spawn error is exit 124 or 127. */
export function run(command: readonly string[] | string, cwd: string, options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): RunResult {
  const start = Date.now();
  const [file, args] = typeof command === "string" ? ["/bin/sh", ["-c", command]] as const : [command[0]!, command.slice(1)] as const;
  const result = spawnSync(file, args, {
    cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
    env: { ...process.env, ...options.env }, stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const exit = result.error ? ((result.error as NodeJS.ErrnoException).code === "ETIMEDOUT" ? 124 : 127) : result.status ?? 128;
  return { exit, ms: Date.now() - start, output, stdout: result.stdout ?? "" };
}

/** git in repo; throws with git's message on a non-zero exit. */
export function git(repo: string, args: readonly string[]): string {
  const result = run(["git", ...args], repo);
  if (result.exit !== 0) throw new Error(`git ${args.join(" ")}: ${result.output.trim().split("\n").slice(-1)[0] ?? `exit ${result.exit}`}`);
  return result.output.replace(/\n$/, "");
}

/** The output a receipt digests: no colour codes, the tree and temp roots as placeholders, every digit run as 0. */
export function normalizeOutput(output: string, roots: readonly string[] = []): string {
  let text = output.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
  for (const root of [...roots, tmpRoot()].filter(Boolean).sort((a, b) => b.length - a.length)) text = text.split(root).join("<root>");
  return text.replace(/\d+/g, "0");
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

/**
 * A temporary detached working tree of rev: a `git clone --shared` of repo (objects borrowed, nothing copied) checked
 * out at rev, in a temp folder. It registers nothing in repo, so remove() is deleting the temp folder.
 */
export function addWorktree(repo: string, rev: string, label: string): Worktree {
  const parent = scratch(`clossys-review-${label}-`);
  const dir = join(parent, "tree");
  const sha = git(repo, ["rev-parse", "--verify", `${rev}^{commit}`]);
  git(parent, ["clone", "--quiet", "--shared", "--no-checkout", repo, dir]);
  git(dir, ["-c", "advice.detachedHead=false", "checkout", "--quiet", "--detach", sha]);
  return { dir, remove() { rmSync(parent, { recursive: true, force: true }); } };
}
