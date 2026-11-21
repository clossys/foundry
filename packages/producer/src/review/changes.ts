/**
 * The changed set of a review (`git diff base...head`): files, the packages that hold them, the head-side line ranges
 * of each hunk, and the forbidden-path findings (bump freeze, retired leaves, baseline and allowlist growth).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { git } from "./exec.js";
import type { Finding } from "./types.js";

export interface Change { readonly status: string; readonly path: string; readonly from?: string; readonly added: number; readonly deleted: number; readonly binary?: boolean }

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
    numstat.set(path, [match[1] === "-" ? -1 : Number(match[1]), match[2] === "-" ? -1 : Number(match[2])]);
  }
  const changes: Change[] = [];
  for (let i = 0; i < status.length; i++) {
    const code = status[i]!;
    const from = /^[RC]/.test(code) ? status[++i] : undefined;
    const path = status[++i]!;
    const [added, deleted] = numstat.get(path) ?? [0, 0];
    // A binary file's numstat is "-": no line counts, so any change to it counts as an addition.
    const binary = added < 0;
    changes.push({ status: code[0]!, path, ...(from ? { from } : {}), added: Math.max(added, 0), deleted: Math.max(deleted, 0), ...(binary ? { binary } : {}) });
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

const CHANGELOG = (path: string) => /(^|\/)CHANGELOG(\.[a-z]+)?$/i.test(path) || /^\.changeset\/(?!README\.md$)[^/]+\.md$/.test(path);
const RELEASE_CATALOG = (path: string) => /(^|\/)release-catalog\.json$/.test(path);
const RETIRED_LEAVES = (path: string) => /(^|\/)retired-leaves\.ts$/.test(path);
/** A file that loosens a check by listing what it lets through: a baseline, allowlist, exemption list or ceiling. */
const LOOSENING = (path: string) => /(baseline|allow-?list)[^/]*$/i.test(path) || /^governance\/known-[^/]+\.json$/.test(path)
  || /(exemption|ceiling)[^/]*\.(?:json|jsonc|ya?ml|txt|csv|tsv)$/i.test(path);
/** Either side of a change: the path, and the path a rename or copy came from. */
const either = (change: Change, test: (path: string) => boolean) => test(change.path) || (change.from !== undefined && test(change.from));

/** Forbidden-path rules: id, what it matches, why. Doc text is generated from this table. */
export const FORBIDDEN_RULES: readonly { readonly id: string; readonly matches: string; readonly test: (change: Change) => boolean }[] = [
  { id: "forbidden.changelog", matches: "any CHANGELOG file or .changeset/*.md entry, as either side of a change (a rename away included; bump freeze)", test: change => either(change, CHANGELOG) },
  { id: "forbidden.release-catalog", matches: "any release-catalog.json, as either side of a change (a rename away included)", test: change => either(change, RELEASE_CATALOG) },
  { id: "forbidden.retired-leaves", matches: "any retired-leaves.ts, as either side of a change", test: change => either(change, RETIRED_LEAVES) },
  {
    id: "forbidden.baseline",
    matches: "an addition to a file named *baseline* or *allowlist*/*allow-list*, a governance/known-*.json, or a data file (json, yaml, txt, csv) named *exemption* or *ceiling*: an added line, any change to a binary one, or a rename or copy into such a name",
    test: change => change.status !== "D" && LOOSENING(change.path) && (change.added > 0 || change.binary === true || (change.from !== undefined && !LOOSENING(change.from))),
  },
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
