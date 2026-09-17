#!/usr/bin/env node
// check-contamination-classes — catch the contamination a denylist cannot see.
//
//   node scripts/check-contamination-classes.mjs <dir> [--json] [--class N]
//
// Exit 0 = clean. Exit 1 = findings (any high or medium). Exit 2 = cannot run
// (an unreadable directory, or — see CLASS 4 below — a case that genuinely
// could not be resolved either way, such as CLASS 4 needing git history a
// shallow checkout can't provide).
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
//   A same-scope name that ISN'T currently live has two very different
//   explanations, and this class tells them apart by CONTEXT rather than by
//   a hand-maintained list of "retired" names (the same reasoning CLASS 1
//   uses real path resolution instead of a list of "known dangling docs",
//   and CLASS 4's own import-specifier check already uses below): a name
//   this repo genuinely once published — read from git history at run time,
//   same self-maintaining discipline as the live list above — mentioned in
//   ordinary prose (a CHANGELOG entry recording its own removal, a comment
//   explaining what moved where) is a legitimate, permanent fact about this
//   repo's own history, not a leak. The same name sitting in a LIVE
//   INSTRUCTION — an `npm install`-shaped command, a manifest dependency
//   entry — is still wrong regardless of whether the name is historical or
//   entirely fabricated: either way, following that instruction fails
//   today, which is the actual defect this class exists to catch.
//
//   The history read is only load-bearing for ONE shape: a same-scope name
//   OUTSIDE a live instruction that isn't currently published. That's the
//   one case a live-vs-prose context test alone cannot resolve — a
//   genuinely retired name and a wholly fabricated one read identically in
//   prose, so telling them apart needs an actual record of what this repo
//   once shipped. A SHALLOW git checkout (GitHub Actions' default,
//   `fetch-depth: 1`) makes that record silently truncated rather than
//   absent — `git log` still succeeds, it just can't see the commit where a
//   long-retired package was ever added. Reporting "no historical names
//   found" as if that were a confident, reliable answer would make a
//   shallow CI checkout treat every retired package the same as a
//   fabricated one — the exact bug #27 exists to fix, just relocated to a
//   clone-depth setting instead of a missing feature. So this class asks
//   git whether its own checkout IS shallow before trusting `historicalNames`
//   at all, and reports "cannot verify" (a third outcome, see
//   `indeterminate` below) rather than quietly guessing wrong when it is.
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
import { join, relative, extname, resolve, dirname, basename, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positional = argv.filter((a) => !a.startsWith("--"));
const root = positional[0];

function flagValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

if (!root) {
  console.error(
    "usage: check-contamination-classes.mjs <dir> [--json] [--class N] [--include-built]\n" +
      "                                        [--allowlist <file>] [--no-allowlist]",
  );
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

// `dist` and `build` are skipped by DEFAULT and scanned under --include-built.
//
// They are gitignored, so a tree scan that walked them would be reading
// whatever happens to be lying around from the last local build rather than
// anything a reviewer can see in a diff. But they are also the LARGEST thing
// in the shipped tarball, and `tsc` preserves comments — the #927 citation
// reached `dist/index.js` and six `.d.ts` files, where a consumer reads it
// and no tree scan ever looked. So the surface is opt-in rather than absent:
// `--include-built` is what `preflight-package.mjs` passes after a real
// build, and check-artifact-safety.mjs runs this gate against the EXTRACTED
// TARBALL, which is the same question asked with no build-artifact ambiguity
// at all (everything in a tarball ships, by definition).
const SKIP_DIRS = new Set(["node_modules", ".git", "coverage"]);
const BUILT_DIRS = ["dist", "build"];
if (!flags.has("--include-built")) for (const d of BUILT_DIRS) SKIP_DIRS.add(d);
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

// The set of package names this repository has EVER published, including
// ones since retired — read from git history, not hand-maintained. A name
// that appears as some `packages/*/package.json`'s "name" field in ANY
// commit reachable from any ref was, at some point, a real thing this repo
// shipped; a CHANGELOG entry recording ITS OWN removal is not a leak, it's
// the whole point of a CHANGELOG (see docs/PUBLISHING.md and GH issue #27).
// Deliberately not a hardcoded "retired" list: the moment a package is
// deleted, git already knows it used to exist, so there is nothing for a
// human to remember to update, and nothing to go stale. Whether a mention
// of a name in this set is actually fine still depends on WHERE it appears
// — see isInstallInstruction/isDependencyEntry below — a retired package is
// exactly as uninstallable as one that never existed.
//
// `reliable` matters as much as `names`. A SHALLOW clone (GitHub Actions'
// default `fetch-depth: 1`, unless a job opts into full history the way the
// `safety` job's gitleaks step already does) makes `git log` succeed with
// almost no history at all — no error to catch, just a quietly wrong
// answer. Truncated history is indistinguishable from "this name was never
// real" using `names` alone, so the caller is told explicitly whether the
// history behind `names` can be trusted, and treats "cannot tell" as its
// own outcome rather than silently reporting whichever of the two labels
// happens to come out of a false negative.
function loadHistoricalPackageNames(ownRepoRoot) {
  const unreliable = { names: new Set(), reliable: false };
  let shallow;
  try {
    shallow = execFileSync("git", ["-C", ownRepoRoot, "rev-parse", "--is-shallow-repository"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return unreliable; // no git binary, or not a git checkout at all
  }
  if (shallow !== "false") return unreliable; // "true" (truncated), or any unexpected answer
  let log;
  try {
    log = execFileSync(
      "git",
      ["-C", ownRepoRoot, "log", "--all", "-p", "--", "packages/*/package.json"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch {
    return unreliable; // full clone confirmed, but the log command itself still failed
  }
  const names = new Set();
  const nameLineRe = /^[+-]\s*"name"\s*:\s*"([^"]+)"/gm;
  for (const m of log.matchAll(nameLineRe)) names.add(m[1]);
  return { names, reliable: true };
}
const { names: historicalNames, reliable: historicalNamesReliable } = loadHistoricalPackageNames(
  resolve(dirname(fileURLToPath(import.meta.url)), ".."),
);

// The scope this SCANNED package itself publishes under, e.g. `@example-scope`
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

// A THIRD outcome, distinct from both "findings" (a real defect) and a clean
// run (nothing to report): a case this run genuinely could not resolve
// either way, because it needed information (reliable git history) that
// wasn't available. Kept as its own list rather than folded into `findings`
// with some severity — the run-level exit code below reads this list first
// and, if it's non-empty, exits 2 regardless of what `findings` says. A gate
// with only pass/fail states silently turns "could not check" into
// whichever of the two it happens to degrade toward; this is the explicit
// third state so that never happens here.
const indeterminate = [];
function reportIndeterminate(cls, file, line, snippet, detail) {
  indeterminate.push({
    class: cls,
    className: CLASS_NAMES[cls],
    file: relative(rootAbs, file),
    line,
    snippet: snippet.trim().slice(0, 100),
    detail,
  });
}

// ------------------------------------------------------------------- CLASS 1

// EXTRACTION — WHAT COUNTS AS A CITATION (GH #935)
//
// This used to terminate in a literal `\.md\b`, which meant the class caught
// exactly the Markdown half of itself. A `see internal/foo.test.ts` comment
// was invisible, and one such citation in a shipped package outlived the
// cross-package retirement that deleted its referent and passed every gate
// on every release since. The extension list below is deliberately a LIST
// rather than "any dotted suffix": `foo.bar` in prose is far more often a
// property access, a version, or a hostname than a file. A new file type
// joins the class by being added here — not by growing a second
// `.ts`-shaped pair of patterns beside the `.md` one, which would reproduce
// the same defect one extension along.
const CITATION_EXTENSIONS = [
  "md", "mdx",
  "ts", "tsx", "mts", "cts",
  "js", "jsx", "mjs", "cjs",
  "json", "jsonc",
  "yml", "yaml",
  "css", "scss",
  "sh",
];
const CITATION_EXT_ALT = CITATION_EXTENSIONS.join("|");

// A path-shaped citation: at least one directory segment before the filename,
// e.g. `docs/architecture/foo.md`, `../../DECISIONS.md`,
// `internal/peer-guard-coverage.test.ts`. Deliberately broad — a broad match
// that turns out to resolve is simply not reported, since resolution is the
// actual test.
// The leading `(?<![@$\\w])` is load-bearing. `@scope/pkg/tokens.css` is a
// package SUBPATH EXPORT, resolved by the module system, and `$RUNNER_TEMP/
// report.json` is an environment variable — neither is a path in this tree,
// and without the guard the regex would start matching mid-token at `scope/`
// and `RUNNER_TEMP/` and report both as dangling.
const PATH_CITATION_RE = new RegExp(`(?<![@$\\w\\/])(?:[\\w.-]+\\/)+[\\w.-]+\\.(?:${CITATION_EXT_ALT})\\b`, "g");
// A bare SHOUTY-KEBAB or SHOUTY_SNAKE (or single-word SHOUTY) filename with no
// path prefix at all, e.g. `CASCADE.md`, `KIT-CONVENTIONS.md`.
const SHOUTY_MD_RE = /\b[A-Z]{2,}[A-Z0-9]*(?:[-_][A-Z0-9]+)*\.md\b/g;
// A bare test-file citation — `verify.test.ts`, `auth-clerk.test.ts`. The one
// bare, non-SHOUTY shape that earns a place here, because it is the shape the
// #935 evidence is actually made of: a `see foo.test.ts` comment is written
// beside the file it names, never read again by its author, and survives every
// rename and retirement of its referent. Bare citations in general are NOT
// extracted (`package.json`, `index.ts`, `tsconfig.json` appear constantly in
// prose as vocabulary rather than as pointers, and matching them would drown
// the class); `.test.`/`.spec.` is specific enough to be a pointer every time.
const BARE_TEST_FILE_RE = /(?<![@$\w\/.\-])[\w-]+(?:\.[\w-]+)*\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)\b/g;

// An absolute URL is openable by definition — its path segments are not a
// citation of anything in this tree. Stripped before extraction so that
// `https://example.com/docs/FOO.md` does not read as a dangling
// `docs/FOO.md`, and so that a `//`-introduced URL inside a string literal
// cannot be mistaken for the start of a line comment below.
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s)\]>"'`]+/gi;

// WHERE A CITATION CAN LIVE. In Markdown, prose is the whole file. In code it
// is the comments — and ONLY the comments. A module specifier
// (`from "./foo.js"`) is not a citation: it is resolved by the toolchain,
// which fails loudly when it is wrong, and reading it as prose would flag
// every TypeScript ESM import in the catalogue. This is the inverse of
// `codeOnlyLines` below (CLASS 6), which keeps the code and drops the
// comments.
const COMMENTED_CODE_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".css", ".scss"]);

function commentOnlyLines(lines, ext) {
  const out = [];
  let inBlock = false;
  const hasLineComment = ext !== ".css" && ext !== ".scss";
  for (const raw of lines) {
    // URLs are removed BEFORE the comment split, not after: `"https://x/y"`
    // sitting in live code would otherwise have its `//` read as the start of
    // a line comment and drag the rest of the line into the prose surface.
    let rest = raw.replace(URL_RE, " ");
    let acc = "";
    for (;;) {
      if (inBlock) {
        const end = rest.indexOf("*/");
        if (end === -1) {
          acc += rest;
          rest = "";
          break;
        }
        acc += rest.slice(0, end);
        rest = rest.slice(end + 2);
        inBlock = false;
        continue;
      }
      const startBlock = rest.indexOf("/*");
      const startLine = hasLineComment ? rest.indexOf("//") : -1;
      if (startLine !== -1 && (startBlock === -1 || startLine < startBlock)) {
        acc += " " + rest.slice(startLine + 2);
        rest = "";
        break;
      }
      if (startBlock !== -1) {
        rest = rest.slice(startBlock + 2);
        inBlock = true;
        continue;
      }
      break;
    }
    out.push(acc);
  }
  return out;
}

// The prose surface of a file, line for line: comments for code, everything
// for Markdown and other text. Same length as `lines`, so a finding still
// reports the real line number and the real source line as its snippet.
function proseLines(lines, ext) {
  if (COMMENTED_CODE_EXT.has(ext)) return commentOnlyLines(lines, ext);
  return lines.map((l) => l.replace(URL_RE, " "));
}

// The block of prose a citation sits inside — the unit a reader takes in as
// one thought. For code that is the contiguous run of comment lines (a JSDoc
// header, a `//` paragraph); for Markdown, the paragraph. Used ONLY by the
// self-disclosure exemption below, never by resolution.
function blockRangesFor(prose) {
  const ranges = [];
  let start = -1;
  prose.forEach((text, i) => {
    const has = text.trim().length > 0;
    if (has && start === -1) start = i;
    if (!has && start !== -1) {
      ranges.push([start, i - 1]);
      start = -1;
    }
  });
  if (start !== -1) ranges.push([start, prose.length - 1]);
  return ranges;
}

// ---------------------------------------------------------------- resolution

// WHAT SHIPS. The decisive question this class asks is not "does the cited
// path exist on the machine that wrote the comment" — it is "can the reader
// open it". For a published package the reader's world is the tarball, so
// the shipped file set is read from `npm pack --dry-run`, the same list npm
// itself will publish, rather than from a reimplementation of npm's `files`
// matching rules. That distinction is the entire #927 defect: the cited
// `internal/peer-guard-coverage.test.ts` DID exist in `src/`, and was
// excluded from the tarball by `"!src/**/*.test.ts"`, so an existence-only
// check reports clean while the shipped `.d.ts` points a consumer at nothing.
let shippedSetCache;
function shippedFileSet() {
  if (shippedSetCache !== undefined) return shippedSetCache;
  if (!existsSync(join(rootAbs, "package.json"))) {
    // Not a package at all (a docs tree, a fixture). There is no "ships"
    // concept here, so resolution degrades honestly to existence — not to a
    // silent failure, and not to a fabricated tarball.
    shippedSetCache = { set: null, reason: "no-manifest" };
    return shippedSetCache;
  }
  let out;
  try {
    out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: rootAbs,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    shippedSetCache = { set: null, reason: "pack-failed" };
    return shippedSetCache;
  }
  try {
    const parsed = JSON.parse(out);
    const files = parsed?.[0]?.files;
    if (!Array.isArray(files)) throw new Error("no files[]");
    shippedSetCache = { set: new Set(files.map((f) => f.path)), reason: null };
  } catch {
    shippedSetCache = { set: null, reason: "pack-failed" };
  }
  return shippedSetCache;
}

// WHOSE citations matter. A dangling reference inside a file that is itself
// excluded from the tarball — a `*.test.ts`, a vitest config — reaches no
// consumer and misleads nobody outside this repository. The class is about
// what a reader of the PUBLISHED package is pointed at, so the citing file
// has to be one of the files they receive.
function shipsToAReader(file) {
  const shipped = shippedFileSet();
  if (!shipped.set) return true; // no manifest, or no packable answer — scan everything
  return shipped.set.has(relative(rootAbs, file).split(sep).join("/"));
}

// Every directory from the citing file up to the scanned root. A reader of
// `src/internal/peer-version.ts` who meets `providers/clerk/verify.ts` finds
// it at `src/providers/clerk/verify.ts` without being told; a reader of
// `README.md` resolves from the package root. Resolving from the root ALONE
// — the previous behaviour — was survivable while only `.md` paths were
// extracted, and is not once source comments are in scope.
//
// Still deliberately NOT extended upward past the scanned directory into "the
// enclosing repository": a citation copy-pasted while a package still sits
// inside a large private origin monorepo would resolve against that
// monorepo's tree, which is exactly the false negative that matters.
function candidateBases(file) {
  const bases = [];
  let dir = dirname(file);
  for (let i = 0; i < 64; i++) {
    bases.push(dir);
    if (dir === rootAbs) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!bases.includes(rootAbs)) bases.push(rootAbs);
  return bases;
}

// TypeScript's own module-specifier convention writes `./peer-version.js` for
// a file that is `peer-version.ts` in source and `peer-version.js` only after
// a build. A comment quoting that specifier is citing a real, openable file,
// so the source spellings are tried too.
const SOURCE_SPELLINGS = { js: ["ts", "tsx"], jsx: ["tsx"], mjs: ["mts", "ts"], cjs: ["cts", "ts"] };
function pathSpellings(citedPath) {
  const out = [citedPath];
  const m = /\.(js|jsx|mjs|cjs)$/.exec(citedPath);
  if (m) for (const ext of SOURCE_SPELLINGS[m[1]]) out.push(citedPath.slice(0, -m[0].length) + "." + ext);
  return out;
}

// Every path git tracks in the enclosing repository, used for ONE question:
// is the cited path real somewhere in this repository, or real nowhere? That
// separates ordinary rot ("this file no longer exists at all") from a
// deliberate cross-boundary reference ("this file exists, it just is not in
// your tarball"), and the two are not the same defect — see the exemption
// below, which applies to the second and never to the first.
let repoFileCache;
function repoFileList() {
  if (repoFileCache !== undefined) return repoFileCache;
  try {
    const out = execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    repoFileCache = out.split("\u0000").filter(Boolean);
  } catch {
    repoFileCache = null;
  }
  return repoFileCache;
}
// Two questions, not one, and the strictness differs on purpose.
//
// A `packages/…` citation names an EXACT repository-relative path, so it is
// matched exactly: `packages/auth/src/internal/peer-version.ts` either is a
// tracked path or names a package this repository retired, and there is no
// third reading.
//
// Any other citation is matched loosely — by full-path suffix first, then by
// BASENAME anywhere in the repository. That is deliberately conservative
// about claiming rot: `src/theme-parity.test.ts` cited from a file whose real
// sibling lives at `src/tokens/theme-parity.test.ts` is a citation a reader
// cannot follow, but it is not a file that stopped existing, and saying so
// would be false.
function findElsewhereInRepo(citedPath) {
  const files = repoFileList();
  if (!files) return null;
  const tail = citedPath.replace(/^(?:\.\.?\/)+/, "");
  if (!tail) return null;
  if (REPO_SHAPED_RE.test(tail)) return files.includes(tail) ? tail : null;
  const exact = files.find((f) => f === tail || f.endsWith("/" + tail));
  if (exact) return exact;
  // The basename fallback is for TEST FILES ONLY. `theme-parity.test.ts` is a
  // distinctive name that identifies one file; `package.json` is not, and
  // matching it by basename would "find" `next/package.json` — a path inside
  // an installed dependency — somewhere in this repository's own fixtures and
  // report a confident, wrong location.
  if (!TEST_FILE_RE.test(tail)) return null;
  const base = tail.slice(tail.lastIndexOf("/") + 1);
  const byName = files.find((f) => f === base || f.endsWith("/" + base));
  return byName ?? null;
}

const CITATION_SHIPS = "ships";
const CITATION_UNREACHABLE = "unreachable";
const CITATION_ROT = "rot";
const CITATION_UNKNOWN = "unknown";
const CITATION_IGNORE = "ignore";

// Built output is named in prose constantly — `dist/cli.js`, `packages/x/dist/
// bin.js` — and is gitignored, so on any tree without a build it resolves
// nowhere while being perfectly real in the tarball. Treating that as a
// dangling citation would make the gate's answer depend on whether someone
// had run `npm run build` in this checkout, which is not a property of the
// code. Under --include-built the directory is present and is checked for
// real, like anything else.
const BUILT_SEGMENT_RE = /(?:^|\/)(?:dist|build)\//;

// ROT — "there is nothing to open, at any path, at any commit" — is a strong
// claim, so it is only made about citations that are unambiguously ABOUT THIS
// REPOSITORY. Two shapes qualify:
//
//   a `packages/…` path, which names this repository's own layout and can
//   mean nothing else; and
//
//   a `*.test.*` / `*.spec.*` file, which is a test in some source tree and is
//   never the reader's own integration file.
//
// Everything else that resolves nowhere is deliberately NOT reported. A README
// that says "add this to `app/layout.tsx`" or "write it to `./proofs.json`" is
// naming the READER's files, not this package's, and no mechanical test
// separates those from a rotted citation. Reporting them would be the
// false-positive flood that gets a gate suppressed, so the narrower claim is
// the one enforced and the gap is named here rather than papered over.
const REPO_SHAPED_RE = /^packages\//;
const TEST_FILE_RE = /(?:^|[\/.])[\w-]+\.(?:test|spec)\.[a-z]+$/;
// `.md` is the third shape, and it is here to PRESERVE behaviour rather than
// to add any: a documentation citation that resolves nowhere is the original
// CLASS 1 finding, the one #930 caught in a CHANGELOG, and widening the
// extraction must not quietly narrow the rule that already worked.
const DOC_FILE_RE = /\.mdx?$/i;
function isRepositoryShaped(citedPath) {
  return REPO_SHAPED_RE.test(citedPath) || TEST_FILE_RE.test(citedPath) || DOC_FILE_RE.test(citedPath);
}

function classifyCitation(citedPath, file) {
  if (!flags.has("--include-built") && BUILT_SEGMENT_RE.test(citedPath)) return { state: CITATION_IGNORE };

  const shipped = shippedFileSet();
  let reachedVia = null; // a real file this citation resolves to, if any

  for (const base of candidateBases(file)) {
    for (const spelling of pathSpellings(citedPath)) {
      const abs = resolve(base, spelling);
      if (!existsSync(abs)) continue;
      if (!shipped.set) {
        // No manifest (a docs tree, a fixture): there is no "ships" concept
        // here, so resolution degrades honestly to existence — exactly as
        // this class behaved before #935.
        if (shipped.reason === "no-manifest") return { state: CITATION_SHIPS };
        return { state: CITATION_UNKNOWN, where: relative(rootAbs, abs) };
      }
      const rel = relative(rootAbs, abs).split(sep).join("/");
      if (!rel.startsWith("..") && shipped.set.has(rel)) return { state: CITATION_SHIPS };
      // An EXPLICITLY relative link that walks out of the package
      // (`../../docs/DECISIONS.md`) is a deliberate, working cross-boundary
      // reference — the author wrote the `../` themselves, and it resolves
      // for a reader browsing this public repository. That has always been
      // treated as legitimate here; widening the extraction does not change
      // it. A BARE path that merely happens to sit at the repository root
      // (`docs/LIFECYCLE.md`) is the opposite case and is still reported —
      // that is exactly the #930 finding this class already catches.
      if (rel.startsWith("..") && /(?:^|\/)\.\.\//.test("/" + citedPath)) return { state: CITATION_SHIPS };
      if (reachedVia === null) reachedVia = rel;
    }
  }

  if (reachedVia !== null) return { state: CITATION_UNREACHABLE, where: reachedVia };
  const elsewhere = findElsewhereInRepo(citedPath);
  if (elsewhere) return { state: CITATION_UNREACHABLE, where: elsewhere };
  if (!isRepositoryShaped(citedPath)) return { state: CITATION_IGNORE };
  return { state: CITATION_ROT };
}

// ----------------------------------------------- the self-disclosure exemption
//
// The rule this class enforces is NOT "no citation to a path that does not
// ship". It is "no citation a reader would reasonably expect to be able to
// open" — and a citation that discloses its own unavailability in the same
// breath is exactly the case where that expectation was never created. This
// repository has a real, load-bearing instance: a hand-ported range algorithm
// whose header cites the repository-root script it was ported FROM, and says
// in the same comment that `scripts/` is in no package's `files` allowlist and
// so is not present once a package is installed. Stripping that path would
// destroy the point of the sentence, and flagging it would invite a
// suppression comment — which is how gates start being routed around.
//
// HOW THE EXEMPTION IS BOUNDED, AND WHY THAT BOUND IS SAFE
//
// The disclosure is looked for in the citation's whole enclosing comment
// block or Markdown paragraph, not in some tuned window of N lines or N
// characters around it. Proximity was tried first and does not survive
// contact with real prose: in this repository's own example the disclosure
// sits four lines below its citation, while an unrelated "(unshipped)"
// qualifier sits seven lines below a DIFFERENT, genuinely rotten citation in
// the same file. No line or character window separates those two.
//
// What separates them is the STATE, not the distance. An unavailability
// qualifier is a claim about SHIPPING, so it can only ever excuse a citation
// whose defect is shipping — `present-not-shipped`. A citation that resolves
// NOWHERE is not explained by "it does not ship with this package": the
// reader was still told to go and look, and there is nothing to find, in this
// tarball or any checkout. So `missing` is never exempt, however the
// surrounding prose is worded.
//
// That is what makes a block-wide search safe. The widest thing a stray
// qualifier can do is excuse a real, findable file that merely is not in this
// package's tarball — the mildest half of the class — and it can never
// excuse rot. A suppression comment, by contrast, would excuse both, which is
// precisely why one is not offered here.
const UNAVAILABILITY_RE = new RegExp(
  [
    "\\bun-?shipped\\b",
    "\\b(?:does|do|did|will) not ship\\b",
    "\\bnever ships?\\b",
    "\\bnever shipped\\b",
    "\\bnot shipped\\b",
    "\\bnot packed\\b",
    "\\bnot in the (?:packed )?tarball\\b",
    "\\babsent from the (?:packed )?tarball\\b",
    "\\bexcluded from the (?:published|packed|shipped)\\b",
    "\\b(?:not|never) part of (?:any |this |the )?[^.]{0,40}`?files`? allowlist\\b",
    "\\bnot present once [^.]{0,40}installed\\b",
    "\\bnot (?:available|present) in the (?:published|installed) package\\b",
  ].join("|"),
  "i",
);

// The SECOND exemption, and the mirror of the first. Prose that records a
// citation's referent as GONE — a CHANGELOG entry documenting the dangling
// reference it just fixed, a comment explaining that a donor package was
// retired — names a path a reader is explicitly told not to go looking for.
// Reporting that as rot would mean a package cannot describe its own
// corrected history without failing the gate that caught it, which is a
// direct incentive to describe the fix vaguely, or not at all.
//
// Scoped to ROT and only rot, exactly as UNAVAILABILITY_RE is scoped to
// unreachable and only unreachable: "this file was deleted" does not explain
// a path that is real, present, and merely absent from the tarball. Each
// qualifier excuses the one defect it is actually a claim about, which is
// what keeps a block-wide search from becoming a general-purpose mute.
const NONEXISTENCE_RE = new RegExp(
  [
    "\\bno longer exists?\\b",
    "\\bnever existed\\b",
    "\\b(?:does|did|do) not exist\\b",
    "\\b(?:was|were|since|been) (?:deleted|removed)\\b",
    "\\b(?:stale|dangling) citation\\b",
    "\\bdangling reference\\b",
    "\\b(?:retired|deleted|removed) (?:by|in) #?\\d+\\b",
    "\\bretirement that deleted\\b",
    "\\b(?:donor|sibling) packages? (?:was|were|has been|have been) retired\\b",
    "\\bthis repository (?:no longer|does not) (?:ships?|contains?)\\b",
  ].join("|"),
  "i",
);

// --------------------------------------------------------------- allowlist
//
// The pre-existing instances this widening surfaces across the catalogue are
// NOT fixed here: every one of them sits in packed content, so each fix moves
// a package tree and needs its own version and qualification record. Landing
// the gate and fixing the findings in one change would be unreviewable, so
// the known set is recorded once, keyed to the issue that tracks it, and the
// gate refuses to let that set grow. An entry that no longer matches anything
// is itself a finding — that is what makes the list shrink rather than
// calcify, and it is why fixing a citation and deleting its entry are the
// same commit.
const DEFAULT_ALLOWLIST = join(repoRoot, "governance", "known-dangling-citations.json");

function loadAllowlist() {
  if (flags.has("--no-allowlist")) return { entries: [], path: null };
  const explicit = flagValue("--allowlist");
  const path = explicit ?? DEFAULT_ALLOWLIST;
  if (!existsSync(path)) {
    if (explicit) {
      console.error(`check-contamination-classes: no such allowlist: ${path}`);
      process.exit(2);
    }
    return { entries: [], path: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`check-contamination-classes: cannot parse allowlist ${path}: ${error.message}`);
    process.exit(2);
  }
  const issue = parsed?.issue;
  if (typeof issue !== "string" || !issue) {
    console.error(`check-contamination-classes: allowlist ${path} has no "issue" — a waiver with nothing tracking it is not a waiver`);
    process.exit(2);
  }
  const entries = [];
  for (const [pkg, files] of Object.entries(parsed.packages ?? {})) {
    for (const [file, cited] of Object.entries(files ?? {})) {
      if (!Array.isArray(cited)) {
        console.error(`check-contamination-classes: allowlist ${path}: packages["${pkg}"]["${file}"] must be an array of cited paths`);
        process.exit(2);
      }
      for (const c of cited) entries.push({ package: pkg, file, cited: c, issue });
    }
  }
  return { entries, path };
}
const allowlist = loadAllowlist();
const scannedPackageDirName = basename(rootAbs);
const allowlistForScan = allowlist.entries.filter((e) => e.package === scannedPackageDirName);
const allowlistUsed = new Set();
const waived = [];

function allowlistEntryFor(relFile, citedPath) {
  return allowlistForScan.find((e) => e.file === relFile && e.cited === citedPath);
}

// ---------------------------------------------------------------- the check

// Filenames that name a PUBLIC, third-party agent-instruction format rather
// than a document in anyone's repository. When prose says a policy lives in
// "layered AGENTS.md", or that a skill is defined by a "SKILL.md", it is naming
// a convention an outside reader can look up — not pointing at a file in this
// package that they will fail to open. That is the exact distinction CLASS 1
// draws, and these fall on the harmless side of it.
//
// The decisive argument is narrower than "these are well known", though, and it
// is what keeps this from being a convenience hole: check-public-safety.mjs
// FORBIDS these very filenames from existing anywhere in this repository
// outside two exact root paths. So for any package that documents agent
// conventions, "make the citation resolve locally" is not a fix that was
// declined — it is a fix the safety gate refuses to allow. A rule no package
// can ever satisfy is not enforcing anything; it is training contributors to
// route around the checker.
//
// Kept deliberately short. A name earns a place here only if it is a published
// cross-vendor format AND forbidden to exist here as a real file. An internal
// SHOUTY-KEBAB convention doc — the original motivating case — satisfies
// neither, and still reports.
const PUBLIC_FORMAT_FILENAMES = new Set([
  "AGENTS.md", // the agents.md cross-vendor instruction convention
  "CLAUDE.md", // vendor instruction loader
  "GEMINI.md", // vendor instruction loader
  "SKILL.md", // the Agent Skills package format
]);

function checkClass1(file, lines, ext) {
  const prose = proseLines(lines, ext);
  const blocks = blockRangesFor(prose);
  const blockText = new Map();
  for (const [from, to] of blocks) {
    const text = prose.slice(from, to + 1).join(" ");
    for (let i = from; i <= to; i++) blockText.set(i, text);
  }
  const relFile = relative(rootAbs, file);

  prose.forEach((text, i) => {
    const matches = [];
    for (const m of text.matchAll(PATH_CITATION_RE)) matches.push(m[0]);
    for (const re of [SHOUTY_MD_RE, BARE_TEST_FILE_RE]) {
      for (const m of text.matchAll(re)) {
        // A bare filename that's just the tail of a path match already
        // collected above (`packages/KIT-CONVENTIONS.md` also contains
        // `KIT-CONVENTIONS.md`) is the same citation, not a second one.
        if (matches.some((p) => p === m[0] || p.endsWith("/" + m[0]))) continue;
        matches.push(m[0]);
      }
    }
    if (!matches.length) return;
    const state = new Map(matches.map((t) => [t, classifyCitation(t, file)]));
    for (const t of matches) {
      const cited = state.get(t);
      if (cited.state === CITATION_SHIPS) continue;
      // Only the BARE name is format vocabulary. A path-prefixed citation
      // (`docs/AGENTS.md`) is a real pointer at a real file, and a dangling one
      // is exactly this class's job regardless of what the file is called.
      if (PUBLIC_FORMAT_FILENAMES.has(t)) continue;
      // A bare match that is exactly the tail of an already-resolving sibling
      // match on the same line — `[docs/X.md](../../docs/X.md)` — is that same,
      // working citation written twice, not a second, broken one.
      const echoesResolvedSibling = matches.some(
        (other) => other !== t && state.get(other).state === CITATION_SHIPS && other.endsWith(t),
      );
      if (echoesResolvedSibling) continue;

      if (cited.state === CITATION_IGNORE) continue;

      if (cited.state === CITATION_UNKNOWN) {
        reportIndeterminate(
          1,
          file,
          i + 1,
          lines[i] ?? text,
          `cites "${t}", which exists at "${cited.where}" — but this run could not determine whether that path is in the published file set, because \`npm pack --dry-run\` failed here. Whether a reader can open it is exactly the question, so this is neither a pass nor a finding.`,
        );
        continue;
      }

      // The exemption, and the whole reason it is safe to search the entire
      // enclosing block for it: an unavailability qualifier is a claim about
      // SHIPPING, so it can only ever excuse the citation whose defect is
      // shipping. CITATION_ROT is never exempt, however the prose is worded —
      // "it does not ship with this package" does not explain a path that
      // exists in no checkout at any commit.
      if (cited.state === CITATION_UNREACHABLE && UNAVAILABILITY_RE.test(blockText.get(i) ?? text)) continue;
      if (cited.state === CITATION_ROT && NONEXISTENCE_RE.test(blockText.get(i) ?? text)) continue;

      const entry = allowlistEntryFor(relFile, t);
      if (entry) {
        allowlistUsed.add(entry);
        waived.push({ file: relFile, line: i + 1, cited: t, issue: entry.issue, state: cited.state });
        continue;
      }

      if (cited.state === CITATION_ROT) {
        report(
          1,
          "high",
          file,
          i + 1,
          lines[i] ?? text,
          `cites "${t}" — no such path is tracked anywhere in this repository. A reader has nothing to open, in this package or any checkout of it.`,
        );
      } else {
        report(
          1,
          "high",
          file,
          i + 1,
          lines[i] ?? text,
          `cites "${t}" — the nearest real file is "${cited.where}", which is NOT in this package's published file set, so a reader who installed this package cannot open it at the path cited. Either correct the path, drop the citation, or say inline that it does not ship.`,
        );
      }
    }
  });
}

function reportStaleAllowlistEntries() {
  for (const entry of allowlistForScan) {
    if (allowlistUsed.has(entry)) continue;
    report(
      1,
      "medium",
      join(rootAbs, entry.file),
      0,
      `allowlist entry: ${entry.cited}`,
      `governance/known-dangling-citations.json still waives "${entry.cited}" in "${entry.file}", but this run found no such citation. A waiver that matches nothing is a waiver that has stopped tracking anything — delete it in the same commit as the fix (${entry.issue}).`,
    );
  }
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

// A line that reads as a copy-pasteable package-manager install/add command.
// Whether the named package is entirely fabricated or a real one this repo
// retired, running this line fails today — that's the live instruction the
// original README-install-command case (GH issue #27) needs to keep failing.
const INSTALL_COMMAND_RE = /\b(?:npm|npx|pnpm|yarn|bun)\s+(?:install|i|add|dlx|create|exec)\b/i;
function isInstallInstruction(line) {
  return INSTALL_COMMAND_RE.test(line);
}

// A line shaped like a manifest dependency entry — `"@scope/name": "^1.2.3"`
// — whether it's sitting in a real package.json (not in SCAN_EXT, so never
// actually reached this way today) or copy-pasted into a README code fence
// showing one. Same reasoning as an install command: this is an instruction
// to depend on the name, not prose describing it.
const DEPENDENCY_ENTRY_RE = /["']@[\w.-]+\/[\w.-]+["']\s*:\s*["'][^"']*["']/;
function isDependencyEntry(line) {
  return DEPENDENCY_ENTRY_RE.test(line);
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
      const liveInstruction = isInstallInstruction(text) || isDependencyEntry(text);
      const everPublished = historicalNames.has(base);
      // A name this repo genuinely once shipped, mentioned OUTSIDE a live
      // instruction, is legitimate history — a CHANGELOG naming what it
      // just removed, a comment explaining what moved where. Nothing to
      // flag. Inside a live instruction it's flagged below regardless,
      // same as a name that was never real — installing it fails today
      // either way, so THIS branch never needs to know whether the history
      // behind `everPublished` can be trusted.
      if (!liveInstruction) {
        if (everPublished) continue;
        if (!historicalNamesReliable) {
          // The only case that genuinely needs history: a non-live,
          // non-instruction reference. Without reliable history this run
          // cannot tell "a real package we retired" from "always
          // fabricated" — those look identical in prose — so this is not a
          // clean pass and not a confident finding either.
          reportIndeterminate(
            4,
            file,
            i + 1,
            text,
            `names "${cleaned}" in prose, and this run cannot verify whether this repo ever published it — its own git history is unreliable here (a shallow clone, or no usable checkout). A full-history run is required to tell a legitimate reference to a retired package from a foreign one.`,
          );
          continue;
        }
      }
      const stale = staleOssName(base);
      if (stale) {
        report(4, "medium", file, i + 1, text, `names "${cleaned}" — stale reference to the pre-"-oss" name; the package now publishes as "${stale}" (see README)`);
      } else if (liveInstruction && everPublished) {
        report(4, "high", file, i + 1, text, `names "${cleaned}" as something to install or depend on — this repo retired that package; it is not installable today`);
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
  // Strip a stray NUL byte rather than treating its presence as "this whole
  // file is binary, skip it" — that heuristic is exactly what let a real
  // identity leak slip past scripts/check-public-safety.mjs in this very
  // repository. This very line used to be written as a raw NUL literal (the
  // needle of a check identical in shape to the one it just replaced), and
  // that earlier version of scripts/check-public-safety.mjs's wholesale skip
  // made this whole file invisible to a FULL-mode scan as a result. SCAN_EXT
  // above already restricts this walk to genuinely-text extensions, so there
  // is no real binary content here to protect against — only a byte that,
  // left unstripped, would switch this scan off for whatever file happens to
  // contain one.
  contents = contents.replace(/\u0000/g, "");
  const lines = contents.split("\n");
  const ext = extname(file).toLowerCase();

  if (wants(1) && shipsToAReader(file)) checkClass1(file, lines, ext);
  if (wants(2) && CLASS2_6_EXT.has(ext)) checkClass2(file, lines);
  if (wants(3)) checkClass3(file, lines);
  if (wants(4)) checkClass4(file, lines);
  if (wants(5)) checkClass5(file, lines);
  if (wants(6) && CLASS2_6_EXT.has(ext)) checkClass6(file, lines, ext);
}

// An allowlist entry that matched nothing this run is reported as a finding of
// its own — see the allowlist note in CLASS 1 for why a waiver that tracks
// nothing is worse than no waiver.
if (wants(1)) reportStaleAllowlistEntries();

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
  console.log(
    JSON.stringify({ root: rootAbs, repoRoot, scanned: scanFiles.length, findings, indeterminate, waived }, null, 2),
  );
  process.exit(indeterminate.length ? 2 : findings.length ? 1 : 0);
}

console.log(`check-contamination-classes: scanned ${scanFiles.length} files under ${rootAbs}`);
console.log(`repo root: ${repoRoot}`);
console.log("");

// Indeterminate cases are checked, and reported, BEFORE the pass/fail
// verdict below — a run that could not resolve every case is neither a
// clean PASS nor an ordinary FAIL; it is its own outcome (exit 2), same as
// the walker's unreadable-directory case above. Any concrete findings are
// still printed in full underneath, so a human has the complete picture,
// but the exit code reports the ambiguity, not whichever of pass/fail
// happens to be more numerous.
if (indeterminate.length) {
  console.log(`## COULD NOT VERIFY — ${indeterminate.length} case(s)`);
  for (const f of indeterminate) {
    console.log(`  CLASS ${f.class} — ${f.file}:${f.line}`);
    console.log(`      ${f.detail}`);
    console.log(`      > ${f.snippet}`);
  }
  console.log("");
}

// Waived citations are PRINTED on every run, pass or fail. A waiver that is
// invisible while it holds is indistinguishable from a rule that was never
// broken, and the whole point of this list is that it is embarrassing enough
// to shrink.
if (waived.length) {
  console.log(`## KNOWN, WAIVED — ${waived.length} pre-existing CLASS 1 citation(s)`);
  for (const w of waived) {
    console.log(`  ${w.file}:${w.line} cites "${w.cited}" (${w.state}) — waived, tracked by ${w.issue}`);
  }
  console.log("");
}

if (!findings.length && !indeterminate.length) {
  console.log(
    waived.length
      ? `PASS — no NEW contamination-class findings (${waived.length} known citation(s) waived above; a waived run is not a clean one).`
      : "PASS — no contamination-class findings.",
  );
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

if (indeterminate.length) {
  console.log(
    `CANNOT VERIFY — ${indeterminate.length} case(s) this run could not resolve (see above)` +
      (findings.length ? `, plus ${findings.length} confirmed finding(s) across ${new Set(findings.map((f) => f.class)).size} class(es).` : "."),
  );
  process.exit(2);
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
