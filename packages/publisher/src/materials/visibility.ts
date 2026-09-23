import type { PackVisibility } from "../pack/index.js";

/**
 * Materials are `internal` by default (#1206's owner decision) — the
 * materials site is never deployed and never browsable on a public domain.
 */
export const MATERIALS_DEFAULT_VISIBILITY: PackVisibility = "internal";

export interface MaterialsVisibilityCheckInput {
  itemId: string;
  visibility: PackVisibility;
  /** Whether the repository that would hold this item's committed output is public. */
  repositoryIsPublic: boolean;
}

export interface MaterialsVisibilityFinding {
  rule: string;
  itemId: string;
  message: string;
}

/**
 * "Git is a publication channel too" (#1206): committing an `internal`
 * item to a public repository publishes it. This check is the refusal —
 * it never writes anything itself, it only tells a caller whether the
 * write it is about to make would publish something that was never meant
 * to be public, so the caller can turn the item `blocked` and stop before
 * the commit happens rather than after.
 */
export function checkMaterialsVisibility(input: MaterialsVisibilityCheckInput): { blocked: boolean; findings: MaterialsVisibilityFinding[] } {
  if (input.visibility === "internal" && input.repositoryIsPublic) {
    return {
      blocked: true,
      findings: [
        {
          rule: "internal-item-in-public-repository",
          itemId: input.itemId,
          message: `"${input.itemId}" is internal but its output repository is public. Committing it there publishes it. Move internal materials to a private repository before committing; the content is never committed publicly.`,
        },
      ],
    };
  }
  return { blocked: false, findings: [] };
}
