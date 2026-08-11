/**
 * Plain TypeScript types for @vespeneventures/copy/voice's four entities: voice
 * rules, a glossary entry, a claim, and the `VoiceRecord` that binds them
 * together for one consumer. Pure data — no validation logic lives here
 * (see `schema.ts`) and no I/O.
 *
 * No runtime schema library. That follows this repository's own
 * precedent: `@vespeneventures/catalog`, `@vespeneventures/policy`, and
 * `@vespeneventures/ui/tokens` all ship zero runtime dependencies; only
 * `@vespeneventures/ui` carries any, and only because it wraps React
 * primitives it genuinely cannot hand-roll. `@vespeneventures/copy/voice`'s
 * entire job is dependency-free data shape validation — the same job
 * `@vespeneventures/policy`'s `validate.ts` already does, in plain type
 * guards, for a smaller shape. `schema.ts` follows that file's pattern
 * closely rather than pulling in a schema library (and its own major-
 * version churn, a real cost for a *public* package's consumers) for what
 * one file of type guards already covers.
 *
 * This file ships no example content of a real voice. Every field here is
 * either required-and-generic or a structural placeholder — filling in an
 * actual person rule, glossary, or claims register is a consumer's job,
 * the same split `@vespeneventures/ui/tokens` draws between `tokens.css`
 * (neutral machinery) and a consumer's own `brand.css` (real values). See
 * "The single most important constraint" in the README.
 */

// ---------------------------------------------------------------------------
// Voice rules — tone, person, tense, formality
// ---------------------------------------------------------------------------

/** Descriptive only. Never mechanically checked — see README. */
export type FormalityLevel = "casual" | "neutral" | "formal";

/**
 * The valid `FormalityLevel` values, in declaration order — exported as a
 * list, mirroring `@vespeneventures/policy`'s `DIGEST_ALGORITHMS`, so
 * `schema.ts` never hardcodes them as a second, separately-maintained
 * literal check.
 */
export const FORMALITY_LEVELS: readonly FormalityLevel[] = ["casual", "neutral", "formal"];

/**
 * A "person" rule, e.g. "always address the reader as you, never refer to
 * the product/company as I". `description` is for humans — it is never
 * parsed. `forbiddenPronouns` is the ONLY part of this rule the checker
 * actually evaluates: a plain list of pronouns that, if they appear in
 * copy, contradict the rule. Matched case-insensitively, whole-word only —
 * except a single-letter, uppercase entry (e.g. `"I"`), which `checker.ts`
 * matches case-sensitively so it cannot collide with an unrelated
 * lowercase letter (a roman numeral, a loop variable in quoted code).
 *
 * This is deliberately a word list, not a `"first" | "second" | "third"`
 * enum the checker tries to infer grammar from. A word list is auditable —
 * a reader can see exactly what will be flagged — and it is the same
 * mechanism the glossary check already uses, rather than a second,
 * differently-shaped piece of pseudo-grammar logic.
 */
export interface PersonRule {
  description: string;
  forbiddenPronouns: string[];
}

/**
 * A "tense" rule. Same shape and same honesty as `PersonRule`:
 * `forbiddenMarkers` is a plain word list (e.g. `["will", "shall"]` to
 * steer away from future-tense promises), not an attempt at real
 * grammatical tense parsing — see the README's "what this checker does not
 * attempt" section for why that line is drawn here.
 */
export interface TenseRule {
  description: string;
  forbiddenMarkers: string[];
}

/**
 * The full rules block of a `VoiceRecord`. `person` and `tense` are
 * mechanically checkable (via their word lists, when populated).
 * `formality` and `tone` are metadata for a human writer/reviewer only —
 * the checker never reads them. See README, "Be honest about what is and
 * is not mechanically checkable."
 */
export interface VoiceRules {
  person: PersonRule;
  tense: TenseRule;
  formality: FormalityLevel;
  /** Free-text tone descriptors, e.g. `["warm", "direct", "no jargon"]`. */
  tone: string[];
}

// ---------------------------------------------------------------------------
// Glossary — forbidden / preferred terms
// ---------------------------------------------------------------------------

export type GlossaryStatus = "forbidden" | "preferred";

/** The valid `GlossaryStatus` values, in declaration order. See `FORMALITY_LEVELS`'s doc comment for why this is a list, not a repeated literal check. */
export const GLOSSARY_STATUSES: readonly GlossaryStatus[] = ["forbidden", "preferred"];

/**
 * One glossary entry. Only `status: "forbidden"` entries are ever actively
 * scanned for by the checker — see README for why `"preferred"` entries are
 * documentation-only (detecting "did you use the sanctioned synonym" would
 * require real synonym/paraphrase detection, which this package does not
 * attempt and will not claim to).
 */
export interface GlossaryEntry {
  term: string;
  status: GlossaryStatus;
  /** Required — a forbidden or preferred term with no stated reason is not auditable. */
  reason: string;
  /** Suggested replacement, shown in a finding's message when `status` is `"forbidden"`. */
  alternative?: string;
  /** Default `false` — most house-style terms are meant to be caught regardless of capitalization. */
  caseSensitive: boolean;
}

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
 * copy for to decide this claim is being made. When empty, the checker
 * falls back to searching for `text` itself. Matching is literal and
 * case-insensitive — a paraphrase of the claim that never uses one of
 * these phrases is not detected. See README's limits section.
 */
export interface Claim {
  id: string;
  /** Human-readable statement of the claim, for the register itself and as the default match phrase. */
  text: string;
  matchPhrases: string[];
  /**
   * Opaque plain-string reference into a consumer's own facts registry.
   * Never validated by this package — see README, "The `factRef` seam".
   */
  factRef?: string;
  /** Default `true`: most claims in a register are there because they need backing. */
  requiresSupport: boolean;
}

// ---------------------------------------------------------------------------
// VoiceRecord — one consumer's bound values
// ---------------------------------------------------------------------------

/**
 * One consumer's complete, bound voice: an identifier, its rules, its
 * glossary, and its claims register. This is the "brand.css" of this
 * package — foundry ships the schema this conforms to, never a real
 * instance of it. See README, "The single most important constraint".
 */
export interface VoiceRecord {
  id: string;
  rules: VoiceRules;
  glossary: GlossaryEntry[];
  claims: Claim[];
}

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
 * `@vespeneventures/policy`, on purpose (see README, "Requirements").
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
