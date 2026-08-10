/** An ordered, least-to-most-privileged list of application-defined roles. */
export interface RoleHierarchy {
  readonly roles: readonly string[];
}

/** A provider-neutral identity whose role is evaluated locally. */
export interface Viewer {
  readonly subjectId: string;
  readonly role?: string | null;
}

function validRole(role: unknown): role is string {
  return typeof role === "string" && role.trim().length > 0;
}

/** Creates a closed role hierarchy and rejects ambiguous role declarations. */
export function defineRoleHierarchy(roles: readonly string[]): RoleHierarchy {
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new TypeError("A role hierarchy must contain at least one role.");
  }

  const copy = [...roles];
  const seen = new Set<string>();
  for (const role of copy) {
    if (!validRole(role) || seen.has(role)) {
      throw new TypeError("Role hierarchy entries must be distinct, non-empty strings.");
    }
    seen.add(role);
  }

  return Object.freeze({ roles: Object.freeze(copy) });
}

/** Returns a role's rank, or `undefined` when the hierarchy does not know it. */
export function getRoleRank(role: unknown, hierarchy: RoleHierarchy): number | undefined {
  if (!validRole(role) || !hierarchy || !Array.isArray(hierarchy.roles)) return undefined;
  const rank = hierarchy.roles.indexOf(role);
  return rank === -1 ? undefined : rank;
}

/** Returns true only for a role explicitly configured in the hierarchy. */
export function isKnownRole(role: unknown, hierarchy: RoleHierarchy): role is string {
  return getRoleRank(role, hierarchy) !== undefined;
}

/**
 * Evaluates a minimum-role requirement. Missing or unknown supplied and
 * required roles fail closed rather than being coerced to a default rank.
 */
export function hasRoleAtLeast(role: unknown, requiredRole: unknown, hierarchy: RoleHierarchy): boolean {
  const actualRank = getRoleRank(role, hierarchy);
  const requiredRank = getRoleRank(requiredRole, hierarchy);
  return actualRank !== undefined && requiredRank !== undefined && actualRank >= requiredRank;
}

/** Returns a viewer's configured role, never an unknown provider-supplied value. */
export function resolveViewerRole(viewer: Viewer | null | undefined, hierarchy: RoleHierarchy): string | undefined {
  const role = viewer?.role;
  return isKnownRole(role, hierarchy) ? role : undefined;
}

/** Evaluates viewer access through the supplied closed hierarchy. */
export function viewerHasAccess(viewer: Viewer | null | undefined, requiredRole: unknown, hierarchy: RoleHierarchy): boolean {
  return hasRoleAtLeast(resolveViewerRole(viewer, hierarchy), requiredRole, hierarchy);
}
