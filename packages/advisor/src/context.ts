/**
 * The shared engagement context record (issue #1173): the business
 * questions a non-technical founder answers once, so no later role intake
 * asks again what this record already answers. Matches
 * this repository's engagement-context contract (issue #1173). Lives at `clossys/advisor/context.json`
 * in a hub, per the layout approved in issue #1171.
 *
 * An unanswered field stays `unknown` and is never invented — Advisor does
 * not infer a business's stage or intent from anything but the founder's
 * own answer. Technical facts (languages, frameworks, installed packages,
 * hosting) never live here; they come from reading the repository, not
 * from asking the founder.
 */
export type EngagementContextFieldId = "business" | "product" | "audience" | "stage" | "intent" | "constraints";

export const ENGAGEMENT_CONTEXT_FIELD_IDS: readonly EngagementContextFieldId[] = [
  "business",
  "product",
  "audience",
  "stage",
  "intent",
  "constraints",
];

/** A known field carries the chosen choice id as its value; an unknown field carries nothing. */
export type EngagementContextField =
  | { id: EngagementContextFieldId; state: "known"; value: string }
  | { id: EngagementContextFieldId; state: "unknown" };

export interface EngagementContext {
  schemaVersion: 1;
  fields: readonly EngagementContextField[];
}

export function fieldById(context: Pick<EngagementContext, "fields">, id: EngagementContextFieldId): EngagementContextField | undefined {
  return context.fields.find((field) => field.id === id);
}
