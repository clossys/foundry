/**
 * Surface documents move to Publisher (issue #1205): Publisher authors the
 * in-tree `SectionedView`/`MarketingView` page document — which template,
 * which sections, which copy ids and asset ids, all by reference — and owns
 * every file under `clossys/agents/publisher/surfaces/`. Designer and Writer own
 * everything a surface document references (tokens, components, blocks, copy)
 * in their own folders; they propose changes and review renders, but they
 * never edit a Publisher surface file directly. Every file under `clossys/`
 * now has exactly one owner.
 *
 * This is a pure check, the same shape as `checkWebRoutes.ts`'s
 * `evaluateWebRouteManifest`: it takes a flat list of ownership claims
 * (normally assembled from every role's own folder manifest under
 * `clossys/`) and flags any path more than one role claims.
 *
 * The shared consumer layout contract (issue #1171) lists
 * `clossys/agents/publisher/surfaces` as a Publisher-owned folder. The layout
 * contract is repository governance and does not ship in this package, so
 * `PUBLISHER_SURFACES_DIR` below remains the runtime value; the two must
 * name the same path.
 */

/** The one directory Publisher owns under a consumer's `clossys/` layout (#1171, #1205). */
export const PUBLISHER_SURFACES_DIR = "clossys/agents/publisher/surfaces/";
/** Read-only migration prefix; never an authoring destination. */
const LEGACY_PUBLISHER_SURFACES_DIR = "clossys/publisher/surfaces/";

export interface SurfaceOwnershipClaim {
  /** Path relative to the consumer repository root, e.g. `clossys/agents/publisher/surfaces/home.json`. */
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
  /** Retired claim paths accepted for reading; never write destinations. */
  legacyPaths?: string[];
  notices?: string[];
}

/**
 * Every path under `clossys/` must have exactly one owner. Two roles
 * claiming the same path — for example Designer writing into
 * `clossys/agents/publisher/surfaces/home.json` directly instead of proposing a
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

  const legacyPaths = [...ownersByPath.keys()].filter((path) => path.startsWith(LEGACY_PUBLISHER_SURFACES_DIR)).sort();
  if (legacyPaths.length > 0 && [...ownersByPath.keys()].some((path) => path.startsWith(PUBLISHER_SURFACES_DIR))) {
    findings.push({
      rule: "surface-directory-indeterminate",
      path: PUBLISHER_SURFACES_DIR,
      message: `Both ${PUBLISHER_SURFACES_DIR} and the retired ${LEGACY_PUBLISHER_SURFACES_DIR} have claims — refusing to silently pick one.`,
    });
  }

  for (const [path, owners] of ownersByPath) {
    if (owners.size > 1) {
      findings.push({
        rule: "multiple-owners",
        path,
        message: `"${path}" is claimed by more than one role (${[...owners].sort().join(", ")}). Every file under clossys/ must have exactly one owner.`,
      });
    }
    if ((path.startsWith(PUBLISHER_SURFACES_DIR) || path.startsWith(LEGACY_PUBLISHER_SURFACES_DIR)) && !owners.has("publisher")) {
      findings.push({
        rule: "surface-owner-mismatch",
        path,
        message: `"${path}" is under ${path.startsWith(PUBLISHER_SURFACES_DIR) ? PUBLISHER_SURFACES_DIR : LEGACY_PUBLISHER_SURFACES_DIR}, which only Publisher owns, but no "publisher" claim names it (claimed by: ${[...owners].sort().join(", ") || "(none)"}).`,
      });
    }
  }

  findings.sort((left, right) => left.path.localeCompare(right.path) || left.rule.localeCompare(right.rule));
  return {
    exitCode: findings.length === 0 ? 0 : 1,
    findings,
    ...(legacyPaths.length > 0 ? {
      legacyPaths,
      notices: [`Reading retired ${LEGACY_PUBLISHER_SURFACES_DIR} claims read-only — move them to ${PUBLISHER_SURFACES_DIR}.`],
    } : {}),
  };
}
