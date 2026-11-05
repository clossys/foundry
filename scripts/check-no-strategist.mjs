#!/usr/bin/env node
// check:no-strategist: the Director is called the Director (owner,
// 2026-11-04). No live path or line in the tree may spell the retired role
// name, in any case, in a file path or in file content.
//
// History is left as written, and is the only place the word may stay:
//
//   - HISTORY_PREFIXES: dated records (release records and policy, identity
//     history, changelogs, pending changesets, decisions, RFCs, evidence
//     snapshots, the controller's historical contracts) and the sealed
//     digest corpora whose values were computed outside this repository;
//   - UPSTREAM_SOURCES: third-party source vendored byte for byte and sealed
//     by tree hash (packages/designer/references, checked by
//     check:ref-verbatim and the references manifest); its English text
//     ("Content Strategist" as a job title) is upstream's, not a role name;
//   - CONTENT_ADDRESSED_HISTORY: lines recorded by sha256 in
//     governance/package-identity-history.json, which must stay unchanged;
//   - a reference to a file under a history prefix (a README linking its
//     changelog) names that record as it is spelled;
//   - RENAME_MAP: scripts/lib/package-renames.mjs, the one live source that
//     maps a published identity to its workspace package, and this check and
//     its test, which must name the word they forbid;
//   - SELF_NAME: this check's own name (check:no-strategist and its script
//     files), wherever the check is wired or cited; nothing else on that line
//     is excused.
//
// Usage: node scripts/check-no-strategist.mjs [--root DIR] [--json]
// Exit 0 when nothing is found, 1 on any finding, 2 on a usage or environment error.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WORD = /strategist/i;

export const HISTORY_PREFIXES = Object.freeze([
  "governance/release-",
  "governance/package-identity-history.json",
  "governance/package-identity-transition.json",
  "governance/package-repository-history.json",
  "docs/changelogs/",
  ".changesets/",
  "docs/DECISIONS.md",
  "docs/rfcs/",
  "docs/evidence/",
  "packages/controller/contracts/historical/",
  // Sealed digest corpora (#1178, #1475): their values were computed
  // independently of this repository and are compared byte for byte.
  "docs/contracts/apply-change-set-digest.fixture.json",
  "docs/contracts/installed-ledger.fixture.json",
  "docs/contracts/advisor-plan-digest.fixture.json",
  "docs/contracts/advisor-plan-rules.fixture.json",
]);

/** Vendored upstream source, kept verbatim and sealed by its manifest's tree hashes. */
export const UPSTREAM_SOURCES = Object.freeze(["packages/designer/references/"]);

export const CONTENT_ADDRESSED_HISTORY = "governance/package-identity-history.json";

export const RENAME_MAP = Object.freeze([
  "scripts/lib/package-renames.mjs",
  "scripts/check-no-strategist.mjs",
  "scripts/check-no-strategist.test.mjs",
]);

/** This check's own name, as a script key or a script path. */
export const SELF_NAME = /check[:-]no-strategist(?:\.test)?(?:\.mjs)?/g;

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A path into a history prefix, as text inside a line: the record is named as it is spelled. */
const HISTORY_REFERENCE = new RegExp(`(?:${HISTORY_PREFIXES.map(escape).join("|")})[\\w./@-]*`, "g");

export const isHistoryPath = (path) => HISTORY_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function recordedLines(root) {
  const recorded = new Map();
  const path = join(root, CONTENT_ADDRESSED_HISTORY);
  if (!existsSync(path)) return recorded;
  const history = JSON.parse(readFileSync(path, "utf8"));
  for (const reference of history.references ?? []) {
    if (typeof reference?.path !== "string" || typeof reference?.lineSha256 !== "string") continue;
    if (!recorded.has(reference.path)) recorded.set(reference.path, new Set());
    recorded.get(reference.path).add(reference.lineSha256.replace(/^sha256:/, ""));
  }
  return recorded;
}

function trackedFiles(root) {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return [...new Set(out.split("\0").filter(Boolean))].sort();
}

/** Findings for one file's path and text. `recorded` is the set of line digests history keeps for this path. */
export function fileFindings(path, text, recorded = new Set()) {
  if (isHistoryPath(path) || RENAME_MAP.includes(path) || UPSTREAM_SOURCES.some((prefix) => path.startsWith(prefix))) return [];
  const findings = [];
  if (WORD.test(path)) findings.push({ path, line: 0, text: path });
  if (text === null) return findings;
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!WORD.test(line)) continue;
    if (recorded.has(sha256(line))) continue;
    if (!WORD.test(line.replace(HISTORY_REFERENCE, "").replace(SELF_NAME, ""))) continue;
    findings.push({ path, line: index + 1, text: line.trim().slice(0, 160) });
  }
  return findings;
}

const isBinary = (buffer) => buffer.subarray(0, 8000).includes(0);

export function checkNoStrategist(root) {
  const recorded = recordedLines(root);
  const findings = [];
  let scanned = 0;
  for (const path of trackedFiles(root)) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) continue;
    scanned += 1;
    let text = null;
    try {
      const buffer = readFileSync(absolute);
      text = isBinary(buffer) ? null : buffer.toString("utf8");
    } catch {
      text = null;
    }
    findings.push(...fileFindings(path, text, recorded.get(path)));
  }
  return { scanned, findings };
}

function parseArgs(argv) {
  const args = { root: resolve(fileURLToPath(new URL("..", import.meta.url))), json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--json") args.json = true;
    else if (flag === "--root" && argv[index + 1]) args.root = resolve(argv[++index]);
    else throw new Error(`unknown argument ${flag}; usage: check-no-strategist.mjs [--root DIR] [--json]`);
  }
  return args;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(`check:no-strategist: ${error.message}`); process.exit(2); }
  let result;
  try { result = checkNoStrategist(args.root); }
  catch (error) { console.error(`check:no-strategist: ERROR ${error.message}`); process.exit(2); }
  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else for (const finding of result.findings) console.log(`FAIL ${finding.path}${finding.line ? `:${finding.line}` : " (path)"}  ${finding.text}`);
  const files = new Set(result.findings.map((finding) => finding.path)).size;
  if (result.findings.length) {
    console.log(`check:no-strategist: FAIL ${result.findings.length} finding(s) in ${files} file(s) of ${result.scanned} scanned`);
    process.exit(1);
  }
  console.log(`check:no-strategist: PASS ${result.scanned} file(s) scanned; history left as written`);
}
