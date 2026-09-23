#!/usr/bin/env node
// plan-qualified-publish-set — the eligibility question behind issue #1227:
// of every non-private packages/*/package.json, which ones would a batch
// publish actually upload, and why does each of the rest stay out?
//
//   node scripts/plan-qualified-publish-set.mjs               # human-readable report
//   node scripts/plan-qualified-publish-set.mjs --json         # eligible matrix only, dependency-ordered
//   node scripts/plan-qualified-publish-set.mjs --report-json  # the full per-package report, machine-readable
//
// WHY THIS EXISTS
// ---------------
// This script is the shared eligibility computation behind #1227's "publish
// everything that is ready, in one owner action": it answers "what would
// publish, and why is each package in or out" once, so a human running it
// locally and `scripts/publish-qualified-set.mjs`'s own owner-present publish
// loop ask the identical question instead of two gates quietly drifting
// apart.
//
// It deliberately invents no new selection or freshness logic:
//   - registry-vs-manifest discovery, dependency ordering and the release
//     target filter are `select-publishable-packages.mjs`'s own exported
//     functions (issue #416) — the same ones `publish.yml`'s unreachable
//     push-trigger branch would use.
//   - "does this candidate already have a retained, still-matching
//     qualification record" is `check-qualification-record-present.mjs`'s
//     own exported `qualificationRecordPresence` — the same join
//     `publish.yml`'s "Preflight retained qualification records" step and
//     `validate-candidate-publish.mjs` both use.
//
// This script only combines those two verdicts into one classification and
// prints or serialises it. It never packs a tarball, never publishes, and
// never touches a credential — planning is read-only.
//
// "On npm already" and "qualification record missing" are reported as
// distinct, non-overlapping reasons (never collapsed into one generic "not
// eligible"), because the fix for each is different: nothing to do, versus
// qualify (or requalify) the candidate and retain its record on main.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { discoverPackageManifests, orderByDependency, registryProbeOptions, selectMissingPackages } from "./select-publishable-packages.mjs";
import { probeVersions, resolveVersionLookups } from "./registry-version-lookup.mjs";
import { filterPackagesForTarget, loadReleaseCatalog, readCurrentReleaseIdentity, resolveReleaseTarget } from "./check-release-catalog.mjs";
import { qualificationRecordPresence } from "./check-qualification-record-present.mjs";

function die(message, code = 1) {
  console.error(`plan-qualified-publish-set: ${message}`);
  process.exit(code);
}

/**
 * Turns `selectMissingPackages`'s three-way registry split, plus one
 * qualification-record check per still-unpublished candidate, into a single
 * ordered report. Pure and injectable (`qualificationCheck`) so this is
 * testable without touching the filesystem or the network — the same seam
 * `select-publishable-packages.mjs` uses for its own registry probe.
 *
 * Returns `{ eligible, report }`:
 *   - `eligible` is `orderByDependency`'s own matrix shape (`{ package }[]`),
 *     dependency-ordered.
 *   - `report` is one entry per discovered package, in discovery order, each
 *     `{ package, name, version, status, reason, path }` with `status` one of
 *     `"eligible"`, `"on-npm-already"`, `"qualification-record-missing"`,
 *     `"qualification-record-stale"`, `"qualification-record-indeterminate"`,
 *     or `"registry-lookup-inconclusive"`. `path` is the record path when one
 *     was resolved (every status except `on-npm-already` and
 *     `registry-lookup-inconclusive`, and even then only once a manifest
 *     lets `qualificationPath` be derived).
 */
export function classifyPackagesForPublish({ entries, verdicts, qualificationCheck }) {
  const { missing, published, inconclusive } = selectMissingPackages(entries, verdicts);
  const report = [];

  for (const entry of published) {
    report.push({
      package: entry.directory,
      name: entry.manifest.name,
      version: entry.manifest.version,
      status: "on-npm-already",
      reason: `${entry.manifest.name}@${entry.manifest.version} is already on the registry — nothing to publish.`,
      path: undefined,
    });
  }

  const eligibleEntries = [];
  for (const entry of missing) {
    const presence = qualificationCheck(entry.directory);
    const base = { package: entry.directory, name: entry.manifest.name, version: entry.manifest.version };
    if (presence.state === "present") {
      eligibleEntries.push(entry);
      report.push({
        ...base,
        status: "eligible",
        reason: `not yet on the registry, and a retained qualification record matches the current candidate at ${presence.path}.`,
        path: presence.path,
      });
    } else if (presence.state === "missing") {
      report.push({
        ...base,
        status: "qualification-record-missing",
        reason: `not yet on the registry, but has no retained qualification record at ${presence.path}. Qualify the candidate and retain its record on the default branch first.`,
        path: presence.path,
      });
    } else if (presence.state === "stale") {
      report.push({
        ...base,
        status: "qualification-record-stale",
        reason: `not yet on the registry, but the retained record at ${presence.path} no longer matches the current candidate (${presence.staleFields.join(", ")} changed). Re-qualify and retain a fresh record first.`,
        path: presence.path,
      });
    } else {
      report.push({
        ...base,
        status: "qualification-record-indeterminate",
        reason: `not yet on the registry, but its qualification record could not be checked: ${presence.reason}`,
        path: undefined,
      });
    }
  }

  for (const item of inconclusive) {
    report.push({
      package: undefined,
      name: item.name,
      version: undefined,
      status: "registry-lookup-inconclusive",
      reason: `registry lookup returned "${item.kind}" — excluded rather than guessed. A scheduled scripts/check-registry-parity.mjs run will report it if it is genuinely unpublished.`,
      path: undefined,
    });
  }

  return { eligible: orderByDependency(eligibleEntries), report };
}

/** Renders `classifyPackagesForPublish`'s `report` as a fixed-width table with a one-line summary. */
export function formatReport(report) {
  const width = Math.max(0, ...report.map((row) => (row.package ?? row.name).length));
  const lines = report.map((row) => `  ${(row.package ?? row.name).padEnd(width)}  ${row.status.padEnd(32)}  ${row.reason}`);
  const eligibleCount = report.filter((row) => row.status === "eligible").length;
  return [`plan: ${eligibleCount} of ${report.length} package(s) would publish`, ...lines].join("\n");
}

function listPackageDirectories(packagesRoot) {
  if (!existsSync(packagesRoot)) return [];
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * The full pipeline: release identity/target, manifest discovery, the
 * registry probe, and `classifyPackagesForPublish` above. THROWS (never
 * `process.exit`s) on a fatal condition, so a caller like
 * `publish-qualified-set.mjs` can catch and report it as its own failure
 * rather than being killed out from under it. The CLI entrypoint below is
 * the only caller that turns a thrown error into a process exit.
 */
export async function planQualifiedPublishSet({ fetchImpl = fetch } = {}) {
  const identity = (() => {
    try {
      return readCurrentReleaseIdentity();
    } catch (error) {
      throw new Error(error.message.replace(/^release catalog: /, ""));
    }
  })();
  const probeOptions = registryProbeOptions(identity);
  if (probeOptions.fatal) throw new Error(probeOptions.fatal);

  const releaseTarget = (() => {
    try {
      return resolveReleaseTarget(loadReleaseCatalog(), identity, process.env.PUBLISH_RELEASE_TARGET || undefined);
    } catch (error) {
      throw new Error(error.message.replace(/^release catalog: /, ""));
    }
  })();

  const { entries: discoveredEntries, fatal } = discoverPackageManifests({
    packagesRoot: "packages",
    listDirectories: listPackageDirectories,
    manifestExists: existsSync,
    currentManifest: (path) => JSON.parse(readFileSync(path, "utf8")),
  });
  if (fatal) throw new Error(fatal);

  let entries;
  try {
    entries = filterPackagesForTarget(discoveredEntries, releaseTarget);
  } catch (error) {
    throw new Error(error.message.replace(/^release catalog: /, ""));
  }

  if (entries.length === 0) return { eligible: [], report: [] };

  const outcomes = await probeVersions(
    entries.map(({ manifest }) => ({ name: manifest.name, version: manifest.version })),
    { ...probeOptions, fetchImpl },
  );
  const verdicts = resolveVersionLookups(outcomes);

  const anyKnown = [...verdicts.values()].some((verdict) => verdict.kind === "published" || verdict.kind === "missing");
  if (!anyKnown) {
    throw new Error(
      `could not confirm ANY of ${entries.length} package(s) against the registry. Refusing to plan (let alone publish) from a scan that never proved a definitive registry answer.`,
    );
  }

  return classifyPackagesForPublish({
    entries,
    verdicts,
    qualificationCheck: (packageKey) => qualificationRecordPresence({ packageKey }),
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const asReportJson = argv.includes("--report-json");
  if (asJson && asReportJson) die("--json and --report-json are mutually exclusive");

  let eligible, report;
  try {
    ({ eligible, report } = await planQualifiedPublishSet());
  } catch (error) {
    die(error.message);
  }

  if (asJson) {
    process.stdout.write(`${JSON.stringify(eligible)}\n`);
    return;
  }
  if (asReportJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  console.log(report.length === 0 ? "plan: no non-private packages are authorized for the active release target." : formatReport(report));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => die(`unexpected error: ${error?.stack ?? error}`));
