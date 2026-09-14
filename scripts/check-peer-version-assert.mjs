#!/usr/bin/env node
// check-peer-version-assert — does every hand-copied `assertPeerVersion`
// still agree with the canonical body, once each package's own name and
// its comments are set aside? (#518)
//
//   node scripts/check-peer-version-assert.mjs [--json]
//
// Exit 0 = every discovered `peer-version.ts` matches canonical. Exit 1 =
// at least one has diverged. Exit 2 = the check could not be completed (the
// canonical file is unreadable, a discovered file's owning package could
// not be identified, or discovery itself looks broken — see EMPTY/SHORT
// SCAN below). Same three-way split every gate in this repo uses — see
// CONTRIBUTING.md's "Gate CLIs exit 0/1/2" entry.
//
// WHY A GATE, NOT AN EXTRACTION (#518)
// -------------------------------------
// The obvious fix for nine — now six, see RETIREMENT below — hand-copies of
// one function is to extract a shared implementation. That does not
// transfer here. Five of this repository's six `peer-version.ts` owners
// (bouncer, butler, controller, designer, keeper) declare ZERO first-party
// runtime dependencies in their own `package.json` — not an oversight, a
// stated design goal, the same way `check-shared-vocabularies.mjs`'s
// header argues observer's zero-dependency contract is not free to spend.
// A shared package would hand every one of those five a first-party
// dependency edge it does not have today, to save roughly 40 lines. The
// one package here that is NOT zero-dependency, publisher, is LAST in
// `governance/release-catalog.json`'s publish order — it precedes nobody,
// so it cannot be the thing the other five import from without inverting
// that order. `AGENTS.md` forbids `workspace:*`/`catalog:` protocols, so
// any such dependency would also need to be a real pinned semver range
// against a published sibling — exactly the release-ordering constraint
// `check-release-catalog.mjs`'s qualification tests enforce. Extraction
// was considered and declined for these reasons; this gate is the
// alternative the issue asked for instead — keep the copies, verify them.
//
// RETIREMENT. The issue that opened this measured nine files across nine
// packages. Three of those — auth, comms, consent — were fully retired in
// "Retire superseded donor packages" (#536), already on `main` by the time
// this gate was written. Six files remain; this gate discovers them by
// walking the tree rather than hardcoding a roster of nine, so a package
// added or retired later changes what this gate finds without anyone
// having to remember to edit a list here — the same class of "someone has
// to remember" failure #518 itself is about.
//
// WHAT THIS GATE FOUND, ALREADY, THE FIRST TIME IT RAN
// -------------------------------------------------------
// bouncer, controller, designer and publisher are byte-identical once
// comments and each package's own name are set aside. butler and keeper
// are ALSO byte-identical to each other, but not to the other four: they
// are missing the fix `bouncer/src/internal/peer-version.test.ts` names
// and dates precisely — "does not throw on a prerelease peer version —
// reports indeterminate via a single console.warn instead (#389)". Where
// the canonical body treats an unparseable INSTALLED version as
// indeterminate (warn once, proceed — the peer might be fine; the string
// just couldn't be read), butler and keeper still throw. Their own test
// files assert the OLD behaviour by name: "throws a loud error for an
// unparseable installed version, never an assumed pass" — so this is not
// a false positive; it is a real, dated regression this gate is the first
// mechanism ever to see. Porting #389 into butler and keeper is a real
// source change to two published packages — a version bump and a
// qualification record each, per `docs/LIFECYCLE.md` — and is deliberately
// NOT bundled into the change that added this gate. See the PR that added
// this file for the recommended follow-up.
//
// COMMENTS AND SELF-NAMING. Every copy's own module-doc header
// legitimately names its own package — `check-shared-vocabularies.mjs`
// grants the same allowance. Stripping comments handles every one of
// those. But `assertPeerVersion`'s self-naming is not only in a comment:
// each copy also embeds its own package name in an actual runtime
// `console.warn` string — `[@clossys/bouncer]` vs. `[@clossys/controller]`,
// etc. — which shifts where a wrapped template literal happens to break, a
// cosmetic difference a raw hash would wrongly report as divergence. This
// gate reads each file's OWN `package.json` `"name"` and blanks that exact
// string out of the code before hashing, so a package naming itself — in a
// comment or in its own log line — is never mistaken for drift.
//
// CONTROL, NOT JUST A STRIP. #518 itself records the strip-that-matches-
// nothing failure mode: a first pass used a BSD-`sed`-only `\s` and
// silently hashed prose, reporting nine distinct bodies where only seven
// were real. `normalize()` below is asserted, in
// `check-peer-version-assert.test.mjs`, to shrink a real file by a
// non-trivial margin — the same control that caught that bug, kept.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, dirname } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname;

/** The body every other copy is measured against, and why. */
export const CANONICAL_PATH = "packages/bouncer/src/internal/peer-version.ts";
export const CANONICAL_REASON =
  "carries the #389 fix (warn-and-continue on an unparseable INSTALLED version) that " +
  "bouncer, controller, designer and publisher all share once each package's own name " +
  "is set aside, and that butler and keeper's own tests show they never received.";

/** A scan finding fewer files than this is treated as broken discovery, not a clean pass. */
const MINIMUM_EXPECTED_FILES = 2;

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * Merge adjacent template-literal string concatenation — `` `a` + `b` ``
 * becomes `` `ab` `` — repeatedly, until nothing more merges. Prettier
 * wraps a long `+`-joined message at whatever column the CURRENT string
 * lengths put it at, so the exact same concatenated string ends up split
 * across two backtick literals at a different word depending only on how
 * long `[@clossys/<name>]` happens to be. That is a line-wrap artifact,
 * not a behavioural difference, and folding it away BEFORE tokenizing is
 * what makes this gate compare the string the code actually produces
 * rather than where a formatter chose to break it. Safe for this file's
 * content specifically: no literal here contains a backtick, so
 * `[^`]*` never crosses into a neighbouring literal by accident.
 */
function foldAdjacentTemplateLiterals(src) {
  let previous;
  let current = src;
  do {
    previous = current;
    current = current.replace(/`([^`]*)`\s*\+\s*`([^`]*)`/g, "`$1$2`");
  } while (current !== previous);
  return current;
}

/** Blank out every literal occurrence of a package naming itself. */
function stripOwnName(src, ownName) {
  if (!ownName) return src;
  return src.split(ownName).join("__OWN_PACKAGE_NAME__");
}

/**
 * Comments gone, this package's own name blanked out, every run of
 * whitespace — including a wrapped template literal's OWN line break —
 * collapsed to one space. That last part is load-bearing: the four
 * canonical-cluster files are genuinely byte-identical once comments and
 * self-naming are set aside, EXCEPT that Prettier wraps one console.warn
 * string at a different word depending on how long `[@clossys/<name>]`
 * happens to be — "declared range" on one line, "declared" / "range" split
 * across two on another. A per-line compare reports that as divergence; it
 * is not, the concatenated string is identical. Tokenizing on whitespace is
 * what "behaviour, not formatting" (the standard this gate's own issue
 * sets) requires here. Exported so the test file can assert the control
 * directly: this must actually shrink a real file, not match nothing the
 * way a BSD-incompatible `\s` class silently did in #518's first
 * measurement.
 */
export function normalize(src, ownName) {
  const folded = foldAdjacentTemplateLiterals(stripOwnName(stripComments(src), ownName));
  return folded
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .join(" ");
}

function hash(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

/** Walk packages/*, returning every file literally named peer-version.ts (never dist/, never node_modules/). */
export function discoverPeerVersionFiles(repoRoot = REPO_ROOT) {
  const found = [];
  const packagesDir = join(repoRoot, "packages");
  let packageNames;
  try {
    packageNames = readdirSync(packagesDir);
  } catch {
    return found;
  }
  for (const pkg of packageNames) {
    const pkgDir = join(packagesDir, pkg);
    if (!statSync(pkgDir).isDirectory()) continue;
    walk(join(pkgDir, "src"), repoRoot, found);
  }
  return found.sort();
}

function walk(dir, repoRoot, found) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, repoRoot, found);
    } else if (entry.isFile() && entry.name === "peer-version.ts") {
      found.push(relative(repoRoot, full));
    }
  }
}

/** The nearest ancestor package.json's declared name — this file's own package, read fresh, never assumed. */
function ownPackageName(filePath, repoRoot) {
  let dir = dirname(join(repoRoot, filePath));
  while (dir.startsWith(join(repoRoot, "packages"))) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      if (typeof manifest.name === "string") return manifest.name;
    } catch {
      // not the package root — keep climbing
    }
    dir = dirname(dir);
  }
  return null;
}

export async function run({ repoRoot = REPO_ROOT } = {}) {
  const files = discoverPeerVersionFiles(repoRoot);

  if (files.length < MINIMUM_EXPECTED_FILES) {
    return {
      verdict: "indeterminate",
      reasons: [
        `discovery found only ${files.length} file(s) named peer-version.ts under packages/*/src — ` +
          `expected at least ${MINIMUM_EXPECTED_FILES}. Either every copy but one was legitimately retired ` +
          `(update MINIMUM_EXPECTED_FILES with that reasoning) or discovery itself is broken; an empty-looking ` +
          `scan is never reported as agreement.`,
      ],
      files,
    };
  }

  let canonicalRaw;
  try {
    canonicalRaw = readFileSync(join(repoRoot, CANONICAL_PATH), "utf8");
  } catch (error) {
    return {
      verdict: "indeterminate",
      reasons: [`canonical file ${CANONICAL_PATH} could not be read: ${error instanceof Error ? error.message : String(error)}`],
      files,
    };
  }
  const canonicalOwnName = ownPackageName(CANONICAL_PATH, repoRoot);
  const canonicalNormalized = normalize(canonicalRaw, canonicalOwnName);
  const canonicalHash = hash(canonicalNormalized);

  const reasons = [];
  const details = [];
  for (const file of files) {
    const rawText = readFileSync(join(repoRoot, file), "utf8");
    const own = ownPackageName(file, repoRoot);
    if (!own) {
      reasons.push(`${file}: could not find an owning package.json under packages/*/ — cannot tell what name to treat as self-naming`);
      details.push({ file, verdict: "indeterminate" });
      continue;
    }
    const normalized = normalize(rawText, own);
    const fileHash = hash(normalized);
    if (file === CANONICAL_PATH || fileHash === canonicalHash) {
      details.push({ file, verdict: "satisfied", hash: fileHash });
      continue;
    }
    const firstDiffLine = firstDivergingLine(canonicalNormalized, normalized);
    reasons.push(
      `${file}: diverges from canonical (${CANONICAL_PATH}) — normalized hash ${fileHash} vs ${canonicalHash}. ` +
        `First point of divergence: ${firstDiffLine}`,
    );
    details.push({ file, verdict: "violated", hash: fileHash });
  }

  if (reasons.some((r) => r.includes("could not find an owning package.json"))) {
    return { verdict: "indeterminate", reasons, files: details };
  }
  if (reasons.length > 0) {
    return { verdict: "violated", reasons, files: details, canonicalHash, canonicalReason: CANONICAL_REASON };
  }
  return { verdict: "satisfied", reasons: [], files: details, canonicalHash, canonicalReason: CANONICAL_REASON };
}

function firstDivergingLine(canonicalNormalized, otherNormalized) {
  const a = canonicalNormalized.split(" ");
  const b = otherNormalized.split(" ");
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) {
      const context = (tokens, at) => tokens.slice(Math.max(0, at - 4), at + 5).join(" ");
      return `token ${i + 1}: canonical has ...${JSON.stringify(context(a, i))}..., this file has ...${JSON.stringify(context(b, i))}...`;
    }
  }
  return "(hashes differ but no token-level difference was found — investigate directly)";
}

export const EXIT_CODES = Object.freeze({ satisfied: 0, violated: 1, indeterminate: 2 });

async function main() {
  const result = await run();
  const json = process.argv.includes("--json");
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`  [${result.verdict.toUpperCase()}] assertPeerVersion — ${result.files?.length ?? 0} copies discovered under packages/*/src`);
    for (const reason of result.reasons) console.log(`      ${reason}`);
    if (result.verdict !== "indeterminate") {
      console.log(`\n  canonical: ${CANONICAL_PATH}\n  reason: ${CANONICAL_REASON}`);
    }
    console.log(
      result.verdict === "satisfied"
        ? `\nPEER-VERSION-ASSERT OK — every discovered copy matches canonical.`
        : result.verdict === "violated"
          ? `\nPEER-VERSION-ASSERT FAIL — at least one copy of assertPeerVersion has diverged from canonical.`
          : `\nPEER-VERSION-ASSERT INDETERMINATE — the check could not be completed; see reasons above.`,
    );
  }
  process.exit(EXIT_CODES[result.verdict]);
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) await main();
