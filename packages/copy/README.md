# @vespeneventures/copy

`@vespeneventures/copy` owns the language system for a product: its voice
rules, glossary, claims register, addressable copy records, and source
traceability checks. It ships the machinery and a deliberately unbound voice
template; each consumer supplies its own language and facts.

```bash
npm install @vespeneventures/copy
```

## Public entry points

- `@vespeneventures/copy` exposes both voice and copy-record APIs.
- `@vespeneventures/copy/voice` exposes only the voice contract:
  `checkCopy`, `auditClaimsRegister`, `isCiBlockingSeverity`,
  `checkPatternSafety`, `parseVoiceRecord`, `validateVoiceRecordShape`,
  `VOICE_FIELDS`, `VOICE_SEVERITIES`, and their types — including the rule
  vocabulary described below: `PatternRule`, `VoicePattern`, `VoiceSeverity`,
  `VoiceChannel`.
- `@vespeneventures/copy/voice-record.template.jsonc` is an annotated,
  unbound template to copy into a consumer repository and fill in.

```ts
import {
  createCopyResolver,
  checkCopy,
  checkCopyRecord,
  type CopyRegistry,
  type VoiceRecord,
} from "@vespeneventures/copy";

const voice: VoiceRecord = {
  id: "acme-app",
  rules: {
    person: { description: "second person", forbiddenPronouns: ["we", "our"] },
    tense: { description: "present tense", forbiddenMarkers: ["will"] },
    formality: "neutral",
    tone: ["direct"],
  },
  glossary: [{ term: "utilize", status: "forbidden", reason: "prefer plain language" }],
  claims: [],
};

const record: CopyRegistry = {
  id: "acme-app",
  locale: "en",
  revision: "2026-08-11",
  source: { kind: "consumer", reference: "editorial/revisions/42" },
  entries: [{ id: "home.title", text: "Plan your week.", context: "home page heading", status: "approved" }],
};

checkCopy(voice, record.entries[0].text);
checkCopyRecord(record, voice);
const resolveCopy = createCopyResolver(record);
resolveCopy({ id: "home.title" });
```

`copy-check` scans a source tree and checks its user-facing literals against a
registered `CopyRecord`. It exits 0 when clean, 1 when it finds traceability
issues, and 2 when it cannot run.

This package does not resolve a claim's `factRef`, infer tone or grammar, or
ship actual product language. Those decisions remain with the consumer and the
product's facts system.

## Resolving copy for a surface

`CopyRecord` is the minimal schema used by source scanning and voice checking.
Rendered output must use the stronger `CopyRegistry`: one locale, a revision,
opaque source provenance, and an explicit lifecycle state for every entry.
Only `approved` entries resolve. This prevents a surface manifest from claiming
traceability for draft, retired, unversioned, or unlocalised text.

```ts
import { createCopyResolver, type CopyRef, type CopyRegistry } from "@vespeneventures/copy";

declare const registry: CopyRegistry;
const ref: CopyRef = { id: "account.greeting", locale: "en", values: { name: "Ada" } };
const resolved = createCopyResolver(registry)(ref);

if (!resolved) throw new Error("Required copy could not be resolved");
// resolved.text goes to the renderer. Its registry/revision/locale/source and
// entry identifier can be retained structurally by
// surface's createResolvedOutputManifest helper.
```

The resolver is strict: it fails closed for an invalid runtime registry,
unknown ID, locale mismatch, draft/retired entry, missing placeholder value,
or unexpected value. Locale fallback belongs to a consumer-owned registry
selector, rather than an implicit package policy.

## Where this package sits on i18n

"i18n" is two different things, and this package deliberately does only one
of them.

**Translation RUNTIME** — ICU message format, plural rules, locale
negotiation, date/number formatting — is out of scope. `CopyLocale` is a
plain string (see `types.ts`) precisely so this package never grows a second
internationalisation stack: that job already belongs to `Intl`
(`Intl.PluralRules`, `Intl.ListFormat`, `Intl.RelativeTimeFormat`,
`Intl.NumberFormat`) and a consumer's own choice of locale-negotiation
policy. This is a scope decision, not a gap this package failed to fill —
see `placeholders`' own doc comment in `types.ts` for the same point made
about interpolation specifically.

**Translation GOVERNANCE** — is every locale actually covered, has the
source locale drifted ahead of its translations, is a target locale carrying
entries that no longer exist upstream — is this package's job, because it is
the same "addressable, checkable copy" problem this package already solves
within one locale, applied across locales. What this package DOES do for
multi-locale work:

- **Addressing and resolution**: `CopyRegistry` is already locale-keyed
  (`locale: CopyLocale`), and `resolveCopyRef` already fails closed with a
  `"locale-mismatch"` issue when a `CopyRef` requests a locale a given
  registry does not provide.
- **Coverage governance**: `checkLocaleCoverage` (below) checks a set of
  locale-keyed registries against a declared source locale for missing
  coverage (an entry the source has that a target locale doesn't) and
  orphaned entries (an entry a target locale has that the source no longer
  does).
- **Staleness governance**: `checkLocaleCoverage` also checks whether a
  target-locale entry's translation is still current against a since-edited
  source entry. This is deliberately **content-derived**, not a
  human-maintained revision counter: `CopyRegistryEntry.translation`
  (`CopyTranslationProvenance`) records a `sourceFingerprint` — the source
  entry's `text`, digested by `computeCopyFingerprint` (`node:crypto`
  `sha256`, no runtime dependency) at the moment the translation was
  produced. `checkLocaleCoverage` recomputes that fingerprint against the
  source entry's CURRENT `text` and compares. A hand-bumped revision number
  requires someone to remember to bump it every time source copy changes,
  and nothing enforces that discipline — it drifts silently. A content hash
  cannot drift: identical text always fingerprints identically, and any
  edit changes the fingerprint with certainty.

  `translation` is optional — an entry authored before this field existed,
  or by a host that has not adopted it, remains a fully valid
  `CopyRegistryEntry`. `checkLocaleCoverage` treats "checked, still current"
  (no finding), "checked, and stale" (`"locale-coverage:stale-entry"`), and
  "no provenance recorded, cannot tell" (`"locale-coverage:provenance-missing"`)
  as three genuinely different outcomes, never collapsed into one signal —
  collapsing "cannot tell" into either of the other two would silently
  report a dimension it did not actually check as either clean or dirty.
- **Interpolation-parity governance**: for every entry present in both a
  source and target locale, `checkLocaleCoverage` also compares each
  entry's `placeholders` in both directions: a name the source declares
  that the target's translation is missing
  (`"locale-coverage:interpolation-missing"`, a broken sentence at render
  time — a required value has nowhere to interpolate into) and a name the
  target declares that the source never did
  (`"locale-coverage:interpolation-extra"`, an unfilled `{name}` token
  rendered straight to a user). Both are `"error"` severity, matching the
  same-class-of-bug precedent `placeholder-missing-from-text` already sets
  within one locale.

  See `locale-coverage.ts`'s doc comment for the full design, including why
  this stays translation *governance*, never a competing translation
  runtime — the boundary below is unchanged by any of this.

### Voice glossary vs. i18n glossary — two different axes, easy to conflate

`@vespeneventures/copy/voice`'s `GlossaryEntry` (`term`/`status`/`reason`/
`alternative`/`caseSensitive`) is a **voice** glossary: it enforces brand
terms *within one locale* — "never say utilize, say use," checked by
`checkCopy` against one string in one language. It has no concept of a
second locale at all: a `VoiceRecord` is documented as "one consumer's
complete, bound voice," singular, and `checkCopy` never receives a locale
argument.

An **i18n** glossary is a different axis over similar-looking machinery: it
enforces that a *term stays equivalent across locales* — that whatever "an
en entry translates to in fr" actually says the same thing, not that either
locale's copy avoids a forbidden word. That requires a locale-keyed
term-registry shape (multiple per-locale phrases grouped under one
term-equivalence id) that `GlossaryEntry`/`VoiceRecord` do not have and were
never designed to grow: `VoiceRecord` is deliberately a single, monolingual,
bound voice, and threading a locale axis through `checkCopy`'s single-string
contract would distort what that function already promises, not extend it.
This package does not ship an i18n glossary for that reason — implementing
one honestly is a new register (structurally closer to `checkLocaleCoverage`
above, generalized from entry ids to term-equivalence ids) rather than a
small addition to `copy/voice`.

## Voice rule vocabulary: patterns, severity, and channels

Three additions to `copy/voice`'s rule model, all strictly additive: an
existing `VoiceRecord` that uses none of them validates and behaves exactly
as it did before (see "Scope discipline" below).

### Pattern rules vs. the glossary

`GlossaryEntry` matches one literal term. It cannot express alternation
(`"deep dive"` vs. `"dive deep"`), an optional apostrophe (`"it's"` vs.
`"its"`), or a hard ban on a specific character (a U+2014 em dash). A
`PatternRule` closes all three gaps with one mechanism — a regex — because a
punctuation ban is just a pattern with no alternation in it:

```ts
import { checkCopy, type VoiceRecord } from "@vespeneventures/copy/voice";

const voice: VoiceRecord = {
  id: "acme-app",
  rules: { /* ... */ } as VoiceRecord["rules"],
  glossary: [],
  claims: [],
  patterns: [
    {
      id: "no-em-dash",
      description: "hard ban on the em dash",
      pattern: { source: "\\u2014" },
      severity: "error",
      reason: "house style bans the em dash — use a comma or period",
    },
    {
      id: "deep-dive",
      description: "banned buzzword, either word order",
      pattern: { source: "\\b(deep dive|dive deep)\\b", flags: "i" },
      severity: "warning",
      reason: "overused",
      alternative: "look closely at",
    },
  ],
};

checkCopy(voice, "Let's take a deep dive into this — with an em dash.");
```

**Regex safety.** A caller-supplied pattern can hang a scanner via
catastrophic backtracking. This package's position: bound the pattern AT
REGISTRATION TIME, never at run time — there is no runtime timeout anywhere
in this package. `checkPatternSafety` (exported, so a consumer can validate
a pattern before it ever reaches a `VoiceRecord`) rejects, as a real
finding, never a silent skip: a disallowed flag (only `i`/`u`/`s` are
accepted — never `g`/`y`/`m`), a source over 200 characters, a
backreference (`\1`, `\k<name>`), a bounded quantifier whose upper bound
exceeds 50, and — the classic catastrophic-backtracking shape — a
quantifier applied to a group that itself contains an unbounded quantifier
(`(a+)+`, `(a*)*`, `(.*)+`). This is a real, bounded, documented static
gate, not a general ReDoS detector: it does not catch overlapping-alternation
blowup with no nested quantifier (`(a|a)+`) — see
`src/voice/internal/pattern-safety.ts`'s top doc comment for the complete,
honest limitation list.

**An invalid pattern is a finding, not a silent skip.** Both
`validateVoiceRecordShape`/`parseVoiceRecord` (at registration) and
`checkCopy` itself (as defense-in-depth, since `checkCopy` does not trust
that its `VoiceRecord` argument was ever validated) run this same gate. A
pattern that fails compiles to a `"pattern:invalid-rule"` **error** finding
— always `"error"`, regardless of the rule's own declared severity, and,
like `"voice:unbound-placeholder"`, it can never be waived away. A rule the
author believes is enforcing something must never silently stop enforcing
it.

Patterns are serialized as `{ source, flags }` — the two `RegExp`
constructor arguments — never a real `RegExp` instance, because a
`VoiceRecord` is checked-in JSON data, not code.

### Three severity tiers, and what each means for CI

`VoiceFinding.severity` is now `"error" | "warning" | "advisory"` (widened
from `"error" | "warning"` — every existing finding this package produces
still uses exactly the same value it always did):

| Tier | Meaning |
| --- | --- |
| `"error"` | Fails CI. This package's documented idiom — `report.findings.some(f => f.severity === "error")` — treats this, and only this, tier as build-breaking. `isCiBlockingSeverity(severity)` is the same check, exported so a caller does not have to hardcode the string. |
| `"warning"` | Fails only a narrower, editorial gate — a stricter, consumer-owned check (e.g. "block merge to a marketing branch") that this package does not implement. Unchanged in behavior from before this release: the `tense` dimension already produced `"warning"` findings, and nothing about how they flow through `checkCopy` has changed. |
| `"advisory"` | Purely informational. Never fails anything, including the narrower editorial gate. |

Only `PatternRule.severity` requires an author to pick one of these
explicitly — every other dimension's severity remains hardcoded by
`checker.ts`, exactly as before.

### Channel scoping

An optional `channel` on a `GlossaryEntry` or `PatternRule` scopes it to one
named channel — LinkedIn, X, HN, or whatever a consumer's own product calls
its channels. **This package does not define what a channel is.** `VoiceChannel`
is a plain string, validated for shape only (non-empty, non-whitespace),
exactly the same seam `CopyLocale` draws for locale and `Claim.factRef`
draws for a facts registry:

```ts
{
  term: "synergy",
  status: "forbidden",
  reason: "buzzword",
  caseSensitive: false,
  channel: "linkedin", // this rule only applies when checkCopy is called with { channel: "linkedin" }
}
```

```ts
checkCopy(voice, copyForLinkedIn, { channel: "linkedin" });
```

A rule with no `channel` is global and always applies. A channel-scoped rule
applies only when `options.channel` matches it EXACTLY (plain string
equality — no case-folding, no interpretation). Omitting `options.channel`
entirely is identical to every release before this one: no rule has a
`channel` unless its author added one.

### Scope discipline

`patterns` is optional at the `VoiceRecord` TYPE level (not merely defaulted
at validation time, the way `glossary`/`claims` are) specifically so every
`VoiceRecord` object literal written before this feature existed keeps
compiling and behaving unchanged: a record that never declares `patterns`
gets no `"pattern"` entry in `checkCopy`'s `ran`/`skipped` at all — not
"skipped for lack of configuration", genuinely absent, so
`report.complete`/`report.skipped.length` reproduce this package's
pre-pattern-rule behavior exactly. `packages/copy/src/voice/checker.test.ts`
pins this explicitly.

## Path exclusions for the scanning surface

The mention-vs-use failure: a style guide that documents this voice's own
banned terms — "never say X, say Y instead" — necessarily contains the
literal banned text, as a MENTION, not a USE. Scanned like any other file,
that mention looks identical to real, unregistered product copy.
`ScanOptions.pathExclusions` fixes this for `scanCopySourceTree`'s scanning
surface (the walk that feeds `checkCopyTraceability`):

```ts
import { scanCopySourceTree } from "@vespeneventures/copy";

const scan = scanCopySourceTree(sourceDir, {
  pathExclusions: [
    { path: "docs/style-guide.ts", reason: "documents banned terms; does not ship them" },
    { path: "docs/**", reason: "internal documentation, not product copy" },
    { path: "fixtures/*.ts", reason: "test fixtures" },
  ],
});
```

A matched file is skipped BEFORE it is ever tokenized — it contributes no
candidates, no excluded literals, no citations, no unchecked items, exactly
as if it did not exist. The pattern language is deliberately small (no glob
library, this package's usual zero-runtime-dependency rule): an exact path,
a `dir/**` subtree, or a single `*` confined to the final path segment.

**This is a different feature from `ExclusionReason`/`ExcludedLiteral`**,
which scan.ts already had: that mechanism classifies one LITERAL already
found inside a file that IS being scanned (is this string an import
specifier, a CSS class, ...?) — a per-literal judgment. `pathExclusions`
answers a different question at a different granularity: should this FILE
be looked at at all, before a single character of it is tokenized? See
`src/path-exclusions.ts`'s top doc comment for the full argument for why
these are two separate mechanisms, not a coincidence of both being named
"exclusion".

**Fails closed**, mirroring `checkCopy`'s `VoiceCheckWaiver` handling: a
malformed entry (missing/empty `path` or `reason`, or a pattern this small
grammar cannot parse) is never applied — it exempts nothing — and is
reported as an `"error"`-severity `PathExclusionFinding` on
`ScanResult.pathExclusionFindings`. An exclusion that matched zero files
this run is reported too, as a `"warning"`, since a stale exclusion (the
file it named was renamed or deleted) is otherwise indistinguishable from
one still doing real work.

## Copy addressability — is prose resolved from the registry, or typed inline?

`checkCopyTraceability` above answers "does this literal match a registered
entry, or carry a `copy:<id>` citation?" — but a literal that matches is
still a literal: the sentence sits in the component's own source, so a
marketing rename means editing every component that typed it, not one
registry entry. `checkAddressability` (`addressability.ts`) answers the
stricter question traceability does not: is this prose actually resolved
from the registry by id? There is no citation or text-match escape hatch.

```ts
import { scanAddressabilitySources, checkAddressability } from "@vespeneventures/copy";

const scan = scanAddressabilitySources(sourceDir);
const result = checkAddressability(scan);
// result.verdict: "satisfied" | "violated" | "indeterminate"
```

Three positions are classified:

1. **Markup text nodes** (`<span>Hello</span>`'s `Hello`) — always a
   violation when it carries real prose.
2. **The four user-facing attributes** — `aria-label`, `placeholder`,
   `alt`, `title` — carry prose a person reads and are NOT text nodes; a
   scanner that only understands text nodes reports zero on a component
   whose entire user-facing surface is `<input aria-label="..." />`.
   Always a violation when the value is literal prose.
3. **Everything else** — a template literal (in any position, including
   one of the four attributes above), an object/array literal value, or a
   prop that is none of the four — this gate cannot confidently tell
   whether it is resolved-through-an-id or genuinely non-user-facing, so it
   is reported as `unchecked` (indeterminate), never silently treated as
   clean.

`AddressabilityGateResult.verdict` is `"indeterminate"` whenever `unchecked`
is non-empty, zero components were scanned, or the tree could not be read —
`"indeterminate"` wins over `"violated"` even when both are true in the same
run, mirroring `checkCopyTraceability`'s own "a `2` gates before findings are
counted" precedence.

`copy-check addressability [scan-dir]` (see `cli.ts` — a subcommand of the
existing `copy-check` bin, dispatched on an explicit `argv[0] ===
"addressability"`, never by installed `bin` name or invoking path) exits
`0` clean / `1` at least one violation / `2` could not run — deliberately a
SEPARATE exit code from `copy-check`'s default command rather than folded
into it, since the two gates' natural test fixtures are structurally
incompatible (a literal traceability needs to prove a registry match is
exactly a literal addressability cannot confirm is safe).

## API

The root entry point exports the copy registry and traceability surface:

- Registry and schema: `parseCopyRecord`, `validateCopyRecordShape`,
  `parseCopyRegistry`, `validateCopyRegistryShape`, `readCopyRecord`,
  `createCopyResolver`, `resolveCopyRef`, `checkCopyRecord`, `CopyRecord`,
  `CopyRegistry`, `CopyEntry`, `CopyRegistryEntry`, `CopyRef`, `CopyResolution`,
  `CopyResolver`, `CopySource`, `CopyLocale`, `CopyValue`, `CopyEntryStatus`,
  `CopyResolveIssue`, `CopyResolveIssueReason`, `CopyResolveResult`,
  `CopyEntryId`, `CopyFinding`, `CopyRegistryReadIssue`,
  `CopyRegistryReadIssueReason`, `CopyRegistryReadResult`,
  `CopyEntryCheckResult`, `CopyEntrySkip`, `CopyRecordCheckOptions`,
  `CopyRecordCheckReport`, `CopyRecordFinding`, and
  `CopyRecordWaivedFinding`.
- Translation provenance and fingerprinting (see "Where this package sits
  on i18n" above): `CopyTranslationProvenance`, `computeCopyFingerprint`,
  and `COPY_FINGERPRINT_ALGORITHM`.
- Source discovery: `extractCopyCandidates`, `scanCopySourceTree`,
  `PLACEHOLDER_SENTINEL`, `Citation`, `CopyCandidate`, `ExcludedLiteral`,
  `ExclusionReason`, `ParseFailure`, `ScanOptions`, `ScanResult`,
  `SkippedFile`, and `UncheckedItem`.
- Path exclusions for the scanning surface (see above): `validatePathExclusions`,
  `PathExclusion`, `ExcludedPath`, `PathExclusionFinding`,
  `PathExclusionFindingRule`, and `PathExclusionValidation`.
- Traceability: `checkCopyTraceability`, `CopyGateFinding`,
  `CopyGateIgnored`, `CopyGateResult`, and `CopyGateRule`.
- Addressability (see above): `scanAddressabilitySources`,
  `extractAddressabilityCandidates`, `checkAddressability`,
  `AddressabilityGateResult`, `AddressabilityPosition`,
  `AddressabilityScanOptions`, `AddressabilityScanResult`,
  `AddressabilityUncheckedItem`, `AddressabilityVerdict`, and
  `AddressabilityViolation`.
- Locale-coverage governance: `checkLocaleCoverage`, `LocaleCoverageFinding`,
  `LocaleCoverageReport`, `LocaleCoverageSkip`, and
  `LocaleCoverageSkipReason` — see "Where this package sits on i18n" above.

The voice names described under Public entry points are re-exported from the
root and from `@vespeneventures/copy/voice`, including the rule-vocabulary
additions: `PatternRule`, `VoicePattern`, `VoiceSeverity`, `VOICE_SEVERITIES`,
`VoiceChannel`, `isCiBlockingSeverity`, `checkPatternSafety`,
`PatternSafetyIssue`, and `PatternSafetyResult`.
