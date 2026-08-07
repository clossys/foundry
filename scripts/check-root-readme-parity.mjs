#!/usr/bin/env node
// check-root-readme-parity — the root README's Packages table is a promise
// about what lives in packages/, and until now nothing checked it.
//
//   node scripts/check-root-readme-parity.mjs [repoRoot] [--json]
//
// Exit 0 = every real package is a table row, every table row is a real
// package, and no row's description contradicts that package's own real
// exports. Exit 1 = the table and packages/ disagree. Exit 2 = cannot run.
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
// listing, each entry's own `package.json` "name" field, and (for CHECK D,
// below) each entry's own `package.json` "exports" map — never a hardcoded
// roster of package names or subpaths. A hardcoded list would itself be a
// second copy of the same fact the README already gets wrong, and would go
// stale the exact same way. Reading the filesystem is what makes this gate
// keep working, unchanged, the next time a package is added, removed, or
// gains a subpath.
//
// CHECK D — SUBPATH CLAIMS, AND ITS DELIBERATE LIMIT
// -----------------------------------------------------
// CHECK A/B (below) catch a row whose PACKAGE NAME is wrong or missing.
// Neither catches a row whose name is exactly right but whose PROSE is a
// lie. That is the actual defect that motivated this gate: the historical
// `ui` row named the real package correctly and then said "Ships the
// `atoms` layer only ... `blocks` and `views` are a planned future
// subpath, not built yet" months after both had shipped. A row can pass
// CHECK A/B perfectly and still assert something false about the one
// package it names.
//
// Most prose can't be mechanically verified — "React components styled
// with tokens" is not a checkable claim. But a claim naming a subpath is,
// because `package.json`'s "exports" map is a list of real, checkable
// strings. CHECK D verifies exactly that overlap, in two directions:
//
//   D1 (positive). An explicit `./name`-shaped mention in a row is an
//      unambiguous claim that a subpath by that name exists. If it isn't a
//      real key in that package's own "exports", the row documents a
//      subpath that doesn't exist — the same shape as check-readme-parity's
//      CHECK C, one level up.
//
//   D2 (negative — the harder direction, and the one that actually would
//      have caught the historical defect). A BARE word — no `./` prefix —
//      is normal English prose almost everywhere ("ships", "views", any
//      component name), so bare words are NOT scanned for "is this a
//      subpath claim" in general; that is a natural-language question this
//      script does not attempt. It becomes checkable only when a bare word
//      happens to be IDENTICAL to a real, verified subpath name of the
//      package the row is about (e.g. "blocks", "views" are literal keys
//      of `ui`'s own "exports", stripped of their `./`). When that
//      coincidence holds AND the same clause also contains one of a small,
//      curated set of "this doesn't exist yet" phrases (`not built`,
//      `not shipped`, `planned future subpath`, `TBD`, ...), the row is
//      asserting the impossible: that a real, present export doesn't
//      exist. That is exactly the historical `ui` row's shape.
//
// D2's negation-phrase list is intentionally narrow and literal — it knows
// nothing about English beyond a handful of fixed phrases modeled on the
// actual defect, the same kind of admitted, documented gap as this
// script's sibling check-public-safety.mjs (whose "separator-required"
// identity patterns are known, on the record, to miss compound-word
// evasions — see check-denylist-quality.mjs). It will not catch every way
// a README could claim a real subpath is missing; it reliably catches the
// phrasing this repo has actually used. A broader claim — "this checks
// whether a row's prose is truthful" — would not be honest; this is
// narrower and says so.

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

// A package's real subpath names, derived from its own "exports" map: every
// key other than "." (the root entry point, not a subpath), with its
// leading "./" stripped. A package with no subpath exports (just ".", or no
// "exports" field at all) yields an empty set — CHECK D then simply has
// nothing to compare that row against, which is not a failure; it is the
// same "not applicable" as a package with zero table findings elsewhere.
function realSubpathsOf(manifest) {
  const out = new Set();
  const exp = manifest.exports;
  if (exp && typeof exp === "object") {
    for (const key of Object.keys(exp)) {
      if (key === ".") continue;
      if (key.startsWith("./")) out.add(key.slice(2));
    }
  }
  return out;
}

const realPackages = []; // { name, dir, subpaths: Set<string> }
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
  realPackages.push({ name, dir: entry.name, subpaths: realSubpathsOf(manifest) });
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

const tableRows = []; // { line, name, description }
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
  if (match) tableRows.push({ line: i + 1, name: match[0], description: cells.slice(1).join(" | ") });
}

if (tableRows.length === 0) {
  die(
    `found a "## Packages" heading in ${readmePath} but could not parse any package rows from a table under it — the table is missing, malformed, or its first column no longer contains an "@scope/name"-shaped identifier`,
  );
}

// ------------------------------------------------------------------- compare

const realByName = new Map(realPackages.map((p) => [p.name, p]));
const tableNames = new Set(tableRows.map((r) => r.name));

const missingFromReadme = realPackages.filter((p) => !tableNames.has(p.name));
const staleInReadme = tableRows.filter((r) => !realByName.has(r.name));

// --------------------------------------------------------------- CHECK D

// A small, literal, documented-as-narrow set of phrases this repo has
// actually used to claim a subpath doesn't exist yet. See the CHECK D
// header comment above for why this list is deliberately not an attempt at
// general natural-language negation detection.
const NEGATION_MARKERS = [
  /\bnot\s+(?:yet\s+)?built\b/i,
  /\bnot\s+(?:yet\s+)?shipped\b/i,
  /\bnot\s+(?:yet\s+)?available\b/i,
  /\bnot\s+(?:yet\s+)?implemented\b/i,
  /\bplanned(?:\s+future)?\s+subpath\b/i,
  /\bfuture\s+subpath\b/i,
  /\bcoming\s+soon\b/i,
  /\bTBD\b/,
  /\bnot\s+(?:a\s+|an\s+)?(?:real\s+)?subpath\b/i,
  /\bdoes(?:n't|\s+not)\s+(?:yet\s+)?ship\b/i,
];

// A bare (non-`./`-prefixed) backticked word that could plausibly be a
// subpath name if it turns out to match one — letters, digits, dots
// (`tokens.css`-shaped), underscores, hyphens, starting with a letter.
// Anything else backticked in a description (an npm scope like
// `` `@vespeneventures/tokens` ``, a comma-joined list) never reaches this
// far because it never equals a real subpath name (checked below) — this
// pattern only needs to be permissive enough not to reject a real one.
const bareCandidateRe = /^[A-Za-z][A-Za-z0-9_.-]*$/;

// Splits `text` into clause-like spans on "." / ";" that fall OUTSIDE any
// backtick-quoted span, so a literal "." inside `` `./atoms` `` or
// `` `tokens.css` `` never fractures a subpath token in two. Each backtick
// token is then attributed to the clause its position falls in, which is
// what lets D2 require a negation phrase to share a clause with the
// specific subpath name it negates, not just share a table cell with it
// (a row correctly documenting one subpath and, in a later clause,
// correctly saying a DIFFERENT one isn't built yet must not cross-flag the
// first).
function findClauseSpans(text) {
  const backtickSpans = [...text.matchAll(/`[^`]*`/g)].map((m) => [m.index, m.index + m[0].length]);
  const insideBacktick = (pos) => backtickSpans.some(([s, e]) => pos >= s && pos < e);
  const spans = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if ((text[i] === "." || text[i] === ";") && !insideBacktick(i)) {
      spans.push([start, i]);
      start = i + 1;
    }
  }
  spans.push([start, text.length]);
  return spans;
}

const subpathFindings = [];
for (const row of tableRows) {
  const pkg = realByName.get(row.name);
  if (!pkg || pkg.subpaths.size === 0) continue; // stale row, or nothing to compare against

  for (const [clauseStart, clauseEnd] of findClauseSpans(row.description)) {
    const clause = row.description.slice(clauseStart, clauseEnd);
    const hasNegation = NEGATION_MARKERS.some((re) => re.test(clause));

    for (const m of clause.matchAll(/`([^`]+)`/g)) {
      const inner = m[1];
      const explicit = inner.startsWith("./");
      const candidate = explicit ? inner.slice(2) : inner;
      if (!explicit && !bareCandidateRe.test(candidate)) continue;

      const isRealSubpath = pkg.subpaths.has(candidate);

      if (explicit && !isRealSubpath) {
        subpathFindings.push({
          check: "nonexistent-subpath",
          severity: "high",
          file: "README.md",
          line: row.line,
          message: `README.md's "${row.name}" row references subpath "./${candidate}", which is not a key in packages/${pkg.dir}/package.json's "exports"`,
        });
      } else if (isRealSubpath && hasNegation) {
        subpathFindings.push({
          check: "false-absence-claim",
          severity: "high",
          file: "README.md",
          line: row.line,
          message: `README.md's "${row.name}" row describes "${candidate}" as not built/shipped, but packages/${pkg.dir}/package.json's "exports" already declares "./${candidate}"`,
        });
      }
    }
  }
}

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
  ...subpathFindings,
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
printGroup("SUBPATH CLAIMS — a row's prose contradicts that package's real exports", subpathFindings);

if (findings.length === 0) {
  console.log("\n  README matches reality: every real package has a row, every row names a real package, and no row's prose contradicts that package's real exports.");
}

console.log(
  hasFailure
    ? `\ncheck-root-readme-parity: FAIL — ${findings.length} finding(s).`
    : `\ncheck-root-readme-parity: OK.`,
);

process.exit(hasFailure ? 1 : 0);
