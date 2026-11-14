/**
 * derive.director (R-DIRECTOR-DERIVED, foundry-feedback-0016): a Designer candidate says which
 * pinned Director trait it realises. Tailwind and shadcn values are references (the base a value
 * starts from), never the reason: the reason must cite the Director slot whose pin it realises.
 */
import { strings } from "../../core/lib.js";
import type { Criterion } from "../../core/types.js";
import { elementOf, SLOT_ID } from "./lib.js";

/** Every `director:<slot-id>` citation in a text, without a `#key` or trailing punctuation. */
export function directorCitations(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/(?<![\w.-])director:([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3})(@v?\d+)?/g)) {
    found.push(match[2] ? `${match[1]}${match[2]}` : match[1]!);
  }
  return found;
}

/** Every `default:<ref>` claim in a text (keeping a reference value unchanged). */
export const defaultClaims = (text: string): string[] => [...text.matchAll(/(?<![\w.-])default:(\S+)/g)].map(match => match[1]!.replace(/[.,;:)]+$/, ""));

/**
 * derive.director: `meta.element.reason` cites `director:<slot-id>` for at least one of
 * `params.traits` (the Director slots the standard derives from) and every one of `params.required`.
 * A citation never carries a version suffix. A `default:<ref>` claim (keeping the reference value)
 * is allowed only beside such a citation: keeping a default needs a Director reason too.
 */
export const directorDerived: Criterion = (subject, params) => {
  const traits = strings(params.traits), required = strings(params.required);
  if (!traits.length && !required.length) return ["params.traits must list the Director slots the standard derives from"];
  const bad = [...traits, ...required].filter(id => !SLOT_ID.test(id) || id.includes(":"));
  if (bad.length) return [`params name ${bad.join(", ")}: list bare Director slot ids`];
  const reason = elementOf(subject)?.reason;
  if (typeof reason !== "string" || !reason.trim()) return ["meta.element.reason is missing: say which Director trait the candidate realises"];
  const cited = directorCitations(reason);
  const failures: string[] = [];
  for (const citation of cited.filter(item => /@v?\d+$/.test(item))) failures.push(`citation director:${citation} carries a version suffix; cite the slot id only`);
  const ids = new Set(cited.filter(item => !/@v?\d+$/.test(item)));
  const anyOf = traits.filter(id => ids.has(id));
  const claims = defaultClaims(reason);
  if (traits.length && !anyOf.length) {
    failures.push(claims.length
      ? `keeps default:${claims[0]} without a Director reason: cite director:<trait> (one of ${traits.join(", ")}) for keeping it`
      : `the reason cites no Director trait it realises (director:<slot-id>, one of ${traits.join(", ")}); a reference value is a base, not a reason`);
  }
  for (const id of required.filter(item => !ids.has(item))) failures.push(`the reason does not cite director:${id}`);
  return failures;
};
