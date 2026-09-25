/**
 * Strategist's audience intake, made aware of the shared engagement context
 * (issue #1173): the founder already told Advisor, once, whether this is
 * for everyday consumers or other businesses (the `audience` context
 * field, `docs/contracts/engagement-context.json`). Strategist reads that
 * coarse choice through {@link EngagementContextSnapshot} and asks only
 * for what it does not provide — `audiences.json`'s detailed record
 * (`id`, `name`, `situation`, `pains`; see `schema.ts`'s `Audience`) still
 * needs a specific situation and at least one pain, because a B2C/B2B
 * choice alone cannot honestly answer those without inventing founder
 * words. This mirrors decision 28's own duplicate-question rule: the
 * reserved context field id is `audience`; this package's own intake
 * question ids below (`audience-type`, `audience-name`,
 * `audience-situation`, `audience-pains`) are a different, narrower
 * vocabulary, so none of them collides with it.
 *
 * Only `audience` maps into a Strategist record today. The other five
 * context fields (`business`, `product`, `stage`, `intent`, `constraints`)
 * are readable through the same `EngagementContextSnapshot` for a future
 * intake surface but are not wired into any `clossys/strategist/*.json`
 * seed yet — wiring one is a separate change, not assumed here.
 */

import type { Audience } from "./schema.js";
import { audienceContextValue } from "./engagement-context.js";
import type { EngagementContextSnapshot } from "./engagement-context.js";

export type AudienceIntakeQuestionId = "audience-type" | "audience-name" | "audience-situation" | "audience-pains";

export interface AudienceIntakeQuestion {
  readonly id: AudienceIntakeQuestionId;
  readonly prompt: string;
}

const AUDIENCE_INTAKE_QUESTIONS: readonly AudienceIntakeQuestion[] = [
  { id: "audience-type", prompt: "Is this audience everyday consumers (B2C) or other businesses (B2B)?" },
  { id: "audience-name", prompt: "What should we call this audience?" },
  { id: "audience-situation", prompt: "What is this audience's situation right now?" },
  { id: "audience-pains", prompt: "What pains does this audience have? (at least one)" },
];

/**
 * The audience intake questions still worth asking, in the fixed order
 * above, given what the engagement context already answered. Only
 * `audience-type` can be dropped — it is the one question the context's
 * coarse `audience` field answers; a `business`, `stage`, `intent`, or
 * any other known context field never drops it, because none of them
 * answers "consumers or businesses". `audience-name`, `-situation`, and
 * `-pains` are always asked: the context's fixed choice ids never carry
 * founder prose, so this package never invents them.
 */
export function pendingAudienceIntakeQuestions(context: EngagementContextSnapshot): readonly AudienceIntakeQuestion[] {
  const typeKnown = audienceContextValue(context) !== undefined;
  return AUDIENCE_INTAKE_QUESTIONS.filter((question) => !(typeKnown && question.id === "audience-type"));
}

const AUDIENCE_TYPE_LABEL: Record<"consumers" | "businesses", { name: string; situation: string }> = {
  consumers: { name: "Consumers", situation: "Everyday consumers (B2C)." },
  businesses: { name: "Businesses", situation: "Other businesses (B2B)." },
};

export type AudienceSeedResult =
  | { readonly seeded: true; readonly audience: Pick<Audience, "id" | "name" | "situation" | "notes">; readonly provenance: { readonly audience: "brief" } }
  | { readonly seeded: false; readonly reason: "no-audience-context" | "audiences-already-recorded" };

/**
 * Proposes a starting `audiences.json` entry from the brief's coarse
 * `audience` context field, never overwriting an existing detailed
 * record: when `existingAudiences` already has one or more entries, this
 * refuses to seed at all, on the theory that Strategist's own governed
 * record — built from the founder's specific answers — always outranks
 * a coarse B2C/B2B guess (`clossys/strategist/audiences.json` is the
 * detailed record; the brief's `audience` field is not).
 *
 * The proposed `situation` is Advisor's own fixed-choice label text
 * (`packages/advisor/src/context-questions.ts`'s recorded choice labels,
 * mirrored in this package's `AUDIENCE_TYPE_LABEL`) — a recorded answer,
 * not invented prose — and `pains` is deliberately left off the returned
 * shape: it is `Audience`'s one required field this seed cannot honestly
 * fill, so the caller still asks `audience-pains` (see
 * {@link pendingAudienceIntakeQuestions}) before writing a valid entry.
 * `notes` records where the seed came from, so a reader of
 * `audiences.json` can see the entry started from the brief.
 */
export function seedAudienceFromContext(context: EngagementContextSnapshot, existingAudiences: readonly Pick<Audience, "id">[]): AudienceSeedResult {
  if (existingAudiences.length > 0) return { seeded: false, reason: "audiences-already-recorded" };
  const value = audienceContextValue(context);
  if (value === undefined) return { seeded: false, reason: "no-audience-context" };
  const label = AUDIENCE_TYPE_LABEL[value];
  return {
    seeded: true,
    audience: {
      id: value,
      name: label.name,
      situation: label.situation,
      notes: "Seeded from the engagement brief's audience context field (issue #1173) — pains and a more specific situation are still needed before handoff.",
    },
    provenance: { audience: "brief" },
  };
}
