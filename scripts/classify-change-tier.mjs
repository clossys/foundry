#!/usr/bin/env node
// classify-change-tier -- decides how much of ci.yml a pull_request or
// merge_group run actually needs, so a change that touches only prose (a
// `.changesets/*.md` file, anything under `docs/**` including
// `docs/changelogs/**`, a root `*.md` file -- or, narrower still, only a
// packed `packages/*/README.md` or `packages/*/skill/SKILL.md`) can skip
// the jobs that cannot possibly be affected by it: build and test, packed
// consumer readiness, and the candidate-qualification shards (issue #1420).
//
//   node scripts/classify-change-tier.mjs
//
// Reads GITHUB_EVENT_NAME and BASE_SHA from the environment (the workflow
// sets both, the same two the sibling scripts/check-touches-packages.mjs
// already reads) and writes a single `tier=full|prose|packed-prose` line to
// $GITHUB_OUTPUT (and to stdout, for a human reading the run log). Always
// exits 0: this script is a router, never a gate, and must never be the
// reason a required context fails to report.
//
// FAIL CLOSED, BY CONSTRUCTION -- READ THIS BEFORE CHANGING ANYTHING BELOW
// ------------------------------------------------------------------------
// "A skipped required job reports as passing" is issue #1420's own framing
// of the danger here. The single most damaging failure mode this script
// could have is answering 'prose' or 'packed-prose' when it is not actually
// certain -- so every branch that cannot PROVE the change is prose-only
// reports 'full' (run everything), never a narrower tier:
//
//   - not a pull_request or merge_group event (push to main,
//     workflow_dispatch, ...) -- this script's job only ever needs to
//     narrow those two trigger types; every other event runs everything,
//     the same way it always has.
//   - BASE_SHA missing or empty
//   - the base ref doesn't resolve (resolveBaseRef throws)
//   - `git merge-base` fails
//   - `git diff` fails
//   - the diff reports ZERO changed paths -- a pull_request or merge_group
//     run that reaches this job always changed *something* relative to its
//     base, so an empty result here means the comparison went wrong, not
//     that nothing changed. Treated identically to every other detection
//     failure -- the same polarity check-touches-packages.mjs already uses
//     for its own empty-diff case.
//   - a single changed path this script does not recognise as prose or
//     packed-prose
//   - any other exception anywhere in this script
//
// `--no-renames` on the diff is deliberate: without it, git's own rename
// heuristic can collapse a two-sided change -- a file genuinely MOVED from
// packages/ to docs/, deleting real source and adding a doc -- into one
// line naming only the new path, which would read as pure prose and miss
// the deleted source entirely. `--no-renames` always reports a rename as a
// delete and an add, so both the old and the new path are classified
// independently, and the old, non-prose path forces 'full' on its own.
//
// Reuses check-release-readiness.mjs's own `git` helper and
// `resolveBaseRef()` merge-base resolution -- the same two
// scripts/check-touches-packages.mjs already reuses -- rather than a
// second implementation that could drift from either.

import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { git, resolveBaseRef } from "./check-release-readiness.mjs";

// A changed path is classified into exactly one tier. "full" always wins
// when even one path in a diff falls outside the other two sets -- see
// classifyChangeTier() below.
const PROSE_PATTERNS = [
  /^\.changesets\/[^/]+\.md$/, // .changesets/*.md
  /^docs\//, // docs/** (any file, any depth -- includes docs/changelogs/**)
  /^[^/]+\.md$/, // a root-level *.md file
];

const PACKED_PROSE_PATTERNS = [
  /^packages\/[^/]+\/README\.md$/, // a package's own README
  /^packages\/[^/]+\/skill\/SKILL\.md$/, // a package's own packed skill
];

/**
 * Classifies one changed path as "prose" (cannot affect anything but the
 * prose gates), "packed-prose" (a packed file: also needs the README
 * code-examples typecheck and artifact safety, since those are the gates
 * that actually read it), or "full" (anything else, including a path this
 * function does not recognise at all).
 */
export function classifyPath(path) {
  if (PROSE_PATTERNS.some((pattern) => pattern.test(path))) return "prose";
  if (PACKED_PROSE_PATTERNS.some((pattern) => pattern.test(path))) return "packed-prose";
  return "full";
}

/**
 * The pure classifier. Every changed path must classify as prose or
 * packed-prose for the result to be anything other than 'full' -- a single
 * non-prose path anywhere in the list (including the deleted half of a
 * rename), an empty list, or a path this function does not recognise, all
 * force 'full'. 'packed-prose' wins over 'prose' only when nothing in the
 * diff forced 'full': it is a strictly wider tier than 'prose' (prose gates
 * plus the two packed-file gates), never a replacement for it.
 */
export function classifyChangeTier(changedPaths) {
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) return "full";
  let sawPackedProse = false;
  for (const path of changedPaths) {
    const kind = classifyPath(path);
    if (kind === "full") return "full";
    if (kind === "packed-prose") sawPackedProse = true;
  }
  return sawPackedProse ? "packed-prose" : "prose";
}

function writeOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) appendFileSync(outputPath, `${name}=${value}\n`);
}

function report(tier, reason) {
  console.log(`classify-change-tier: tier=${tier} -- ${reason}`);
  writeOutput("tier", tier);
}

function main() {
  const eventName = process.env.GITHUB_EVENT_NAME ?? "";
  if (eventName !== "pull_request" && eventName !== "merge_group") {
    report("full", `event is '${eventName || "(unset)"}', not 'pull_request' or 'merge_group' -- always run everything outside a diffed change`);
    return;
  }

  const baseSha = process.env.BASE_SHA ?? "";
  if (!baseSha) {
    report("full", "BASE_SHA is empty -- cannot resolve a comparison point");
    return;
  }

  const gitRoot = git(["rev-parse", "--show-toplevel"], process.cwd()).trim();

  let baseRef;
  try {
    baseRef = resolveBaseRef(gitRoot, baseSha);
  } catch (error) {
    report("full", `base ref did not resolve: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  let mergeBase;
  try {
    mergeBase = git(["merge-base", baseRef, "HEAD"], gitRoot).trim();
  } catch (error) {
    report("full", `git merge-base failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  let diffOutput;
  try {
    // --no-renames: see the header comment above for why a moved file must
    // always be seen as its own delete + add, never collapsed to one line.
    diffOutput = git(["diff", "--no-renames", "--name-only", mergeBase, "HEAD"], gitRoot);
  } catch (error) {
    report("full", `git diff failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const changed = diffOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (changed.length === 0) {
    report("full", "diff reported zero changed paths -- treated as a detection failure, not a genuinely empty change");
    return;
  }

  const tier = classifyChangeTier(changed);
  const offender = tier === "full" ? changed.find((path) => classifyPath(path) === "full") : undefined;
  report(
    tier,
    tier === "full"
      ? `${changed.length} changed path(s) since merge-base ${mergeBase.slice(0, 12)} include at least one non-prose path (e.g. ${offender ?? "(unknown)"})`
      : `${changed.length} changed path(s) since merge-base ${mergeBase.slice(0, 12)}, every one classified '${tier}'`,
  );
}

// Guarded exactly like check-release-readiness.mjs's own main() call
// (scripts/check-release-readiness.mjs): this module is imported directly
// by its own test file for classifyChangeTier()/classifyPath()'s pure
// table tests, and an unconditional main() + process.exit(0) at import
// time would kill that test process before a single test() callback ran.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    // Belt and braces: nothing above should throw past its own try/catch,
    // but if something does, this is still not a reason to run less.
    report("full", `unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exit(0);
}
