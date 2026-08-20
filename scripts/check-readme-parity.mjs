#!/usr/bin/env node
// check-readme-parity — a README is a promise about the package's public
// surface, and nothing in the toolchain checks that promise against reality.
//
//   node scripts/check-readme-parity.mjs <packageDir> [--json]
//
// Exit 0 = README matches reality. Exit 1 = findings. Exit 2 = cannot run.
//
// WHY THIS GATE EXISTS
// ---------------------
// An audit of this repo found two independent ways a README silently drifts
// from the code it documents, both of which are invisible to every other
// check here (typecheck, build, the safety/collision gates) because none of
// them read prose:
//
//   1. UNDOCUMENTED EXPORTS. package-a/src/index.ts exports `AreaChart` — an
//      entire chart component — plus four helpers/constants, none of which
//      appear anywhere in the README. A consumer reading the README has no
//      way to discover AreaChart exists. Exports get added to `index.ts` in
//      the same commit as the feature; nothing forces the README table to be
//      touched in that same commit, so it silently falls behind.
//
//   2. WRONG PACKAGE NAME IN EXAMPLES. A README's copy-pasteable
//      `import`/`npm install` lines are written by hand and are not checked
//      by anything the way source is. If a package is ever renamed, those
//      lines keep naming the old package: `npm install` fetches one thing
//      and the following `import` resolves nothing. The example reads as
//      authoritative precisely because it looks executable, so a stale one
//      is worse than no example at all.
//
// A third check (documented-but-nonexistent exports) is the mirror image of
// #1: it catches a README that describes something that used to exist, or
// was renamed, or was never real to begin with. Same root cause — the
// README and the export list are two independently-maintained lists of the
// same thing — different direction of drift.
//
// A fourth check covers a real incident, not a hypothetical: five READMEs in
// this repo kept saying "zero runtime dependencies," or named a
// pre-consolidation dependency set, after every one of them started
// depending on `@scope/governance` for real. Dependency prose is exactly as
// hand-written and exactly as unchecked as an import example, and drifts the
// same way — see CHECK D below.
//
// A second, later incident showed the same root cause has a third shape:
// naming the right package is not enough if the version RANGE next to it is
// stale. Five READMEs (the same five, after the first incident was fixed)
// kept citing `@scope/governance`'s old `^0.2.0` range after every manifest
// moved to `^0.3.0`. Neither of the two dependency-prose checks above reads
// a version number, so all five passed. See CHECK D3 below.
//
// WHY EVERYTHING IS DERIVED, NOT HARDCODED
// ------------------------------------------
// This file ships in a public repo and is itself scanned by
// check-public-safety.mjs, which refuses any file containing the private
// scope/org name as a literal. That constraint turns out to produce a better
// script anyway: the scope and package name are read from package.json at
// run time, so this gate keeps working unchanged if the scope is ever
// renamed (see scripts/set-scope.mjs) or if a third package is added.
//
// WHICH ENTRYPOINTS CHECKS A/C EXAMINE (issue #311)
// ---------------------------------------------------
// Earlier versions of this gate read exactly one file per package —
// src/index.ts — no matter how many subpaths package.json's "exports" map
// actually declared. A package with real, consumer-reachable exports behind
// a subpath (package.json `"./conventions": { "types": ..., "import": ... }`,
// say) had that entire surface invisible to CHECK A and CHECK C: the README
// could omit it completely and this gate would still print its "every export
// is documented" success sentence, having examined a fraction of the
// package's actual public surface. See the "entrypoint resolution" section
// below for exactly how the full entrypoint set is now derived from
// "exports", what counts as out of scope (wildcard and static-asset
// subpaths), and why an entrypoint this gate is told exists but cannot
// resolve is an indeterminate result (exit 2) for the whole run rather than
// a pass over whatever it could find. The normal (non-JSON) output always
// states how many entrypoints were checked out of how many were declared,
// so a future narrowing of scope is visible instead of silent.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positional = argv.filter((a) => !a.startsWith("--"));
const pkgDirArg = positional[0];

function die(msg, code = 2) {
  console.error(`check-readme-parity: ${msg}`);
  process.exit(code);
}

if (!pkgDirArg) {
  die("usage: check-readme-parity.mjs <packageDir> [--json]");
}

const pkgDir = resolve(pkgDirArg);
const manifestPath = join(pkgDir, "package.json");
const readmePath = join(pkgDir, "README.md");

if (!existsSync(manifestPath)) die(`no package.json at ${manifestPath}`);
if (!existsSync(readmePath)) die(`no README.md at ${readmePath}`);

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  die(`package.json does not parse: ${error.message}`);
}

const packageName = manifest.name;
if (typeof packageName !== "string" || !packageName.startsWith("@") || !packageName.includes("/")) {
  die(`package.json "name" (${JSON.stringify(packageName)}) is not a scoped name of the form "@scope/name"`);
}
const scope = packageName.slice(0, packageName.indexOf("/")); // e.g. "@scope"

const readmeSrc = readFileSync(readmePath, "utf8");
const readmeLines = readmeSrc.split("\n");

// ------------------------------------------------------------- entrypoint resolution
//
// package.json's "exports" map is the authoritative list of what a consumer
// can actually reach — not just the root barrel. A package that declares
// `"./conventions": { "types": "./dist/conventions/index.d.ts", ... }` makes
// every export of src/conventions/index.ts as reachable to a consumer as the
// root export, and a README that never mentions one of those names is making
// exactly the same undocumented-export mistake CHECK A exists to catch — the
// gate must therefore examine every declared entrypoint, not only the root.
//
// Three kinds of declared subpath are NOT a source module and are
// deliberately out of scope for the export-name checks below:
//
//   - A WILDCARD subpath ("./conventions/documents/*") maps a whole directory
//     of files through unchanged (its target string contains the same "*").
//     It exposes files (markdown, shell scripts, JSON), not language-level
//     exports, so there is no export list to diff against a README.
//   - A STATIC-ASSET subpath maps directly to one non-code file, verbatim,
//     with no build step in between — real examples in this workspace:
//     `"./tokens.css": "./styles/tokens.css"` and
//     `"./voice-record.template.jsonc": "./templates/voice-record.template.jsonc"`.
//     Its target is a plain string (not a conditions object with
//     "types"/"import") whose extension is not a JS/TS one, so there is no
//     compiled output to trace back to a `src/*.ts` file and, like a
//     wildcard, no export list to diff against a README — a stylesheet or a
//     template has no "exports" in the sense this gate checks.
//
//   Both of the above are counted and reported separately so a reader can
//   see they were seen and deliberately excluded, not silently skipped.
//
//   - A concrete, code-shaped subpath (an object with "types"/"import"/etc.,
//     or a plain string ending in a JS/TS extension) whose target cannot be
//     resolved to a real source file under "./dist/" makes the scope of this
//     gate itself uncertain: it has been told a door exists but cannot find
//     it. That is an indeterminate result for the whole run (exit 2), not a
//     pass that silently examined fewer entrypoints than declared.
const CODE_EXTENSION_RE = /\.(?:d\.ts|d\.mts|d\.cts|ts|mts|cts|tsx|js|mjs|cjs|jsx)$/;

function deriveSourceRelativePath(distTarget) {
  if (typeof distTarget !== "string") return null;
  const match = distTarget.match(/^\.\/dist\/(.+)$/);
  if (!match) return null;
  const rel = match[1];
  if (rel.endsWith(".d.ts")) return rel.slice(0, -".d.ts".length) + ".ts";
  if (rel.endsWith(".js")) return rel.slice(0, -".js".length) + ".ts";
  return null;
}

function resolveConcreteTarget(target) {
  const candidates = [];
  if (typeof target === "string") {
    candidates.push(target);
  } else if (target && typeof target === "object" && !Array.isArray(target)) {
    for (const key of ["types", "import", "default", "require"]) {
      if (typeof target[key] === "string") candidates.push(target[key]);
    }
  }
  for (const candidate of candidates) {
    const rel = deriveSourceRelativePath(candidate);
    if (rel) return join(pkgDir, "src", rel);
  }
  return null;
}

function subpathLabel(subpath) {
  return subpath === "." ? "root entrypoint (src/index.ts)" : `subpath export "${subpath}"`;
}

const wildcardSubpaths = [];
const staticAssetSubpaths = [];
const unresolvedSubpaths = [];
const entrypoints = []; // { subpath, sourcePath }

if (manifest.exports === undefined) {
  // No "exports" map at all — the only entrypoint a consumer (or this gate,
  // historically) can see is the conventional root barrel.
  entrypoints.push({ subpath: ".", sourcePath: join(pkgDir, "src", "index.ts") });
} else {
  const exportsField = manifest.exports;
  const exportsMap = typeof exportsField === "string" ? { ".": exportsField } : exportsField;
  if (typeof exportsMap !== "object" || exportsMap === null || Array.isArray(exportsMap)) {
    die(`package.json "exports" (${JSON.stringify(exportsField)}) is neither a string nor an object`);
  }
  for (const [subpath, target] of Object.entries(exportsMap)) {
    if (subpath.includes("*")) {
      wildcardSubpaths.push(subpath);
      continue;
    }
    if (typeof target === "string" && !CODE_EXTENSION_RE.test(target)) {
      staticAssetSubpaths.push(subpath);
      continue;
    }
    const sourcePath = resolveConcreteTarget(target);
    if (!sourcePath) {
      unresolvedSubpaths.push({ subpath, target });
      continue;
    }
    entrypoints.push({ subpath, sourcePath });
  }
}

if (unresolvedSubpaths.length > 0) {
  die(
    `cannot resolve declared export${unresolvedSubpaths.length === 1 ? "" : "s"} to a source file: ` +
      unresolvedSubpaths.map((u) => `"${u.subpath}" -> ${JSON.stringify(u.target)}`).join(", "),
  );
}

for (const { subpath, sourcePath } of entrypoints) {
  if (!existsSync(sourcePath)) {
    die(`declared export ${subpathLabel(subpath)} resolves to ${sourcePath}, which does not exist`);
  }
}

if (entrypoints.length === 0) {
  die(
    `package.json "exports" declares no entrypoint this gate can resolve to a source file ` +
      `(only wildcard subpaths: ${wildcardSubpaths.join(", ") || "none"}; static-asset subpaths: ${staticAssetSubpaths.join(", ") || "none"})`,
  );
}

const nonCodeSubpathsTotal = wildcardSubpaths.length + staticAssetSubpaths.length;
const entrypointsTotal = entrypoints.length + nonCodeSubpathsTotal;
const entrypointsChecked = entrypoints.length;

// --------------------------------------------------------------- CHECK A/C shared: parse exports

// Strip comments before scanning for `export` statements. Prose inside a
// block comment (package-b/src/index.ts opens with a long doc comment that
// mentions several export names in backticked prose) must not be mistaken
// for an actual export statement — it never contains the literal sequence
// `export {`/`export type {`/`export const` etc., but stripping comments
// first removes any doubt and matches what a reader would consider "real
// code" rather than documentation.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// name -> { isType: boolean, subpaths: Set<string> }. A name can only be
// introduced once per entrypoint by a well-formed barrel file, so last-write-
// wins on `isType` within one file; a name reachable through more than one
// entrypoint (unusual, but not forbidden) just accumulates the extra subpath.
const exportsByName = new Map();

function recordExport(rawName, isType, subpath) {
  const name = rawName.trim();
  if (!name) return;
  const existing = exportsByName.get(name);
  if (existing) {
    existing.isType = isType;
    existing.subpaths.add(subpath);
  } else {
    exportsByName.set(name, { isType, subpaths: new Set([subpath]) });
  }
}

// Split a `{ ... }` export-list body on top-level commas and record each
// member. `blockIsType` is true for `export type { A, B }`; individual
// members can additionally be marked `type X` inside an otherwise-value
// block (`export { A, type B } from "./x.js"`), which is per-member type-only
// regardless of the block.
function recordExportList(body, blockIsType, subpath) {
  for (const rawMember of body.split(",")) {
    const member = rawMember.trim();
    if (!member) continue;
    let isType = blockIsType;
    let spec = member;
    if (/^type\s+/.test(spec)) {
      isType = true;
      spec = spec.replace(/^type\s+/, "");
    }
    // `A as B` — the name a consumer imports (and what a README should
    // mention) is the alias, B, not the original local name A.
    const asMatch = spec.match(/^(.+?)\s+as\s+(.+)$/);
    const exportedName = asMatch ? asMatch[2].trim() : spec.trim();
    recordExport(exportedName, isType, subpath);
  }
}

// `export { ... } from "..."` and `export type { ... } from "..."`, and the
// same two forms without a `from` clause (re-exports always have `from`
// here, but local named exports of already-declared bindings do not).
// Matching is non-greedy across `{...}` so multi-line export lists (used
// throughout every entrypoint here) are captured whole.
const exportBlockRe = /export\s+(type\s+)?\{([\s\S]*?)\}(?:\s*from\s*["'][^"']*["'])?\s*;?/g;
// `export const F = ...` / `export function G(...)` / `export function* G`
// / `export class H`. Not used by most barrel files in this repo today (most
// are pure re-export barrels) but a barrel file gaining a direct declaration
// is a plausible future edit, and the task spec calls out this form
// explicitly as a real one to handle.
const directDeclRe = /export\s+(?:const|let|var|function\*?|class|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;

// Every declared, resolved entrypoint is scanned the same way — the root
// barrel gets no special treatment relative to a subpath barrel. This is the
// fix for the defect this gate exists to close: previously only src/index.ts
// (the "." entrypoint) was ever read here, so an export reachable only
// through a subpath like "./conventions" was invisible to CHECK A/C no
// matter how real or undocumented it was.
for (const { subpath, sourcePath } of entrypoints) {
  const code = stripComments(readFileSync(sourcePath, "utf8"));
  for (const match of code.matchAll(exportBlockRe)) {
    recordExportList(match[2], Boolean(match[1]), subpath);
  }
  for (const match of code.matchAll(directDeclRe)) {
    recordExport(match[1], false, subpath);
  }
}

const valueExports = [...exportsByName.entries()].filter(([, v]) => !v.isType).map(([name, v]) => ({ name, subpaths: v.subpaths }));
const typeExports = [...exportsByName.entries()].filter(([, v]) => v.isType).map(([name, v]) => ({ name, subpaths: v.subpaths }));
const allExportNames = new Set(exportsByName.keys());

function firstSubpathLabel(subpaths) {
  return subpathLabel([...subpaths][0]);
}

// ------------------------------------------------------------------------- CHECK A

// A VALUE export is undocumented if its name does not appear ANYWHERE in the
// README text — not just the API table. Both READMEs here also mention
// exports in prose (e.g. "assignCategoricalColor(index) ... are exported"),
// so a substring search across the whole document, not just the table, is
// the right bar: it is permissive about WHERE a name is documented and
// strict about WHETHER it is documented at all.
const undocumentedValues = valueExports.filter((e) => !readmeSrc.includes(e.name));
const undocumentedTypes = typeExports.filter((e) => !readmeSrc.includes(e.name));

// ------------------------------------------------------------------------- CHECK B

// Any `@scope/something` reference on a line that looks like a copy-pasteable
// usage example (import/require/install), where "something" isn't exactly
// this package's real published name, is a broken example: the reader would
// `npm install` the right tarball and then have every `import` 404.
//
// Restricted to scope-prefixed references inside usage lines deliberately:
// a README may legitimately name another package of this scope in prose
// (describing a dependency, say), and that sentence is not something anyone
// copy-pastes into a terminal. Only import/require/install lines are checked.
const scopedNameRe = new RegExp(`${scope.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/[A-Za-z0-9._-]+`, "g");
// The `import` alternative needs a trailing boundary too, not just a leading
// one: a bare `\bimport` matches the first six letters of "important",
// "importance", "imported", etc., so ordinary prose ("...the single most
// important constraint...") sitting on the same line as an `@scope/other`
// reference was tripping this check. `(?![a-zA-Z])` requires the character
// after "import" not continue the word, while still matching real usage
// shapes: `import { x } from "..."`, `import * as x`, and `import(...)`.
const usageLineRe = /\bimport(?![a-zA-Z])|\brequire\(|(?:npm|pnpm|yarn)\s+(?:install|add|i)\b/i;

const wrongNameFindings = [];
readmeLines.forEach((line, i) => {
  if (!usageLineRe.test(line)) return;
  for (const found of line.match(scopedNameRe) ?? []) {
    if (found !== packageName) {
      wrongNameFindings.push({ line: i + 1, found, text: line.trim() });
    }
  }
});

// ------------------------------------------------------------------------- CHECK C

// Walk README.md's markdown table(s) inside the "## API" section (or any
// heading containing "API" — package-a and package-b both use "## API"
// but the check shouldn't break on a differently-worded heading) and flag
// any first-column identifier that doesn't correspond to a real export.
//
// Table rows are identified structurally (header row, then a separator row
// of only `-`/`:`/`|`/whitespace, then data rows) rather than by matching
// literal header text like "Export" — that keeps the check working whether
// the column is titled "Export", "Name", or anything else, and is what lets
// it correctly skip the header without special-casing its wording.
// Generic "find the section under the first heading matching this pattern"
// helper, factored out of the original API-only version so CHECK D below can
// reuse the same structural approach for a "## Requirements" heading instead
// of duplicating the walk.
function findSectionLines(headingRe) {
  const start = readmeLines.findIndex((l) => headingRe.test(l));
  if (start === -1) return null;
  let end = readmeLines.length;
  for (let i = start + 1; i < readmeLines.length; i++) {
    if (/^#{1,6}\s/.test(readmeLines[i])) {
      end = i;
      break;
    }
  }
  return [start + 1, end]; // exclusive of the heading itself
}

function findApiSectionLines() {
  return findSectionLines(/^#{1,6}\s*.*\bAPI\b/i);
}

const separatorRowRe = /^\|?[\s:|-]+\|?$/;

function splitTableRow(line) {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|")) body = body.slice(0, -1);
  return body.split("|").map((c) => c.trim());
}

// A cell can name one identifier (`` `ChartFrame` ``), several separated by
// " / " (`` `Grid` / `Axes` ``), or a call-shaped signature
// (`` `storageKey(spec)` `` — package-b's table style). Backticks are
// stripped per-token (splitting on "/" first) so a multi-name cell doesn't
// get mangled into "Grid` / `Axes", and only the leading identifier of each
// token is kept so `readJSON<T>(key, opts?)` resolves to `readJSON`.
function candidateIdentifiers(rawCell) {
  const out = [];
  for (let token of rawCell.split("/")) {
    token = token.trim().replace(/^`+|`+$/g, "").trim();
    if (!token) continue;
    // Prose, not an identifier: contains a space once backticks are gone
    // ("component" descriptions never land here, but a stray prose cell
    // would), or reads like a sentence fragment ("Not yet documented").
    if (/\s/.test(token)) continue;
    if (/^[A-Z][a-z]/.test(token) && / /.test(rawCell)) continue;
    const idMatch = token.match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
    if (idMatch) out.push(idMatch[0]);
  }
  return out;
}

const nonexistentDocumented = [];
const apiSection = findApiSectionLines();
if (apiSection) {
  const [from, to] = apiSection;
  let sawSeparator = false;
  for (let i = from; i < to; i++) {
    const line = readmeLines[i];
    if (!line.trim().startsWith("|")) {
      sawSeparator = false; // table block ended; a later "|" line starts a new table (new header)
      continue;
    }
    if (!sawSeparator) {
      // This is a header row unless/until we see the separator row that
      // must follow it in a well-formed markdown table.
      const next = readmeLines[i + 1] ?? "";
      if (separatorRowRe.test(next.trim()) && next.includes("-")) {
        sawSeparator = true;
        // consume the separator on the next loop iteration too, harmlessly
        // (it will fail startsWith("|") check? no — it does start with "|").
        // Skip it explicitly so it is never treated as a data row.
        i++;
      }
      continue;
    }
    if (separatorRowRe.test(line.trim()) && line.includes("-")) continue; // stray separator, ignore
    const cells = splitTableRow(line);
    if (cells.length === 0) continue;
    const idsInFirstCell = candidateIdentifiers(cells[0]);
    for (const id of idsInFirstCell) {
      if (!allExportNames.has(id)) {
        nonexistentDocumented.push({ line: i + 1, name: id, text: line.trim() });
      }
    }
  }
}

// ------------------------------------------------------------------------- CHECK D

// A README's dependency prose is a promise the same way its export table and
// import examples are, and it drifts the same way: nothing forces "no
// runtime dependencies" or a hand-listed dependency name to be touched when
// `package.json`'s real `dependencies` change. That is exactly what
// happened here — five READMEs kept claiming "zero runtime dependencies" or
// naming pre-consolidation dependencies (`@scope/catalog`, `@scope/policy`)
// after every one of them started declaring a real `dependencies` entry on
// `@scope/governance`, and nothing in this file (or anywhere else) read
// dependency prose at all.
//
// A full natural-language check of arbitrary dependency prose is not
// realistic. This aims narrower and stays honest about it: it only fires on
// two concrete, previously-real drift shapes, both anchored on the literal
// phrase "runtime dependenc[y|ies]" so it never second-guesses prose that
// isn't making a dependency claim in the first place.
//
//   D1. The README asserts NO/ZERO runtime dependencies for ITSELF, while
//       `package.json` declares a non-empty `dependencies` object. This is
//       the exact shape that shipped undetected. Scoped to the
//       "## Requirements" section (the same house convention CHECK C
//       already leans on for "## API") rather than the whole document: this
//       package's own README legitimately quotes a *different* package's
//       clean "zero runtime dependencies" result as a worked example
//       (`packages/release` describing `packages/policy`'s round-trip
//       result) — scanning the whole document for the bare phrase would
//       misread that as a claim about the README's own package. A package
//       whose README has no "## Requirements" heading at all falls back to
//       a whole-document scan, on the theory that a check that never fires
//       for such a package is worse than one that occasionally over-fires.
//
//   D2. A same-scope `@scope/name` reference appears inside the tight,
//       deliberate DECLARATION CLAUSE that a "runtime dependenc[y|ies]"
//       lead-in introduces — e.g. "Runtime dependencies: `@scope/catalog`
//       and `@scope/policy`." or "`gates` has a runtime dependency on
//       `@scope/governance`." — but that name is not a key in the real
//       `dependencies` object. This catches a described dependency set that
//       is stale in either direction — naming something no longer depended
//       on, or never depended on at all — without trying to parse arbitrary
//       surrounding English.
//
//       Earlier this fired on any same-scope name sharing a *paragraph* with
//       the bare phrase "runtime dependenc[y|ies]" anywhere in it. That is
//       far too loose for a monorepo whose READMEs constantly cross-
//       reference sibling packages: a purely rhetorical comparison
//       ("`@scope/catalog`, `@scope/policy`, and `@scope/ui/tokens` all ship
//       with zero runtime dependencies, and this package's own pitch...")
//       and a boundary statement ("belongs to `@scope/surface`;
//       audience-facing words belong to `@scope/copy`") both got misread as
//       *this* package declaring those names as ITS dependencies, because
//       both happened to share a "paragraph" (in one real case, one giant
//       bullet-list block with no blank line for hundreds of lines) with the
//       phrase somewhere else in it. A gate that fails on accurate prose is
//       worse than no gate.
//
//       The fix is to require the scoped name to sit inside the clause the
//       lead-in actually introduces, not merely nearby: immediately after
//       "runtime dependenc[y|ies]" is followed by ":" or "on" (the only two
//       connectors this repo's READMEs actually use to introduce a
//       declaration — see the real shapes above and in packages/gates,
//       packages/governance, packages/surface), scanning stops at the first
//       sentence-ending "." that isn't inside a backtick span (so a version
//       number like "`^0.3.0`" can't be mistaken for a sentence end) or at
//       the next blank line / heading, whichever comes first. That is
//       "declares X" read structurally rather than semantically: a name
//       merely mentioned later in the same paragraph, or earlier in a
//       sentence that only gets around to saying "runtime dependencies"
//       afterward, is outside the window and is never considered.
const declarationLeadInRe = /runtime\s+dependenc(?:y|ies)\s*(:|on\b)/gi;

function declarationWindow(text, startIndex) {
  let inBacktick = false;
  let i = startIndex;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === "`") {
      inBacktick = !inBacktick;
      continue;
    }
    if (inBacktick) continue;
    if (ch === ".") {
      i++;
      break;
    }
    if (ch === "\n") {
      let j = i + 1;
      while (text[j] === " " || text[j] === "\t") j++;
      if (text[j] === "\n" || text[j] === "#") break; // blank line or next heading
    }
  }
  return text.slice(startIndex, i);
}

// Both checks read `dependencies` only (not `devDependencies` or
// `peerDependencies`): "runtime dependency" is a claim about what a
// consumer's own install pulls in transitively, which is exactly what
// `dependencies` — and only `dependencies` — means in a published manifest.
const realDependencyNames = new Set(
  manifest.dependencies && typeof manifest.dependencies === "object" && !Array.isArray(manifest.dependencies)
    ? Object.keys(manifest.dependencies)
    : [],
);
const hasRealDependencies = realDependencyNames.size > 0;

const zeroDepsClaimRe = /\b(?:zero|no)\s+runtime\s+dependenc(?:y|ies)\b/i;
const requirementsSection = findSectionLines(/^#{1,6}\s*.*\bRequirements\b/i);
const zeroDepsScanText = requirementsSection
  ? readmeLines.slice(requirementsSection[0], requirementsSection[1]).join("\n")
  : readmeSrc;
const claimsZeroDeps = zeroDepsClaimRe.test(zeroDepsScanText);

const staleNamedDependencies = new Set();
for (const leadIn of readmeSrc.matchAll(declarationLeadInRe)) {
  const window = declarationWindow(readmeSrc, leadIn.index + leadIn[0].length);
  for (const found of window.match(scopedNameRe) ?? []) {
    if (found === packageName) continue; // a README may legitimately name itself
    if (!realDependencyNames.has(found)) staleNamedDependencies.add(found);
  }
}

// ------------------------------------------------------------------------- CHECK D3

// D1 and D2 catch the WRONG package name; this catches the RIGHT name with a
// STALE range next to it, which is a real incident, not a hypothetical: five
// READMEs here kept saying `@scope/governance` (`^0.2.0`) after every
// manifest moved to `^0.3.0`, and D1/D2 both passed every one of them
// because neither reads a version number at all. On a 0.x package this is
// not merely stale, it's actively wrong: caret ranges are minor-locked below
// 1.0 (`^0.2.0` means `>=0.2.0 <0.3.0`), so `^0.2.0` and `^0.3.0` cannot both
// be satisfied by one installed version — a consumer who trusts the README
// range installs something that cannot satisfy the manifest's real
// constraint.
//
// Deliberately whole-document, like D2 and unlike D1 — but for a different
// reason than D2's. D1 and D2 anchor themselves (to "## Requirements", or to
// the literal phrase "runtime dependency") because a bare scoped-name
// mention alone is ordinary, common prose — a README describing what a
// sibling package does — that would otherwise be misread as a dependency
// claim. This check doesn't need that anchor to stay narrow, because its
// trigger shape already is one: a backticked package name immediately
// followed by a backticked, parenthesized range. Nobody writes
// "`@scope/foo` (`^1.2.3`)" except to cite that package's installed range.
// That's what lets this also catch a stale range documented under any other
// heading, or attached to a `peerDependencies` mention that never says
// "runtime dependency" at all (e.g. "Peer dependency: `@scope/foo`
// (`^1.2.3`)") — a stale peer range misleads a reader exactly as much as a
// stale runtime one, so both `dependencies` and `peerDependencies` are
// checked here, unlike D1/D2 which read `dependencies` only.
//
// This only fires when the README actually states a range. A README that
// merely names a dependency with no version attached is not required to add
// one — that would invent a new documentation burden this check has no
// business creating (see D2's comment above for the same principle). And the
// comparison is exact STRING equality against the manifest, not
// semver-range equivalence: "^0.3.0" and ">=0.3.0 <0.4.0" resolve
// identically but do not read the same to a human, and any intentional
// difference between README prose and the manifest range is better fixed by
// rewording than by teaching this script to shrug at it.
const declaredRanges = new Map(); // same-scope package name -> its declared range string
for (const depsField of [manifest.dependencies, manifest.peerDependencies]) {
  if (depsField && typeof depsField === "object" && !Array.isArray(depsField)) {
    for (const [name, range] of Object.entries(depsField)) {
      if (typeof range === "string") declaredRanges.set(name, range);
    }
  }
}

// Matches "`@scope/name`" immediately followed by "(`range`)", allowing
// whitespace (including a line break) between the two backticked spans —
// the real prose shape in packages/catalog/README.md:164-165 puts the
// package name at the end of one line and "(`^0.3.0`)" at the start of the
// next.
const namedRangeRe = new RegExp(
  `\`(${scope.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/[A-Za-z0-9._-]+)\`\\s*\\(\`([^\`]+)\`\\)`,
  "g",
);

const staleRanges = [];
for (const match of readmeSrc.matchAll(namedRangeRe)) {
  const [, name, claimedRange] = match;
  if (name === packageName) continue; // a README may legitimately cite its own published range
  const realRange = declaredRanges.get(name);
  if (realRange !== undefined && realRange !== claimedRange) {
    staleRanges.push({ name, claimedRange, realRange });
  }
}

// ------------------------------------------------------------------------ report

const findings = [
  ...undocumentedValues.map((e) => ({
    check: "A",
    severity: "high",
    message: `export "${e.name}" (${firstSubpathLabel(e.subpaths)}) is not mentioned anywhere in README.md`,
  })),
  ...undocumentedTypes.map((e) => ({
    check: "A",
    severity: "low",
    message: `type "${e.name}" (${firstSubpathLabel(e.subpaths)}) is not mentioned anywhere in README.md`,
  })),
  ...wrongNameFindings.map((f) => ({
    check: "B",
    severity: "high",
    file: "README.md",
    line: f.line,
    message: `import example uses "${f.found}", but the published package name is "${packageName}"`,
  })),
  ...nonexistentDocumented.map((f) => ({
    check: "C",
    severity: "medium",
    file: "README.md",
    line: f.line,
    message: `README documents "${f.name}", which is not an export of any declared entrypoint (checked ${entrypointsChecked}/${entrypointsTotal}: ${entrypoints.map((e) => e.subpath).join(", ")})`,
  })),
  ...(claimsZeroDeps && hasRealDependencies
    ? [
        {
          check: "D",
          severity: "high",
          message: `README claims no/zero runtime dependencies, but package.json declares "dependencies": ${[...realDependencyNames].join(", ")}`,
        },
      ]
    : []),
  ...[...staleNamedDependencies].map((name) => ({
    check: "D",
    severity: "high",
    message: `README names "${name}" as a runtime dependency, but package.json's "dependencies" does not include it`,
  })),
  ...staleRanges.map((f) => ({
    check: "D",
    severity: "high",
    message: `README.md claims "${f.name}" is at "${f.claimedRange}", but package.json declares "${f.realRange}" for it`,
  })),
];

const hasFailure = findings.some((f) => f.severity === "high" || f.severity === "medium");

if (flags.has("--json")) {
  console.log(
    JSON.stringify(
      {
        package: packageName,
        packageDir: pkgDirArg,
        entrypointsChecked,
        entrypointsTotal,
        entrypointsCheckedSubpaths: entrypoints.map((e) => e.subpath),
        wildcardSubpathsSkipped: wildcardSubpaths,
        staticAssetSubpathsSkipped: staticAssetSubpaths,
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

console.log(`check-readme-parity: ${packageName}`);
console.log(
  `  entrypoints checked: ${entrypointsChecked}/${entrypointsTotal} (${entrypoints.map((e) => e.subpath).join(", ")})` +
    (wildcardSubpaths.length
      ? ` — ${wildcardSubpaths.length} wildcard subpath(s) skipped (expose files, not symbols): ${wildcardSubpaths.join(", ")}`
      : "") +
    (staticAssetSubpaths.length
      ? ` — ${staticAssetSubpaths.length} static-asset subpath(s) skipped (map to one non-code file, not a symbol export): ${staticAssetSubpaths.join(", ")}`
      : ""),
);
printGroup("CHECK A — export coverage", findings.filter((f) => f.check === "A"));
printGroup("CHECK B — wrong package name in examples", findings.filter((f) => f.check === "B"));
printGroup("CHECK C — documented exports that don't exist", findings.filter((f) => f.check === "C"));
printGroup("CHECK D — dependency prose vs. manifest", findings.filter((f) => f.check === "D"));

if (findings.length === 0) {
  console.log(
    `\n  README matches reality: every export is documented, every example uses the real package name (${entrypointsChecked}/${entrypointsTotal} entrypoints examined).`,
  );
}

console.log(
  hasFailure
    ? `\ncheck-readme-parity: FAIL — ${findings.filter((f) => f.severity !== "low").length} finding(s) at medium/high severity.`
    : `\ncheck-readme-parity: OK${findings.length ? " (informational findings only)" : ""}.`,
);

process.exit(hasFailure ? 1 : 0);
