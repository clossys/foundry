#!/usr/bin/env node
// filter-qualification-dispatch — of the packages
// scripts/select-unqualified-packages.mjs reports as missing a retained
// record, which ones does .github/workflows/auto-qualify.yml still need to
// dispatch qualify-candidate.yml for, and which already have a run's own
// branch pushed for this exact package@version?
//
//   node scripts/filter-qualification-dispatch.mjs <unqualified.json> [--json]
//
// Reads the same `{ package, name, version }[]` shape
// select-unqualified-packages.mjs --json produces, checks each candidate's
// qualification branch (`claude/qualify-<pkg>-<version>`, the exact name
// .github/workflows/qualify-candidate.yml's own "Push branch and open pull
// request" step pushes) against the real remote via one
// `git ls-remote --heads origin`, and prints the subset that still needs a
// fresh dispatch.
//
// Exit 0 always (a filtering step, not a gate — matches select-unqualified-
// packages.mjs's own exit-code contract for anything short of a fatal read
// failure).
//
// WHY THIS EXISTS (issue #1324 item 1)
// -------------------------------------
// auto-qualify.yml's own concurrency group (`cancel-in-progress: true`)
// cancels a stale in-flight SELECTION when a newer push to main lands, but
// the `gh workflow run qualify-candidate.yml` dispatches an EARLIER run
// already made are fire-and-forget — not cancelled with it. Two rapid
// pushes that both see the same package as still-unqualified (before the
// first run has finished and pushed its qualification branch) could
// double-dispatch. This does not close that race outright — a dispatch
// made while an earlier run for the same package is still IN FLIGHT (branch
// not pushed yet) is not caught here, since there is nothing on the remote
// yet to detect — but it does close the far more common case this
// workflow's own push-triggered nature actually produces: auto-qualify.yml
// re-running (a later, unrelated push to main) while an EARLIER run's
// qualify-candidate.yml dispatch is still working through the pinned
// runtime, or has already finished and pushed its branch/PR, for a package
// whose record has not yet landed on main. Without this filter, every such
// re-run re-dispatches the same package@version, producing either a
// wasted, ultimately-failing qualify-candidate.yml run (branch already
// exists) or, worse, a genuine duplicate branch/PR if that workflow's own
// internal handling of an existing branch does not refuse cleanly.
//
// Deliberately does NOT call qualify-candidate.yml's own concurrency group
// or check run status via the Actions API — a branch-existence check is
// the cheap, purely-additive signal CodeRabbit's own review named, and
// needs no token beyond anonymous read access to this public repository's
// own refs.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function die(message, code = 1) {
  console.error(`filter-qualification-dispatch: ${message}`);
  process.exit(code);
}

/** The exact branch name qualify-candidate.yml's own "Push branch and open pull request" step pushes for one candidate — see that workflow's own `branch="claude/qualify-${PKG}-${VERSION}"` line. */
export function qualificationBranchName(pkg, version) {
  return `claude/qualify-${pkg}-${version}`;
}

/**
 * Pure: given the candidates select-unqualified-packages.mjs reported and
 * the set of branch names that already exist on the remote, returns the
 * subset whose qualification branch is NOT already present — the ones that
 * still genuinely need a fresh dispatch. Testable with a hand-built Set,
 * no git or network involved.
 */
export function packagesNeedingDispatch(candidates, existingBranchNames) {
  return candidates.filter((c) => !existingBranchNames.has(qualificationBranchName(c.package, c.version)));
}

/**
 * The real remote read: every branch name currently on `origin` whose name
 * starts with `claude/qualify-` (the whole namespace this workflow's own
 * dispatches push into), via one `git ls-remote --heads`. Injectable so
 * tests never need a real network round trip.
 */
export function defaultExistingQualificationBranches({ cwd = process.cwd(), run = execFileSync } = {}) {
  const output = run("git", ["ls-remote", "--heads", "origin", "refs/heads/claude/qualify-*"], { cwd, encoding: "utf8" });
  const names = new Set();
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const tab = trimmed.indexOf("\t");
    if (tab === -1) continue;
    const ref = trimmed.slice(tab + 1);
    const prefix = "refs/heads/";
    if (ref.startsWith(prefix)) names.add(ref.slice(prefix.length));
  }
  return names;
}

const USAGE = `Usage: node scripts/filter-qualification-dispatch.mjs <unqualified.json> [--json]

  <unqualified.json>  path to a file holding the same
                       { package, name, version }[] shape
                       select-unqualified-packages.mjs --json produces.
  (no flag)  one "<package> -- <name>@<version>" line per package that
             still needs a fresh qualify-candidate.yml dispatch (skipped
             candidates are logged to stderr, not silently dropped).
  --json     the same filtered selection as JSON.
  --help     print this message and exit 0.
`;

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  const json = argv.includes("--json");
  const positional = argv.filter((a) => !a.startsWith("--"));
  if (positional.length !== 1) die(`expected exactly one <unqualified.json> path argument, got ${positional.length}`, 2);
  const [inputPath] = positional;

  let candidates;
  try {
    candidates = JSON.parse(readFileSync(inputPath, "utf8"));
  } catch (error) {
    die(`could not read/parse ${inputPath}: ${error instanceof Error ? error.message : String(error)}`, 2);
    return;
  }

  let existingBranchNames;
  try {
    existingBranchNames = defaultExistingQualificationBranches();
  } catch (error) {
    die(`could not list existing claude/qualify-* branches on origin: ${error instanceof Error ? error.message : String(error)}`, 2);
    return;
  }

  const pending = packagesNeedingDispatch(candidates, existingBranchNames);
  const skipped = candidates.filter((c) => !pending.includes(c));
  for (const s of skipped) {
    console.error(`filter-qualification-dispatch: skipping ${s.package}@${s.version} — branch ${qualificationBranchName(s.package, s.version)} already exists on origin`);
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(pending)}\n`);
  } else if (pending.length === 0) {
    console.log("filter-qualification-dispatch: nothing left to dispatch — every candidate already has a qualification branch pushed.");
  } else {
    for (const s of pending) console.log(`${s.package} -- ${s.name}@${s.version}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
