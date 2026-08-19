import { REQUIREMENT_ID_CATEGORIES } from "./types.js";
import type { RepositoryProfileFindingRule } from "./types.js";

/**
 * Shared classifier for the settled two-segment `<category>.<subject>`
 * requirement-id grammar (issue #316). `validate.ts` (profile requirements)
 * and `evaluate.ts` (declarations and observations) both call this so the
 * two never drift back into checking the id shape independently, the same
 * failure mode that produced the divergence issue #316 exists to close.
 *
 * The governing principle: the id names the slot, the constraint names the
 * value. An id that instead embeds its own value or precision --
 * `runtime.node.major` (extra precision segment), `package-manager.npm`
 * (the concrete tool folded into what should be the category) -- is the
 * same error either way, so both are reported through the one
 * `requirement-id-value-embedded` rule rather than accepted.
 */

const CATEGORY_SET = new Set<string>(REQUIREMENT_ID_CATEGORIES);
/** Only lowercase letters, digits, dots, and hyphens -- checked before any segment is trusted. */
const ID_CHARSET = /^[a-z0-9.-]+$/;
/** One segment: lowercase words joined by single hyphens, never empty. */
const SEGMENT = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export type RequirementIdFindingRule = Extract<RepositoryProfileFindingRule, "requirement-id" | "requirement-id-value-embedded">;

export interface RequirementIdFinding {
  readonly rule: RequirementIdFindingRule;
  readonly message: string;
}

const CATEGORY_LIST = REQUIREMENT_ID_CATEGORIES.join(", ");

/**
 * Classifies a requirement id against the closed grammar. Returns
 * `undefined` for a conforming id, otherwise the one finding that explains
 * why -- generic malformed shape, or a value embedded in the id.
 */
export function classifyRequirementId(id: unknown): RequirementIdFinding | undefined {
  if (typeof id !== "string" || id.length === 0 || !ID_CHARSET.test(id)) {
    return {
      rule: "requirement-id",
      message: `id must be exactly <category>.<subject>, with category one of ${CATEGORY_LIST}.`,
    };
  }

  const segments = id.split(".");
  if (segments.some((segment) => segment.length === 0)) {
    return {
      rule: "requirement-id",
      message: `id "${id}" must not have an empty segment; id must be exactly <category>.<subject>.`,
    };
  }
  if (segments.length < 2) {
    return {
      rule: "requirement-id",
      message: `id "${id}" is missing a category; id must be exactly <category>.<subject>, with category one of ${CATEGORY_LIST}.`,
    };
  }
  if (segments.length > 2) {
    return {
      rule: "requirement-id-value-embedded",
      message: `id "${id}" has ${segments.length} dot-separated segments; id must be exactly <category>.<subject> -- move the extra precision or value into the constraint, not the id.`,
    };
  }

  const [category, subject] = segments as [string, string];
  if (!CATEGORY_SET.has(category)) {
    return {
      rule: "requirement-id-value-embedded",
      message: `id "${id}" uses category "${category}", which is not one of ${CATEGORY_LIST} -- a category outside this closed vocabulary usually means a value was folded into the id instead of left in the constraint.`,
    };
  }
  if (!SEGMENT.test(subject)) {
    return {
      rule: "requirement-id",
      message: `id "${id}" has an invalid subject "${subject}"; subject must be lowercase words separated by hyphens.`,
    };
  }

  return undefined;
}
