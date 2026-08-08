/**
 * The bindable/fixed split for `VoiceRecord` — the `TokenDefinition.brandable`
 * analog for this package. See `@vespeneventures/tokens`' `src/tokens.ts` for
 * the model this file ports.
 *
 * WHERE THE LINE ACTUALLY FALLS (a finding, not an assumption)
 * ---------------------------------------------------------------------------
 * In `tokens`, the split runs WITHIN one flat namespace: `styles/tokens.css`
 * declares 154 real CSS custom properties, and only 42 of them are
 * `brandable: true` — the other 112 (spacing, the type ramp, z-index,
 * duration, easing, breakpoints, the neutral ramp, ...) are declared with a
 * real value and STAY that value for every brand, forever. Both the
 * brandable and the non-brandable tokens live in the same file, the same
 * `TOKENS` record, distinguished only by the boolean.
 *
 * `VoiceRecord` does not have that shape, and pretending it does would be
 * dishonest. Every field a `VoiceRecord` instance actually carries — `id`,
 * both rules' `description`s, `forbiddenPronouns`, `forbiddenMarkers`,
 * `formality`, `tone`, `glossary`, `claims` — is content one specific
 * consumer authors: there is no field here that ships a working default
 * value and stays that value for every voice the way `--spacing-lg: 16px`
 * does for every brand. `VoiceRecord` IS the consumer-owned binding layer in
 * its entirety, the same way `brand.css` is: nothing in `brand-template.css`
 * is "shipped, leave it alone" either — every slot IN that file is
 * `bindable`, by construction, because only the bindable slots were ever
 * put in the template in the first place. The non-brandable 112 in `tokens`
 * live in `tokens.css`, a different file `brand-template.css` never touches;
 * `VoiceRecord`'s analog of that other file is `types.ts` and `schema.ts` —
 * TypeScript interfaces and string-literal unions, not runtime record
 * fields at all.
 *
 * So the split for voice runs BETWEEN two files, not within one:
 *
 *   FIXED (rule KINDS — never appear below, never appear in the template,
 *   shipped once in `types.ts`, identical for every consumer forever):
 *     - the shape of `VoiceRules` itself — that a voice has exactly a
 *       `person` rule, a `tense` rule, a `formality` axis, and a `tone`
 *       axis, no more, no fewer;
 *     - `FormalityLevel`'s three possible values (`"casual"`, `"neutral"`,
 *       `"formal"`) and `GlossaryStatus`'s two (`"forbidden"`,
 *       `"preferred"`) — the ENUM, not which member a given entry picks;
 *     - the field set of `PersonRule`, `TenseRule`, `GlossaryEntry`, and
 *       `Claim` — that a glossary entry has a `term`/`status`/`reason`/
 *       `alternative`/`caseSensitive` and nothing else, for instance.
 *
 *   BINDABLE (rule VALUES — every entry below, every one `true`, all
 *   consumer-owned, all present in `voice-record.template.jsonc`):
 *     - which pronouns are forbidden, which tense markers, which specific
 *       terms are forbidden or preferred and why, which claims are
 *       registered and whether each needs a `factRef` — the actual data
 *       that fills the fixed shape above, one consumer's own.
 *
 * This file catalogs only the second half — the runtime fields of a
 * `VoiceRecord` instance — because those are the only things a template can
 * meaningfully hold a fill-in-the-blank for. It is `Readonly<Record<...>>`,
 * every entry `bindable: true`, deliberately: `src/field-coverage.test.ts`
 * still runs a two-way check against it (and a third, currently-vacuous but
 * future-guarding check that no `bindable: false` entry is ever live in the
 * template), the same shape as `tokens`' `brand-coverage.test.ts`, so that
 * if a future field is ever added here as `bindable: false`, the existing
 * tests immediately start meaning something rather than needing to be
 * written from scratch.
 *
 * A LEAF, NOT A TREE — WHY ARRAYS STOP HERE
 * ---------------------------------------------------------------------------
 * `glossary` and `claims` are each catalogued as ONE path, not expanded
 * into their per-entry fields (`glossary.term`, `glossary.reason`, ...).
 * Both are variable-length collections of consumer-authored records — the
 * PER-ENTRY shape (`GlossaryEntry`, `Claim`) is the FIXED half described
 * above, already enumerated once in `types.ts`; re-stating it here as
 * catalog entries would just be a second, driftable copy of the same
 * interface. What's bindable about `glossary` and `claims` is that the
 * ARRAY exists and a consumer populates it — exactly what one path each,
 * marked `bindable: true`, records.
 */

/** One runtime field path of a `VoiceRecord` instance, and its bindable/fixed classification. */
export interface VoiceFieldDefinition {
  /** Dot-path from the record root, e.g. `"rules.person.forbiddenPronouns"`. Array-valued fields stop here — see this file's header comment, "A leaf, not a tree". */
  readonly path: string;
  /**
   * `true` for every entry in this catalog: a rule VALUE, consumer-owned,
   * expected to appear in `voice-record.template.jsonc`. See this file's
   * header comment for why no `VoiceRecord` field is ever `false` here, and
   * where the fixed half of this package's contract actually lives instead.
   */
  readonly bindable: boolean;
  /** Human-readable note on what this slot holds. */
  readonly description: string;
}

/**
 * Every runtime field path a `VoiceRecord` instance carries, keyed by that
 * same path. `src/field-coverage.test.ts` asserts, in both directions, that
 * this set and `templates/voice-record.template.jsonc`'s own set of paths
 * are identical.
 */
export const VOICE_FIELDS: Readonly<Record<string, VoiceFieldDefinition>> = {
  id: {
    path: "id",
    bindable: true,
    description: "This voice's own identifier, e.g. the product or repo it belongs to.",
  },
  "rules.person.description": {
    path: "rules.person.description",
    bindable: true,
    description: "Human-readable statement of the person rule, e.g. \"second-person, you-voice\".",
  },
  "rules.person.forbiddenPronouns": {
    path: "rules.person.forbiddenPronouns",
    bindable: true,
    description: "The word list `checkCopy` actually scans for — pronouns that contradict the person rule.",
  },
  "rules.tense.description": {
    path: "rules.tense.description",
    bindable: true,
    description: "Human-readable statement of the tense rule, e.g. \"present tense, no future promises\".",
  },
  "rules.tense.forbiddenMarkers": {
    path: "rules.tense.forbiddenMarkers",
    bindable: true,
    description: "The word list `checkCopy` actually scans for — tense markers that contradict the tense rule.",
  },
  "rules.formality": {
    path: "rules.formality",
    bindable: true,
    description: "Which `FormalityLevel` this voice picks. Descriptive only — never read by `checkCopy`.",
  },
  "rules.tone": {
    path: "rules.tone",
    bindable: true,
    description: "Free-text tone descriptors, e.g. [\"warm\", \"direct\", \"no jargon\"]. Descriptive only.",
  },
  glossary: {
    path: "glossary",
    bindable: true,
    description: "This voice's own forbidden/preferred term list. Per-entry shape (`GlossaryEntry`) is fixed; the entries themselves are this consumer's own.",
  },
  claims: {
    path: "claims",
    bindable: true,
    description: "This voice's own claims register. Per-entry shape (`Claim`) is fixed; the entries themselves are this consumer's own.",
  },
};

/**
 * The literal placeholder value `voice-record.template.jsonc` uses for every
 * bindable string slot. Loud and specific on purpose — see
 * `checker.ts`'s `findPlaceholderPaths` for why an unmissable, near-zero-
 * collision sentinel is exactly what makes the unbound signal trustworthy:
 * a real voice's copy of the template that forgot to fill in even one slot
 * still trips it, and nothing a real consumer would plausibly type by
 * coincidence ever does.
 */
export const TEMPLATE_PLACEHOLDER = "REPLACE_ME__VOICE_TEMPLATE_PLACEHOLDER";
