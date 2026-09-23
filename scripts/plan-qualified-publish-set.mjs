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
//
// "MISSING" IS NOT THE SAME QUESTION AS "NEW" (issue #1286's routing sibling)
// -----------------------------------------------------------------------
// `select-publishable-packages.mjs`'s registry verdicts answer "does the
// registry already have THIS EXACT version" — that is what makes a package a
// self-healing, idempotent publish candidate at all (see that file's own
// header). It is not the same question as "has this package NAME ever been
// published, at any version", and conflating the two used to route every
// version bump of an established package through the SAME owner-present
// local `npm publish` path as a package's genuine first identity. npm cannot
// bind a trusted publisher to an identity that does not exist yet, so that
// path is correct only for a first-ever identity; for every other
// already-established package it silently uploads without provenance. This
// script now asks the narrower question too (`probePackageIdentities`
// below) and reports an already-existing identity as `route-publish-workflow`
// — eligible for `publish.yml`'s OIDC lane, never for a local upload —
// instead of folding it into `eligible`.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { discoverPackageManifests, orderByDependency, registryProbeOptions, selectMissingPackages } from "./select-publishable-packages.mjs";
import { probeVersions, resolveVersionLookups } from "./registry-version-lookup.mjs";
import { filterPackagesForTarget, loadReleaseCatalog, readCurrentReleaseIdentity, resolveReleaseTarget } from "./check-release-catalog.mjs";
import { qualificationRecordPresence } from "./check-qualification-record-present.mjs";
import { fetchPublicNpmPackument, PUBLIC_NPM_REGISTRY } from "./lib/public-npm-registry.mjs";

function die(message, code = 1) {
  console.error(`plan-qualified-publish-set: ${message}`);
  process.exit(code);
}

/** The exact one-line dispatch a maintainer runs for a package whose npm identity already exists — see `routeToPublishWorkflowCommand` below. */
export function routeToPublishWorkflowCommand(packageKey) {
  return `gh workflow run publish.yml --ref main -f package=${packageKey} -f dry_run=false -f verify_only=false`;
}

/**
 * Turns `selectMissingPackages`'s three-way registry split, plus one
 * qualification-record check and one registry-identity check per still-
 * unpublished candidate, into a single ordered report. Pure and injectable
 * (`qualificationCheck`, `identityCheck`) so this is testable without
 * touching the filesystem or the network — the same seam
 * `select-publishable-packages.mjs` uses for its own registry probe.
 *
 * `identityCheck(name)` answers a narrower question than `verdicts` does:
 * `verdicts` already tells us THIS EXACT version is missing from the
 * registry, but says nothing about whether the package NAME has ever been
 * published at any other version. npm cannot bind a trusted publisher
 * (`publish.yml`'s credential-free OIDC upload) to a package identity that
 * does not exist yet, so a first-ever identity is the only case an
 * owner-present local `npm publish` may legitimately handle — every package
 * whose identity already exists on the registry, even at a different
 * version, must publish its new version through `publish.yml` instead, so
 * that upload carries provenance. `identityCheck` returns
 * `{ state: "new" }` (no version of this name has ever been published — safe
 * for an owner-present local first publish), `{ state: "existing" }` (some
 * version already exists — must route through `publish.yml`), or
 * `{ state: "indeterminate", reason }` (the registry could not confirm
 * either way — never guessed, always excluded).
 *
 * Returns `{ eligible, report }`:
 *   - `eligible` is `orderByDependency`'s own matrix shape (`{ package }[]`),
 *     dependency-ordered, and contains only genuinely first-ever identities.
 *   - `report` is one entry per discovered package, in discovery order, each
 *     `{ package, name, version, status, reason, path, command? }` with
 *     `status` one of `"eligible"`, `"route-publish-workflow"`,
 *     `"on-npm-already"`, `"qualification-record-missing"`,
 *     `"qualification-record-stale"`, `"qualification-record-indeterminate"`,
 *     `"registry-identity-indeterminate"`, or
 *     `"registry-lookup-inconclusive"`. `path` is the record path when one
 *     was resolved. `command` is set only for `"route-publish-workflow"` —
 *     the exact `gh workflow run` dispatch for that package.
 */
export function classifyPackagesForPublish({ entries, verdicts, qualificationCheck, identityCheck = () => ({ state: "new" }) }) {
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
      const identity = identityCheck(entry.manifest.name);
      if (identity.state === "existing") {
        const command = routeToPublishWorkflowCommand(entry.directory);
        report.push({
          ...base,
          status: "route-publish-workflow",
          reason:
            `${entry.manifest.name}'s npm identity already exists on the registry (bound to trusted publishing) — ` +
            `an owner-present local publish cannot carry provenance for it. Dispatch the OIDC lane instead: \`${command}\``,
          path: presence.path,
          command,
        });
        continue;
      }
      if (identity.state !== "new") {
        report.push({
          ...base,
          status: "registry-identity-indeterminate",
          reason: `not yet confirmed missing-vs-existing on the registry, so an owner-present local publish is refused rather than guessed: ${identity.reason ?? "registry identity lookup did not return a definitive answer"}.`,
          path: presence.path,
        });
        continue;
      }
      eligibleEntries.push(entry);
      report.push({
        ...base,
        status: "eligible",
        reason: `not yet on the registry (a genuinely first-ever identity), and a retained qualification record matches the current candidate at ${presence.path}.`,
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
 * Answers `classifyPackagesForPublish`'s `identityCheck` question — has this
 * package NAME ever been published, at any version — for every candidate
 * `selectMissingPackages` already found missing at its OWN exact version.
 * Reuses the exact registry module (`scripts/lib/public-npm-registry.mjs`)
 * and `fetchImpl`/`registry` values `planQualifiedPublishSet` already
 * resolved for its own per-version probe above; this is the SAME registry
 * this run already queries, asked once more per candidate at the package
 * (not version) level — never a second, differently-sourced lookup path.
 *
 * Only public npm's anonymous packument distinguishes "never published" from
 * "published, just not this version" from one request (a 404 there is
 * definitive absence, not credential ambiguity — see
 * `lib/public-npm-registry.mjs`'s own header). The historical GitHub
 * Packages lane already folds that distinction into `probeOneVersion` itself
 * (a package identity `probeVersions` resolves to `missing` there was
 * necessarily `known` first — see `registry-version-lookup.mjs`), so it is
 * left untouched here: this lane is retained only as immutable predecessor
 * history (see docs/PUBLISHING.md) and is not the active release target.
 */
export async function probePackageIdentities({ missing, registry, fetchImpl }) {
  const results = new Map();
  if (registry !== PUBLIC_NPM_REGISTRY || missing.length === 0) return results;
  await Promise.all(
    missing.map(async ({ manifest }) => {
      const packument = await fetchPublicNpmPackument({ registry, name: manifest.name, fetchImpl });
      if (packument.kind === "not-found") results.set(manifest.name, { state: "new" });
      else if (packument.kind === "found") results.set(manifest.name, { state: "existing" });
      else results.set(manifest.name, { state: "indeterminate", reason: packument.detail ?? `registry identity lookup returned "${packument.kind}"` });
    }),
  );
  return results;
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

  const { missing } = selectMissingPackages(entries, verdicts);
  const identityResults = await probePackageIdentities({ missing, registry: probeOptions.registry, fetchImpl });

  return classifyPackagesForPublish({
    entries,
    verdicts,
    qualificationCheck: (packageKey) => qualificationRecordPresence({ packageKey }),
    identityCheck: (name) => identityResults.get(name) ?? { state: "new" },
  });
}

const USAGE = `Usage: node scripts/plan-qualified-publish-set.mjs [--json|--report-json]

  (no flag)       human-readable report: every non-private package, whether
                  it would publish, and why the rest would not.
  --json          the eligible, dependency-ordered matrix only (as
                  { package }[] JSON), for a caller that just needs the list.
  --report-json   the full per-package report (as JSON), including every
                  reason.
  --help          print this message and exit 0.

Exit codes: 0 on a completed plan (even with zero eligible packages), 1 if
the registry or the release catalogue could not be resolved at all.
`;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
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
