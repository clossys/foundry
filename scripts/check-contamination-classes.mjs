#!/usr/bin/env node
// check-contamination-classes — catch the contamination a denylist cannot see.
//
//   node scripts/check-contamination-classes.mjs <dir> [--json] [--class N]
//
// Exit 0 = clean. Exit 1 = findings (any high or medium). Exit 2 = cannot run.
//
// scripts/check-public-safety.mjs matches STRINGS: a person's name, a product,
// a domain, an internal path. It is a denylist, and a denylist can only refuse
// what someone already thought to list. An internal-repo audit
// (see docs/PUBLISHING.md, "Scrub prose") found six recurring shapes of
// contamination that survive a clean denylist scan untouched, because none of
// them contain a single denylisted string — they are *structural* tells about
// a private system, not named ones. Each class below exists because it was
// found for real, described in docs/PUBLISHING.md with a concrete example, and
// was previously only catchable by a human reading every file by hand.
//
// CLASS 1 — dangling internal doc citations.
//   A comment or README line points a reader at a documentation path that
//   exists only in the private source repo and does not ship in this one —
//   `docs/architecture/....md`, or a SHOUTY-KEBAB.md convention file like
//   `KIT-CONVENTIONS.md`. The string itself isn't secret; the defect is that
//   an outside reader who follows it hits a 404. Detected structurally (any
//   `<dir>/.../<file>.md`-shaped path, any bare ALL-CAPS `.md` filename), then
//   checked against real relative-path resolution from the scanned directory
//   only — deliberately NOT against "the enclosing repository", which would
//   report a false clean bill while the package still sits inside the huge
//   private monorepo it came from.
//
// CLASS 2 — internal-convention DOM/data attributes.
//   A fleet-wide internal tagging convention rendered straight into markup —
//   a `data-<xx>-...` attribute whose prefix is a short opaque internal
//   abbreviation, not an English word. It compiles and renders fine, so
//   nothing in CI or a denylist ever sees it as a problem; it just quietly
//   tells anyone reading the DOM that this component came out of a private
//   design system with its own naming scheme. The fix each time was renaming
//   to a self-explanatory prefix (a real one now ships as `data-chart-part`)
//   — same job (a stable selector), no internal vocabulary leaked.
//
// CLASS 3 — private-codebase statistics.
//   Prose describing the shape of the private system by the numbers —
//   "appears across roughly N files in the four-repo stack". Not a secret in
//   the sense of an identity, but it discloses scale and topology of
//   something not meant to be public knowledge.
//
// CLASS 4 — "proving consumer" / internal-adopter prose.
//   A README section naming the internal package that first consumed,
//   adopted, or re-exported this code before it was extracted — meaningful
//   only to someone with access to the private monorepo, and typically
//   naming a scoped package that was never published here. The set of
//   package names that ARE legitimately published here is read from
//   packages/*/package.json at run time — never hardcoded — so this class
//   never needs to know a real internal name to catch one.
//
// CLASS 5 — internal architecture layer/tier framing.
//   "Layer 0 — the upstream truth", "Resource-tier", "generic-core only".
//   Even with every proper noun scrubbed, this vocabulary describes the
//   private architecture's own internal layering scheme. A non-standard
//   `tier` or `layer` key sitting in package.json is the same leak in
//   structural form rather than prose.
//
// CLASS 6 — CSS custom properties with no fallback.
//   `var(--something)` with no second (fallback) argument, where the token in
//   question is normally supplied by a private, unpublished package. Nothing
//   fails to compile; the component just renders unstyled or invisible for
//   anyone who installs the public package without the private token source.
//   The fix is a fallback: `var(--x, <default>)`.
//
// None of these are exact-match rules. Every one is a heuristic tuned against
// real findings, meant to flag a human for a second look — not a proof. A
// clean run here is necessary, not sufficient; check-public-safety.mjs is the
// separate, harder gate that still has to pass before anything publishes.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, extname, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positional = argv.filter((a) => !a.startsWith("--"));
const root = positional[0];

function flagValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

if (!root) {
  console.error("usage: check-contamination-classes.mjs <dir> [--json] [--class N]");
  process.exit(2);
}
if (!existsSync(root)) {
  console.error(`check-contamination-classes: no such directory: ${root}`);
  process.exit(2);
}

const classFilter = flagValue("--class") ? Number(flagValue("--class")) : null;
if (classFilter !== null && (!Number.isInteger(classFilter) || classFilter < 1 || classFilter > 6)) {
  console.error("check-contamination-classes: --class must be an integer 1-6");
  process.exit(2);
}
function wants(n) {
  return classFilter === null || classFilter === n;
}

const CLASS_NAMES = {
  1: "internal doc citation",
  2: "internal-convention DOM attribute",
  3: "private-codebase statistic",
  4: "proving-consumer / internal-adopter prose",
  5: "internal architecture layer/tier framing",
  6: "CSS custom property with no fallback",
};

// --------------------------------------------------------------- file walking

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage"]);
const SCAN_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".css", ".md"]);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (error) {
    // Fail closed, matching check-public-safety.mjs's walker: an unreadable
    // directory (a permission error, a symlink loop, anything else readdir
    // can throw) must abort the gate, not be silently treated as empty. A
    // gate that shrugs off "couldn't read this" and reports clean on
    // whatever it DID manage to see is worse than no gate at all — it turns
    // "cannot verify" into a false "verified clean".
    console.error(`check-contamination-classes: cannot read directory ${dir}: ${error.message}`);
    process.exit(2);
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue; // broken symlink
    }
    if (stat.isDirectory()) walk(full, out);
    else if (stat.isFile()) out.push(full);
  }
  return out;
}

const rootAbs = resolve(root);
const allFiles = walk(rootAbs);
const scanFiles = allFiles.filter((f) => SCAN_EXT.has(extname(f).toLowerCase()));

// The repository root, found by walking up from the scanned directory looking
// for `.git`. CLASS 1 needs it because a citation can be relative to either
// the package being scanned or the repository that contains it, and a path
// that resolves in NEITHER is what makes it dangling.
function findRepoRoot(startDir) {
  let dir = resolve(startDir);
  for (let i = 0; i < 25; i++) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(startDir); // no .git found within range — fall back to itself
}
const repoRoot = findRepoRoot(rootAbs);

// The set of package names legitimately published from THIS repository — read
// from the repo the script itself lives in, not the directory being scanned,
// since the whole point of CLASS 4 is comparing an arbitrary source tree
// against what this repo actually ships. Never hardcoded: reading it at run
// time is what lets this file avoid ever writing a real scope or package name.
function loadPublishedPackageNames() {
  const names = new Set();
  const ownRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const packagesDir = join(ownRepoRoot, "packages");
  let dirs;
  try {
    dirs = readdirSync(packagesDir);
  } catch {
    return names;
  }
  for (const d of dirs) {
    const manifestPath = join(packagesDir, d, "package.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (typeof manifest.name === "string") names.add(manifest.name);
    } catch {
      // unreadable/unparsable manifest — nothing to add, nothing to crash over
    }
  }
  return names;
}
const publishedNames = loadPublishedPackageNames();

// The scope this SCANNED package itself publishes under, e.g. `@thecalvinhung`
// — read from the scanned directory's own package.json `name`, never
// hardcoded. CLASS 4's scoped-package check only ever needs to ask "does this
// look like OUR OWN organisation talking about itself", so a reference under
// any other scope (`@testing-library`, `@types`, anyone else's) is an
// ordinary third-party dependency and is never evaluated at all — only a
// same-scope reference can possibly be internal-adopter prose.
function loadOwnScope(scanDir) {
  const manifestPath = join(scanDir, "package.json");
  if (!existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (typeof manifest.name === "string" && manifest.name.startsWith("@")) {
      return { scope: manifest.name.slice(0, manifest.name.indexOf("/")), name: manifest.name };
    }
  } catch {
    // unreadable/unparsable — no scope to compare against
  }
  return null;
}
const ownManifestInfo = loadOwnScope(rootAbs);
const firstPartyScope = ownManifestInfo?.scope ?? null;

const findings = [];
function report(cls, severity, file, line, snippet, detail) {
  findings.push({
    class: cls,
    className: CLASS_NAMES[cls],
    severity,
    file: relative(rootAbs, file),
    line,
    snippet: snippet.trim().slice(0, 100),
    detail,
  });
}

// ------------------------------------------------------------------- CLASS 1

// A path-shaped citation: at least one directory segment before a `.md` file,
// e.g. `docs/architecture/foo.md` or `../../SOME-CONVENTIONS.md`. Deliberately
// broad — a broad match that turns out to exist is simply not reported, since
// existence is the actual test.
const PATH_MD_RE = /(?:[\w.-]+\/)+[\w.-]+\.md\b/g;
// A bare SHOUTY-KEBAB or SHOUTY_SNAKE (or single-word SHOUTY) filename with no
// path prefix at all, e.g. `CASCADE.md`, `KIT-CONVENTIONS.md`.
const SHOUTY_MD_RE = /\b[A-Z]{2,}[A-Z0-9]*(?:[-_][A-Z0-9]+)*\.md\b/g;

// Existence is checked ONE way only: real relative-path resolution from the
// scanned directory. That deliberately does NOT walk up to "the enclosing
// repository" and search there — a citation copy-pasted while this package
// still sits inside its giant PRIVATE origin monorepo would "resolve" against
// that monorepo's own docs/ tree, which is exactly the false negative that
// matters (the citation is dangling the moment this directory is copied out
// alone, which is the only scenario this gate is actually guarding). A
// genuine relative link (`../../docs/DECISIONS.md`) still resolves correctly
// here, because `path.resolve` walks real "../" segments through the real
// filesystem regardless of how big the surrounding repository is — no
// separate "repo root" concept is needed for that case at all.
//
// The one thing this would over-flag without help: docs conventionally cited
// BARE (no leading `../`, as if "from repo root") right next to the real
// working relative link, e.g. `[docs/DECISIONS.md](../../docs/DECISIONS.md)`
// — both `docs/DECISIONS.md` and `../../docs/DECISIONS.md` are separate
// regex matches on that one line, but they're one citation, not two. A bare
// match that is exactly the tail of an already-resolving sibling match on the
// same line is treated as that same, working citation.
function resolvesLocally(citedPath) {
  return existsSync(resolve(rootAbs, citedPath));
}

function checkClass1(file, lines) {
  lines.forEach((text, i) => {
    const matches = [];
    for (const m of text.matchAll(PATH_MD_RE)) matches.push(m[0]);
    for (const m of text.matchAll(SHOUTY_MD_RE)) {
      // A bare shouty filename that's just the tail of a path match already
      // collected above (`packages/KIT-CONVENTIONS.md` also contains
      // `KIT-CONVENTIONS.md`) is the same citation, not a second one.
      if (matches.some((p) => p === m[0] || p.endsWith("/" + m[0]))) continue;
      matches.push(m[0]);
    }
    if (!matches.length) return;
    const resolved = new Map(matches.map((t) => [t, resolvesLocally(t)]));
    for (const t of matches) {
      if (resolved.get(t)) continue;
      const echoesResolvedSibling = matches.some((other) => other !== t && resolved.get(other) && other.endsWith(t));
      if (echoesResolvedSibling) continue;
      report(1, "high", file, i + 1, text, `cites "${t}" — does not resolve relative to the scanned package directory; a reader here cannot open it`);
    }
  });
}

// ------------------------------------------------------------------- CLASS 2

// data-<prefix>-<rest>, where <prefix> is 2-4 characters — short enough to be
// an internal abbreviation rather than an English word. Attributes with no
// second segment at all (`data-testid`, `data-state`, `data-slot`,
// `data-orientation`, `data-side`, `data-disabled`) never match this shape in
// the first place. A prefix that IS a real word just happens to run long
// enough to fall outside 2-4 characters (`chart`, `series`) and passes
// naturally; ALLOWED_PREFIXES exists only as a belt-and-braces list for short
// real words that might otherwise trip the length heuristic.
const DATA_ATTR_RE = /data-([a-zA-Z][a-zA-Z0-9]{1,3})-([a-zA-Z][a-zA-Z0-9-]*)/g;
const ALLOWED_PREFIXES = new Set(["chart", "test", "aria", "grid", "menu", "item", "root", "part"]);

function checkClass2(file, lines) {
  lines.forEach((text, i) => {
    for (const m of text.matchAll(DATA_ATTR_RE)) {
      const prefix = m[1].toLowerCase();
      if (ALLOWED_PREFIXES.has(prefix)) continue;
      report(2, "high", file, i + 1, text, `attribute "${m[0]}" — prefix "${prefix}" is a short opaque token, not a self-explanatory word; unreadable to an outside consumer`);
    }
  });
}

// ------------------------------------------------------------------- CLASS 3

const STAT_NUMBER_RE = /\b\d+\s+(files|packages|repos|repositories)\b/i;
const STAT_CONTEXT_RE = /\b(across|stack|monorepo|internal|fleet|our)\b/i;
const STAT_PHRASE_RE = /\b(?:[a-z]+-repo\b|the stack\b|the monorepo\b|internal consumers\b)/i;

function checkClass3(file, lines) {
  lines.forEach((text, i) => {
    if (STAT_NUMBER_RE.test(text) && STAT_CONTEXT_RE.test(text)) {
      report(3, "medium", file, i + 1, text, "describes the private codebase's scale/shape by the numbers");
    } else if (STAT_PHRASE_RE.test(text)) {
      report(3, "medium", file, i + 1, text, "phrase describing the private multi-repo system's shape");
    }
  });
}

// ------------------------------------------------------------------- CLASS 4

// "extracted from" alone is ordinary, honest provenance narrative — this repo's
// own READMEs say exactly that about themselves, truthfully and harmlessly. It
// only becomes CLASS 4 in the shape the audit actually found: naming what the
// extraction was FOR (breaking a dependency cycle with some other private
// component), which is the part that leaks internal structure.
const ADOPTER_PHRASE_RE = /\b(consumed by|re-exported by|adopted by|first adopter|proving consumer)\b/i;
const EXTRACTION_CYCLE_RE = /\bextracted from\b.{0,80}\b(break|cycle)\b/i;
// A scoped, npm-style package reference: `@scope/name` with optional deeper
// subpath segments (`@scope/name/sub/path`). Trailing punctuation (a sentence
// period, a closing paren picked up by the greedy segment class) is trimmed
// before comparison so it doesn't manufacture a fake mismatch.
const SCOPED_PKG_RE = /@[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9._-]+)*/g;

// This repo's own known, documented, PUBLIC renaming convention (see
// docs/PUBLISHING.md and each package's README "Published name has a
// temporary `-oss` suffix" note): a package may ship under `<name>-oss` to
// dodge a namespace collision. A prose reference to the bare, un-suffixed
// name is a real but MINOR defect — a stale mention of the pre-rename name —
// not an internal-adopter leak, so it gets its own message and a lower
// severity rather than being silently swallowed.
function staleOssName(base) {
  return publishedNames.has(`${base}-oss`) ? `${base}-oss` : null;
}

// A reference sitting inside an actual `import`/`require`/dynamic-`import()`
// specifier is a real dependency — that's a job for the package manager and
// the safety gate's `workspace:`/`catalog:` check, not this class. CLASS 4
// only cares about a first-party name appearing in PROSE: a comment, a
// README line, a JSDoc block. This checks whether the text immediately
// before the match opened an import/require string.
const IMPORT_OPEN_RE = /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"`]\s*$/;
function isImportSpecifier(line, matchIndex) {
  return IMPORT_OPEN_RE.test(line.slice(0, matchIndex));
}

function checkClass4(file, lines) {
  lines.forEach((text, i) => {
    if (ADOPTER_PHRASE_RE.test(text)) {
      report(4, "high", file, i + 1, text, "internal-adopter / proving-consumer prose — meaningful only inside the private monorepo");
    }
    if (EXTRACTION_CYCLE_RE.test(text)) {
      report(4, "high", file, i + 1, text, "names what an extraction broke a dependency cycle with — internal structure, not public provenance");
    }
    if (!firstPartyScope) return; // no scoped own-manifest to compare against — nothing more to check
    for (const m of text.matchAll(SCOPED_PKG_RE)) {
      const cleaned = m[0].replace(/[).,;:!?'"`]+$/, "");
      const segments = cleaned.split("/");
      const scope = segments[0];
      if (scope !== firstPartyScope) continue; // a different scope is someone else's package — not our concern
      if (isImportSpecifier(text, m.index)) continue; // a real dependency, not prose
      const base = `${segments[0]}/${segments[1]}`;
      if (publishedNames.has(base)) continue; // exact match to something this repo actually publishes
      const stale = staleOssName(base);
      if (stale) {
        report(4, "medium", file, i + 1, text, `names "${cleaned}" — stale reference to the pre-"-oss" name; the package now publishes as "${stale}" (see README)`);
      } else {
        report(4, "high", file, i + 1, text, `names "${cleaned}" — not one of the packages published from this repo`);
      }
    }
  });
}

// ------------------------------------------------------------------- CLASS 5

const LAYER_RE = /\bLayer\s+[0-9A-Z]\b/;
const TIER_HYPHEN_RE = /\b[a-zA-Z]+-tier\b/i;
const GENERIC_CORE_RE = /\bgeneric-core\b/i;

function checkClass5(file, lines) {
  lines.forEach((text, i) => {
    if (LAYER_RE.test(text)) {
      report(5, "medium", file, i + 1, text, "names an internal architecture layer by number/letter");
    }
    if (TIER_HYPHEN_RE.test(text)) {
      report(5, "medium", file, i + 1, text, "names an internal architecture tier");
    }
    if (GENERIC_CORE_RE.test(text)) {
      report(5, "medium", file, i + 1, text, `"generic-core" — internal architecture vocabulary`);
    }
  });
  // The structural form of the same leak: package.json is not in SCAN_EXT (it
  // isn't prose), but a non-standard `tier`/`layer` top-level key is exactly
  // this class expressed as metadata instead of a sentence, and was the actual
  // shape found in a real audited package.
  if (file.endsWith(`${sep}package.json`) || file.endsWith("package.json")) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return;
    }
    for (const key of ["tier", "layer"]) {
      if (key in manifest) {
        report(5, "medium", file, 0, `"${key}": ${JSON.stringify(manifest[key])}`, `package.json carries a non-standard "${key}" field — internal architecture classification leaked as metadata`);
      }
    }
  }
}

// ------------------------------------------------------------------- CLASS 6

// var(--name) with nothing else inside the parens — no comma, so no fallback.
const VAR_NO_FALLBACK_RE = /var\(\s*(--[a-zA-Z0-9_-]+)\s*\)/g;

// A doc comment describing what NOT to do, or explaining the fallback syntax
// itself, often writes the bare, no-fallback form of a `var()` call as an
// example — that's documentation, not the defect it's documenting. Strip `//`
// line comments and `/* ... */` block comments (tracked across lines, since a
// JSDoc block runs for several) before matching, so only executable code is
// checked. CSS has no `//` comment syntax, so only block comments are
// stripped there — naively cutting at `//` would also truncate a live
// `url(http://...)`.
function codeOnlyLines(lines, ext) {
  const out = [];
  let inBlock = false;
  const stripLineComment = ext !== ".css";
  for (const raw of lines) {
    let l = raw;
    if (inBlock) {
      const end = l.indexOf("*/");
      if (end === -1) {
        out.push("");
        continue;
      }
      l = l.slice(end + 2);
      inBlock = false;
    }
    for (;;) {
      const start = l.indexOf("/*");
      if (start === -1) break;
      const end = l.indexOf("*/", start + 2);
      if (end === -1) {
        l = l.slice(0, start);
        inBlock = true;
        break;
      }
      l = l.slice(0, start) + l.slice(end + 2);
    }
    if (stripLineComment) {
      const idx = l.indexOf("//");
      if (idx !== -1) l = l.slice(0, idx);
    }
    out.push(l);
  }
  return out;
}

// A placeholder name in documentation prose — `--chart-cat-N`, `--x-<n>` — is
// not a real token any component actually renders through; it's illustrating
// a naming pattern. Recognised by its last hyphenated segment being a single
// uppercase letter, or containing a "some value goes here" marker.
function isPlaceholderVarName(varName) {
  const segments = varName.replace(/^--/, "").split("-");
  const last = segments[segments.length - 1];
  return /^[A-Z]$/.test(last) || /[<>…]/.test(varName) || last === "N";
}

function checkClass6(file, lines, ext) {
  const codeLines = codeOnlyLines(lines, ext);
  codeLines.forEach((text, i) => {
    for (const m of text.matchAll(VAR_NO_FALLBACK_RE)) {
      if (isPlaceholderVarName(m[1])) continue;
      report(6, "high", file, i + 1, text, `${m[0]} has no fallback — renders unstyled/invisible for a consumer that doesn't supply this token`);
    }
  });
}

// --------------------------------------------------------------------- run

const CLASS2_6_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".css"]);

for (const file of scanFiles) {
  let contents;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (contents.includes(" ")) continue; // binary
  const lines = contents.split("\n");
  const ext = extname(file).toLowerCase();

  if (wants(1)) checkClass1(file, lines);
  if (wants(2) && CLASS2_6_EXT.has(ext)) checkClass2(file, lines);
  if (wants(3)) checkClass3(file, lines);
  if (wants(4)) checkClass4(file, lines);
  if (wants(5)) checkClass5(file, lines);
  if (wants(6) && CLASS2_6_EXT.has(ext)) checkClass6(file, lines, ext);
}

// CLASS 5's structural package.json check runs outside the main extension
// filter (see above) — package.json is scanned for that one check regardless
// of SCAN_EXT, but only under the scanned root, and only for the tier/layer
// keys, never for prose.
if (wants(5)) {
  for (const file of allFiles) {
    if (extname(file) === ".json" && (file.endsWith(`${sep}package.json`) || file === join(rootAbs, "package.json"))) {
      checkClass5(file, []); // lines=[] — only the structural key check runs
    }
  }
}

// -------------------------------------------------------------------- report

if (flags.has("--json")) {
  console.log(JSON.stringify({ root: rootAbs, repoRoot, scanned: scanFiles.length, findings }, null, 2));
  process.exit(findings.length ? 1 : 0);
}

console.log(`check-contamination-classes: scanned ${scanFiles.length} files under ${rootAbs}`);
console.log(`repo root: ${repoRoot}`);
console.log("");

if (!findings.length) {
  console.log("PASS — no contamination-class findings.");
  process.exit(0);
}

for (let cls = 1; cls <= 6; cls++) {
  if (!wants(cls)) continue;
  const rows = findings.filter((f) => f.class === cls);
  if (!rows.length) continue;
  console.log(`## CLASS ${cls} — ${CLASS_NAMES[cls]} — ${rows.length} finding(s)`);
  for (const f of rows) {
    const loc = f.line ? `${f.file}:${f.line}` : f.file;
    console.log(`  [${f.severity}] ${loc}`);
    console.log(`      ${f.detail}`);
    console.log(`      > ${f.snippet}`);
  }
  console.log("");
}

console.log("## summary");
for (let cls = 1; cls <= 6; cls++) {
  if (!wants(cls)) continue;
  const n = findings.filter((f) => f.class === cls).length;
  if (n) console.log(`  CLASS ${cls} (${CLASS_NAMES[cls]}): ${n}`);
}
console.log("");
console.log(`FAIL — ${findings.length} finding(s) across ${new Set(findings.map((f) => f.class)).size} class(es).`);
process.exit(1);
