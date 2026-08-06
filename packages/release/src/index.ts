/**
 * @vespeneventures/release — layer 3, the top of a small foundation.
 *
 * Every layer below this one reasons about DECLARED shape: a manifest says
 * what it depends on, a catalog says whether that declaration is internally
 * consistent, a policy binding says whether materialized content matches
 * what was promised. None of them prove the package actually WORKS when
 * installed the way a real, external stranger would install it — with
 * nothing but the registry and whatever they declared. This package is that
 * proof: pack the real tarball, install it into a genuinely isolated
 * temporary directory with no workspace, no monorepo symlinks, no sibling
 * node_modules helping it out, and try to actually load what it claims to
 * export.
 *
 * Three capabilities:
 *
 *   - `packRoundTrip` — packs one package, installs the resulting tarball
 *     into an isolated directory, and attempts to import every subpath its
 *     own `exports` field declares. Real subprocess work; never throws for
 *     an expected failure mode (a failed install or a failed import is a
 *     finding, not an exception).
 *   - `preflightPackage` — combines this package's own catalog findings
 *     (via `@vespeneventures/gates`'s `runFoundationCheck`) with a real
 *     `packRoundTrip` result, aggregated into one report.
 *   - `verifyPublishedArtifact` — a thin wrapper around
 *     `@vespeneventures/policy`'s own `verifyBinding`, for checking already-
 *     fetched published content against an expected digest.
 *
 * NON-GOAL: this package does not publish anything and does not fetch
 * anything from a real registry. `packRoundTrip` installs from a LOCAL
 * tarball path — fully offline, no network beyond what the packed
 * package's own declared dependencies require to resolve, no credentials.
 * `verifyPublishedArtifact` takes already-fetched content as a plain
 * argument; where that content came from is entirely the caller's problem,
 * deliberately, the same way `@vespeneventures/policy` never reads a file
 * itself. See the README for the full picture, including what this
 * mechanism found when pointed at this repository's own packages today.
 */

export { packRoundTrip } from "./pack-round-trip.js";
export type { PackRoundTripOptions } from "./pack-round-trip.js";

export { preflightPackage } from "./preflight.js";
export type { PreflightPackageOptions } from "./preflight.js";

export { verifyPublishedArtifact } from "./verify-artifact.js";

export type { ImportCheck, RoundTripResult, PreflightReport } from "./types.js";
