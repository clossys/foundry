/**
 * `check --constitution --changed <ref>` (`npm run check:changed`): the slots a change touched,
 * versus a base ref, as a constitution focus (types.ts FocusTarget). The run then checks only those
 * slots, so a data unit's Done-when costs seconds instead of the whole-tree strict gate (which stays
 * in the root `check`).
 *
 * Deterministic and model-free: the input is `git diff --name-only --no-renames <ref>` (committed
 * and working-tree changes) plus the untracked, non-ignored files, both limited to
 * `<consumer>/agents`. A path under `<agent>/<slot>/` focuses that slot; an agent-level file
 * (`ia.json`, `ledger.json`, ...) is kept as a path, so the rows about that file are judged too.
 * A deleted slot focuses nothing of its own (its folder is gone); the rows it leaves on other slots
 * are the root strict gate's to find.
 */
import { execFileSync } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import { isSlotFolderName } from "../records/slots.js";
import { MODEL_AGENTS } from "../records/slot-model/types.js";
import type { FocusTarget } from "./types.js";

export interface ChangedSlots {
  /** The changed slots, sorted, one per `<agent>/<slot>`. */
  readonly focus: readonly FocusTarget[];
  /** Workspace-relative agent-level files that changed (rows on these paths are kept). */
  readonly paths: readonly string[];
  /** Every changed path under `<consumer>/agents`, workspace-relative, sorted. */
  readonly files: readonly string[];
}

const git = (cwd: string, args: readonly string[]): string[] =>
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 })
    .toString("utf8").split("\n").map(line => line.trim()).filter(Boolean);

const posix = (path: string) => path.split(sep).join("/");

/** The slot focus for every path under `<consumer>/agents` that differs from `base` (see the module comment). */
export function changedSlots(root: string, consumer: string, base: string): ChangedSlots {
  if (!/^[A-Za-z0-9._/@{}~^-]+$/.test(base) || base.startsWith("-")) throw new Error(`--changed: not a git ref: ${base}`);
  const agents = resolve(consumer, "agents");
  const top = git(root, ["rev-parse", "--show-toplevel"])[0]!;
  const scope = posix(relative(top, agents)) || ".";
  const names = new Set([
    ...git(top, ["diff", "--name-only", "--no-renames", base, "--", scope]),
    ...git(top, ["ls-files", "--others", "--exclude-standard", "--", scope]),
  ]);
  const focus = new Map<string, FocusTarget>();
  const paths = new Set<string>();
  const files: string[] = [];
  for (const name of names) {
    const abs = resolve(top, name);
    const rel = posix(relative(agents, abs));
    if (rel.startsWith("..")) continue;
    files.push(posix(relative(root, abs)));
    const [agent, entry, ...rest] = rel.split("/");
    if (!agent || !(MODEL_AGENTS as readonly string[]).includes(agent) || !entry) continue;
    if (rest.length && isSlotFolderName(entry)) focus.set(`${agent}/${entry}`, { agent, slot: entry });
    else paths.add(posix(relative(root, abs)));
  }
  return {
    focus: [...focus.keys()].sort().map(key => focus.get(key)!),
    paths: [...paths].sort(),
    files: files.sort(),
  };
}
