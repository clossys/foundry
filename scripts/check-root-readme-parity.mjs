#!/usr/bin/env node
// check-root-readme-parity — the root README's Packages table is a promise
// about what lives in packages/, and until now nothing checked it.
//
//   node scripts/check-root-readme-parity.mjs [repoRoot] [--json]
//
// Exit 0 = every real package is a table row and every table row is a real
// package. Exit 1 = the table and packages/ disagree. Exit 2 = cannot run.
//
// WHY THIS GATE EXISTS
// ---------------------
// check-readme-parity.mjs (this same directory) runs once per directory
// under packages/ and validates each PACKAGE's own README against its own
// src/index.ts. Nothing plays that role for the repository's own root
// README: it is not "a package" from `check:readme`'s point of view, so the
// loop that walks packages/*/ never looks at it, and it rotted in place.
// The root README's Packages table drifted on two independent axes at
// once — a row describing what shipped as of an early commit and never
// updated as the package grew, and two whole packages added later with no
// row at all — and no gate that only walks packages/*/ can ever see a file
// that sits one level above every directory it walks. The general lesson:
// a checker built to validate each thing INSIDE packages/ has, by
// construction, no way to validate the file that describes packages/ from
// the outside. That needs its own, separate gate, keyed off the repo root,
// not off any one package directory — this file.
//
// WHY EVERYTHING IS DERIVED, NOT HARDCODED
// ------------------------------------------
// The "reality" side of this comparison is the actual `packages/` directory
// listing and each entry's own `package.json` "name" field — never a
// hardcoded roster of package names. A hardcoded list would itself be a
// second copy of the same fact the README already gets wrong, and would go
// stale the exact same way. Reading the filesystem is what makes this gate
// keep working, unchanged, the next time a package is added or removed.
//
// FAIL-CLOSED, EXPLICITLY
// ------------------------
// A gate that cannot find the table, cannot parse a single row from it, or
// finds no real packages to compare against is not "clean" — it inspected
// nothing. Every one of those cases exits 2, distinct from both "0 rows
// found, README matches" (impossible — see below) and "findings, exit 1".
// "Could not check" and "checked and it was fine" must never share an exit
// code, because that collapse is exactly how the defect this gate closes
// survived undetected: a check that silently validates nothing looks
// identical, from CI, to a check that ran and passed.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positional = argv.filter((a) => !a.startsWith("--"));
const repoRootArg = positional[0] ?? ".";

function die(msg, code = 2) {
  console.error(`check-root-readme-parity: ${msg}`);
  process.exit(code);
}

const repoRoot = resolve(repoRootArg);
const readmePath = join(repoRoot, "README.md");
const packagesDir = join(repoRoot, "packages");

if (!existsSync(readmePath)) die(`no README.md at ${readmePath}`);
if (!existsSync(packagesDir)) die(`no packages/ directory at ${packagesDir}`);

let packagesDirStat;
try {
  packagesDirStat = statSync(packagesDir);
} catch (error) {
  die(`cannot stat ${packagesDir}: ${error.message}`);
}
if (!packagesDirStat.isDirectory()) die(`${packagesDir} is not a directory`);

// ------------------------------------------------------------- reality side

// Every immediate subdirectory of packages/ that has a package.json with a
// scoped "name" is a real package. Anything else in there (a stray file, a
// directory mid-scaffold with no manifest yet) is silently not a package —
// the same tolerance packages/*/'s own build/test scripts already have via
// `--if-present`, not a reason to fail.
let packageDirEntries;
try {
  packageDirEntries = readdirSync(packagesDir, { withFileTypes: true });
} catch (error) {
  die(`cannot read ${packagesDir}: ${error.message}`);
}

const realPackages = []; // { name, dir }
for (const entry of packageDirEntries) {
  if (!entry.isDirectory()) continue;
  const dir = join(packagesDir, entry.name);
  const manifestPath = join(dir, "package.json");
  if (!existsSync(manifestPath)) continue;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    die(`packages/${entry.name}/package.json does not parse: ${error.message}`);
  }
  const name = manifest.name;
  if (typeof name !== "string" || !name.startsWith("@") || !name.includes("/")) continue;
  realPackages.push({ name, dir: entry.name });
}

if (realPackages.length === 0) {
  die(`found no real packages under ${packagesDir} (no subdirectory has a package.json with a scoped "name") — nothing to compare the README against`);
}

// ---------------------------------------------------------------- README side

const readmeSrc = readFileSync(readmePath, "utf8");
const readmeLines = readmeSrc.split("\n");

// Find the "## Packages" section the same way check-readme-parity.mjs finds
// "## API": by heading text containing the word, not by an exact literal
// heading, so this survives a heading reworded to "## Published packages"
// or similar. Bounded by the next heading of any level, or EOF.
function findPackagesSectionLines() {
  const start = readmeLines.findIndex((l) => /^#{1,6}\s*.*\bPackages\b/i.test(l));
  if (start === -1) return null;
  let end = readmeLines.length;
  for (let i = start + 1; i < readmeLines.length; i++) {
    if (/^#{1,6}\s/.test(readmeLines[i])) {
      end = i;
      break;
    }
  }
  return [start + 1, end];
}

const section = findPackagesSectionLines();
if (!section) {
  die(`could not locate a "## Packages" heading in ${readmePath} — nothing to validate the table against`);
}

const [sectionStart, sectionEnd] = section;
const separatorRowRe = /^\|?[\s:|-]+\|?$/;

function splitTableRow(line) {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|")) body = body.slice(0, -1);
  return body.split("|").map((c) => c.trim());
}

// A first-column cell looks like `` [`@scope/name`](packages/name) `` or
// plain `` `@scope/name` ``. Either way the package identifier is the first
// `@scope/name`-shaped substring in the cell.
const scopedNameInCellRe = /@[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+/;

const tableRows = []; // { line, name }
let sawSeparator = false;
for (let i = sectionStart; i < sectionEnd; i++) {
  const line = readmeLines[i];
  if (!line.trim().startsWith("|")) {
    sawSeparator = false;
    continue;
  }
  if (!sawSeparator) {
    const next = readmeLines[i + 1] ?? "";
    if (separatorRowRe.test(next.trim()) && next.includes("-")) {
      sawSeparator = true;
      i++; // consume the separator row; never treat it as data
    }
    continue;
  }
  if (separatorRowRe.test(line.trim()) && line.includes("-")) continue;
  const cells = splitTableRow(line);
  if (cells.length === 0) continue;
  const match = cells[0].match(scopedNameInCellRe);
  if (match) tableRows.push({ line: i + 1, name: match[0] });
}

if (tableRows.length === 0) {
  die(
    `found a "## Packages" heading in ${readmePath} but could not parse any package rows from a table under it — the table is missing, malformed, or its first column no longer contains an "@scope/name"-shaped identifier`,
  );
}

// ------------------------------------------------------------------- compare

const realNames = new Set(realPackages.map((p) => p.name));
const tableNames = new Set(tableRows.map((r) => r.name));

const missingFromReadme = realPackages.filter((p) => !tableNames.has(p.name));
const staleInReadme = tableRows.filter((r) => !realNames.has(r.name));

const findings = [
  ...missingFromReadme.map((p) => ({
    check: "missing-row",
    severity: "high",
    message: `packages/${p.dir} publishes "${p.name}" but README.md's Packages table has no row for it`,
  })),
  ...staleInReadme.map((r) => ({
    check: "stale-row",
    severity: "high",
    file: "README.md",
    line: r.line,
    message: `README.md documents "${r.name}" in the Packages table, but no packages/*/package.json has that name`,
  })),
];

const hasFailure = findings.length > 0;

if (flags.has("--json")) {
  console.log(
    JSON.stringify(
      {
        repoRoot: repoRootArg,
        realPackages: realPackages.map((p) => p.name),
        tableRows: tableRows.map((r) => r.name),
        findings,
        ok: !hasFailure,
      },
      null,
      2,
    ),
  );
  process.exit(hasFailure ? 1 : 0);
}

function printGroup(title, items) {
  if (items.length === 0) return;
  console.log(`\n${title}`);
  for (const f of items) {
    const loc = f.file ? ` (${f.file}:${f.line})` : "";
    console.log(`  [${f.severity}]${loc} ${f.message}`);
  }
}

console.log(`check-root-readme-parity: comparing README.md's Packages table against ${realPackages.length} real package(s) under packages/`);
printGroup("MISSING — real packages with no README row", missingFromReadme.map((p) => ({
  severity: "high",
  message: `packages/${p.dir} publishes "${p.name}" but README.md's Packages table has no row for it`,
})));
printGroup("STALE — README rows naming a package that no longer exists", staleInReadme.map((r) => ({
  severity: "high",
  file: "README.md",
  line: r.line,
  message: `README.md documents "${r.name}" in the Packages table, but no packages/*/package.json has that name`,
})));

if (findings.length === 0) {
  console.log("\n  README matches reality: every real package has a row, every row names a real package.");
}

console.log(
  hasFailure
    ? `\ncheck-root-readme-parity: FAIL — ${findings.length} finding(s).`
    : `\ncheck-root-readme-parity: OK.`,
);

process.exit(hasFailure ? 1 : 0);
