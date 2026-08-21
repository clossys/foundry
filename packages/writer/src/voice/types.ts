/**
 * Plain TypeScript types for @vespeneventures/writer/voice's four entities: voice
 * rules, a glossary entry, a claim, and the `VoiceRecord` that binds them
 * together for one consumer. Pure data — no validation logic lives here
 * (see `schema.ts`) and no I/O.
 *
 * No runtime schema library. That follows this repository's own
 * precedent: `@vespeneventures/catalog`, `@vespeneventures/policy`, and
 * `@vespeneventures/ui/tokens` all ship zero runtime dependencies; only
 * `@vespeneventures/ui` carries any, and only because it wraps React
 * primitives it genuinely cannot hand-roll. `@vespeneventures/writer/voice`'s
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
  /** See `VoiceChannel`'s doc comment. Omitted (the default) means this entry applies regardless of channel. */
  channel?: VoiceChannel;
}

// ---------------------------------------------------------------------------
// Channel scoping
// ---------------------------------------------------------------------------

/**
 * A consumer-supplied channel tag (e.g. `"linkedin"`, `"x"`, `"hn"`) a rule
 * can be scoped to, so different channels can carry different banned sets —
 * the same seam `CopyLocale` (`../types.ts`) draws for locale, and the same
 * plain-opaque-string pattern `Claim.factRef`/`CopyEntry.factRef` draw for
 * `strategy`'s facts registry. This package does NOT define what a channel
 * IS, does not enumerate valid channels, and never interprets one beyond an
 * exact string-equality comparison against `VoiceCheckOptions.channel` (see
 * `checker.ts`) — that taxonomy is entirely consumer policy. Validated for
 * SHAPE only (a non-empty, non-whitespace-only string) — see `schema.ts`'s
 * `validateChannelShape`.
 */
export type VoiceChannel = string;

// ---------------------------------------------------------------------------
// Severity — three tiers, and what each one means for CI
// ---------------------------------------------------------------------------

/**
 * Three severity tiers, replacing the previous two-value `"error" | "warning"`
 * union (still both present, unchanged in meaning — this is a strictly
 * additive change; see `VOICE_SEVERITIES`' own note on backward
 * compatibility). Every tier is reported identically in `VoiceFinding[]`;
 * what differs is what a CALLER should do with each one, which this package
 * documents explicitly rather than leaving implicit (see the README,
 * "Severity tiers and the exit-code mapping"):
 *
 *   - `"error"` — FAILS CI. This package's own documented idiom
 *     (`report.findings.some(f => f.severity === "error")`) treats this,
 *     and only this, tier as build-breaking. Unchanged from before this
 *     addition: every finding this package's OWN dimensions (glossary,
 *     person, claims) already produced at `"error"` still does.
 *   - `"warning"` — fails only a NARROWER, editorial gate — a stricter,
 *     consumer-owned check (e.g. "block merge to a marketing branch", "flag
 *     for a copy reviewer") that is not this package's CI idiom and that
 *     this package does not implement. The tense dimension already produces
 *     `"warning"` findings; nothing about their behavior changes here — this
 *     is a documentation clarification of a name that was already in use,
 *     not a new runtime behavior for existing findings.
 *   - `"advisory"` — purely informational. Never fails anything, including
 *     the narrower editorial gate above. Exists so a genuinely optional
 *     style nudge (worth a human's attention, never worth blocking on) has
 *     a home that isn't a `"warning"` a consumer's own tooling might
 *     mistakenly treat as gate-worthy.
 *
 * Only `PatternRule.severity` (below) requires an author to pick one of
 * these explicitly today — every other dimension's severity remains
 * hardcoded by `checker.ts`, exactly as before.
 */
export type VoiceSeverity = "error" | "warning" | "advisory";

/** The valid `VoiceSeverity` values, in documented-precedence order (most to least CI-blocking). See `FORMALITY_LEVELS`'s doc comment for why this is a list, not a repeated literal check. */
export const VOICE_SEVERITIES: readonly VoiceSeverity[] = ["error", "warning", "advisory"];

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
// Pattern rules — regex alongside literal glossary terms
// ---------------------------------------------------------------------------

/**
 * A regex pattern, serialized as its two `RegExp` constructor arguments —
 * NEVER a real `RegExp` instance — because a `VoiceRecord` is checked-in
 * JSON data, not code: `JSON.stringify`/`JSON.parse` round-trips a `RegExp`
 * as `{}`, silently losing both the source and the flags. This package
 * stores the two strings a `new RegExp(source, flags)` call actually needs,
 * and constructs the real object only at validation/check time — see
 * `internal/pattern-safety.ts`.
 */
export interface VoicePattern {
  /**
   * The regex source, e.g. `"\\u2014"` for a hard em-dash ban, or
   * `"\\b(deep dive|dive deep)\\b"` for alternation, or `"\\bit'?s\\b"` for
   * an optional apostrophe. Never includes the enclosing `/.../` delimiters
   * — this is `RegExp`'s own `source` argument. Restricted at validation
   * time — see `internal/pattern-safety.ts`'s top doc comment for the full,
   * documented regex-safety gate this package applies before ever
   * constructing a real `RegExp` from this string.
   */
  source: string;
  /**
   * Regex flags, restricted to a safe, documented subset (`i`, `u`, `s` —
   * see `internal/pattern-safety.ts`). Omit for no flags. Never include `g`
   * or `y`: this package always does its own match-counting pass and never
   * accepts a caller-supplied global/sticky flag — see that file's doc
   * comment for why.
   */
  flags?: string;
}

/**
 * A regex-based voice rule — the alternation, optional-apostrophe, and
 * punctuation-ban gaps `GlossaryEntry`'s literal term matching cannot
 * express (see the README, "Pattern rules vs. the glossary"). A hard
 * character ban (a U+2014 em dash, say) is just a pattern with no
 * alternation at all — `PatternRule` subsumes that case rather than this
 * package growing a second, distinct "punctuation rule" type.
 *
 * SAFETY. `pattern` is caller-supplied regex, which can hang a scanner via
 * catastrophic backtracking if accepted unbounded. This package's position:
 * bound the pattern AT REGISTRATION TIME, never at run time — there is no
 * runtime timeout anywhere in this package. See
 * `internal/pattern-safety.ts`'s top doc comment for the full, honest
 * accounting of exactly what is rejected and what known gap remains.
 * `schema.ts`'s `validateVoiceRecordShape` and `checker.ts`'s `checkCopy`
 * BOTH run this gate — the former at registration, the latter as
 * defense-in-depth, since `checkCopy` does not otherwise trust its
 * `VoiceRecord` argument (see that file's own doc comment). Either way, a
 * pattern that fails this gate is reported as a real, unmissable,
 * non-waivable `"pattern:invalid-rule"` finding — never a silent skip. See
 * the `types.ts` header comment's core rule: a check that cannot run must
 * fail, not pass.
 */
export interface PatternRule {
  id: string;
  description: string;
  pattern: VoicePattern;
  severity: VoiceSeverity;
  /** Required — an unauditable pattern rule is exactly the mistake `GlossaryEntry.reason` already guards against. */
  reason: string;
  /** Suggested replacement, shown in a finding's message. */
  alternative?: string;
  /** See `VoiceChannel`'s doc comment. Omitted (the default) means this rule applies regardless of channel. */
  channel?: VoiceChannel;
}

// ---------------------------------------------------------------------------
// VoiceRecord — one consumer's bound values
// ---------------------------------------------------------------------------

/**
 * One consumer's complete, bound voice: an identifier, its rules, its
 * glossary, its claims register, and (optionally) its regex pattern rules.
 * This is the "brand.css" of this package — foundry ships the schema this
 * conforms to, never a real instance of it. See README, "The single most
 * important constraint".
 *
 * `patterns` is OPTIONAL AT THE TYPE LEVEL — unlike `glossary`/`claims`,
 * which are required fields that `validateVoiceRecordShape` merely treats
 * leniently (`undefined` defaults to `[]`) — specifically so every existing
 * `VoiceRecord` object literal anywhere (this package's own tests, a
 * consumer's already-written code) keeps compiling unchanged. Runtime
 * behavior is identical to `glossary`/`claims` either way: omitted means
 * `[]`, once a value has passed through `parseVoiceRecord`/`buildVoiceRecord`
 * (`schema.ts`). See `checker.ts` for why `checkCopy` itself still reads it
 * as `record.patterns ?? []`, since it does not require a `VoiceRecord` to
 * have been built via `parseVoiceRecord` first.
 */
export interface VoiceRecord {
  id: string;
  rules: VoiceRules;
  glossary: GlossaryEntry[];
  claims: Claim[];
  patterns?: PatternRule[];
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
  /** See `VoiceSeverity`'s own doc comment for what each of the three tiers means for CI and for a narrower editorial gate. */
  severity: VoiceSeverity;
  /** Human-readable description of the problem. */
  message: string;
  /** The specific term/pronoun/marker/claim/pattern id this finding is about, when there is a single clear one. */
  path?: string;
}
