/**
 * Strategist's audience intake, made aware of the shared engagement context
 * (issue #1173). A founder already told `@clossys/advisor`, once, whether
 * this is for everyday consumers or other businesses — Advisor's own
 * `audience` context field (`docs/contracts/engagement-context.json`).
 * Strategist does not ask that question again under a different id:
 * `docs/DECISIONS.md` decision 28's duplicate-question rule matches on
 * stable ids, but explicitly leaves a genuine rename of a context
 * question to review, not the gate — and a Strategist card prompting
 * "consumers (B2C) or businesses (B2B)?" with Advisor's own two choices
 * is exactly that: Advisor's `audience` card under a new name. When the
 * brief's `audience` field is unknown, {@link pendingAudienceIntakeQuestions}
 * returns a pointer back to Advisor's own context card instead of a
 * Strategist-owned substitute for it.
 *
 * Only `audience` maps into a Strategist record today. The other five
 * context fields (`business`, `product`, `stage`, `intent`, `constraints`)
 * are readable through the same `EngagementContextSnapshot` for a future
 * intake surface but are not wired into any `clossys/strategist/*.json`
 * seed yet — wiring one is a separate change, not assumed here. The
 * contract and the decisions record cited above are in the public
 * repository -- not shipped in this package.
 */

import type { Audience } from "./schema.js";
import { audienceContextValue } from "./engagement-context.js";
import type { EngagementContextSnapshot } from "./engagement-context.js";

/**
 * Strategist's own audience intake questions. Nothing here asks "consumers
 * or businesses" — that is Advisor's own `audience` context question; see
 * this module's header comment for why a Strategist-owned rename of it is
 * not offered as an alternative. Each of these three is genuinely
 * distinct from every context field id (`business`, `product`, `audience`,
 * `stage`, `intent`, `constraints`): none of the six answers a specific
 * audience's name, situation, or pains.
 */
export type AudienceIntakeQuestionId = "audience-name" | "audience-situation" | "audience-pains";

export interface AudienceIntakeQuestion {
  readonly kind: "question";
  readonly id: AudienceIntakeQuestionId;
  readonly prompt: string;
}

/**
 * Not a question Strategist asks — a pointer. Presented in place of a
 * Strategist-owned audience-type question when the brief does not yet
 * answer Advisor's `audience` context field: the founder answers it once,
 * on Advisor's own card, and every role reads the brief afterward.
 */
export interface AudienceContextPointer {
  readonly kind: "context-pointer";
  readonly fieldId: "audience";
  readonly note: string;
}

export type AudienceIntakeStep = AudienceIntakeQuestion | AudienceContextPointer;

const AUDIENCE_INTAKE_QUESTIONS: readonly AudienceIntakeQuestion[] = [
  { kind: "question", id: "audience-name", prompt: "What should we call this audience?" },
  { kind: "question", id: "audience-situation", prompt: "What is this audience's situation right now?" },
  { kind: "question", id: "audience-pains", prompt: "What pains does this audience have? (at least one)" },
];

const AUDIENCE_CONTEXT_POINTER: AudienceContextPointer = {
  kind: "context-pointer",
  fieldId: "audience",
  note: 'Not recorded yet — answer Advisor\'s own "audience" context card (packages/advisor/src/context-questions.ts); Strategist does not ask this again under its own card.',
};

/**
 * The audience intake steps still worth taking, given what the engagement
 * context already answered. When `audience` is unknown, the first step is
 * {@link AudienceContextPointer} — never a Strategist question that
 * duplicates Advisor's own card. The three genuinely distinct questions
 * (name, situation, at least one pain) are always included: no context
 * field answers any of them, brief present or not.
 */
export function pendingAudienceIntakeQuestions(context: EngagementContextSnapshot): readonly AudienceIntakeStep[] {
  const typeKnown = audienceContextValue(context) !== undefined;
  return typeKnown ? AUDIENCE_INTAKE_QUESTIONS : [AUDIENCE_CONTEXT_POINTER, ...AUDIENCE_INTAKE_QUESTIONS];
}

const AUDIENCE_TYPE_NAME: Record<"consumers" | "businesses", string> = {
  consumers: "Consumers",
  businesses: "Businesses",
};

/**
 * A neutral, package-owned seed sentence built from the coarse choice id —
 * deliberately not a copy of Advisor's own card label text
 * (`packages/advisor/src/context-questions.ts`'s `CHOICES` -- in the public repository, not shipped in this package),
 * which would
 * need a cross-package test to keep the two packages' strings in sync and
 * would blur which package owns the words a founder never actually said.
 * `pains` is still required and not seeded here — see
 * {@link seedAudienceFromContext}.
 */
function seedSituation(value: "consumers" | "businesses"): string {
  return `${AUDIENCE_TYPE_NAME[value]}, per the engagement brief's audience answer — situation not yet described.`;
}

export type AudienceSeedResult =
  | { readonly seeded: true; readonly audience: Pick<Audience, "id" | "name" | "situation" | "notes">; readonly provenance: { readonly audience: "brief" } }
  | { readonly seeded: false; readonly reason: "no-audience-context" | "audiences-already-recorded" };

/**
 * Proposes a starting `audiences.json` entry from the brief's coarse
 * `audience` context field, never overwriting an existing detailed
 * record: when `existingAudiences` already has one or more entries, this
 * refuses to seed at all — a governed record built from the founder's own
 * specific answers always outranks a coarse B2C/B2B guess.
 *
 * `pains` is deliberately left off the returned shape: it is `Audience`'s
 * one required field this seed cannot honestly fill from a coarse choice,
 * so `audience-pains` (see {@link pendingAudienceIntakeQuestions}) stays
 * asked until it is answered. `notes` records where the seed came from.
 */
export function seedAudienceFromContext(context: EngagementContextSnapshot, existingAudiences: readonly Pick<Audience, "id">[]): AudienceSeedResult {
  if (existingAudiences.length > 0) return { seeded: false, reason: "audiences-already-recorded" };
  const value = audienceContextValue(context);
  if (value === undefined) return { seeded: false, reason: "no-audience-context" };
  return {
    seeded: true,
    audience: {
      id: value,
      name: AUDIENCE_TYPE_NAME[value],
      situation: seedSituation(value),
      notes: "Seeded from the engagement brief's audience context field (issue #1173) — pains and a more specific situation are still needed before handoff.",
    },
    provenance: { audience: "brief" },
  };
}
