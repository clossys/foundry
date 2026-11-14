/**
 * Git history of the agent trees for R08 (immutability): one `git log --raw` over
 * `<consumer>/agents` and one `git status`, both read-only. Every path's changes come back oldest
 * first; rows are judged from them in checks/R08-immutability.ts. Contents are never read from git.
 */
import { execFileSync } from "node:child_process";
import { relative, sep } from "node:path";
import type { CandidateHistory, PathChange } from "./types.js";

const posix = (path: string) => path.split(sep).join("/");
const git = (cwd: string, args: readonly string[]) => execFileSync("git", args, { cwd, maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).toString("utf8");

/**
 * Parses `git log --format=%x00%H --name-status --no-renames` output (newest commit first) into
 * each path's changes, oldest first. Paths are as git prints them (repository-relative). It also
 * reads `--raw --no-abbrev` lines (`:<mode> <mode> <blob> <blob> <status>\t<path>`), which add the
 * blob ids before and after each change (what a recorded migration is matched on, R08.2).
 */
export function parseNameStatusLog(output: string): Map<string, PathChange[]> {
  const changes = new Map<string, PathChange[]>();
  for (const block of output.split("\0")) {
    const lines = block.split("\n");
    const commit = lines[0]?.trim();
    if (!commit) continue;
    for (const line of lines.slice(1)) {
      const raw = /^:\d{6} \d{6} ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([AMDT])\t(.+)$/.exec(line);
      const match = raw ? null : /^([AMDT])\t(.+)$/.exec(line);
      if (!raw && !match) continue;
      const path = raw ? raw[4]! : match![2]!;
      const status = (raw ? raw[3] : match![1]) as PathChange["status"];
      const list = changes.get(path) ?? [];
      list.push(raw ? { commit, status, from: raw[1]!, to: raw[2]! } : { commit, status });
      changes.set(path, list);
    }
  }
  for (const list of changes.values()) list.reverse();
  return changes;
}

/** The working-tree paths of `git status --porcelain=v1 -z` whose tracked bytes differ from HEAD or the index. */
export function parseStatus(output: string): Set<string> {
  const dirty = new Set<string>();
  const parts = output.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]!;
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2), path = entry.slice(3);
    if (xy[0] === "R" || xy[0] === "C") i++; // the next field is the source path
    if (/[MT]/.test(xy)) dirty.add(path);
  }
  return dirty;
}

/** Reads the history of `<consumer>/agents`; paths in the result are relative to `root`. */
export function readCandidateHistory(root: string, consumer: string): CandidateHistory {
  let top: string;
  try { top = git(consumer, ["rev-parse", "--show-toplevel"]).trim(); }
  catch (error) { return { available: false, error: `no git history: ${(error as Error).message.split("\n")[0]}`, changes: new Map(), dirty: new Set() }; }
  const scope = posix(relative(top, consumer)) || ".";
  const agents = scope === "." ? "agents" : `${scope}/agents`;
  const toRoot = (path: string) => posix(relative(root, `${top}/${path}`));
  try {
    const log = parseNameStatusLog(git(top, ["log", "--format=%x00%H", "--raw", "--no-abbrev", "--no-renames", "--", agents]));
    const status = parseStatus(git(top, ["status", "--porcelain=v1", "-z", "--untracked-files=no", "--", agents]));
    return {
      available: true,
      changes: new Map([...log].map(([path, list]) => [toRoot(path), list])),
      dirty: new Set([...status].map(toRoot)),
    };
  } catch (error) {
    return { available: false, error: `git failed: ${(error as Error).message.split("\n")[0]}`, changes: new Map(), dirty: new Set() };
  }
}
