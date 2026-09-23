/**
 * Surface documents move to Publisher (issue #1205): Publisher authors the
 * in-tree `SectionedView`/`MarketingView` page document — which template,
 * which sections, which copy ids and asset ids, all by reference — and owns
 * every file under `clossys/publisher/surfaces/`. Designer and Writer own
 * everything a surface document references (tokens, atoms, blocks, copy)
 * in their own folders; they propose changes and review renders, but they
 * never edit a Publisher surface file directly. Every file under `clossys/`
 * now has exactly one owner.
 *
 * This is a pure check, the same shape as `checkWebRoutes.ts`'s
 * `evaluateWebRouteManifest`: it takes a flat list of ownership claims
 * (normally assembled from every role's own folder manifest under
 * `clossys/`) and flags any path more than one role claims.
 *
 * The shared consumer layout contract this path belongs to is issue #1171
 * (Launcher lane), which has not landed in this repository yet — there is
 * no `clossys/` layout file here to add `clossys/publisher/surfaces/` to.
 * `PUBLISHER_SURFACES_DIR` below is Publisher's own record of the path it
 * intends to own once that contract exists; wire it into the shared layout
 * contract's own file when #1171 lands, rather than duplicating a second
 * declaration of it there.
 */

/** The one directory Publisher owns under a consumer's `clossys/` layout (#1171, #1205). */
export const PUBLISHER_SURFACES_DIR = "clossys/publisher/surfaces/";

export interface SurfaceOwnershipClaim {
  /** Path relative to the consumer repository root, e.g. `clossys/publisher/surfaces/home.json`. */
  path: string;
  /** The role folder claiming to own this path, e.g. `publisher`, `designer`, `writer`. */
  owner: string;
}

export interface SurfaceOwnershipFinding {
  rule: string;
  path: string;
  message: string;
}

export interface SurfaceOwnershipCheckResult {
  exitCode: number;
  findings: SurfaceOwnershipFinding[];
}

/**
 * Every path under `clossys/` must have exactly one owner. Two roles
 * claiming the same path — for example Designer writing into
 * `clossys/publisher/surfaces/home.json` directly instead of proposing a
 * change in `clossys/designer/` — is exactly the defect #1205 closes.
 */
export function validateSurfaceOwnership(claims: readonly SurfaceOwnershipClaim[]): SurfaceOwnershipCheckResult {
  const findings: SurfaceOwnershipFinding[] = [];
  const ownersByPath = new Map<string, Set<string>>();

  for (const claim of claims) {
    const path = claim.path?.trim();
    const owner = claim.owner?.trim();
    if (!path || !owner) {
      findings.push({
        rule: "invalid-claim",
        path: path || "(missing path)",
        message: `Ownership claim ${JSON.stringify(claim)} must name both a path and an owner.`,
      });
      continue;
    }
    const owners = ownersByPath.get(path) ?? new Set<string>();
    owners.add(owner);
    ownersByPath.set(path, owners);
  }

  for (const [path, owners] of ownersByPath) {
    if (owners.size > 1) {
      findings.push({
        rule: "multiple-owners",
        path,
        message: `"${path}" is claimed by more than one role (${[...owners].sort().join(", ")}). Every file under clossys/ must have exactly one owner.`,
      });
    }
    if (path.startsWith(PUBLISHER_SURFACES_DIR) && !owners.has("publisher")) {
      findings.push({
        rule: "surface-owner-mismatch",
        path,
        message: `"${path}" is under ${PUBLISHER_SURFACES_DIR}, which only Publisher owns, but no "publisher" claim names it (claimed by: ${[...owners].sort().join(", ") || "(none)"}).`,
      });
    }
  }

  findings.sort((left, right) => left.path.localeCompare(right.path) || left.rule.localeCompare(right.rule));
  return { exitCode: findings.length === 0 ? 0 : 1, findings };
}
