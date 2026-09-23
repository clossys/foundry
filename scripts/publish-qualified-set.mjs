#!/usr/bin/env node
// publish-qualified-set — the owner's one action to publish every package
// that has a retained qualification record but is not yet on the registry
// (issue #1227).
//
//   node scripts/publish-qualified-set.mjs                 # plan only (default) — lists what would publish, publishes nothing
//   node scripts/publish-qualified-set.mjs --publish        # runs the owner-present publish loop, one npm prompt per package
//
// WHAT THIS DOES, AND WHY IT LOOKS LIKE THIS
// -------------------------------------------
// docs/PUBLISHING.md's "Owner-present first publication, then OIDC" section
// is not a style choice this script can route around: npm cannot bind a
// trusted publisher (`publish.yml`'s credential-free OIDC upload) to a
// package identity that does not exist on the registry yet. Every package in
// the current backlog (issue #948) is an unpublished first identity, so a
// batched `workflow_dispatch` fan-out through the OIDC lane cannot publish
// any of them — only an owner-present, interactive `npm publish` can. This
// script is the "one command that loops with a single OTP prompt per
// package" shape issue #1227 names, not the "one workflow dispatch" shape,
// because only the first shape is possible for this backlog today. Once a
// package's first identity is owner-present published, trusted publishing
// can be configured for it and every later version publishes through
// `publish.yml`'s existing OIDC lane instead — this script only ever adds
// the FIRST identity of a package that has none.
//
// It invents no new gate and skips none of the existing ones. Per package,
// in dependency order, it runs exactly the sequence `publish.yml`'s own
// `qualify` and `publish` jobs run for an OIDC upload, substituting an
// owner-present npm publish for the final step:
//   1. `scripts/preflight-package.mjs` — name collision, denylist quality,
//      gate regression, tree safety, artifact safety, README parity,
//      contamination classes. Exactly `npm run preflight -- packages/<name>`.
//   2. `npm pack --ignore-scripts` — a fresh candidate tarball from the
//      current tree, never the tarball from whenever the record was made.
//   3. `scripts/run-candidate-qualification.mjs` — a fresh, credential-free
//      qualification transcript against that exact candidate (the same
//      install-and-import round trip `publish.yml`'s `qualify` job runs).
//   4. `scripts/validate-candidate-publish.mjs`'s `validateCandidatePublish`
//      in `prepublish` mode — joins the fresh transcript against the
//      retained record and the reviewed commit, the same join `publish.yml`'s
//      `publish` job runs immediately before it uploads.
//   5. `scripts/publish-qualified-directory.mjs`'s `publishQualifiedDirectory`
//      in `owner-present` mode — re-asserts the pinned runtime, re-matches
//      the exact qualification record, re-runs the FULL staged public-safety
//      scan, re-packs and byte-compares a clean directory, then the one
//      interactive `npm publish .` and anonymous post-publish verification.
//
// A failure at any step for one package stops only that package. Every other
// eligible package is still attempted, in dependency order, and the final
// summary names every outcome — issue #1227's own requirement, so one bad
// package cannot silently swallow an otherwise-clean batch.
//
// OUT OF SCOPE, ON PURPOSE: `scripts/record-later-publication.mjs`.
// docs/PUBLISHING.md's manual owner-present handoff runs it after each
// publish to retain a `governance/release-publications/later/*.json`
// evidence file. `publish.yml`'s own OIDC `publish` job — the reference this
// script otherwise mirrors step for step — does not call it either; the
// anonymous `verify-published` job and npm's own provenance attestations
// serve that purpose for an OIDC upload. This script matches what
// `publish.yml` actually runs, not the separate pre-CI manual procedure; the
// owner may still run `record-later-publication.mjs` by hand afterward if
// that evidence file is wanted for one of these owner-present firsts.
//
// This script never publishes on its own initiative: with no --publish flag
// it only plans. It never dispatches a workflow and never reads, stores, or
// forwards a token, an OTP, or a password — npm's own interactive prompts
// are relayed to (and answered by) the owner's real terminal, exactly as a
// single `publish-qualified-directory.mjs` invocation already does.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { formatReport, planQualifiedPublishSet } from "./plan-qualified-publish-set.mjs";
import { publishQualifiedDirectory } from "./publish-qualified-directory.mjs";
import { validateCandidatePublish } from "./validate-candidate-publish.mjs";
import { assertReleaseRuntime, RELEASE_RUNTIME } from "./lib/release-runtime.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

function die(message, code = 1) {
  console.error(`publish-qualified-set: ${message}`);
  process.exit(code);
}

/** Runs `preflight-package.mjs` for one package directory. Injectable seam (`run`) for testing without a real subprocess. */
export function defaultRunPreflight(packageDirectory, { denylist, requireDenylist = true, run = execFileSync } = {}) {
  const args = [join(scriptDir, "preflight-package.mjs"), packageDirectory];
  if (requireDenylist) args.push("--require-denylist");
  if (denylist) args.push("--denylist", denylist);
  try {
    const output = run("node", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], cwd: repoRoot });
    return { ok: true, output: String(output ?? "") };
  } catch (error) {
    return { ok: false, output: String(error?.stdout ?? "") + String(error?.stderr ?? ""), code: error?.status ?? 1 };
  }
}

/** Packs a fresh candidate tarball for one package directory into a private temp directory. Injectable seam (`run`) for testing without a real subprocess. */
export function defaultPackCandidate(packageKey, { run = execFileSync, stagingParent = tmpdir() } = {}) {
  const destination = mkdtempSync(join(stagingParent, "clossys-publish-set-"));
  const packageDir = resolve(repoRoot, "packages", packageKey);
  let entries;
  try {
    const raw = run("npm", ["pack", ".", "--ignore-scripts", "--json", "--pack-destination", destination], { cwd: packageDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    entries = JSON.parse(String(raw ?? ""));
  } catch (error) {
    rmSync(destination, { recursive: true, force: true });
    throw new Error(`npm pack failed for packages/${packageKey}: ${error?.message ?? error}`);
  }
  if (!Array.isArray(entries) || entries.length !== 1 || typeof entries[0]?.filename !== "string") {
    rmSync(destination, { recursive: true, force: true });
    throw new Error(`npm pack returned an unexpected result for packages/${packageKey}`);
  }
  return { path: join(destination, entries[0].filename), cleanup: () => rmSync(destination, { recursive: true, force: true }) };
}

/** Runs `run-candidate-qualification.mjs` for one packed candidate, producing a fresh transcript. Injectable seam (`run`) for testing without a real subprocess. */
export function defaultRunQualification(packageKey, candidatePath, { run = execFileSync, stagingParent = tmpdir() } = {}) {
  const transcriptPath = join(mkdtempSync(join(stagingParent, "clossys-publish-set-transcript-")), "transcript.json");
  try {
    run("node", [join(scriptDir, "run-candidate-qualification.mjs"), "--package", packageKey, "--tarball", candidatePath, "--output", transcriptPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], cwd: repoRoot });
  } catch (error) {
    throw new Error(`fresh qualification failed for packages/${packageKey}: ${String(error?.stdout ?? "") + String(error?.stderr ?? "") || error?.message || error}`);
  }
  return transcriptPath;
}

/**
 * Publishes one already-eligible package: preflight, pack a fresh candidate,
 * a fresh qualification transcript, prepublish validation against the
 * retained record, then the existing owner-present publish wrapper — which
 * independently re-asserts the pinned runtime, re-matches the exact
 * qualification record, and re-runs the FULL staged public-safety scan (see
 * publish-qualified-directory.mjs). This function only sequences those
 * existing, unmodified gates for one package; it weakens none of them.
 */
export async function publishOnePackage({
  packageKey,
  recordPath,
  root = repoRoot,
  env = process.env,
  denylist,
  requireDenylist = true,
  runPreflight = defaultRunPreflight,
  packCandidate = defaultPackCandidate,
  runQualification = defaultRunQualification,
  validate = validateCandidatePublish,
  publish = publishQualifiedDirectory,
}) {
  const preflight = runPreflight(join(root, "packages", packageKey), { denylist, requireDenylist });
  if (!preflight.ok) return { packageKey, status: "preflight-failed", detail: preflight.output };

  let candidate;
  try {
    candidate = packCandidate(packageKey, {});
  } catch (error) {
    return { packageKey, status: "pack-failed", detail: error?.message ?? String(error) };
  }
  try {
    let transcriptPath;
    try {
      transcriptPath = runQualification(packageKey, candidate.path, {});
    } catch (error) {
      return { packageKey, status: "qualification-failed", detail: error?.message ?? String(error) };
    }

    let findings;
    try {
      findings = validate({ root, args: { package: packageKey, tarball: candidate.path, transcript: transcriptPath, mode: "prepublish" } });
    } catch (error) {
      return { packageKey, status: "prepublish-validation-failed", detail: error?.message ?? String(error) };
    }
    if (findings.length > 0) {
      return { packageKey, status: "prepublish-validation-failed", detail: findings.map((f) => `[${f.rule}] ${f.message}`).join("\n") };
    }

    const result = await publish({ root, packageKey, candidatePath: candidate.path, recordPath, mode: "owner-present", env });
    return { packageKey, status: "published", detail: result };
  } catch (error) {
    return { packageKey, status: "publish-failed", detail: error?.message ?? String(error) };
  } finally {
    candidate.cleanup();
  }
}

/**
 * Sequentially publishes every entry of `eligible` (already dependency-
 * ordered by plan-qualified-publish-set.mjs), continuing to the next package
 * after ANY failure rather than aborting the whole run — issue #1227's own
 * requirement: "A failure stops only that package, and the run reports each
 * package's outcome." Nothing here batches npm's own per-upload
 * authentication: each package still gets its own owner-present publish
 * prompt, exactly as a lone publish-qualified-directory.mjs dispatch would.
 */
export async function publishEligibleSet({ eligible, recordPaths, publishOne = publishOnePackage, ...options }) {
  const outcomes = [];
  for (const { package: packageKey } of eligible) {
    // Sequential and deliberate: publish.yml's own matrix caps this at
    // max-parallel: 1 for the identical reason — a dependent must never be
    // published before the sibling version it declares, and a shared
    // interactive terminal cannot service two owner-present prompts at once.
    // eslint-disable-next-line no-await-in-loop
    const outcome = await publishOne({ packageKey, recordPath: recordPaths[packageKey], ...options });
    outcomes.push(outcome);
  }
  return outcomes;
}

function formatSummary(outcomes) {
  const published = outcomes.filter((o) => o.status === "published");
  const failed = outcomes.filter((o) => o.status !== "published");
  const lines = [`publish-qualified-set: ${published.length} published, ${failed.length} failed, ${outcomes.length} attempted`];
  for (const outcome of outcomes) {
    lines.push(`  ${outcome.packageKey}: ${outcome.status}`);
    if (outcome.status !== "published") {
      for (const line of String(outcome.detail ?? "").split("\n").filter(Boolean)) lines.push(`    ${line}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const doPublish = argv.includes("--publish");
  const denylistIndex = argv.indexOf("--denylist");
  const denylist = denylistIndex === -1 ? process.env.PUBLIC_SAFETY_DENYLIST : argv[denylistIndex + 1];

  let eligible, report;
  try {
    ({ eligible, report } = await planQualifiedPublishSet());
  } catch (error) {
    die(error.message);
  }

  console.log(report.length === 0 ? "plan: no non-private packages are authorized for the active release target." : formatReport(report));

  if (eligible.length === 0) {
    console.log("\nNothing to publish.");
    return;
  }

  if (!doPublish) {
    console.log(
      `\n${eligible.length} package(s) would publish, on the pinned release runtime (Node ${RELEASE_RUNTIME.node}, npm ${RELEASE_RUNTIME.npm}), one owner-present npm prompt per package. Re-run with --publish to run it.`,
    );
    return;
  }

  if (!denylist) die("--publish requires PUBLIC_SAFETY_DENYLIST (or --denylist <path>) — preflight must run FULL, never degraded, before an upload.");

  try {
    assertReleaseRuntime();
  } catch (error) {
    die(error.message);
  }

  const recordPaths = Object.fromEntries(report.filter((row) => row.status === "eligible").map((row) => [row.package, row.path]));
  const outcomes = await publishEligibleSet({ eligible, recordPaths, denylist });
  console.log(`\n${formatSummary(outcomes)}`);
  if (outcomes.some((outcome) => outcome.status !== "published")) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => die(`unexpected error: ${error?.stack ?? error}`));
