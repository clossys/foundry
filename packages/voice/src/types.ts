/**
 * Zod schemas and inferred types for @vespeneventures/voice's four entities:
 * voice rules, a glossary entry, a claim, and the `VoiceRecord` that binds
 * them together for one consumer. Pure data and validation — no I/O, no
 * React, no network. See the package README for why each shape looks the
 * way it does, and for which parts of it `checker.ts` can and cannot
 * mechanically evaluate.
 *
 * This file ships no example content of a real voice. Every default here is
 * either empty or a structural placeholder — filling in an actual person
 * rule, glossary, or claims register is a consumer's job, the same split
 * @vespeneventures/tokens draws between `tokens.css` (neutral machinery)
 * and a consumer's own `brand.css` (real values). See "The single most
 * important constraint" in the README.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Voice rules — tone, person, tense, formality
// ---------------------------------------------------------------------------

/**
 * A "person" rule, e.g. "always address the reader as you, never refer to
 * the product/company as I". `description` is for humans — it is never
 * parsed. `forbiddenPronouns` is the ONLY part of this rule the checker
 * actually evaluates: a plain list of pronouns that, if they appear in
 * copy, contradict the rule. Matched case-insensitively, whole-word only.
 *
 * This is deliberately a word list, not a `"first" | "second" | "third"`
 * enum the checker tries to infer grammar from. A word list is auditable —
 * a reader can see exactly what will be flagged — and it is the same
 * mechanism the glossary check already uses, rather than a second,
 * differently-shaped piece of pseudo-grammar logic.
 */
export const PersonRuleSchema = z.object({
  description: z.string().min(1),
  forbiddenPronouns: z.array(z.string().min(1)).default([]),
});

/**
 * A "tense" rule. Same shape and same honesty as `PersonRuleSchema`:
 * `forbiddenMarkers` is a plain word list (e.g. `["will", "shall"]` to
 * steer away from future-tense promises), not an attempt at real
 * grammatical tense parsing — see the README's "what this checker does not
 * attempt" section for why that line is drawn here.
 */
export const TenseRuleSchema = z.object({
  description: z.string().min(1),
  forbiddenMarkers: z.array(z.string().min(1)).default([]),
});

/** Descriptive only. Never mechanically checked — see README. */
export const FormalityLevelSchema = z.enum(["casual", "neutral", "formal"]);

/**
 * The full rules block of a `VoiceRecord`. `person` and `tense` are
 * mechanically checkable (via their word lists, when populated).
 * `formality` and `tone` are metadata for a human writer/reviewer only —
 * the checker never reads them. See README, "Be honest about what is and
 * is not mechanically checkable."
 */
export const VoiceRulesSchema = z.object({
  person: PersonRuleSchema,
  tense: TenseRuleSchema,
  formality: FormalityLevelSchema,
  /** Free-text tone descriptors, e.g. `["warm", "direct", "no jargon"]`. */
  tone: z.array(z.string().min(1)).default([]),
});

// ---------------------------------------------------------------------------
// Glossary — forbidden / preferred terms
// ---------------------------------------------------------------------------

export const GlossaryStatusSchema = z.enum(["forbidden", "preferred"]);

/**
 * One glossary entry. Only `status: "forbidden"` entries are ever actively
 * scanned for by the checker — see README for why `"preferred"` entries are
 * documentation-only (detecting "did you use the sanctioned synonym" would
 * require real synonym/paraphrase detection, which this package does not
 * attempt and will not claim to).
 */
export const GlossaryEntrySchema = z.object({
  term: z.string().min(1),
  status: GlossaryStatusSchema,
  /** Required — a forbidden or preferred term with no stated reason is not auditable. */
  reason: z.string().min(1),
  /** Suggested replacement, shown in a finding's message when `status` is `"forbidden"`. */
  alternative: z.string().min(1).optional(),
  /** Default `false` — most house-style terms are meant to be caught regardless of capitalization. */
  caseSensitive: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Claims register
// ---------------------------------------------------------------------------

/**
 * One claim a consumer's copy might make, e.g. "fastest sync in its
 * class". `factRef` is the seam into a separate, not-yet-existent
 * `strategy` package's `facts` registry — see README, "The `factRef`
 * seam", for why it is a plain opaque string and never a typed import.
 *
 * `matchPhrases` are the literal, verbatim phrases the checker searches
 * copy for to decide this claim is being made. When omitted, the checker
 * falls back to searching for `text` itself. Matching is literal and
 * case-insensitive — a paraphrase of the claim that never uses one of
 * these phrases is not detected. See README's limits section.
 */
export const ClaimSchema = z.object({
  id: z.string().min(1),
  /** Human-readable statement of the claim, for the register itself and as the default match phrase. */
  text: z.string().min(1),
  matchPhrases: z.array(z.string().min(1)).default([]),
  /**
   * Opaque plain-string reference into a consumer's own facts registry.
   * Never validated by this package — see README, "The `factRef` seam".
   */
  factRef: z.string().min(1).optional(),
  /** Default `true`: most claims in a register are there because they need backing. */
  requiresSupport: z.boolean().default(true),
});

// ---------------------------------------------------------------------------
// VoiceRecord — one consumer's bound values
// ---------------------------------------------------------------------------

/**
 * One consumer's complete, bound voice: an identifier, its rules, its
 * glossary, and its claims register. This is the "brand.css" of this
 * package — foundry ships the schema this conforms to, never a real
 * instance of it. See README, "The single most important constraint".
 */
export const VoiceRecordSchema = z.object({
  id: z.string().min(1),
  rules: VoiceRulesSchema,
  glossary: z.array(GlossaryEntrySchema).default([]),
  claims: z.array(ClaimSchema).default([]),
});

export type PersonRule = z.infer<typeof PersonRuleSchema>;
export type TenseRule = z.infer<typeof TenseRuleSchema>;
export type FormalityLevel = z.infer<typeof FormalityLevelSchema>;
export type VoiceRules = z.infer<typeof VoiceRulesSchema>;
export type GlossaryStatus = z.infer<typeof GlossaryStatusSchema>;
export type GlossaryEntry = z.infer<typeof GlossaryEntrySchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type VoiceRecord = z.infer<typeof VoiceRecordSchema>;

// ---------------------------------------------------------------------------
// Findings — shared shape, mirroring @vespeneventures/policy's own `Finding`
// ---------------------------------------------------------------------------

/**
 * One thing a validator or the checker found wrong (or, at `"warning"`,
 * worth a look). Deliberately the same shape as `@vespeneventures/policy`'s
 * `Finding` — `rule` / `severity` / `message` / optional `path` — so a
 * caller already handling one kind of finding in this repo's ecosystem
 * does not need a second mental model for this package's. Defined fresh
 * here, not imported: this package has zero runtime dependency on
 * `@vespeneventures/policy`, on purpose (see README, "Dependencies").
 */
export interface VoiceFinding {
  /** Stable identifier for the rule that produced this finding, e.g. `"glossary:forbidden-term"`. */
  rule: string;
  /** `"error"` fails a check; `"warning"` does not. */
  severity: "error" | "warning";
  /** Human-readable description of the problem. */
  message: string;
  /** The specific term/pronoun/marker/claim id this finding is about, when there is a single clear one. */
  path?: string;
}
