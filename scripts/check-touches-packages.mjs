#!/usr/bin/env node
// check-touches-packages -- decides whether a pull request's changes could
// possibly affect what the two expensive package-verification steps in
// .github/workflows/ci.yml's `build` job ("Candidate qualification records"
// and "Packed consumer readiness") would find, so those two steps -- and
// only those two -- can be skipped when the answer is provably no.
//
//   node scripts/check-touches-packages.mjs
//
// Reads GITHUB_EVENT_NAME and BASE_SHA from the environment (the workflow
// sets both) and writes a single `touches=true|false` line to
// $GITHUB_OUTPUT (and to stdout, for a human reading the run log). Always
// exits 0: this script is a router, never a gate, and must never be the
// reason the required "build and test" status context fails to report.
//
// FAIL SAFE, BY CONSTRUCTION -- READ THIS BEFORE CHANGING ANYTHING BELOW
// ------------------------------------------------------------------------
// "A gate that quietly stops running under some trigger condition, while
// continuing to report a pass, is the exact defect this check exists to
// refuse" (this repository's own secret-scan gate). A path filter that is
// too narrow, or a detector that fails closed, is exactly that defect
// wearing a different hat. So every branch below that cannot PROVE the
// change is package-irrelevant reports `touches=true` (run the expensive
// steps), never `touches=false`:
//
//   - not a pull_request event (push to main, workflow_dispatch, ...)
//   - BASE_SHA missing or empty
//   - the base ref doesn't resolve (resolveBaseRef throws)
//   - `git merge-base` fails
//   - `git diff --name-only` fails
//   - the diff reports ZERO changed paths -- a pull request that reaches
//     this job always changed *something* relative to its base, so an
//     empty result here means the comparison went wrong, not that nothing
//     changed. Treated identically to every other detection failure.
//   - any other exception anywhere in this script
//
// The workflow step calling this script adds a second, independent layer:
// its own `if:` conditions treat anything other than the literal string
// "false" as "run" (`if: steps.touch.outputs.touches != 'false'`), and the
// step itself is `continue-on-error: true`. So even a catastrophic failure
// that stops this script before it writes ANY output (a missing Node
// binary, a syntax error introduced by a future edit) still leaves the
// output unset -- which is "not literally 'false'" -- and the expensive
// steps still run. Only an *explicit, successfully-written* `touches=false`
// ever skips them.
//
// Reuses check-release-readiness.mjs's own `git` helper and
// `resolveBaseRef()` merge-base resolution rather than a second
// implementation that could drift from it -- see that file's header for why
// `git merge-base <base> HEAD` against the pull request's real base SHA
// (never just the previous commit) is the only comparison point that is
// actually correct for a PR that has drifted from an updated `main`.

import { appendFileSync } from "node:fs";
import { git, resolveBaseRef } from "./check-release-readiness.mjs";

// Any changed path under these prefixes, or exactly matching one of these
// files, is treated as "could affect package verification". Deliberately
// wide -- whole directories rather than an enumerated file list -- because:
//
//   packages/**   -- the packages being verified. Certainly in scope.
//
//   governance/**  -- every retained record `check:candidate-qualification`
//                     and `check:later-publications` validate lives here
//                     and NOT under packages/: release-qualifications,
//                     release-qualification-cohorts, quarantines,
//                     tail-authorizations, release-publications, the
//                     package-identity-transition policy, and deferrals. A
//                     filter that only watched packages/ would let a PR
//                     that edits one of these records skip the exact check
//                     that validates it -- silently. See
//                     scripts/check-candidate-qualification.mjs's own
//                     imports for the full, currently-six-module list this
//                     one directory prefix stands in for.
//
//   scripts/**    -- both expensive steps' own source, and every lib/
//                     module either one imports (packed-consumer-readiness,
//                     candidate-qualification, package-identity-transition,
//                     release-publication-cohort, release-qualification-
//                     cohort, release-qualification-trio, release-later-
//                     publication, ...), lives here. Naming each file
//                     individually would need this list to track every
//                     import those two scripts make, forever, and a missed
//                     one is exactly the silent-narrowing failure mode this
//                     header opens with. The whole directory is the only
//                     version of this rule that cannot go stale by drift.
//
//   package.json, package-lock.json, package-scope.json (repository root)
//                 -- root manifest/lockfile/scope shape what the packed-
//                    consumer install actually resolves and what the
//                    candidate-qualification identity join compares
//                    against.
//
//   .github/workflows/ci.yml
//                 -- the workflow doing the skipping. A change to the very
//                    file that defines this conditional behaviour must
//                    always exercise what it just changed, never trust
//                    itself to be exempt.
const PACKAGE_TOUCHING_PREFIXES = ["packages/", "governance/", "scripts/"];
const PACKAGE_TOUCHING_EXACT = new Set([
  "package.json",
  "package-lock.json",
  "package-scope.json",
  ".github/workflows/ci.yml",
]);

export function touchesPackages(changedPaths) {
  return changedPaths.some(
    (path) =>
      PACKAGE_TOUCHING_EXACT.has(path) ||
      PACKAGE_TOUCHING_PREFIXES.some((prefix) => path.startsWith(prefix)),
  );
}

function writeOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) appendFileSync(outputPath, `${name}=${value}\n`);
}

function report(touches, reason) {
  console.log(`check-touches-packages: touches=${touches} -- ${reason}`);
  writeOutput("touches", String(touches));
}

function main() {
  const eventName = process.env.GITHUB_EVENT_NAME ?? "";
  if (eventName !== "pull_request") {
    report(true, `event is '${eventName || "(unset)"}', not 'pull_request' -- always run outside a diffed PR`);
    return;
  }

  const baseSha = process.env.BASE_SHA ?? "";
  if (!baseSha) {
    report(true, "BASE_SHA is empty -- cannot resolve a comparison point");
    return;
  }

  const gitRoot = git(["rev-parse", "--show-toplevel"], process.cwd()).trim();

  let baseRef;
  try {
    baseRef = resolveBaseRef(gitRoot, baseSha);
  } catch (error) {
    report(true, `base ref did not resolve: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  let mergeBase;
  try {
    mergeBase = git(["merge-base", baseRef, "HEAD"], gitRoot).trim();
  } catch (error) {
    report(true, `git merge-base failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  let diffOutput;
  try {
    diffOutput = git(["diff", "--name-only", mergeBase, "HEAD"], gitRoot);
  } catch (error) {
    report(true, `git diff failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const changed = diffOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (changed.length === 0) {
    report(true, "diff reported zero changed paths -- treated as a detection failure, not a genuinely empty PR");
    return;
  }

  const touches = touchesPackages(changed);
  report(
    touches,
    touches
      ? `${changed.length} changed path(s) since merge-base ${mergeBase.slice(0, 12)} include at least one package-touching path`
      : `${changed.length} changed path(s) since merge-base ${mergeBase.slice(0, 12)}, none package-touching`,
  );
}

try {
  main();
} catch (error) {
  // Belt and braces: nothing above should throw past its own try/catch, but
  // if something does, this is still not a reason to skip.
  report(true, `unexpected error: ${error instanceof Error ? error.message : String(error)}`);
}
process.exit(0);
