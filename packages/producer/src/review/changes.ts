/**
 * The changed set of a review (`git diff base...head`): files, the packages that hold them, the head-side line ranges
 * of each hunk, and the forbidden-path findings (bump freeze, retired leaves, baseline and allowlist growth).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { git } from "./exec.js";
import type { Finding } from "./types.js";

export interface Change { readonly status: string; readonly path: string; readonly from?: string; readonly added: number; readonly deleted: number }

/** `git diff --name-status` plus `--numstat` of base...head (merge base to head), renames resolved. */
export function changedFiles(repo: string, base: string, head: string): Change[] {
  const range = `${base}...${head}`;
  const status = git(repo, ["diff", "--name-status", "-M", "-z", range]).split("\0").filter(Boolean);
  const numstat = new Map<string, [number, number]>();
  const nums = git(repo, ["diff", "--numstat", "-M", "-z", range]).split("\0");
  for (let i = 0; i < nums.length; i++) {
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(nums[i]!);
    if (!match) continue;
    // A rename's numstat names no path inline: the next two fields are from and to.
    const path = match[3] ? match[3] : (i += 2, nums[i]!);
    numstat.set(path, [match[1] === "-" ? 0 : Number(match[1]), match[2] === "-" ? 0 : Number(match[2])]);
  }
  const changes: Change[] = [];
  for (let i = 0; i < status.length; i++) {
    const code = status[i]!;
    const from = /^[RC]/.test(code) ? status[++i] : undefined;
    const path = status[++i]!;
    const [added, deleted] = numstat.get(path) ?? [0, 0];
    changes.push({ status: code[0]!, path, ...(from ? { from } : {}), added, deleted });
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

/** The nearest directory at or above file (repo-relative) holding a package.json, "." for the root. */
export function packageOf(tree: string, file: string): string {
  let dir = dirname(file);
  while (dir !== "." && dir !== "/" && dir !== "") {
    if (existsSync(join(tree, dir, "package.json"))) return dir;
    dir = dirname(dir);
  }
  return ".";
}

/** Head-side line ranges (1-based, inclusive) of every hunk of file in base...head. */
export function headHunks(repo: string, base: string, head: string, file: string): [number, number][] {
  const out = git(repo, ["diff", "-U0", `${base}...${head}`, "--", file]);
  const ranges: [number, number][] = [];
  for (const match of out.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(match[1]), count = match[2] === undefined ? 1 : Number(match[2]);
    if (count > 0) ranges.push([start, start + count - 1]);
  }
  return ranges;
}

/** Forbidden-path rules: id, what it matches, why. Doc text is generated from this table. */
export const FORBIDDEN_RULES: readonly { readonly id: string; readonly matches: string; readonly test: (change: Change) => boolean }[] = [
  { id: "forbidden.changelog", matches: "any CHANGELOG file, or a .changeset/*.md entry (bump freeze)", test: change => /(^|\/)CHANGELOG(\.[a-z]+)?$/i.test(change.path) || /^\.changeset\/(?!README\.md$)[^/]+\.md$/.test(change.path) },
  { id: "forbidden.release-catalog", matches: "any release-catalog.json", test: change => /(^|\/)release-catalog\.json$/.test(change.path) },
  { id: "forbidden.retired-leaves", matches: "any retired-leaves.ts", test: change => /(^|\/)retired-leaves\.ts$/.test(change.path) || /(^|\/)retired-leaves\.ts$/.test(change.from ?? "") },
  { id: "forbidden.baseline", matches: "an added line in a file named *baseline* or *allowlist*/*allow-list*, or in governance/known-*.json", test: change => change.added > 0 && change.status !== "D" && (/(baseline|allow-?list)[^/]*$/i.test(change.path) || /^governance\/known-[^/]+\.json$/.test(change.path)) },
];

const VERSION_RULE = "forbidden.version";
export const FORBIDDEN_IDS = [...FORBIDDEN_RULES.map(rule => rule.id), VERSION_RULE] as const;

const manifestVersion = (repo: string, rev: string, path: string): string | undefined => {
  try { return (JSON.parse(git(repo, ["show", `${rev}:${path}`])) as { version?: string }).version; } catch { return undefined; }
};

/** Every forbidden edit in changes; a package.json whose "version" differs between base and head is forbidden.version. */
export function forbiddenFindings(repo: string, base: string, head: string, changes: readonly Change[]): Finding[] {
  const findings: Finding[] = [];
  for (const change of changes) {
    for (const rule of FORBIDDEN_RULES) if (rule.test(change)) findings.push({ id: rule.id, level: "fail", subject: change.path, detail: `${change.status} ${rule.matches}` });
    if (/(^|\/)package\.json$/.test(change.path) && change.status === "M") {
      const mergeBase = git(repo, ["merge-base", base, head]);
      const before = manifestVersion(repo, mergeBase, change.path), after = manifestVersion(repo, head, change.path);
      if (before !== after) findings.push({ id: VERSION_RULE, level: "fail", subject: change.path, detail: `version ${before ?? "(none)"} -> ${after ?? "(none)"}` });
    }
  }
  return findings;
}

/** A file's text at a tree, or undefined. */
export function readAt(tree: string, file: string): string | undefined {
  try { return readFileSync(join(tree, file), "utf8"); } catch { return undefined; }
}
