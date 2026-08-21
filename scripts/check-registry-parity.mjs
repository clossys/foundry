#!/usr/bin/env node
// check-registry-parity — FAIL when a package's version on `main` has no
// registry counterpart.
//
//   node scripts/check-registry-parity.mjs [--json]
//
// Exit 0 = every non-private packages/*/package.json's version was
// confirmed present on the registry. Exit 1 = at least one package's
// version is confirmed MISSING — a real gap, most likely a publish that was
// evicted, timed out, or failed silently (see below). Exit 2 = the check
// could not be completed for at least one package (no token, an
// unauthenticated or unreachable registry lookup, a malformed manifest, or
// an empty scan) — never a silent pass. Same three-state contract every
// gate in this repo uses (see CONTRIBUTING.md, and
// scripts/check-package-visibility.mjs's own header for the fullest
// worked example of it): a check that cannot run must fail, never pass on
// doubt.
//
// WHY THIS GATE EXISTS (issue #416)
// -----------------------------------
// `@vespeneventures/auth@0.2.4` was merged to `main`, changelogged, and
// locked — and never published. `publish.yml`'s own
// `concurrency: { group: publish, cancel-in-progress: false }` correctly
// serialises publishing, but GitHub holds at most one PENDING run per
// concurrency group: a third push in a short window EVICTS the pending run
// before any job starts. That run reports `cancelled`, not `failure` — main
// stays green, the changelog claims the version shipped, and the registry
// silently disagrees. The only reason it was caught at all is that someone
// happened to read a run list.
//
// scripts/select-publishable-packages.mjs's `discover` job now selects by
// registry-versus-manifest instead of by one push's diff, which makes an
// ordinary publish self-healing: the next push that touches ANY package
// manifest re-derives the full gap and picks up whatever was missed. But
// "the next push" is exactly the thing that might not happen for a while —
// if the evicted package's own manifest is the last one anybody bumps for
// days, there is no further push to trigger that self-healing at all. This
// gate is the independent backstop that needs no further push: run on a
// schedule (see .github/workflows/registry-parity.yml) or on demand, it
// re-derives the same gap from nothing but `main`'s current manifests and
// the registry.
//
// THE SAME LOOKUP DISCIPLINE, NOT A SECOND ONE
// ------------------------------------------------
// The actual registry lookup, and its denied/unreachable/not-found
// ambiguity handling, live in scripts/registry-version-lookup.mjs — see
// that module's header, which points at
// packages/integrator/src/reachability.ts. This file only turns per-package
// verdicts into a report and an exit code: a `missing` verdict is a
// FINDING (the gap this gate exists to catch); an `unauthenticated` or
// `unreachable` verdict is an ERROR (could not confirm, never silently
// treated as either "fine" or "definitely missing"); a `published` verdict
// is a PASS.
//
// THIS GATE ONLY EVER REPORTS
// -------------------------------
// Exactly like scripts/check-package-visibility.mjs, this never attempts to
// publish anything. A FINDING here means a human runs publish.yml's
// `workflow_dispatch` (`package=<name>`) to publish the missing version —
// the same sanctioned manual path issue #416 used to recover
// `@vespeneventures/auth@0.2.4` — never an automatic, unattended publish
// triggered by this gate.
//
// NOT WIRED INTO `npm run check`
// -----------------------------------
// This calls the live GitHub Packages API and needs a read:packages token,
// exactly the reason scripts/check-package-visibility.mjs is kept out of
// that chain too (see its own header) — wiring it in would make ordinary
// local development, and every fork's CI, require a registry credential it
// has no reason to hold. It is wired into
// .github/workflows/registry-parity.yml's scheduled run instead, where the
// credential already exists for a narrower reason, and is deliberately NOT
// a required status context (see that workflow's own header for why that
// promotion is left to a human).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { probeVersions, resolveVersionLookups } from "./registry-version-lookup.mjs";

const DEFAULT_SCOPE_PATH = "package-scope.json";

function die(msg, code = 2) {
  console.error(`check-registry-parity: ${msg}`);
  process.exit(code);
}

function listPackageDirectories(packagesRoot) {
  if (!existsSync(packagesRoot)) return [];
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Reads every non-private `packages/<directory>/package.json`. Pure and
 * injectable, same shape scripts/select-publishable-packages.mjs's own
 * discoverPackageManifests uses — kept as a separate copy rather than a
 * cross-import between two independently-runnable CLI scripts, matching how
 * every other gate script in this directory stays self-contained (only
 * shared, main()-less library modules like registry-version-lookup.mjs are
 * imported across files).
 *
 * A manifest that fails to parse, or has no valid string `name`/`version`,
 * is fatal: silently skipping it would under-check rather than fail loudly.
 */
export function discoverManifests({ packagesRoot, listDirectories, manifestExists, currentManifest }) {
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
 * The whole check, as one pure-async function so it is testable end-to-end
 * with an injected `fetchImpl` — never through a spawned CLI process, which
 * cannot inject a fake network. Same shape
 * scripts/check-package-visibility.mjs's checkAllPackageVisibility uses.
 *
 * Returns:
 *   - `{ fatal: string, code: 2 }` — could not complete the check at all
 *     (malformed manifest, or an empty scan).
 *   - `{ fatal: null, code: 0 | 1 | 2, results }` — completed; `code` is the
 *     worst status across every package (error dominates finding dominates
 *     pass, same aggregation check-package-visibility.mjs uses): a `missing`
 *     verdict is a "finding", an `unauthenticated`/`unreachable` verdict is
 *     an "error" (never silently a pass), a `published` verdict is a "pass".
 */
export async function checkRegistryParity({ owner, token, fetchImpl, discovery }) {
  const { entries, fatal } = discovery;
  if (fatal) return { fatal, code: 2 };

  if (entries.length === 0) {
    return { fatal: "found zero non-private packages/*/package.json to check — refusing to report a clean pass on an empty scan", code: 2 };
  }

  const outcomes = await probeVersions(
    entries.map(({ manifest }) => ({ name: manifest.name, version: manifest.version })),
    { owner, token, fetchImpl },
  );
  const verdicts = resolveVersionLookups(outcomes);

  const results = entries.map(({ manifest }) => {
    const verdict = verdicts.get(manifest.name) ?? { kind: "unreachable" };
    if (verdict.kind === "published") {
      return { package: manifest.name, version: manifest.version, status: "pass", detail: `"${manifest.name}@${manifest.version}" is on the registry.` };
    }
    if (verdict.kind === "missing") {
      return {
        package: manifest.name,
        version: manifest.version,
        status: "finding",
        detail:
          `"${manifest.name}@${manifest.version}" is on \`main\` (merged, and presumably changelogged) but has NO ` +
          "counterpart on the registry. This is the exact gap issue #416 exists to catch — most likely a publish run " +
          "evicted from publish.yml's concurrency queue, timed out, or failed silently. Fix: dispatch publish.yml manually " +
          `with package=${JSON.stringify(manifest.name.split("/").at(-1))} to publish the missing version. Do not merge ` +
          "further version bumps for this package until it is resolved -- each one only widens the gap.",
      };
    }
    return {
      package: manifest.name,
      version: manifest.version,
      status: "error",
      detail: `could not confirm "${manifest.name}@${manifest.version}" against the registry (lookup: "${verdict.kind}"). Not treated as a pass or a finding -- an unreadable answer must never stand in for either.`,
    };
  });

  const code = results.reduce((acc, r) => (r.status === "error" ? 2 : r.status === "finding" && acc !== 2 ? 1 : acc), 0);
  return { fatal: null, code, results };
}

// ------------------------------------------------------------------- main

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");

  const token = process.env.GH_PACKAGES_TOKEN;
  if (!token) {
    die(
      "GH_PACKAGES_TOKEN is not set. This gate calls the live GitHub Packages API and needs a read:packages token " +
        "to do it — refusing to report a pass from a check that never ran.",
    );
  }

  if (!existsSync(DEFAULT_SCOPE_PATH)) die(`no ${DEFAULT_SCOPE_PATH} found to determine the registry owner/scope.`);
  let scopeDoc;
  try {
    scopeDoc = JSON.parse(readFileSync(DEFAULT_SCOPE_PATH, "utf8"));
  } catch (error) {
    die(`${DEFAULT_SCOPE_PATH} does not parse as JSON: ${error.message}`);
  }
  if (typeof scopeDoc.scope !== "string" || !scopeDoc.scope.startsWith("@")) {
    die(`${DEFAULT_SCOPE_PATH} declares no "scope" string beginning with "@".`);
  }
  const owner = scopeDoc.scope.slice(1);

  const discovery = discoverManifests({
    packagesRoot: "packages",
    listDirectories: listPackageDirectories,
    manifestExists: existsSync,
    currentManifest: (path) => JSON.parse(readFileSync(path, "utf8")),
  });

  const outcome = await checkRegistryParity({ owner, token, fetchImpl: fetch, discovery });
  if (outcome.fatal) die(outcome.fatal, outcome.code);

  const { results, code: worst } = outcome;

  if (json) {
    console.log(JSON.stringify({ results }, null, 2));
  } else {
    const labels = { pass: "PASS ", finding: "FIND ", error: "ERROR" };
    for (const r of results) console.log(`  [${labels[r.status]}] ${r.package}@${r.version} — ${r.detail}`);
  }

  if (!json) {
    console.log("");
    console.log(
      worst === 0
        ? `REGISTRY PARITY OK — all ${results.length} non-private package(s) confirmed on the registry at their \`main\` version.`
        : worst === 2
          ? "REGISTRY PARITY ERROR — could not confirm at least one package against the registry (see ERROR lines above). This is not a pass."
          : "REGISTRY PARITY FAIL — at least one package's `main` version has no registry counterpart — see FIND lines above. Publish it with publish.yml's workflow_dispatch (package=<name>); do not merge further version bumps for it first.",
    );
  }
  process.exit(worst);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => die(`unexpected error: ${error?.stack ?? error}`));
}
