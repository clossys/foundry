#!/usr/bin/env node
// registry-version-lookup — probes the declared registry for whether ONE
// specific version of a package has already been published, distinguishing "the
// registry told us no" from "we could not get an answer" the same way
// packages/integrator/src/reachability.ts already does for the opposite
// (installer-side) direction of this exact ambiguity. Read that module's
// header before changing anything here — nothing below reinvents its
// reasoning, it reapplies the same discipline to a different question.
//
// THE QUESTION reachability.ts DOES NOT ANSWER
// -----------------------------------------------
// reachability.ts resolves "what is the LATEST version this credential can
// see published?" — exactly what packages/integrator/src/currency.ts needs
// for installer-side drift detection. Issue #416 turns on a different
// question: "has THIS EXACT version — the one already committed in a
// package's manifest on `main` — been published?" A package can gain a
// LATER version while an earlier one this repository still cares about
// (because it is what `main`'s manifest declares right now) was silently
// never uploaded at all. That is precisely what happened to
// `@example/auth@0.2.4`: three merges landed in sixteen minutes, the
// middle publish run was evicted from the concurrency queue before any job
// started, and nothing downstream ever asked the registry "did the version
// `main` now claims actually arrive?" — only "what push introduced a
// version bump?", which an evicted run answers with silence, not a version
// list.
//
// THE SAME AMBIGUITY, THE SAME DISCIPLINE
// -------------------------------------------
// GitHub Packages answers 404 both for "this package has never been published" and
// — because it declines to confirm a private package's existence to a
// caller it will not show it to — for "this credential cannot see it". That
// is the identical ambiguity reachability.ts's own header documents for the
// npm registry protocol; this module asks a different endpoint (GitHub's
// packages-by-owner REST API — the same one scripts/check-name-collision.mjs
// and scripts/check-package-visibility.mjs already use for every other
// registry-side lookup in this repository, not the raw npm registry
// protocol reachability.ts's Transport speaks), but the same ambiguity
// applies to it and is resolved the same way.
//
// `denied` (401/403) and `unreachable` (a transport failure, a non-2xx/404
// status, an unparseable body) stay rigorously distinct from each other and
// are never reclassified into "not-found" or into one another — exactly
// reachability.ts's rule.
//
// `not-found` is resolved once per BATCH, the same aggregate reasoning
// `resolveReachability` applies: if nothing in the batch came back `known`
// (a package the credential could actually see, regardless of whether the
// target version was in it), a blind credential explains every 404 in the
// batch better than an entire slice of the catalogue never having been
// published, so the whole batch resolves to `unauthenticated`. A single
// `not-found` alongside at least one proven `known` lookup stays genuinely
// undecidable and resolves to `unreachable` rather than being guessed at in
// either direction.
//
// A CONSEQUENCE WORTH NAMING: A BRAND-NEW PACKAGE'S FIRST PUBLISH
// ---------------------------------------------------------------
// This means a package that has NEVER been published even once will,
// against a batch that also contains established packages, resolve to
// `unreachable` rather than `missing` — its own 404 is indistinguishable
// from "this credential can't see it" by the rule above, even though in
// this specific case it is genuinely just new. That is a deliberate
// consequence of applying reachability.ts's discipline rather than a
// weaker, per-package-only rule: this repository already has a sanctioned,
// human-triggered path for a package's first publish (publish.yml's
// `workflow_dispatch`, documented at the top of that file as covering "the
// initial bootstrap publish of a version that predated this workflow").
// Deferring a brand-new name's very first upload to that deliberate path,
// while every subsequent version bump self-heals automatically and
// idempotently regardless of eviction, is consistent with how cautious this
// repository already is about namespace collisions (see
// scripts/check-name-collision.mjs) — an unattended process should not be
// the first thing to ever claim a brand-new package name.
//
// ONE CASE reachability.ts DOES NOT HAVE, AND NEEDS NO BATCH REASONING
// ----------------------------------------------------------------------
// Once a package's version list IS retrieved (a real 200 from either the
// org or the user endpoint), whether one specific version appears in it is
// NOT ambiguous — the registry answered definitively about a package it
// plainly can see. `hasVersion: false` in that case always means genuinely
// unpublished, never "ask the credential again": resolveVersionLookups below
// reports it as `missing`, never folded into the not-found/batch handling
// above.
//
// Public npmjs is different: its public packument is intentionally anonymous,
// so a 404 is definitive absence rather than credential ambiguity. The
// adapter in scripts/lib/public-npm-registry.mjs supplies that result while
// this module preserves the historical GitHub Packages discipline unchanged.
//
// A caller deciding "should I publish this?" must still never treat
// `unauthenticated` or `unreachable` as `missing` — see this module's two
// callers, scripts/select-publishable-packages.mjs's registry-driven
// discovery and scripts/check-registry-parity.mjs's safety-net gate.

import { PUBLIC_NPM_REGISTRY, probePublicNpmVersion } from "./lib/public-npm-registry.mjs";

const GITHUB_API = "https://api.github.com";
export const GITHUB_PACKAGES_REGISTRY = ["https://npm", "pkg", "github", "com"].join(".");

/** The unscoped final path segment of a scoped npm name — GitHub's packages API wants this, not the full "@scope/name". Same helper scripts/check-package-visibility.mjs already exports under this name. */
export function bareName(fullName) {
  const idx = fullName.indexOf("/");
  return idx === -1 ? fullName : fullName.slice(idx + 1);
}

/** The next-page URL from a paginated GitHub REST response's Link header, or undefined on the last page. Same helper scripts/check-package-visibility.mjs's fetchRegistryPackages already uses. */
function nextPageUrl(response) {
  const link = typeof response?.headers?.get === "function" ? response.headers.get("link") : undefined;
  if (!link) return undefined;
  const match = /<([^>]+)>;\s*rel="next"/.exec(link);
  return match ? match[1] : undefined;
}

/**
 * The raw, per-package result of one registry lookup — before ambiguity is
 * resolved. Mirrors reachability.ts's ProbeOutcome shape exactly, with
 * `known` carrying `hasVersion` (whether the requested version is in the
 * package's published version list) instead of a latest-version string:
 *
 *   { kind: "known", hasVersion: boolean }
 *   { kind: "not-found" }
 *   { kind: "denied" }
 *   { kind: "unreachable" }
 */

/**
 * Probes whether `version` of `name` (a full scoped npm name) has been
 * published, via GitHub's packages-by-owner REST "list package versions"
 * endpoint — tries the organization endpoint first, falling back to the
 * personal-account endpoint only on a 404, the same org-then-user pattern
 * scripts/check-package-visibility.mjs's fetchPackageVisibility and
 * fetchRegistryPackages already use, since there is no single API path that
 * works for both account kinds and no way to know which kind `owner` is
 * without asking.
 *
 * `fetchImpl` is injected so tests never make a real network call — same
 * dependency-injection shape reachability.ts's Transport and
 * check-package-visibility.mjs's fetchImpl already use.
 */
export async function probeOneVersion({ owner, name, version, token, registry = GITHUB_PACKAGES_REGISTRY, fetchImpl }) {
  if (registry === PUBLIC_NPM_REGISTRY) return probePublicNpmVersion({ registry, name, version, fetchImpl });
  if (registry !== GITHUB_PACKAGES_REGISTRY || typeof token !== "string" || token.length === 0) return { kind: "denied" };
  const bare = bareName(name);
  for (const kind of ["orgs", "users"]) {
    const collected = [];
    let url = `${GITHUB_API}/${kind}/${owner}/packages/npm/${bare}/versions?per_page=100`;
    let firstPage = true;
    let sawNotFound = false;
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
      } catch {
        return { kind: "unreachable" };
      }
      if (response.status === 404 && firstPage) {
        sawNotFound = true;
        break;
      }
      if (response.status === 401 || response.status === 403) return { kind: "denied" };
      if (response.status < 200 || response.status >= 300) return { kind: "unreachable" };
      let body;
      try {
        body = await response.json();
      } catch {
        return { kind: "unreachable" };
      }
      if (!Array.isArray(body)) return { kind: "unreachable" };
      for (const entry of body) {
        if (entry && typeof entry === "object" && typeof entry.name === "string") collected.push(entry.name);
      }
      firstPage = false;
      url = nextPageUrl(response);
    }
    if (sawNotFound) continue;
    return { kind: "known", hasVersion: collected.includes(version) };
  }
  return { kind: "not-found" };
}

/**
 * Probe every `{ name, version }` pair independently — one failure never
 * skips the rest. Mirrors reachability.ts's probeReachability exactly.
 */
export async function probeVersions(entries, options) {
  const results = await Promise.all(entries.map(async ({ name, version }) => [name, await probeOneVersion({ ...options, name, version })]));
  return new Map(results);
}

/**
 * Resolve each raw outcome into the verdict a caller actually reasons
 * about. Mirrors reachability.ts's resolveReachability exactly, extended
 * with the unambiguous `missing` case that has no analogue there (see this
 * module's header):
 *
 *   { kind: "published" }       — the exact version is on the registry.
 *   { kind: "missing" }         — the package is visible to this credential
 *                                  and definitively does not have this
 *                                  version. Safe to treat as publishable.
 *   { kind: "unauthenticated" } — an explicit denial, or a not-found the
 *                                  batch could not distinguish from one.
 *   { kind: "unreachable" }     — a transport failure. Nothing else: the
 *                                  registry never answered.
 *   { kind: "indeterminate" }   — the registry ANSWERED and said it does not
 *                                  have this name, with the credential proven
 *                                  to work for other names in the batch.
 *                                  GitHub Packages access is per package, so
 *                                  "never published", "deliberately retired"
 *                                  and "not visible to this credential" stay
 *                                  indistinguishable. Undecidable, and now
 *                                  said so rather than borrowed from
 *                                  `unreachable`, which asserted a failure
 *                                  that did not occur.
 *
 * WHY THIS MIRRORS @clossys/integrator RATHER THAN IMPORTING IT
 * ---------------------------------------------------------------------
 * Not preference, and not an oversight to be tidied away later. This module
 * runs from `scripts/select-publishable-packages.mjs` in publish.yml's
 * `discover` job (line 89) — which is BEFORE `npm ci` and `npm run build`
 * (lines 291 and 298, in a later job). There are no node_modules and no dist
 * when it runs, so it cannot import a workspace package. It also decides
 * whether to publish integrator itself, so importing integrator to make that
 * decision would be a bootstrap loop: a broken integrator build would take
 * out the very step that publishes its fix.
 *
 * So this stays a hand mirror, and a change to integrator's resolver must be
 * mirrored here deliberately. That cost is real and is the reason this
 * paragraph exists — the alternative was discovering it during a convergence
 * attempt that could not work.
 *
 * Never returns `missing` for anything the registry did not affirmatively
 * confirm — a caller must never read `unauthenticated` or `unreachable` as
 * "safe to publish". `denied` and `unreachable` outcomes are never
 * reclassified into each other or into `not-found` — those ARE the two
 * distinctions this module exists to keep apart, so they pass straight
 * through, exactly as reachability.ts's own resolveReachability documents.
 */
export function resolveVersionLookups(outcomes) {
  const hasKnown = [...outcomes.values()].some((outcome) => outcome.kind === "known");

  const resolved = new Map();
  for (const [name, outcome] of outcomes) {
    switch (outcome.kind) {
      case "known":
        resolved.set(name, { kind: outcome.hasVersion ? "published" : "missing" });
        break;
      case "denied":
        resolved.set(name, { kind: "unauthenticated" });
        break;
      case "unreachable":
        resolved.set(name, { kind: "unreachable" });
        break;
      case "not-found":
        resolved.set(name, hasKnown ? { kind: "indeterminate" } : { kind: "unauthenticated" });
        break;
      default:
        throw new Error(`Unhandled probe outcome: ${JSON.stringify(outcome)}`);
    }
  }
  return resolved;
}
