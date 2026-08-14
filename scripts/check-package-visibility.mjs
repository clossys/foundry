#!/usr/bin/env node
// check-package-visibility — fail when a package this repository intends to
// be public is actually PRIVATE on GitHub Packages.
//
//   node scripts/check-package-visibility.mjs [lifecyclePath] [--json] [--owner <login>]
//
// Exit 0 = every declared package's actual registry visibility matches its
// declared intent (or has never been published, which is not a violation —
// see NOT PUBLISHED YET below). Exit 1 = at least one finding (a mismatch,
// or a "published" lifecycle entry with no visibility declared at all).
// Exit 2 = the check could not be completed — no token, an API error, a rate
// limit, an unreachable endpoint, or an unparseable response. Same
// three-state contract every gate in this repo uses (see CONTRIBUTING.md's
// "Gate CLIs exit 0/1/2" entry): a check that cannot run must fail, never
// silently pass.
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
// packages/governance/src/lifecycle.ts's ENTRY_KEYS allowlist rejects any
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
 * packages/deployment/src/vercel/inspector.ts uses for its own provider
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

// ------------------------------------------------------------------- main

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const ownerFlagIndex = argv.indexOf("--owner");
  const ownerOverride = ownerFlagIndex >= 0 ? argv[ownerFlagIndex + 1] : undefined;
  const positional = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--owner");
  const lifecyclePath = positional[0] ?? DEFAULT_LIFECYCLE_PATH;
  const visibilityPath = positional[1] ?? DEFAULT_VISIBILITY_PATH;

  // No token is exit 2, always — never a silent pass, and never even
  // attempted against the network. See CONTRIBUTING.md's "Gate CLIs exit
  // 0/1/2" entry: absence of signal is indistinguishable from a passing
  // signal, so a check that cannot run must fail loudly instead.
  const token = process.env.GH_PACKAGES_TOKEN;
  if (!token) {
    die(
      "GH_PACKAGES_TOKEN is not set. This gate calls the live GitHub Packages API and needs a read:packages " +
        "token to do it — refusing to report a pass from a check that never ran. See docs/PUBLISHING.md's " +
        '"Prerequisites held outside this repository" table.',
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

  let owner = ownerOverride;
  if (!owner) {
    if (!existsSync(DEFAULT_SCOPE_PATH)) die(`no ${DEFAULT_SCOPE_PATH} found to determine the registry owner (or pass --owner <login>)`);
    let scopeDoc;
    try {
      scopeDoc = JSON.parse(readFileSync(DEFAULT_SCOPE_PATH, "utf8"));
    } catch (error) {
      die(`${DEFAULT_SCOPE_PATH} does not parse as JSON: ${error.message}`);
    }
    const scope = scopeDoc?.scope;
    if (typeof scope !== "string" || !scope.startsWith("@")) die(`${DEFAULT_SCOPE_PATH} has no valid "scope" field`);
    owner = scope.slice(1);
  }

  const { results, fatal, lookups } = await checkPackageVisibility({ lifecycle, visibility, owner, token, fetchImpl: fetch });
  if (fatal) die(fatal);

  // A TOKEN THAT SEES NOTHING LOOKS EXACTLY LIKE AN EMPTY REGISTRY.
  // GitHub answers 404 — not 403 — for a package the caller lacks access
  // to, deliberately, so that the API never leaks the existence of a
  // private package to someone who cannot read it. That means a single
  // 404 is genuinely ambiguous: "never published" and "published, but
  // invisible to this credential" are the same response byte for byte,
  // and this gate cannot tell them apart for any one package.
  //
  // It can tell them apart in aggregate. If EVERY declared package comes
  // back 404, the likely explanation is not that this repository has
  // declared a set of published packages none of which was ever
  // published — it is that the credential cannot see them: a
  // GH_PACKAGES_TOKEN rotated to one missing `read:packages`, expired
  // into a reduced-scope state, or belonging to an account without access
  // to this owner's packages. Reporting that as OK would be this gate
  // failing in precisely the way it exists to prevent, and worse than not
  // having it: a daily green check asserting every package is public
  // while the registry was never actually consulted.
  //
  // So: exit 2, could-not-run, not 0. This is the same discipline as the
  // empty-scan guard below — a scan that examined nothing is never a
  // clean pass — extended to a scan that examined everything and learned
  // nothing.
  if (isBlindCredential(lookups)) {
    die(
      `all ${lookups.attempted} declared package(s) returned "not found" from the registry. GitHub returns 404 both for a ` +
        "package that does not exist and for one this credential cannot see, so this result cannot distinguish an unpublished " +
        "set of packages from a GH_PACKAGES_TOKEN that has lost read:packages access — refusing to report a pass either way. " +
        "Confirm the token's scope, then re-run.",
    );
  }

  // Same EMPTY SCAN discipline check-workspace-links.mjs documents: zero
  // results (no "published" entries at all) means this scan examined
  // nothing, which is indistinguishable from a scan that is silently
  // broken — never a clean 0.
  if (results.length === 0) {
    die(`found zero "published" entries in ${lifecyclePath} to check — refusing to report a clean pass on an empty scan`);
  }

  if (json) {
    console.log(JSON.stringify({ results }, null, 2));
  } else {
    const labels = { pass: "PASS ", finding: "FIND ", error: "ERROR", "not-published": "SKIP " };
    for (const r of results) console.log(`  [${labels[r.status]}] ${r.package} — ${r.detail}`);
  }

  // Worst-of-three: an error anywhere dominates a finding, which dominates
  // a clean pass or a not-yet-published report. Same aggregation
  // check-workspace-links.mjs and check-release-readiness.mjs already use.
  const worst = results.reduce((acc, r) => (r.status === "error" ? 2 : r.status === "finding" && acc !== 2 ? 1 : acc), 0);

  if (!json) {
    console.log("");
    console.log(
      worst === 0
        ? "PACKAGE VISIBILITY OK — every declared package's real registry visibility matches its declared intent (or has not been published yet)."
        : worst === 2
          ? "PACKAGE VISIBILITY ERROR — could not determine at least one package's real visibility (see ERROR lines above). This is not a pass."
          : "PACKAGE VISIBILITY FAIL — at least one package is registry-private while declared public (or is undeclared) — see FIND lines above. There is no API to fix this; see docs/PUBLISHING.md's \"Package visibility\" section for the manual step.",
    );
  }
  process.exit(worst);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => die(`unexpected error: ${error?.stack ?? error}`));
}
