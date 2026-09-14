#!/usr/bin/env node
// check-peer-version-assert — does every hand-copied `assertPeerVersion`
// still agree with the canonical body, once each package's own name and
// its comments are set aside? (#518)
//
//   node scripts/check-peer-version-assert.mjs [--json]
//
// Exit 0 = every discovered `peer-version.ts` matches canonical, or its
// divergence is an ACKNOWLEDGED EXCEPTION (see below). Exit 1 = at least
// one has diverged with no matching exception, an exception has gone
// STALE (the file it names now matches canonical — the acknowledgement has
// outlived its reason), or a NEW divergence has appeared in a file an
// exception already names (the exception is pinned to a specific hash, not
// a blanket amnesty for that file). Exit 2 = the check could not be
// completed (the canonical file is unreadable, a discovered file's owning
// package could not be identified, or discovery itself looks broken — see
// EMPTY/SHORT SCAN below). Same three-way split every gate in this repo
// uses — see CONTRIBUTING.md's "Gate CLIs exit 0/1/2" entry.
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
// NOT bundled into the change that added this gate. Tracked at #847.
//
// WHY THIS GATE IS GREEN ON ARRIVAL, NOT RED
// ---------------------------------------------
// A gate that fails the moment it lands on `main` teaches everyone to
// ignore it — `main` had just been brought back to green after #821 cost a
// full day, and #831 is a second, independent account of a required check
// going red on `main` doing exactly that damage. So the butler/keeper
// divergence above is recorded as an ACKNOWLEDGED_EXCEPTIONS entry — same
// shape as `check-package-evidence.mjs`'s `gaps`: a real, tracked shortfall
// with a `reason` and an `issue` (#847), pinned to the SPECIFIC normalized
// hash measured when it was recorded, not merely to the file path. That
// pinning is what keeps this from being a general amnesty: if butler or
// keeper's `peer-version.ts` changes to some THIRD state — neither
// canonical nor the acknowledged divergence — that is a new, unacknowledged
// problem and fails loudly, exactly like any other file here. And the
// moment butler or keeper is brought into line with canonical, ITS
// EXCEPTION ENTRY BECOMES THE FAILURE ("stale-exception") — the same
// `stale-gap` shape `check-package-evidence.mjs` uses for exactly this:
// an acknowledgement that now has evidence must not silently outlive the
// reason it was recorded for. Every file NOT named in
// ACKNOWLEDGED_EXCEPTIONS gets zero tolerance from the day this gate
// landed.
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

/**
 * A REAL, ACKNOWLEDGED divergence — not a general amnesty. Each entry is
 * pinned to `acknowledgedHash`: the specific normalized hash the file had
 * when the exception was recorded. Same shape as `check-package-evidence.mjs`'s
 * `gaps`: a shortfall carries a `reason` and an `issue`, and passes ONLY
 * while it is still true.
 *
 * THREE OUTCOMES PER LISTED FILE, EVERY RUN:
 *   1. current hash === canonical hash        -> "stale-exception": FAILS.
 *      The regression is gone; the acknowledgement has outlived its reason
 *      and must be deleted here (see check-package-evidence.mjs's
 *      `stale-gap` for the same shape — a gap that now has evidence is
 *      itself a finding, never silently carried forward).
 *   2. current hash === acknowledgedHash       -> "acknowledged": PASSES.
 *      Exactly the known, tracked shortfall — main stays green.
 *   3. current hash === neither                -> "violated": FAILS.
 *      Pinning to a hash, not just a file path, means a NEW divergence in
 *      butler or keeper — one that is not the #389 gap this exception
 *      describes — is never swallowed by the same amnesty. Any file NOT
 *      listed here gets no exception at all, acknowledged or otherwise.
 *
 * Landing this gate red on `main` the day it merges teaches everyone to
 * ignore it — see #831 and the day #821 cost recovering from exactly that
 * failure mode. This is why butler/keeper (a real, already-tracked gap) are
 * acknowledged instead of silently exempted or left to fail loudly on
 * arrival; every OTHER file still has zero tolerance.
 */
export const ACKNOWLEDGED_EXCEPTIONS = Object.freeze([
  Object.freeze({
    file: "packages/butler/src/web/internal/peer-version.ts",
    acknowledgedHash: "3b56a43c128a",
    reason:
      "missing the #389 fix (warn-and-continue on an unparseable INSTALLED peer version); still " +
      "hard-throws, and its own test file asserts the old behaviour by name. Porting the fix is a " +
      "real source change to a published package — a version bump and a qualification record per " +
      "docs/LIFECYCLE.md — tracked separately so it is not bundled into the change that added this gate.",
    issue: 847,
  }),
  Object.freeze({
    file: "packages/keeper/src/web/internal/peer-version.ts",
    acknowledgedHash: "3b56a43c128a",
    reason:
      "missing the #389 fix (warn-and-continue on an unparseable INSTALLED peer version); still " +
      "hard-throws, and its own test file asserts the old behaviour by name. Porting the fix is a " +
      "real source change to a published package — a version bump and a qualification record per " +
      "docs/LIFECYCLE.md — tracked separately so it is not bundled into the change that added this gate.",
    issue: 847,
  }),
]);

/**
 * Validate ACKNOWLEDGED_EXCEPTIONS the same way check-package-evidence.mjs
 * validates `gaps`: a malformed entry is never silently honoured — it is
 * reported AND excluded from lookup, so a broken declaration fails closed
 * (the file it names gets zero protection) rather than failing open.
 */
function validateExceptions(discoveredFiles, exceptions) {
  const findings = [];
  const byFile = new Map();
  const seenFiles = new Set();
  for (const exception of exceptions) {
    if (typeof exception.file !== "string" || exception.file.length === 0) {
      findings.push("an ACKNOWLEDGED_EXCEPTIONS entry has no `file`");
      continue;
    }
    if (seenFiles.has(exception.file)) {
      findings.push(`${exception.file}: two ACKNOWLEDGED_EXCEPTIONS entries declared for the same file`);
      continue;
    }
    seenFiles.add(exception.file);
    if (typeof exception.reason !== "string" || exception.reason.trim().length < 20) {
      findings.push(`${exception.file}: ACKNOWLEDGED_EXCEPTIONS entry needs a reason of at least 20 characters saying what is actually missing`);
      continue;
    }
    if (!Number.isInteger(exception.issue)) {
      findings.push(`${exception.file}: ACKNOWLEDGED_EXCEPTIONS entry needs an integer \`issue\` tracking it — a countdown, not a standing exemption`);
      continue;
    }
    if (typeof exception.acknowledgedHash !== "string" || exception.acknowledgedHash.length === 0) {
      findings.push(`${exception.file}: ACKNOWLEDGED_EXCEPTIONS entry needs an \`acknowledgedHash\` — pinned to a file path alone, ANY divergence in that file would pass, which is a general amnesty, not an acknowledged one`);
      continue;
    }
    if (!discoveredFiles.includes(exception.file)) {
      findings.push(`${exception.file}: ACKNOWLEDGED_EXCEPTIONS names a file that was not discovered under packages/*/src — remove the stale entry or fix the path`);
      continue;
    }
    byFile.set(exception.file, exception);
  }
  return { findings, byFile };
}

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

export function hash(text) {
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

export async function run({ repoRoot = REPO_ROOT, exceptions = ACKNOWLEDGED_EXCEPTIONS } = {}) {
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

  const { findings: exceptionFindings, byFile: exceptionsByFile } = validateExceptions(files, exceptions);

  const reasons = [...exceptionFindings];
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
    const exception = exceptionsByFile.get(file);

    if (file === CANONICAL_PATH || fileHash === canonicalHash) {
      if (exception) {
        // STALE EXCEPTION — the regression this acknowledgement describes is
        // gone. Same shape as check-package-evidence.mjs's `stale-gap`: an
        // acknowledgement that now has evidence is itself a failure, so it
        // cannot silently outlive the reason it was recorded for.
        reasons.push(
          `${file}: ACKNOWLEDGED_EXCEPTIONS entry (issue #${exception.issue}) is STALE — this file now matches canonical ` +
            `(hash ${fileHash}). Remove the exception from ACKNOWLEDGED_EXCEPTIONS in scripts/check-peer-version-assert.mjs ` +
            `and close #${exception.issue}.`,
        );
        details.push({ file, verdict: "stale-exception", hash: fileHash, issue: exception.issue });
        continue;
      }
      details.push({ file, verdict: "satisfied", hash: fileHash });
      continue;
    }

    if (exception && exception.acknowledgedHash === fileHash) {
      // ACKNOWLEDGED — exactly the known, tracked divergence, pinned by hash
      // (not merely by file path), so this does not become a general amnesty
      // for whatever butler/keeper happen to contain later.
      details.push({ file, verdict: "acknowledged", hash: fileHash, issue: exception.issue });
      continue;
    }

    const firstDiffLine = firstDivergingLine(canonicalNormalized, normalized);
    if (exception) {
      // A real divergence exists, an exception is declared for this file,
      // but the hash does NOT match what was acknowledged — this is a NEW,
      // unacknowledged divergence riding in on the same file, and must fail
      // loudly rather than being swallowed by the existing exception.
      reasons.push(
        `${file}: diverges from canonical (${CANONICAL_PATH}) AND from its acknowledged exception (issue #${exception.issue}) — ` +
          `this is a DIFFERENT divergence than the one that exception covers (acknowledged hash ${exception.acknowledgedHash}, ` +
          `actual hash ${fileHash}, canonical hash ${canonicalHash}). The exception does not cover this. ` +
          `First point of divergence: ${firstDiffLine}`,
      );
    } else {
      reasons.push(
        `${file}: diverges from canonical (${CANONICAL_PATH}) — normalized hash ${fileHash} vs ${canonicalHash}. ` +
          `First point of divergence: ${firstDiffLine}`,
      );
    }
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
    const acknowledged = (result.files ?? []).filter((f) => f.verdict === "acknowledged");
    for (const a of acknowledged) {
      console.log(`      [ACKNOWLEDGED, issue #${a.issue}] ${a.file}: diverges from canonical, but is a known, tracked exception — see ACKNOWLEDGED_EXCEPTIONS`);
    }
    for (const reason of result.reasons) console.log(`      ${reason}`);
    if (result.verdict !== "indeterminate") {
      console.log(`\n  canonical: ${CANONICAL_PATH}\n  reason: ${CANONICAL_REASON}`);
    }
    console.log(
      result.verdict === "satisfied"
        ? `\nPEER-VERSION-ASSERT OK — every discovered copy matches canonical, modulo ${acknowledged.length} acknowledged exception(s).`
        : result.verdict === "violated"
          ? `\nPEER-VERSION-ASSERT FAIL — at least one copy of assertPeerVersion has diverged from canonical without an acknowledged exception, or an exception has gone stale.`
          : `\nPEER-VERSION-ASSERT INDETERMINATE — the check could not be completed; see reasons above.`,
    );
  }
  process.exit(EXIT_CODES[result.verdict]);
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) await main();
