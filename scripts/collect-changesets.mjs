#!/usr/bin/env node
// collect-changesets — parse and validate the pending release changesets
// under .changesets/, and report them.
//
//   node scripts/collect-changesets.mjs [--json]
//
// Exit 0 = every file under .changesets/ (other than README.md) is a
// well-formed changeset. Exit 1 = at least one is malformed. Exit 2 = the
// directory could not be read.
//
// WHY THIS EXISTS (issue #1255)
// ------------------------------
// Batches releases in the changesets style: a pull request that changes a
// package's packed content adds a small file here instead of bumping the
// package's own version directly. scripts/check-release-readiness.mjs
// accepts a pending changeset as an alternative to a same-PR version bump
// (see that script's own comment). scripts/apply-release-changesets.mjs is
// the release PR: it reads every changeset this module discovers, bumps
// each named package once (highest bump level named across all its
// changesets), writes the CHANGELOG entry, and deletes the changesets it
// applied.
//
// FILE FORMAT
// -----------
// .changesets/<slug>.md, filename matching ^[a-z0-9][a-z0-9-]*\.md$:
//
//   ---
//   controller: minor
//   writer: patch
//   ---
//
//   Add the shared lifecycle vocabulary consumed by check-package-framework.
//
// The frontmatter key is the packages/<dir> directory name (the same key
// governance/release-qualification-deferrals.json uses), never the scoped
// npm name -- the directory is the one join every other script in this
// repository already uses, and it is invariant across an identity
// transition (docs/PUBLISHING.md's W1D/W1E boundary) where the npm name is
// not. The value is one of patch/minor/major. Everything after the closing
// `---` is the summary, trimmed, and must be non-empty -- it becomes the
// CHANGELOG line verbatim.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CHANGESETS_DIR = ".changesets";
export const BUMP_LEVELS = ["patch", "minor", "major"];
const FILENAME_RE = /^[a-z0-9][a-z0-9-]*\.md$/;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

// Every packages/<dir> name that actually exists on disk, so a changeset is
// validated against real packages rather than a hand-maintained list.
function discoverPackageDirs(root) {
  const packagesDir = join(root, "packages");
  if (!existsSync(packagesDir)) return new Set();
  return new Set(
    readdirSync(packagesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(packagesDir, d.name, "package.json")))
      .map((d) => d.name),
  );
}

// Parses one changeset file's text. Returns `{ packages: { [dir]: bumpLevel }, summary }`
// on success, or `{ error }` naming exactly what is wrong -- never throws, so
// a caller can attribute the error to the right file and keep validating
// the rest.
export function parseChangesetText(text, { knownPackageDirs } = {}) {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return { error: "must open with a `---` frontmatter block naming at least one package, then `---`, then a summary" };
  const [, frontmatter, body] = match;
  const summary = body.trim();
  if (summary.length === 0) return { error: "summary (everything after the closing `---`) must not be empty" };

  const packages = {};
  const lines = frontmatter.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return { error: "frontmatter must name at least one package" };
  for (const line of lines) {
    const lineMatch = /^"?([^":]+)"?\s*:\s*(\S+)$/.exec(line);
    if (!lineMatch) return { error: `frontmatter line is not "<package>: <bump>": ${JSON.stringify(line)}` };
    const [, pkg, bump] = lineMatch;
    if (knownPackageDirs && !knownPackageDirs.has(pkg)) return { error: `frontmatter names "${pkg}", which is not a packages/ directory` };
    if (!BUMP_LEVELS.includes(bump)) return { error: `frontmatter names "${pkg}: ${bump}" -- bump must be one of ${BUMP_LEVELS.join(", ")}` };
    if (Object.hasOwn(packages, pkg)) return { error: `frontmatter names "${pkg}" more than once` };
    packages[pkg] = bump;
  }
  return { packages, summary };
}

// Reads every file under .changesets/ (README.md is documentation, not a
// changeset, and is skipped) and validates each. Returns
// `{ entries, findings }`: `entries` is every well-formed changeset
// (`{ file, packages, summary }`, sorted by file name for determinism);
// `findings` is one `{ severity: "error", file, message }` per malformed
// file or bad filename.
export function loadChangesets(root = process.cwd()) {
  const dir = resolve(root, CHANGESETS_DIR);
  if (!existsSync(dir)) return { entries: [], findings: [] };
  const knownPackageDirs = discoverPackageDirs(root);
  const findings = [];
  const entries = [];
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name !== "README.md")
    .map((d) => d.name)
    .sort();
  for (const file of files) {
    if (!FILENAME_RE.test(file)) {
      findings.push({ severity: "error", file, message: `filename must match ${FILENAME_RE} (lowercase, digits, hyphens, .md)` });
      continue;
    }
    const text = readFileSync(join(dir, file), "utf8");
    const result = parseChangesetText(text, { knownPackageDirs });
    if (result.error) {
      findings.push({ severity: "error", file, message: result.error });
      continue;
    }
    entries.push({ file, packages: result.packages, summary: result.summary });
  }
  return { entries, findings };
}

// Every changeset entry that names `packageDir`, each paired with just that package's bump level.
export function changesetsForPackage(entries, packageDir) {
  return entries.filter((e) => Object.hasOwn(e.packages, packageDir)).map((e) => ({ file: e.file, bump: e.packages[packageDir], summary: e.summary }));
}

// The highest of several bump levels (major > minor > patch). Throws on an
// empty list -- a caller only calls this once it knows there is at least one.
export function highestBumpLevel(levels) {
  if (levels.length === 0) throw new Error("highestBumpLevel: no levels given");
  return levels.reduce((best, level) => (BUMP_LEVELS.indexOf(level) > BUMP_LEVELS.indexOf(best) ? level : best));
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const root = process.cwd();

  let entries, findings;
  try {
    ({ entries, findings } = loadChangesets(root));
  } catch (error) {
    const message = `could not read ${CHANGESETS_DIR}/: ${error instanceof Error ? error.message : String(error)}`;
    if (json) console.log(JSON.stringify({ error: message, entries: [], findings: [] }, null, 2));
    else console.error(`collect-changesets: ${message}`);
    process.exit(2);
  }

  if (json) {
    console.log(JSON.stringify({ entries, findings }, null, 2));
  } else {
    if (entries.length === 0 && findings.length === 0) {
      console.log("no pending changesets.");
    } else {
      for (const e of entries) {
        console.log(`  [OK]    ${e.file} -- ${Object.entries(e.packages).map(([p, b]) => `${p}:${b}`).join(", ")} -- ${e.summary.split("\n")[0]}`);
      }
      for (const f of findings) {
        console.log(`  [ERROR] ${basename(f.file)} -- ${f.message}`);
      }
    }
    console.log("");
    console.log(
      findings.length === 0
        ? `CHANGESETS OK -- ${entries.length} pending changeset(s), all well-formed.`
        : `CHANGESETS FAIL -- ${findings.length} malformed file(s) under ${CHANGESETS_DIR}/ (see ERROR lines above).`,
    );
  }
  process.exit(findings.length === 0 ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
