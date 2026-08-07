# @vespeneventures/voice

The verbal contract: the exact peer of `@vespeneventures/tokens`, one layer
over. Tokens is the visual contract — what things look like. Voice is the
verbal contract — how things sound. Same layer, same shape, same
machinery-vs-values split.

```bash
npm install @vespeneventures/voice
```

## The single most important constraint

**foundry ships the machinery; each consumer repo ships its own values.**
Four different products can have four different voices. This package ships
a schema, validators, and a checker — never anyone's actual voice.

There is no example voice content shipped in `src/` beyond obviously
fictional fixtures inside `*.test.ts` files (a placeholder called "Acme",
never a real company, product, person, or domain). Binding a real voice —
real forbidden words, real claims, a real tone — is a consumer repo's job,
the same way `@vespeneventures/tokens` ships a neutral greyscale contract
and leaves the real colors to a consumer's own `brand.css`. See that
package's README, "The three-layer contract", for the fuller version of
this argument; this package's version of it is the same argument, one
layer over:

```
VoiceRecordSchema     machinery      the shape every voice must conform to, this package
your voice record      binding        your rules, your glossary, your claims, your own repo
your copy               consumer layer  the actual writing this checker evaluates
```

## Two halves, and the second justifies the first

A schema nobody reads is dead metadata — this repository has already
deleted an earlier package for exactly that failure: it validated six
fields that were all mechanically re-derivable from data already present
elsewhere, so its own checks could never produce a real finding. So this
package ships two halves on purpose:

1. **The schema** (`src/types.ts`, `src/schema.ts`) — Zod-schema'd entities
   for a voice's rules, glossary, and claims register, plus
   `validateVoiceRecordShape`/`parseVoiceRecord` to check candidate data
   against it. Pure data and validation. No React, no IO, no network.
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
  Genuine grammatical tense parsing is not attempted — see "What it does
  not attempt" below.
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
  handle a legitimate exception.
- **A bare, case-insensitive `"I"` in `forbiddenPronouns` will also match a
  stray lowercase `"i"`** that is not the first-person pronoun at all (a
  roman numeral, a loop variable in quoted code, etc.) — case-insensitive
  matching cannot tell them apart. If that risk matters for a given voice,
  express the rule as a `caseSensitive: true` glossary entry instead of a
  `rules.person.forbiddenPronoun`, since the glossary already supports
  per-term case sensitivity and uses the exact same matching mechanism.

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

Two situations that could otherwise look like "nothing was wrong" are
instead surfaced as an explicit, visible incompleteness — never as a
silent, empty-`findings` pass. This repository's own history has more than
one gate that looked clean only because it never ran; this package does
not repeat that:

- **Empty (or whitespace-only) `copy`.** All four dimensions are recorded
  in `skipped`, not run — `findings` is `[]` for a reason `report.complete`
  and `report.skipped` make visible, not because the copy was judged clean.
- **A dimension with nothing configured** (an empty glossary, no
  `forbiddenPronouns`, no `forbiddenMarkers`, no `claims`) is recorded in
  `skipped` with its own reason, rather than silently contributing zero
  findings to what would otherwise read as a clean run. Other, configured
  dimensions still run normally in the same call.

`report.complete` is `true` exactly when `report.skipped` is empty —
mirroring `@vespeneventures/gates`' `FoundationReport.complete` — so a
caller can ask "did this report actually check everything it could have"
with one boolean read, the same discipline that package holds to.

## False positives and the waiver escape hatch

Word-boundary matching over free-text copy will produce false positives —
a forbidden term quoted from a customer review, a claim phrase that shows
up inside a direct quotation, a stray lowercase `"i"`. A checker that fires
constantly on legitimate copy gets disabled entirely, which is worse than
never having shipped it. `checkCopy`'s second `options` argument accepts
`waivers`, an explicit, narrowly-scoped, auditable exception mechanism:

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
| `checkCopy(record, copy, options?)` | function | The checker. Reports `VoiceFinding`s for forbidden glossary terms, forbidden person/tense markers, and unsupported claims found in `copy`. Pure — no I/O. Throws a plain `TypeError` for a non-string `copy` or non-object `record` (a caller-input problem, not a finding). Fails closed on empty copy and on unconfigured dimensions — see "Fails closed" above. Returns a `VoiceCheckReport`. |
| `auditClaimsRegister(claims)` | function | Pure, copy-free audit of a `Claim[]`: one `"claim:missing-fact-ref"` warning per claim that requires support (`requiresSupport: true`, the default) but has no `factRef`. `[]` for an empty register — an empty claims register is not itself a defect. |
| `validateVoiceRecordShape(value)` | function | Runs `VoiceRecordSchema.safeParse(value)` and turns any issues into `VoiceFinding[]` (`rule: "schema:<dotted.path>"`, always `"error"` severity). `[]` means `value` is a well-formed `VoiceRecord`. Never throws, on any input. |
| `parseVoiceRecord(value)` | function | Same validation as `validateVoiceRecordShape`, but throws a plain `Error` (listing every issue) instead of returning findings — for a fail-fast config-loading call site. Returns a `VoiceRecord` (with schema defaults applied) on success. |
| `VoiceRecordSchema` | Zod schema | The top-level schema: `{ id, rules, glossary, claims }`. What a consumer's whole bound voice must conform to. |
| `VoiceRulesSchema` | Zod schema | `{ person, tense, formality, tone }` — see `PersonRuleSchema`/`TenseRuleSchema`/`FormalityLevelSchema`. |
| `PersonRuleSchema` | Zod schema | `{ description: string, forbiddenPronouns: string[] }`. `description` is for humans; `forbiddenPronouns` is the only part `checkCopy` evaluates. |
| `TenseRuleSchema` | Zod schema | `{ description: string, forbiddenMarkers: string[] }`. Same shape and same honesty as `PersonRuleSchema` — see "What it deliberately does not attempt". |
| `FormalityLevelSchema` | Zod schema | `z.enum(["casual", "neutral", "formal"])`. Descriptive only; never read by `checkCopy`. |
| `GlossaryEntrySchema` | Zod schema | `{ term, status, reason, alternative?, caseSensitive }`. See `GlossaryStatusSchema`. |
| `GlossaryStatusSchema` | Zod schema | `z.enum(["forbidden", "preferred"])`. Only `"forbidden"` entries are actively scanned for — see "What `checkCopy` actually catches". |
| `ClaimSchema` | Zod schema | `{ id, text, matchPhrases, factRef?, requiresSupport }`. See "The `factRef` seam". |
| `VoiceRecord` | type | `z.infer<typeof VoiceRecordSchema>`. |
| `VoiceRules` | type | `z.infer<typeof VoiceRulesSchema>`. |
| `PersonRule` | type | `z.infer<typeof PersonRuleSchema>`. |
| `TenseRule` | type | `z.infer<typeof TenseRuleSchema>`. |
| `FormalityLevel` | type | `z.infer<typeof FormalityLevelSchema>`. |
| `GlossaryEntry` | type | `z.infer<typeof GlossaryEntrySchema>`. |
| `GlossaryStatus` | type | `z.infer<typeof GlossaryStatusSchema>`. |
| `Claim` | type | `z.infer<typeof ClaimSchema>`. |
| `VoiceFinding` | type | `{ rule, severity: "error" \| "warning", message, path? }` — deliberately the same shape as `@vespeneventures/policy`'s own `Finding`, defined fresh here (this package has zero runtime dependency on `policy`). |
| `VoiceCheckReport` | type | `{ findings, waived, skipped, ran, complete }` — what `checkCopy` returns. `complete` is `true` exactly when `skipped` is empty. |
| `VoiceCheckOptions` | type | `{ waivers?: VoiceCheckWaiver[] }` — `checkCopy`'s third argument. |
| `VoiceCheckWaiver` | type | `{ rule, match, reason }` — one explicit, auditable exception. See "False positives and the waiver escape hatch". |
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

Node 20+. ESM only. Runtime dependencies: `zod` (`^4.4.3`) — the schema
library every entity in this package is defined with. No other runtime
dependencies; in particular, zero dependency on `@vespeneventures/policy`,
`@vespeneventures/tokens`, or any `strategy` package, despite this
README's comparisons to all three.

## Licence

MIT
