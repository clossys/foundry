#!/usr/bin/env node
// check-package-visibility — fail when a package this repository intends to
// be public is actually PRIVATE on GitHub Packages.
//
//   node scripts/check-package-visibility.mjs [lifecyclePath] [--json] [--owner <login>]
//
// This is a two-directional check. It starts from
// docs/contracts/package-lifecycle.json's "published" entries and asks the
// registry whether each one's real visibility matches its declared intent
// (or has never been published, which is not a violation — see NOT
// PUBLISHED YET below) — AND it starts from the registry's own package list
// and asks the declaration whether it agrees a package should be there at
// all. Exit 0 = both directions reconcile cleanly: every declared package's
// registry visibility matches its declared intent, and every package the
// registry actually lists is declared "published". Exit 1 = at least one
// finding in either direction (a visibility mismatch, a "published"
// lifecycle entry with no visibility declared, or a package live on the
// registry whose lifecycle entry is not "published"). Exit 2 = the check
// could not be completed — no token, an API error, a rate limit, an
// unreachable endpoint, an unparseable response, or a registry enumeration
// that could not be trusted. Same three-state contract every gate in this
// repo uses (see CONTRIBUTING.md's "Gate CLIs exit 0/1/2" entry): a check
// that cannot run must fail, never silently pass.
//
// WHY THIS GATE EXISTS
// ---------------------
// GitHub Packages defaults every newly published npm package to PRIVATE,
// per package (not per version), regardless of this repository being
// public. Nothing before this gate checked the resulting state.
// @vespeneventures/ui sat private across 12 published versions — completely
// uninstallable by any external reader — while its README confidently
// documented `npm install` instructions that could not possibly work. Four
// packages were found private in total; they were flipped public by hand
// through the web UI. Manual flipping is not a fix: the next package
// published re-enters the same trap silently, invisibly, with a green
// `npm publish` and no failing check anywhere. This gate makes that wrong
// state fail loudly instead.
//
// There is NO REST endpoint to change a GitHub Packages npm package's
// visibility — a PATCH to /orgs/{owner}/packages/npm/{name} returns 404
// even with a full-permission PAT, while GET on that same path works (see
// .github/workflows/publish.yml's `visibility` job, verified directly).
// Changing visibility is web-UI-only. This gate therefore only ever
// DETECTS and FAILS; it never attempts to remediate.
//
// WHERE THE DECLARED INTENT LIVES, AND WHY NOT package-lifecycle.json
// ----------------------------------------------------------------------
// docs/contracts/package-lifecycle.json's schema is owned and exhaustively
// validated by the PUBLISHED @vespeneventures/governance package —
// packages/controller/src/lifecycle.ts's ENTRY_KEYS allowlist rejects any
// field it does not already recognise. Adding an `intendedVisibility` field
// there would force a governance version bump and rewritten test fixtures
// for what is fundamentally repository-tooling metadata (which package
// this repo intends to be public), not package lifecycle maturity (which
// package is incubating/published/deprecated/retired). So the declaration
// lives in a small sibling file instead: docs/contracts/package-visibility.json,
// `{ schemaVersion: 1, packages: [{ name, intendedVisibility }] }`. Neither
// file is shipped in any package's `files` field (docs/ is outside
// packages/*), so adding or changing this declaration needs no package
// version bump at all.
//
// NO PERMISSIVE DEFAULT
// -----------------------
// A "published" docs/contracts/package-lifecycle.json entry with no
// matching, validly-shaped entry in package-visibility.json is a FINDING
// (exit 1), never a silent pass. A new package must not be able to slip
// through by omission.
//
// NOT PUBLISHED YET, vs. PRIVATE
// --------------------------------
// A package the registry has never seen (both the org and user lookups
// return 404) is a materially different condition from one that exists and
// is private: the former is an ordinary pre-publish state, the latter is
// exactly the incident this gate exists to catch. Both are always reported
// — never silently skipped — but only the second counts as a finding.
//
// With one aggregate exception. GitHub answers 404, not 403, for a package
// the caller cannot see, so "never published" and "published but invisible
// to this credential" are the same response — indistinguishable per
// package. If EVERY declared package returns 404, that is far more likely
// a token that lost read:packages than a set of published packages none of
// which was ever published, so the run exits 2 rather than reporting a
// clean pass it did not earn. See the guard in main() for the full
// reasoning.
//
// EVERY PACKAGE, NOT JUST THE FIRST FAILURE
// --------------------------------------------
// Every declared package is checked and reported; a failure on one never
// short-circuits the rest (fail-fast would hide a second private package
// behind the first). The worst status across all results decides the exit
// code: an error (2) dominates a finding (1), which dominates a clean pass
// or a not-yet-published report (0) — the same aggregation
// check-workspace-links.mjs and check-release-readiness.mjs already use.
//
// REGISTRY-DRIVEN RECONCILIATION, NOT JUST DECLARATION-DRIVEN CHECKING
// -----------------------------------------------------------------------
// Everything above starts from docs/contracts/package-lifecycle.json's
// "published" entries and asks the registry whether each one's visibility
// matches its declared intent. That direction alone has a blind spot: a
// package that IS live on the registry, but whose lifecycle entry lags
// reality (still "incubating", or missing from the file altogether), is
// invisible to that scan — not reported as unchecked, simply absent from
// the output, which reads identically to "checked and fine". A package
// published three times over while its lifecycle entry stayed "incubating"
// and it had no docs/contracts/package-visibility.json entry at all sailed
// through every visibility run in that window this way, because the gate
// never once consulted the registry's own package list — only the names
// the declaration told it to look at.
//
// So this gate ALSO enumerates the registry directly — fetchRegistryPackages,
// the org/user packages LIST endpoint, distinct from the per-package GET
// fetchPackageVisibility uses above — and reconciles that real set against
// package-lifecycle.json (reconcileRegistryAgainstLifecycle). Any registry
// package whose lifecycle status is not "published" — incubating,
// deprecated, retired, or simply undeclared — is a FINDING: the declaration
// is wrong about reality, and that mismatch is exactly what a contract gate
// exists to catch. Enumeration failure (an unreachable endpoint, a missing
// or blind credential, an unparseable response) is exit 2, never an empty
// set read as clean — the same discipline as isBlindCredential below,
// extended from "found nothing about a package I already knew the name of"
// to "found nothing about the registry's actual contents".
//
// NEVER WIRED INTO LOCAL `npm run check`
// -----------------------------------------
// Every other gate in that chain is offline and hermetic — exactly
// reproducible with no credentials, on a fork's CI or a contributor's own
// machine. This one calls the live GitHub Packages API and needs a
// read:packages token to do it at all. Wiring it into `check` would make
// ordinary local development (and every fork's CI run) require a package
// registry credential it has no reason to hold, only to fail outright
// without one. It is wired into CI instead, where the credential already
// exists for a narrower reason — see .github/workflows/publish.yml's
// `post-publish visibility` job and .github/workflows/package-visibility.yml's
// scheduled run for where and why.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_LIFECYCLE_PATH = "docs/contracts/package-lifecycle.json";
const DEFAULT_VISIBILITY_PATH = "docs/contracts/package-visibility.json";
const DEFAULT_SCOPE_PATH = "package-scope.json";
const GITHUB_API = "https://api.github.com";
const VALID_VISIBILITIES = new Set(["public", "private"]);

function die(msg, code = 2) {
  console.error(`check-package-visibility: ${msg}`);
  process.exit(code);
}

/** The unscoped final path segment of a scoped npm name — the shape GitHub's package API expects. */
export function bareName(fullName) {
  const idx = fullName.indexOf("/");
  return idx === -1 ? fullName : fullName.slice(idx + 1);
}

/**
 * Joins the two contract documents. Returns:
 *   - `declared`: every package this gate must check against the registry —
 *     a "published" lifecycle entry with a validly-shaped visibility
 *     declaration.
 *   - `results`: findings for anything that could not be joined cleanly (a
 *     "published" entry with no declaration, an invalid declared value, or
 *     a declaration naming a package that is not "published") — reported
 *     immediately, never silently dropped.
 * Never calls the network. Pure data-shape validation only.
 */
export function selectDeclaredPackages(lifecycle, visibility) {
  const results = [];
  const declared = [];

  if (!lifecycle || typeof lifecycle !== "object" || !Array.isArray(lifecycle.packages)) {
    return { declared, results, fatal: `${DEFAULT_LIFECYCLE_PATH} does not have the expected { packages: [...] } shape` };
  }
  if (!visibility || typeof visibility !== "object" || !Array.isArray(visibility.packages)) {
    return { declared, results, fatal: `${DEFAULT_VISIBILITY_PATH} does not have the expected { packages: [...] } shape` };
  }

  const visibilityByName = new Map();
  for (const entry of visibility.packages) {
    if (!entry || typeof entry !== "object" || typeof entry.name !== "string") continue;
    visibilityByName.set(entry.name, entry.intendedVisibility);
  }

  const publishedNames = new Set();
  for (const entry of lifecycle.packages) {
    if (!entry || typeof entry !== "object" || entry.status !== "published") continue;
    const name = entry.name;
    if (typeof name !== "string" || name.length === 0) {
      results.push({ package: "(unnamed)", status: "error", detail: `a "published" lifecycle entry has no valid "name" field — cannot check its visibility.` });
      continue;
    }
    publishedNames.add(name);

    const intended = visibilityByName.get(name);
    if (intended === undefined) {
      results.push({
        package: name,
        status: "finding",
        detail: `"${name}" is "published" in ${DEFAULT_LIFECYCLE_PATH} but has no entry in ${DEFAULT_VISIBILITY_PATH} — its intended visibility is undeclared. A published package must not slip through by omission; add { "name": "${name}", "intendedVisibility": "public" } (or "private", if that is genuinely intended).`,
      });
      continue;
    }
    if (!VALID_VISIBILITIES.has(intended)) {
      results.push({
        package: name,
        status: "finding",
        detail: `"${name}"'s declared intendedVisibility in ${DEFAULT_VISIBILITY_PATH} is ${JSON.stringify(intended)}, not "public" or "private".`,
      });
      continue;
    }
    declared.push({ name, bareName: bareName(name), intendedVisibility: intended });
  }

  // A declaration naming a package that is not a "published" lifecycle
  // entry (typo'd name, or a package that moved to "deprecated"/"retired"
  // and was never removed from this file) is reported too — never silently
  // ignored — though it does not affect the exit code on its own: it is
  // stale bookkeeping, not evidence of a private public package.
  for (const entry of visibility.packages) {
    if (!entry || typeof entry !== "object" || typeof entry.name !== "string") continue;
    if (!publishedNames.has(entry.name)) {
      results.push({
        package: entry.name,
        status: "not-published",
        detail: `"${entry.name}" has an intendedVisibility declaration in ${DEFAULT_VISIBILITY_PATH} but is not a "published" entry in ${DEFAULT_LIFECYCLE_PATH} — nothing to verify against the registry.`,
      });
    }
  }

  return { declared, results, fatal: null };
}

/**
 * Reads one package's current GitHub Packages visibility. Tries the
 * organization endpoint first, falling back to the personal-account
 * endpoint only on a 404 — the same org-then-user pattern
 * .github/workflows/publish.yml's `visibility` job already uses, since
 * there is no single API path that works for both account kinds and no way
 * to know which kind `owner` is without asking.
 *
 * Returns one of:
 *   - { state: "found", visibility: "public" | "private" }
 *   - { state: "not-found" } — both endpoints 404: never published (yet).
 *   - { state: "error", detail } — anything else: a non-404 HTTP error, a
 *     network failure, or a response this gate cannot parse. Never treated
 *     as "not-found" or silently downgraded to a pass.
 *
 * `fetchImpl` is injected so tests never make a real network call — see
 * scripts/check-package-visibility.test.mjs, and the same pattern
 * packages/builder/src/deployment/vercel/inspector.ts uses for its own provider
 * calls.
 */
export async function fetchPackageVisibility({ owner, name, token, fetchImpl }) {
  for (const kind of ["orgs", "users"]) {
    const url = `${GITHUB_API}/${kind}/${owner}/packages/npm/${name}`;
    let response;
    try {
      response = await fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
    } catch (error) {
      return { state: "error", detail: `network error calling the ${kind} package endpoint for "${name}": ${error.message}` };
    }
    if (response.status === 404) continue;
    if (!response.ok) {
      return {
        state: "error",
        detail: `the ${kind} package endpoint for "${name}" returned HTTP ${response.status} — could not determine its visibility. A non-404 error is never treated as "not yet published".`,
      };
    }
    let body;
    try {
      body = await response.json();
    } catch (error) {
      return { state: "error", detail: `the ${kind} package endpoint for "${name}" returned a response this gate could not parse as JSON: ${error.message}` };
    }
    if (!body || typeof body !== "object" || !VALID_VISIBILITIES.has(body.visibility)) {
      return { state: "error", detail: `the ${kind} package endpoint for "${name}" returned no recognisable "visibility" field (got ${JSON.stringify(body?.visibility)}).` };
    }
    return { state: "found", visibility: body.visibility };
  }
  return { state: "not-found" };
}

/**
 * Turns a name GitHub's packages LIST endpoint returned into the full scoped
 * npm name package-lifecycle.json uses. Unlike the single-package GET
 * endpoint fetchPackageVisibility calls (which deliberately wants the bare,
 * unscoped segment — see bareName above), what the LIST endpoint puts in its
 * own `name` field is not pinned down here to one shape: if it already reads
 * as a scoped name, it is trusted as-is; otherwise it is prefixed with
 * `scope`, which is either package-scope.json's own declared scope or, if
 * that file is unavailable, `@${owner}` — the ordinary convention this
 * workspace itself follows (`owner` "vespeneventures", `scope`
 * "@vespeneventures").
 */
export function normalizeRegistryName(rawName, scope) {
  return rawName.startsWith("@") ? rawName : `${scope}/${rawName}`;
}

/** The next-page URL from a paginated GitHub REST response's Link header, or undefined on the last page. */
function nextPageUrl(response) {
  const link = typeof response?.headers?.get === "function" ? response.headers.get("link") : undefined;
  if (!link) return undefined;
  const match = /<([^>]+)>;\s*rel="next"/.exec(link);
  return match ? match[1] : undefined;
}

/**
 * Enumerates every npm package GitHub Packages actually lists for `owner` —
 * the org/user packages LIST endpoint, not a lookup of any name this gate
 * already knows. This is the half of the gate that lets a package the
 * declaration never mentioned be found at all; fetchPackageVisibility above
 * can only ever confirm or deny a name it is handed.
 *
 * Returns one of:
 *   - { state: "found", packages: [fullScopedName, ...] }
 *   - { state: "error", detail } — an unreachable endpoint, a non-404/200
 *     HTTP status, an unparseable response, or a credential/owner that
 *     neither the org nor the user endpoint recognises. Deliberately no
 *     "not-found" state here (contrast fetchPackageVisibility): a single
 *     package can legitimately not exist yet, but an owner that enumerates
 *     to nothing at all is far more likely a bad owner name or a credential
 *     that cannot list packages than a registry genuinely holding zero — so
 *     this is treated as could-not-enumerate, not "found: empty".
 *
 * `fetchImpl` is injected so tests never make a real network call, same as
 * fetchPackageVisibility above.
 */
export async function fetchRegistryPackages({ owner, scope, token, fetchImpl }) {
  for (const kind of ["orgs", "users"]) {
    const collected = [];
    let url = `${GITHUB_API}/${kind}/${owner}/packages?package_type=npm&per_page=100`;
    let firstPage = true;
    let notFound = false;
    while (url) {
      let response;
      try {
        response = await fetchImpl(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });
      } catch (error) {
        return { state: "error", detail: `network error calling the ${kind} packages list endpoint: ${error.message}` };
      }
      if (response.status === 404 && firstPage) {
        notFound = true;
        break;
      }
      if (!response.ok) {
        return {
          state: "error",
          detail: `the ${kind} packages list endpoint returned HTTP ${response.status} — could not enumerate registry packages for "${owner}".`,
        };
      }
      let body;
      try {
        body = await response.json();
      } catch (error) {
        return { state: "error", detail: `the ${kind} packages list endpoint returned a response this gate could not parse as JSON: ${error.message}` };
      }
      if (!Array.isArray(body)) {
        return { state: "error", detail: `the ${kind} packages list endpoint returned a non-array response — could not enumerate registry packages for "${owner}".` };
      }
      for (const item of body) {
        if (!item || typeof item !== "object" || typeof item.name !== "string" || item.name.length === 0) continue;
        collected.push(normalizeRegistryName(item.name, scope));
      }
      firstPage = false;
      url = nextPageUrl(response);
    }
    if (notFound) continue;
    return { state: "found", packages: collected };
  }
  return {
    state: "error",
    detail: `neither the organization nor the user packages list endpoint could enumerate registry packages for "${owner}" — the credential may lack read:packages access, or the owner name is wrong. Refusing to report a reconciled set it never verified.`,
  };
}

/**
 * Reconciles the real registry package set (from fetchRegistryPackages)
 * against package-lifecycle.json. Pure, no network — mirrors
 * selectDeclaredPackages's shape and is tested the same hermetic way.
 *
 * A registry package whose lifecycle status is "published" is reconciled —
 * its visibility is what checkPackageVisibility already verifies above, so
 * it is not reported again here. Anything else — a status of "incubating",
 * "deprecated", "retired", or no lifecycle entry at all — is a FINDING: the
 * package is live and public-or-private on the registry regardless of what
 * this repository's own declaration says, and the declaration is what is
 * wrong. This is the direction selectDeclaredPackages's join never checks:
 * declaration-versus-declaration is covered there; this is
 * registry-versus-declaration.
 */
export function reconcileRegistryAgainstLifecycle(lifecycle, registryPackageNames) {
  const statusByName = new Map();
  for (const entry of lifecycle.packages) {
    if (entry && typeof entry === "object" && typeof entry.name === "string" && entry.name.length > 0) {
      statusByName.set(entry.name, entry.status);
    }
  }

  const results = [];
  for (const name of registryPackageNames) {
    const status = statusByName.get(name);
    if (status === "published") continue;
    results.push({
      package: name,
      status: "finding",
      detail:
        typeof status === "string"
          ? `"${name}" is live on the registry but its ${DEFAULT_LIFECYCLE_PATH} status is "${status}", not "published" — the declaration is wrong about reality. Either the package should not have been published yet, or its lifecycle entry is stale and needs to move to "published".`
          : `"${name}" is live on the registry but has no entry at all in ${DEFAULT_LIFECYCLE_PATH} — the declaration is wrong about reality.`,
    });
  }
  return results;
}

/**
 * The whole check: join the two contract documents, then look up every
 * declared package's real registry visibility and compare it against its
 * declared intent. Every package is checked — a failure on one never stops
 * the rest, so the caller can report every finding, not just the first.
 */
export async function checkPackageVisibility({ lifecycle, visibility, owner, token, fetchImpl }) {
  const { declared, results, fatal } = selectDeclaredPackages(lifecycle, visibility);
  if (fatal) return { results: [], fatal, lookups: { attempted: 0, found: 0 } };

  // Counted separately from `results`, and only for real registry lookups:
  // a "not-published" result can also come from a stale declaration that
  // was never looked up at all (see selectDeclaredPackages), and that must
  // not be mistaken for evidence about what this token can see.
  const lookups = { attempted: 0, found: 0 };

  for (const pkg of declared) {
    lookups.attempted += 1;
    const outcome = await fetchPackageVisibility({ owner, name: pkg.bareName, token, fetchImpl });
    if (outcome.state === "error") {
      results.push({ package: pkg.name, status: "error", detail: `could not determine registry visibility for "${pkg.name}": ${outcome.detail}` });
    } else if (outcome.state === "not-found") {
      results.push({
        package: pkg.name,
        status: "not-published",
        detail: `"${pkg.name}" has not been published to the registry yet (declared intendedVisibility: "${pkg.intendedVisibility}") — nothing to verify against a package that does not exist there.`,
      });
    } else if (outcome.visibility === pkg.intendedVisibility) {
      lookups.found += 1;
      results.push({ package: pkg.name, status: "pass", detail: `"${pkg.name}" is registry-${outcome.visibility}, matching its declared intendedVisibility.` });
    } else {
      lookups.found += 1;
      const extra =
        outcome.visibility === "private" && pkg.intendedVisibility === "public"
          ? ` GitHub Packages defaults every new package to private regardless of this repository being public — that is the exact incident this gate exists to catch. There is no API to change this; an owner must visit https://github.com/orgs/${owner}/packages/npm/${pkg.bareName}/settings (or the equivalent personal-account settings page) and flip it under Danger Zone. See docs/PUBLISHING.md's "Package visibility" section.`
          : "";
      results.push({
        package: pkg.name,
        status: "finding",
        detail: `"${pkg.name}" is registry-${outcome.visibility} but declares intendedVisibility "${pkg.intendedVisibility}".${extra}`,
      });
    }
  }

  return { results, fatal: null, lookups };
}

/**
 * True when this run looked packages up and every single one came back 404
 * — the signature of a credential that cannot see this owner's packages,
 * which GitHub reports identically to their not existing. Exported so the
 * decision is testable without a network call; see the guard in main() for
 * why it must produce exit 2 rather than a clean pass.
 */
export function isBlindCredential(lookups) {
  return Boolean(lookups) && lookups.attempted > 0 && lookups.found === 0;
}

/**
 * The full two-directional check, orchestrated as one pure-async function
 * so it is testable end-to-end with an injected `fetchImpl` — never through
 * a spawned CLI process, which cannot inject a fake network. Runs both
 * directions and every guard main() enforces, and returns a result shaped
 * for the caller to act on rather than calling process.exit itself:
 *
 *   - { fatal: string, code: 2 } — could not complete either direction of
 *     the check (declaration-side blind credential or empty scan,
 *     registry-side enumeration failure or an untrustworthy empty result).
 *   - { fatal: null, code: 0 | 1 | 2, results, lookups,
 *       registryPackagesEnumerated } — completed; `code` is the worst
 *       status across BOTH directions' results (declaration-vs-registry
 *       from checkPackageVisibility, and registry-vs-declaration from
 *       reconcileRegistryAgainstLifecycle combined).
 *
 * This is deliberately the seam the three required proofs run through: a
 * declared-"incubating" package live on the registry, a fully reconciled
 * set, and an unreachable registry all exercise this one function with a
 * different injected `fetchImpl`, never a real network call.
 */
export async function checkAllPackageVisibility({ lifecycle, visibility, owner, scope, token, fetchImpl }) {
  const { results, fatal, lookups } = await checkPackageVisibility({ lifecycle, visibility, owner, token, fetchImpl });
  if (fatal) return { fatal, code: 2 };

  // See the guard in main()'s historical comment block, preserved here: a
  // token that sees nothing looks exactly like an empty registry, and only
  // the aggregate — every declared lookup coming back 404 — can tell the
  // two apart.
  if (isBlindCredential(lookups)) {
    return {
      fatal:
        `all ${lookups.attempted} declared package(s) returned "not found" from the registry. GitHub returns 404 both for a ` +
        "package that does not exist and for one this credential cannot see, so this result cannot distinguish an unpublished " +
        "set of packages from a GH_PACKAGES_TOKEN that has lost read:packages access — refusing to report a pass either way. " +
        "Confirm the token's scope, then re-run.",
      code: 2,
    };
  }

  // Same EMPTY SCAN discipline check-workspace-links.mjs documents: zero
  // results (no "published" entries at all) means this half examined
  // nothing, which is indistinguishable from a scan that is silently
  // broken — never a clean 0.
  if (results.length === 0) {
    return { fatal: `found zero "published" entries in ${DEFAULT_LIFECYCLE_PATH} to check — refusing to report a clean pass on an empty scan`, code: 2 };
  }

  // Everything above starts from the declaration and asks the registry
  // whether it agrees. This half starts from the registry and asks the
  // declaration whether IT agrees — the direction that catches a package
  // that is live and public while its lifecycle entry still reads
  // "incubating" (or has no entry at all). Enumeration failure is exit 2,
  // never an empty set read as clean — see fetchRegistryPackages's own doc
  // comment for why a total miss is "could not enumerate", not "found
  // zero".
  const registryResult = await fetchRegistryPackages({ owner, scope, token, fetchImpl });
  if (registryResult.state === "error") {
    return { fatal: `could not enumerate registry packages to reconcile against ${DEFAULT_LIFECYCLE_PATH}: ${registryResult.detail}`, code: 2 };
  }

  // A registry enumeration that comes back empty while at least one
  // per-package lookup above independently confirmed a real answer (found a
  // package, public or private) is internally inconsistent: the LIST
  // endpoint missed packages the GET endpoint just proved exist. Reporting
  // a reconciled set in that state would be exactly the "empty scan read as
  // clean" mistake this file's other guards refuse to make.
  if (registryResult.packages.length === 0 && lookups.found > 0) {
    return {
      fatal:
        `the registry packages list for "${owner}" returned zero packages, but ${lookups.found} declared package(s) were ` +
        "independently confirmed to exist via direct lookup above — the list enumeration cannot be trusted here (missing " +
        "list-scoped access, or an incomplete response). Refusing to report a reconciled registry set it did not actually obtain.",
      code: 2,
    };
  }

  const registryFindings = reconcileRegistryAgainstLifecycle(lifecycle, registryResult.packages);
  const allResults = [...results, ...registryFindings];

  // Worst-of-three across BOTH directions combined: an error anywhere
  // dominates a finding, which dominates a clean pass or a not-yet-
  // published report. Same aggregation check-workspace-links.mjs and
  // check-release-readiness.mjs already use.
  const code = allResults.reduce((acc, r) => (r.status === "error" ? 2 : r.status === "finding" && acc !== 2 ? 1 : acc), 0);

  return { fatal: null, code, results: allResults, lookups, registryPackagesEnumerated: registryResult.packages.length };
}

// ------------------------------------------------------------------- main

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const ownerFlagIndex = argv.indexOf("--owner");
  const ownerOverride = ownerFlagIndex >= 0 ? argv[ownerFlagIndex + 1] : undefined;
  const positional = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--owner");
  const lifecyclePath = positional[0] ?? DEFAULT_LIFECYCLE_PATH;
  const visibilityPath = positional[1] ?? DEFAULT_VISIBILITY_PATH;

  // --declarations-only runs the half of this gate that needs no credential:
  // the pure join between package-lifecycle.json's "published" entries and
  // package-visibility.json. It exists because the credentialed half can only
  // run AFTER publish.yml has already uploaded a tarball, which makes it a
  // detector rather than a gate — it reports a fault that has already shipped.
  //
  // That is not hypothetical. `@vespeneventures/secret-scan` was published
  // with no visibility declaration, and every subsequent publish run went red
  // on this check for a data omission that was fully knowable offline, at
  // review time, before anything reached the registry. Four consecutive runs
  // failed that way, which also means a REAL publish failure in that window
  // would have been indistinguishable from the known one.
  //
  // The join is `selectDeclaredPackages` — already pure, already exported,
  // already never touching the network. Splitting the gate along the line the
  // credential actually draws lets the offline half run in `npm run check` on
  // every pull request, and leaves the live-visibility half where it belongs.
  const declarationsOnly = argv.includes("--declarations-only");

  // No token is exit 2, always — never a silent pass, and never even
  // attempted against the network. See CONTRIBUTING.md's "Gate CLIs exit
  // 0/1/2" entry: absence of signal is indistinguishable from a passing
  // signal, so a check that cannot run must fail loudly instead.
  //
  // --declarations-only is exempt because it never reaches the network at
  // all: requiring a credential for a check that makes no request would be
  // the mirror of the same mistake, refusing to run a check that CAN run.
  const token = process.env.GH_PACKAGES_TOKEN;
  if (!token && !declarationsOnly) {
    die(
      "GH_PACKAGES_TOKEN is not set. This gate calls the live GitHub Packages API and needs a read:packages " +
        "token to do it — refusing to report a pass from a check that never ran. See docs/PUBLISHING.md's " +
        '"Prerequisites held outside this repository" table. To run only the offline declaration join, ' +
        "pass --declarations-only.",
    );
  }

  if (!existsSync(lifecyclePath)) die(`no lifecycle document at ${resolve(lifecyclePath)}`);
  if (!existsSync(visibilityPath)) die(`no visibility declaration document at ${resolve(visibilityPath)}`);

  let lifecycle;
  try {
    lifecycle = JSON.parse(readFileSync(lifecyclePath, "utf8"));
  } catch (error) {
    die(`${lifecyclePath} does not parse as JSON: ${error.message}`);
  }
  let visibility;
  try {
    visibility = JSON.parse(readFileSync(visibilityPath, "utf8"));
  } catch (error) {
    die(`${visibilityPath} does not parse as JSON: ${error.message}`);
  }

  if (declarationsOnly) {
    const { declared, results, fatal } = selectDeclaredPackages(lifecycle, visibility);
    if (fatal) die(fatal);

    const findings = results.filter((r) => r.status === "finding" || r.status === "error");
    if (json) {
      console.log(JSON.stringify({ mode: "declarations-only", declared: declared.length, results }, null, 2));
    } else {
      for (const r of results) console.log(`  [${r.status === "error" ? "ERROR" : "FIND "}] ${r.package} — ${r.detail}`);
      if (findings.length === 0) {
        console.log(`PACKAGE VISIBILITY DECLARATIONS OK — all ${declared.length} "published" packages declare an intended visibility.`);
        console.log("Live registry visibility is NOT checked here; that half needs a credential and runs post-publish.");
      } else {
        console.log("");
        console.log("PACKAGE VISIBILITY DECLARATIONS FAIL — see FIND lines above. This is the offline half of the gate:");
        console.log("every fault here is knowable before anything reaches the registry, so fix it now rather than after publish.");
      }
    }
    process.exit(findings.length === 0 ? 0 : 1);
  }

  let owner = ownerOverride;
  let scope;
  const scopeFileExists = existsSync(DEFAULT_SCOPE_PATH);
  if (scopeFileExists) {
    let scopeDoc;
    try {
      scopeDoc = JSON.parse(readFileSync(DEFAULT_SCOPE_PATH, "utf8"));
    } catch (error) {
      die(`${DEFAULT_SCOPE_PATH} does not parse as JSON: ${error.message}`);
    }
    if (typeof scopeDoc?.scope === "string" && scopeDoc.scope.startsWith("@")) scope = scopeDoc.scope;
  }
  if (!owner) {
    // These are two different operator problems and they have two different
    // fixes. Reporting "not found" for a file that is sitting right there sends
    // the reader to create a file that already exists, and leaves the actual
    // defect -- a malformed `scope` inside it -- unmentioned.
    if (!scope) {
      die(
        scopeFileExists
          ? `${DEFAULT_SCOPE_PATH} exists but declares no "scope" string beginning with "@", so the registry owner cannot be determined (fix the file, or pass --owner <login>)`
          : `no ${DEFAULT_SCOPE_PATH} found to determine the registry owner (or pass --owner <login>)`,
      );
    }
    owner = scope.slice(1);
  }
  // package-scope.json's own declared scope is preferred; falling back to
  // `@${owner}` only when that file is absent (an --owner override with no
  // scope file at all) — see normalizeRegistryName's own doc comment.
  if (!scope) scope = `@${owner}`;

  const outcome = await checkAllPackageVisibility({ lifecycle, visibility, owner, scope, token, fetchImpl: fetch });
  if (outcome.fatal) die(outcome.fatal, outcome.code);

  const { results: allResults, lookups, registryPackagesEnumerated, code: worst } = outcome;

  if (json) {
    console.log(JSON.stringify({ results: allResults, registryPackagesEnumerated }, null, 2));
  } else {
    const labels = { pass: "PASS ", finding: "FIND ", error: "ERROR", "not-published": "SKIP " };
    for (const r of allResults) console.log(`  [${labels[r.status]}] ${r.package} — ${r.detail}`);
  }

  if (!json) {
    console.log("");
    console.log(
      worst === 0
        ? `PACKAGE VISIBILITY OK — ${lookups.found} declared package(s) confirmed against their real registry visibility, and ` +
            `${registryPackagesEnumerated} registry package(s) reconciled against ${lifecyclePath}. No mismatches found.`
        : worst === 2
          ? "PACKAGE VISIBILITY ERROR — could not determine at least one package's real visibility (see ERROR lines above). This is not a pass."
          : "PACKAGE VISIBILITY FAIL — at least one package's real registry state does not match what this repository declares — see FIND lines above. There is no API to change visibility; see docs/PUBLISHING.md's \"Package visibility\" section for the manual step. A lifecycle-status mismatch is fixed by editing docs/contracts/package-lifecycle.json instead.",
    );
  }
  process.exit(worst);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => die(`unexpected error: ${error?.stack ?? error}`));
}
