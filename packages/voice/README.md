# @vespeneventures/voice

The verbal contract: the exact peer of `@vespeneventures/tokens`, one layer
over. Tokens is the visual contract — what things look like. Voice is the
verbal contract — how things sound. Same layer, same shape, same
machinery-vs-values split — now including that package's other half too:
a template a consumer copies and fills in, a two-way coverage test that
keeps the template honest, and an unbound signal so a voice can't ship
silently unbranded the way an interface can't ship silently unstyled.

```bash
npm install @vespeneventures/voice
```

## The single most important constraint

**foundry ships the machinery; each consumer repo ships its own values.**
Four different products can have four different voices. This package ships
a schema, validators, a template, and a checker — never anyone's actual
voice.

There is no example voice content shipped in `src/` beyond obviously
fictional fixtures inside `*.test.ts` files (a placeholder called "Acme",
never a real company, product, person, or domain), and the one template
this package does ship (`voice-record.template.jsonc`) fills every slot
with a loud, structural placeholder — never a plausible-looking example
value; see "The template" below for why that distinction matters. Binding a
real voice — real forbidden words, real claims, a real tone — is a consumer
repo's job, the same way `@vespeneventures/tokens` ships a neutral
greyscale contract and leaves the real colors to a consumer's own
`brand.css`. See that package's README, "The three-layer contract", for the
fuller version of this argument; this package's version of it is the same
argument, one layer over:

```
the VoiceRecord shape   machinery      types.ts + schema.ts, this package
voice-record.template.jsonc  binding template  fields.ts's bindable slots, blank — this package
your voice record        binding value  your rules, your glossary, your claims, your own repo
your copy                 consumer layer  the actual writing this checker evaluates
```

## The bindable/fixed split

The line falls the same place `@vespeneventures/tokens`' `brandable: boolean`
draws it, but between two FILES here rather than within one:

- **Rule KINDS — fixed, shipped once in `src/types.ts`, never a
  fill-in-the-blank.** That a voice has exactly a `person` rule and a
  `tense` rule and nothing else; that `formality` is one of exactly three
  values (`FormalityLevel`) and a glossary entry's `status` is one of
  exactly two (`GlossaryStatus`); that a claim has exactly
  `id`/`text`/`matchPhrases`/`factRef`/`requiresSupport` and no more
  fields. Every consumer gets the identical shape, forever — the same role
  `tokens.css`'s namespace/family structure plays.
- **Rule VALUES — bindable, consumer-owned, catalogued in `src/fields.ts`'s
  `VOICE_FIELDS` and present in `voice-record.template.jsonc`.** Which
  pronouns are forbidden, which tense markers, which terms are forbidden or
  preferred and why, which claims are registered and whether each needs a
  fact — the actual data that fills the fixed shape above, one consumer's
  own.

**A finding, not an assumption:** unlike `tokens.css`, where only 42 of 154
declared tokens are `brandable: true` (the rest — spacing, the type ramp,
z-index, duration, easing, breakpoints — stay their shipped value for every
brand), **every single entry in `VOICE_FIELDS` is `bindable: true`.** There
is no `VoiceRecord` field that ships a working default and is meant to stay
that value across every voice; `VoiceRecord` IS the consumer-owned binding
layer in its entirety, the same way nothing in `brand-template.css` is
"shipped, leave it alone" either. The fixed half of this package's contract
isn't a subset of `VoiceRecord`'s own fields at all — it's the type system
that shapes them, in a different file, checked by `tsc` rather than by a
runtime `bindable` flag. `src/fields.ts`'s header comment has the full
account of why the split runs there instead of inside one flat namespace.

## The template

`voice-record.template.jsonc` is `VoiceRecord`'s analog of
`brand-template.css`: copy it, fill it in, never ship it unedited.

```bash
cp node_modules/@vespeneventures/voice/voice-record.template.jsonc \
   src/voice/acme-app.voice.jsonc
```

**Format: JSONC, not plain JSON or a `.ts` literal.** JSON alone can't carry
the fill-in-the-blank commentary a template like this needs to be usable —
`brand-template.css`'s value comes largely from its per-slot comments, and
this package's template needs the same. A `.ts` module could carry comments
too, but would need to export a real (if partial) `VoiceRecord`-shaped
value, forcing every placeholder to already satisfy the type checker —
`formality` couldn't hold a loud sentinel string, only a real
`FormalityLevel`. JSONC keeps the file inert, human-and-machine-readable
data (a consumer's own tooling, or a non-JS pipeline, can read it without
touching this package's TypeScript at all) while still allowing exactly the
annotated, human-facing style `brand-template.css` uses.
`src/internal/parse-template.ts` hand-rolls the (string-aware) comment
stripping this needs, the same call `@vespeneventures/tokens` makes for
its own CSS parsing rather than adding a dependency for it.

Only the nine bindable slots from `VOICE_FIELDS` appear: `id`,
`rules.person.description`, `rules.person.forbiddenPronouns`,
`rules.tense.description`, `rules.tense.forbiddenMarkers`,
`rules.formality`, `rules.tone`, `glossary` (one example entry), and
`claims` (one example entry). Every fixed rule-KIND field name
(`person`/`tense`/`formality`/`tone` as keys, `status`'s two values, a
claim's five field names) appears only as real, valid structure — never as
something to fill in.

## A two-way coverage test

`src/field-coverage.test.ts` is the direct port of `@vespeneventures/tokens`'
own `src/brand-coverage.test.ts`, run against `VOICE_FIELDS` and the real
template file instead of `TOKENS` and `brand-template.css`:

1. Every field marked `bindable: true` in `VOICE_FIELDS` appears in
   `voice-record.template.jsonc`.
2. The template names no field this package doesn't declare — catches a
   stale or typo'd slot (a renamed field whose old path was never removed)
   that would otherwise be harmless JSON and go unnoticed.
3. No `bindable: false` field is present in the template — currently
   vacuous (every entry is `bindable: true`, see "The bindable/fixed
   split" above), kept anyway so the day a field IS ever added as
   `bindable: false`, this assertion is already meaningful.

## Two halves, and the second justifies the first

A schema nobody reads is dead metadata — this repository has already
deleted an earlier package for exactly that failure: it validated six
fields that were all mechanically re-derivable from data already present
elsewhere, so its own checks could never produce a real finding. So this
package ships two halves on purpose:

1. **The schema** (`src/types.ts`, `src/schema.ts`) — plain TypeScript
   types for a voice's rules, glossary, and claims register, plus
   `validateVoiceRecordShape`/`parseVoiceRecord` (hand-rolled type-guard
   validators, in the style of `@vespeneventures/policy`'s own
   `validate.ts` — see "Requirements" for why this package carries no
   schema-library dependency) to check candidate data against it. Pure
   data and validation. No React, no IO, no network.
2. **The checker** (`src/checker.ts`) — `checkCopy`, which actually reads
   the schema it's given and reports real violations in a real piece of
   copy. This is what proves the schema is not decoration.

## Usage

```ts
import { checkCopy, type VoiceRecord } from "@vespeneventures/voice";

// A consumer repo owns this — never this package. "Acme" here is an
// obviously fictional placeholder, the same one already used in this
// repository's own packages/ui README.
const acmeVoice: VoiceRecord = {
  id: "acme-app",
  rules: {
    person: { description: "second-person, you-voice", forbiddenPronouns: ["I", "me", "my"] },
    tense: { description: "present tense, no future promises", forbiddenMarkers: ["will", "shall"] },
    formality: "neutral",
    tone: ["direct", "no jargon"],
  },
  glossary: [
    { term: "revolutionary", status: "forbidden", reason: "overused buzzword", alternative: "new" },
  ],
  claims: [
    { id: "fast-sync", text: "fastest sync in its class", matchPhrases: [], requiresSupport: true },
  ],
};

const report = checkCopy(acmeVoice, "Our revolutionary new dashboard will change everything.");

for (const finding of report.findings) {
  console.error(`[${finding.severity}] ${finding.rule}: ${finding.message}`);
}
if (!report.complete) {
  console.error(`warning: ${report.skipped.length} dimension(s) were not checked this run`);
}
if (report.findings.some((f) => f.severity === "error")) process.exitCode = 1;
```

## What `checkCopy` actually catches

Only what is genuinely mechanical. Tone is not mechanically checkable — a
checker that claimed to verify "warmth" would be lying, so this one does
not attempt it. What it does check, all driven by explicit, auditable word
lists rather than any grammar/NLP guesswork:

- **Forbidden glossary terms.** Every `glossary` entry with
  `status: "forbidden"` is searched for in the copy, whole-word,
  case-insensitive by default (per-entry `caseSensitive: true` available).
  `"preferred"` entries are **not** actively enforced — detecting "did the
  writer use the sanctioned synonym instead of a forbidden one" would
  require real paraphrase/synonym detection, and this package does not
  attempt that. A `"preferred"` entry exists for a human reader's benefit,
  and, indirectly, by being the `alternative` a forbidden entry points to.
- **Wrong person, wrong tense, where it's a word-list violation.**
  `rules.person.forbiddenPronouns` and `rules.tense.forbiddenMarkers` are
  plain word lists a consumer supplies — not this package inferring
  grammar from a `"second-person"` enum. If `forbiddenPronouns` includes
  `"we"` and copy contains "we", that's a finding; that's the entire
  mechanism. This is deliberately the same mechanism the glossary check
  uses, not a second, differently-shaped piece of pseudo-grammar logic.
  Matching is case-insensitive, with one automatic exception: a single
  uppercase letter (in practice, `"I"`) is matched case-sensitively, so a
  `forbiddenPronouns: ["I"]` rule does not also fire on a stray lowercase
  `"i"` (a roman numeral, a loop variable in quoted code) that isn't the
  pronoun at all — see `checker.ts`'s `isSingleUppercaseLetter`. Genuine
  grammatical tense parsing is not attempted — see "What it does not
  attempt" below.
- **Unsupported claims.** Each `claims` entry with `requiresSupport: true`
  (the default) and no `factRef` is checked against the copy: if the
  claim's `text` (or one of its `matchPhrases`, when given) appears
  verbatim, case-insensitively, that's a finding. A claim that DOES carry
  a `factRef` is never flagged here — whether that `factRef` actually
  resolves to a real fact is explicitly out of scope; see "The `factRef`
  seam" below.

## What it deliberately does not attempt

Said plainly, because over-claiming here would be worse than a small,
honest scope:

- **Tone, warmth, "brand feel".** `rules.tone` and `rules.formality` are
  metadata for a human writer or reviewer. `checkCopy` never reads either
  field. There is no mechanical proxy for "does this sound warm" that this
  package is willing to claim works.
- **Real grammatical tense parsing.** `tense.forbiddenMarkers` is a word
  list, not a parser. It catches "this copy contains the literal word
  'will'", not "this sentence is grammatically in the future tense" — a
  sentence can be future tense without "will" (and can contain "will" as
  a noun, not a modal auxiliary). If a consumer needs finer control than a
  word list gives, that precision has to live in a glossary entry (which
  supports per-term `caseSensitive`) or be accepted as a limit.
- **Paraphrase / synonym detection**, for both the glossary's `"preferred"`
  entries and the claims register's phrase matching. Only the literal
  strings configured are ever searched for.
- **Whether a `factRef` actually resolves to a real fact.** See below.
- **Distinguishing a forbidden word used in the voice's own writing from
  the same word appearing inside a quotation, a customer testimonial, or
  code.** Word-boundary matching cannot tell those apart; see "False
  positives and the waiver escape hatch" below for the intended way to
  handle a legitimate exception. (The one deliberate, narrow exception to
  this general limit is the single-uppercase-letter case-sensitivity rule
  described above, which closes the one specific instance of this gap —
  `"I"` vs. a stray `"i"` — that was common enough, and cheap enough to
  fix precisely, to be worth a special case rather than a documented limit.)

## The `factRef` seam

A sibling `strategy` package (not built by this package, and not a
dependency of it) is expected to eventually carry a `facts` registry. A
claim in this package's claims register should, in the fullness of time,
be traceable to one of those facts.

`Claim.factRef` is that seam: a **plain, optional string** — never a typed
import, never a runtime dependency on `strategy`. `checkCopy` only checks
whether `factRef` is *present*; it never resolves it, never validates that
it names a real fact, and never imports anything to do so. Resolving
`factRef` values against a real facts registry is a **later gate's** job —
one with visibility into both a `VoiceRecord`'s claims and a `strategy`
package's facts, which this package deliberately does not have.

This is the same kind of seam `@vespeneventures/tokens` draws between
itself and a consumer's `brand.css`: the coupling there is a CSS custom
property *name*, not a code import, so `tokens.css` never depends on any
one consumer's brand. Here, the coupling is an opaque string convention
(`factRef`), not a code import, so `@vespeneventures/voice` never depends
on `strategy` — which also means this package works today, before
`strategy` exists at all, and will keep working unchanged after it does.

`auditClaimsRegister(claims)` is the one place this package looks at
`factRef` presence outside of `checkCopy`'s copy-scanning: a pure,
copy-free audit of a claims register, flagging every claim that requires
support but has no `factRef` set at all yet. Useful as a standing "is this
register itself complete" check, run on its own, separate from "did THIS
piece of copy make an unsupported claim".

## Fails closed

Three situations that could otherwise look like "nothing was wrong" are
instead surfaced as an explicit, visible incompleteness or an explicit,
unmissable error — never as a silent, empty-`findings` pass. This
repository's own history has more than one gate that looked clean only
because it never ran; this package does not repeat that:

- **Empty (or whitespace-only) `copy`.** All four dimensions are recorded
  in `skipped`, not run — `findings` is `[]` for a reason `report.complete`
  and `report.skipped` make visible, not because the copy was judged clean.
- **A dimension with nothing configured** (an empty glossary, no
  `forbiddenPronouns`, no `forbiddenMarkers`, no `claims`) is recorded in
  `skipped` with its own reason, rather than silently contributing zero
  findings to what would otherwise read as a clean run. Other, configured
  dimensions still run normally in the same call.
- **`record` is still (partly) an unedited copy of the template.** See
  "The unbound signal" below — this one produces its own unwaivable error
  finding, not merely an entry in `skipped`.

`report.complete` is `true` exactly when `report.skipped` is empty —
mirroring `@vespeneventures/gates`' `FoundationReport.complete` — so a
caller can ask "did this report actually check everything it could have"
with one boolean read, the same discipline that package holds to.
`report.bound` is the analogous read for the third case.

## The unbound signal

`@vespeneventures/tokens` has a visual answer to "did anyone bind this
yet": import only `tokens.css` and the page renders in visible grey, plus a
literal dev-mode badge (`html:not([data-brand-bound])::before`), until
`data-brand-bound` is set. Copy has no pixels to fall back to — there's no
"render this text in grey" — so this package's answer is the honest analog
for data instead of paint: **every bindable slot in
`voice-record.template.jsonc` is filled with one specific, loud, exported
sentinel, `TEMPLATE_PLACEHOLDER` (`"REPLACE_ME__VOICE_TEMPLATE_PLACEHOLDER"`,
from `fields.ts`), never a plausible-looking example value.** A
plausible-looking placeholder (a real-sounding pronoun, a real-sounding
claim) is exactly what would let an unbound voice happen to pass — it would
be indistinguishable from a deliberately-authored record that just happens
to match the example. A structurally unmistakable one can't be.

`checkCopy` scans every string reachable in `record` — recursively, the
same way it scans `copy` — for exact equality with `TEMPLATE_PLACEHOLDER`.
Two things happen if it finds even one, both unconditionally, whether or
not `copy` is even given:

1. `report.bound` is `false`.
2. An `"error"`-severity `"voice:unbound-placeholder"` finding is pushed
   into `report.findings` for **each** slot still carrying it — not merely
   a flag a caller has to remember to check separately.

**Why the finding, not just the boolean:** this package's own Usage example
above already tells every caller to do
`if (report.findings.some(f => f.severity === "error")) process.exitCode = 1;`.
An unbound record fails that exact, pre-existing, idiomatic check on its
own — no second code path to add, no way to accidentally ship a build that
only checked `report.complete` and missed `report.bound`. This is the
deliberate design choice, and the reason it's a design choice rather than
an assumption: an unbound voice must never look like a bound one that
happens to pass, and the only way to guarantee that against a caller who
does the bare minimum (checks `findings` for an error) is to make the
unbound signal show up exactly there.

**Why it cannot be waived.** `"voice:unbound-placeholder"` findings are
kept out of the waiver-matching loop entirely — supplying a waiver with
`rule: "voice:unbound-placeholder"` does nothing (and is itself reported as
`"waiver:unused"`, since it genuinely never matches). Every other finding
this function produces is a judgment call a reviewer can legitimately
override with a reason (a forbidden term quoted from a review, a claim
phrase inside a testimonial); an unbound record isn't a judgment call, it's
a structural precondition, the same category as the `TypeError`s `checkCopy`
throws for a non-string `copy` or non-object `record` — also not waivable.
Allowing a waiver to remove this finding would reopen the exact gap this
whole mechanism exists to close.

## False positives and the waiver escape hatch

Word-boundary matching over free-text copy will produce false positives —
a forbidden term quoted from a customer review, a claim phrase that shows
up inside a direct quotation, a tense marker used as an unrelated part of
speech ("will" the noun, not "will" the auxiliary verb). A checker that
fires constantly on legitimate copy gets disabled entirely, which is worse
than never having shipped it. `checkCopy`'s second `options` argument
accepts `waivers`, an explicit, narrowly-scoped, auditable exception
mechanism:

```ts
checkCopy(acmeVoice, copy, {
  waivers: [
    { rule: "glossary:forbidden-term", match: "revolutionary", reason: "quoting a customer review verbatim" },
  ],
});
```

- A waiver matches exactly one `rule` **and** the exact `path` of the
  finding it covers (one specific term, pronoun, marker, or claim id) —
  never a whole dimension, never the whole run. There is no "ignore
  everything" option.
- `reason` is **required and must be non-empty**. A waiver missing one is
  rejected outright as its own `"waiver:invalid"` error finding and is
  never applied — a waiver with no stated reason is not silently honored.
- A waived finding is moved to `report.waived`, not deleted — it stays
  fully visible, with the waiver (including its `reason`) attached, so a
  reviewer can audit every exception a piece of copy is relying on.
- A waiver that matches nothing in a given run produces its own
  `"waiver:unused"` **warning** finding. This keeps waivers from silently
  rotting: if the copy that needed an exception gets rewritten, the
  now-pointless waiver is surfaced instead of quietly doing nothing
  forever.

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `checkCopy(record, copy, options?)` | function | The checker. Reports `VoiceFinding`s for forbidden glossary terms, forbidden person/tense markers, unsupported claims found in `copy`, and — unconditionally, regardless of `copy` — any bindable field of `record` still carrying `TEMPLATE_PLACEHOLDER` (`"voice:unbound-placeholder"`, unwaivable). Pure — no I/O. Throws a plain `TypeError` for a non-string `copy` or non-object `record` (a caller-input problem, not a finding). Fails closed on empty copy, on unconfigured dimensions, and on an unbound `record` — see "Fails closed" and "The unbound signal" above. Returns a `VoiceCheckReport`. |
| `auditClaimsRegister(claims)` | function | Pure, copy-free audit of a `Claim[]`: one `"claim:missing-fact-ref"` warning per claim that requires support (`requiresSupport: true`, the default) but has no `factRef`. `[]` for an empty register — an empty claims register is not itself a defect. |
| `validateVoiceRecordShape(value)` | function | Hand-rolled structural validation (plain `typeof`/shape checks, no schema library — see "Requirements"), in the style of `@vespeneventures/policy`'s `validateBindingShape`. Returns a `VoiceFinding[]` with descriptive rule ids (`"id-shape"`, `"glossary-status-shape"`, `"claim-fact-ref-shape"`, etc. — see `schema.ts` for the full list), always `"error"` severity. `[]` means `value` is a well-formed `VoiceRecord`, once defaults are applied. Never throws, on any input. |
| `parseVoiceRecord(value)` | function | Same validation as `validateVoiceRecordShape`, but throws a plain `Error` (listing every issue) instead of returning findings — for a fail-fast config-loading call site. Returns a `VoiceRecord` with this schema's defaults applied (`glossary: []`, `claims: []`, `tone: []`, `forbiddenPronouns: []`, `forbiddenMarkers: []`, `matchPhrases: []`, `caseSensitive: false`, `requiresSupport: true`) on success. |
| `FORMALITY_LEVELS` | constant | `readonly FormalityLevel[]` — `["casual", "neutral", "formal"]`, in declaration order. Exported as a list (mirroring `@vespeneventures/policy`'s `DIGEST_ALGORITHMS`) so `schema.ts` never hardcodes these as a second, separately-maintained literal check. |
| `GLOSSARY_STATUSES` | constant | `readonly GlossaryStatus[]` — `["forbidden", "preferred"]`, in declaration order. Same reasoning as `FORMALITY_LEVELS`. |
| `VOICE_FIELDS` | constant | `Readonly<Record<string, VoiceFieldDefinition>>` — every runtime field path a `VoiceRecord` instance carries, each `bindable: true`. See "The bindable/fixed split" and `src/fields.ts`'s header comment. |
| `TEMPLATE_PLACEHOLDER` | constant | `"REPLACE_ME__VOICE_TEMPLATE_PLACEHOLDER"` — the exact sentinel `voice-record.template.jsonc` fills every bindable slot with, and the value `checkCopy` scans `record` for. See "The unbound signal". |
| `VoiceRecord` | type | `{ id, rules, glossary, claims }`. What a consumer's whole bound voice must conform to. |
| `VoiceRules` | type | `{ person, tense, formality, tone }` — see `PersonRule`/`TenseRule`/`FormalityLevel`. |
| `PersonRule` | type | `{ description: string, forbiddenPronouns: string[] }`. `description` is for humans; `forbiddenPronouns` is the only part `checkCopy` evaluates. |
| `TenseRule` | type | `{ description: string, forbiddenMarkers: string[] }`. Same shape and same honesty as `PersonRule` — see "What it deliberately does not attempt". |
| `FormalityLevel` | type | `"casual" \| "neutral" \| "formal"`. Descriptive only; never read by `checkCopy`. |
| `GlossaryEntry` | type | `{ term, status, reason, alternative?, caseSensitive }`. See `GlossaryStatus`. |
| `GlossaryStatus` | type | `"forbidden" \| "preferred"`. Only `"forbidden"` entries are actively scanned for — see "What `checkCopy` actually catches". |
| `Claim` | type | `{ id, text, matchPhrases, factRef?, requiresSupport }`. See "The `factRef` seam". |
| `VoiceFinding` | type | `{ rule, severity: "error" \| "warning", message, path? }` — deliberately the same shape as `@vespeneventures/policy`'s own `Finding`, defined fresh here (this package has zero runtime dependency on `policy`). |
| `VoiceFieldDefinition` | type | `{ path, bindable, description }` — one entry of `VOICE_FIELDS`. The `TokenDefinition` analog. |
| `VoiceCheckReport` | type | `{ findings, waived, skipped, ran, complete, bound }` — what `checkCopy` returns. `complete` is `true` exactly when `skipped` is empty; `bound` is `true` exactly when `record` carried no `TEMPLATE_PLACEHOLDER` value. |
| `VoiceCheckOptions` | type | `{ waivers?: VoiceCheckWaiver[] }` — `checkCopy`'s third argument. |
| `VoiceCheckWaiver` | type | `{ rule, match, reason }` — one explicit, auditable exception. See "False positives and the waiver escape hatch". Cannot target `"voice:unbound-placeholder"` — see "The unbound signal". |
| `WaivedVoiceFinding` | type | A `VoiceFinding` plus the `VoiceCheckWaiver` that covered it. What `report.waived` holds. |
| `VoiceCheckDimension` | type | `"glossary" \| "person" \| "tense" \| "claims"`. |
| `VoiceDimensionSkip` | type | `{ dimension, reason }` — one entry of `report.skipped`. |

## Non-goal: resolving `factRef`

This package defines the seam and checks that a claim requiring support
carries *a* `factRef` (`auditClaimsRegister`) or does not make an
unsupported claim in given copy (`checkCopy`). It never validates that a
`factRef` string actually names a real fact in any registry, and never
will — that check needs visibility into both this package's claims and a
`strategy` package's facts, which is a different, deliberately separate
tool's job, the same way `@vespeneventures/gates`' README draws its own
"Non-goal: content safety" line around what it will never attempt either.

## Requirements

Node 20+. ESM only. **No runtime dependencies.** This follows this
repository's own precedent, not just a preference: `@vespeneventures/catalog`,
`@vespeneventures/policy`, and `@vespeneventures/tokens` all ship zero
runtime dependencies; only `@vespeneventures/ui` carries any, and only
because it wraps React primitives it genuinely cannot hand-roll. This
package's entire job is dependency-free data validation — `schema.ts`
hand-rolls that validation with plain type guards, in the style of
`@vespeneventures/policy`'s own `validate.ts`, rather than reaching for a
schema library. That matters more than usual for a *public* package: this
package's only consumers are external installers, and a schema-library
dependency would force every one of them onto that library's major
version (or a duplicate install, if their own code already depends on a
different one) for the sake of validating a handful of nested objects. In
particular, zero dependency on `@vespeneventures/policy`,
`@vespeneventures/tokens`, or any `strategy` package, despite this
README's comparisons to all three.

## Licence

MIT
