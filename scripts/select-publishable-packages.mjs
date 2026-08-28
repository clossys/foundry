#!/usr/bin/env node
// Select the packages `publish.yml`'s `discover` job is allowed to publish
// on a push to `main`.
//
// WHAT THIS USED TO DO, AND WHY THAT WAS THE DEFECT (issue #416)
// -----------------------------------------------------------------
// Until #416, this script diffed `package.json` between the push's `before`
// and `head` commits and selected whatever manifest's `version` changed. That
// is a "what did THIS push do?" question, and `publish.yml`'s own
// `concurrency: { group: publish, cancel-in-progress: false }` block means
// it is sometimes the wrong one to ask: GitHub holds at most one PENDING run
// per concurrency group, and a third arrival EVICTS the pending one before
// any job starts. `@vespeneventures/auth@0.2.4` was merged, changelogged,
// and locked, and its publish run was evicted this way — it reports
// `cancelled`, not `failure`, so nothing goes red. No later run could ever
// pick it up either: a diff against a LATER push's own before/head never
// re-examines a version bump an EARLIER, evicted push already introduced.
//
// WHAT IT DOES NOW: registry-versus-manifest, not push-versus-push
// -----------------------------------------------------------------
// Every non-private `packages/*/package.json` at the current checkout is
// compared directly against the registry: does IT already have this exact
// version? A package whose manifest version has no registry counterpart is
// selected, regardless of which push introduced that version or whether an
// earlier run for it was evicted, timed out, or simply failed. This makes
// publishing idempotent and self-healing — the next push (or a scheduled
// run of scripts/check-registry-parity.mjs finding the same gap) recovers
// automatically instead of requiring anyone to notice a cancelled run in a
// list.
//
// The actual registry lookup and its denied/unreachable/not-found
// discipline live in scripts/registry-version-lookup.mjs — see that
// module's header, which in turn points at
// packages/integrator/src/reachability.ts. Nothing here re-derives that
// ambiguity handling; this file only turns its per-package verdicts into a
// selection and a dependency-ordered matrix.
//
// A registry lookup that could not be completed is NEVER treated as "needs
// publishing" — see selectMissingPackages below. If not one single package
// in the whole batch could be confirmed either way, main() refuses to emit
// any matrix at all (fails the job) rather than silently publish nothing
// while looking like a clean, empty run.
//
// workflow_dispatch's manual, single-package path (`package`, `dry_run`,
// `verify_only`, `visibility_only`) does not call this script at all — see
// .github/workflows/publish.yml's `discover` job, which builds that matrix
// inline. It remains the sanctioned path for a preflight dry run and for a
// brand-new package's very first publish (see
// scripts/registry-version-lookup.mjs's header for why a first publish is
// deliberately not auto-selected here).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { filterPackagesForTarget, loadReleaseCatalog, readCurrentReleaseIdentity, resolveReleaseTarget } from "./check-release-catalog.mjs";
import { probeVersions, resolveVersionLookups } from "./registry-version-lookup.mjs";

function die(msg, code = 1) {
  console.error(`select-publishable-packages: ${msg}`);
  process.exit(code);
}

/**
 * Reads every non-private `packages/<directory>/package.json` under
 * `packagesRoot`. Pure and injectable (`listDirectories`, `manifestExists`,
 * `currentManifest`) so it is testable without touching the real
 * filesystem — same seam scripts/check-package-visibility.mjs's tests use
 * for its own document-reading functions.
 *
 * A manifest that fails to parse, or has no valid string `name`/`version`,
 * is fatal: a discover step that silently skipped a malformed manifest
 * would under-select rather than fail loudly, which is exactly the "did not
 * run, reported as an absence" pattern this repository keeps finding (see
 * this file's own header).
 */
export function discoverPackageManifests({ packagesRoot, listDirectories, manifestExists, currentManifest }) {
  const entries = [];
  for (const directory of listDirectories(packagesRoot)) {
    const path = `${packagesRoot}/${directory}/package.json`;
    if (!manifestExists(path)) continue;
    let manifest;
    try {
      manifest = currentManifest(path);
    } catch (error) {
      return { entries: [], fatal: `${path} does not parse as JSON: ${error.message}` };
    }
    if (manifest.private === true) continue;
    if (typeof manifest.name !== "string" || manifest.name.length === 0 || typeof manifest.version !== "string" || manifest.version.length === 0) {
      return { entries: [], fatal: `${path} has no valid string "name" and "version" — cannot check it against the registry.` };
    }
    entries.push({ directory, manifest });
  }
  return { entries, fatal: null };
}

/**
 * Splits `manifestEntries` into `missing` (registry-confirmed absent — safe
 * to publish), `published` (registry-confirmed present — nothing to do),
 * and `inconclusive` (denied, unreachable, or a not-found the batch could
 * not resolve — see scripts/registry-version-lookup.mjs). `anyKnown` is
 * true the moment at least one package resolved definitively (published OR
 * missing) — the same "did this scan see ANYTHING real?" signal
 * scripts/check-package-visibility.mjs's isBlindCredential uses, generalised
 * from "every lookup 404d" to "every lookup came back inconclusive".
 *
 * Pure: `verdicts` is already resolveVersionLookups's output, so this
 * function makes no network call and needs no injection.
 */
export function selectMissingPackages(manifestEntries, verdicts) {
  const missing = [];
  const published = [];
  const inconclusive = [];
  let anyKnown = false;

  for (const entry of manifestEntries) {
    const verdict = verdicts.get(entry.manifest.name);
    if (!verdict) {
      inconclusive.push({ name: entry.manifest.name, kind: "unreachable", detail: "no lookup result was returned for this package" });
      continue;
    }
    if (verdict.kind === "published") {
      anyKnown = true;
      published.push(entry);
    } else if (verdict.kind === "missing") {
      anyKnown = true;
      missing.push(entry);
    } else {
      inconclusive.push({ name: entry.manifest.name, kind: verdict.kind });
    }
  }

  return { missing, published, inconclusive, anyKnown };
}

/**
 * Orders `entries` (`{ directory, manifest }`) so a package always appears
 * after every first-party dependency also present in the set — unchanged
 * from this script's pre-#416 topological sort, just decoupled from HOW the
 * set of entries was chosen. `publish.yml`'s matrix runs with
 * `max-parallel: 1` in this order so a dependent is never published before
 * the sibling version it declares.
 */
export function orderByDependency(entries) {
  const manifests = new Map(entries.map(({ directory, manifest }) => [manifest.name, { directory, manifest }]));
  const pending = new Set(manifests.keys());
  const ordered = [];
  while (pending.size > 0) {
    const ready = [...pending]
      .filter((name) => {
        const dependencies = manifests.get(name).manifest.dependencies ?? {};
        return !Object.keys(dependencies).some((dependency) => pending.has(dependency));
      })
      .sort();
    if (ready.length === 0) {
      throw new Error(`cannot publish a cyclic first-party dependency set: ${[...pending].sort().join(", ")}`);
    }
    for (const name of ready) {
      pending.delete(name);
      ordered.push({ package: manifests.get(name).directory });
    }
  }
  return ordered;
}

function listPackageDirectories(packagesRoot) {
  if (!existsSync(packagesRoot)) return [];
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function main() {
  let identity;
  try {
    identity = readCurrentReleaseIdentity();
  } catch (error) {
    die(error.message.replace(/^release catalog: /, ""));
  }
  const owner = identity.scope.slice(1);

  let releaseTarget;
  try {
    releaseTarget = resolveReleaseTarget(loadReleaseCatalog(), identity, process.env.PUBLISH_RELEASE_TARGET || undefined);
  } catch (error) {
    die(error.message.replace(/^release catalog: /, ""));
  }

  const token = process.env.GH_PACKAGES_TOKEN;
  if (!token) {
    die(
      "GH_PACKAGES_TOKEN is not set. Selecting publishable packages now means asking the registry which versions " +
        "already exist, which needs a read:packages token — refusing to emit a matrix (empty or otherwise) from a " +
        "step that never actually asked.",
    );
  }

  const { entries: discoveredEntries, fatal } = discoverPackageManifests({
    packagesRoot: "packages",
    listDirectories: listPackageDirectories,
    manifestExists: existsSync,
    currentManifest: (path) => JSON.parse(readFileSync(path, "utf8")),
  });
  if (fatal) die(fatal);

  let entries;
  try {
    entries = filterPackagesForTarget(discoveredEntries, releaseTarget);
  } catch (error) {
    die(error.message.replace(/^release catalog: /, ""));
  }

  if (entries.length === 0) {
    process.stdout.write("[]\n");
    return;
  }

  const outcomes = await probeVersions(
    entries.map(({ manifest }) => ({ name: manifest.name, version: manifest.version })),
    { owner, token, fetchImpl: fetch },
  );
  const verdicts = resolveVersionLookups(outcomes);
  const { missing, inconclusive, anyKnown } = selectMissingPackages(entries, verdicts);

  if (!anyKnown) {
    const kinds = [...new Set(inconclusive.map((item) => item.kind))].join('", "');
    die(
      `could not confirm ANY of ${entries.length} package(s) against the registry — every lookup came back "${kinds}". ` +
        "GitHub returns 404 identically for a package that was never published and for one this credential cannot see, " +
        "so a total miss cannot be trusted either way. Refusing to emit a publish matrix (empty or otherwise) from a scan " +
        "that never proved it could see the registry at all. Confirm GH_PACKAGES_TOKEN's scope, then re-run.",
    );
  }

  for (const item of inconclusive) {
    console.error(
      `::warning title=Registry lookup inconclusive::"${item.name}" returned "${item.kind}" and was excluded from this run's ` +
        "publish selection. If it is genuinely unpublished, scripts/check-registry-parity.mjs's scheduled run will report it.",
    );
  }

  let ordered;
  try {
    ordered = orderByDependency(missing);
  } catch (error) {
    die(error.message);
  }
  process.stdout.write(`${JSON.stringify(ordered)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => die(`unexpected error: ${error?.stack ?? error}`));
