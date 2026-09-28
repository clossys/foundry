# @clossys/writer

**The writer role — is it well said?** This package is named for the job,
not the artifact. The records it owns are still copy records, and the
vocabulary inside it (`CopyRegistry`, `CopyRef`, `checkCopyRecord`, the
`copy-record` schema, and every voice/glossary/claim term) is unchanged: a
role owns artifacts, and renaming the role does not rename what it reasons
about.

`@clossys/writer` owns the language system for a product: its voice
rules, glossary, claims register, addressable copy records, and source
traceability checks. It ships the machinery and a deliberately unbound voice
template; each consumer supplies its own language and facts.

```bash
npm install @clossys/writer
```

This package is published to the public npm registry, `https://registry.npmjs.org`.
Installing it needs no authentication: no npm token, no `.npmrc` registry
override, and no GitHub credential of any kind.

## Approved copy coverage rate

Independent consumer evidence shows the position's owned metric meets its
setpoint over the declared review cadence. The owned metric is `approved
copy coverage rate`, computed by `assessApprovedCopyCoverageRate()`. An
empty evaluated set is `indeterminate`, never a perfect rate of 1.
`checkCopyRecord` and `checkCopyTraceability` remain the gates they are;
neither is this rate. This package does not measure consumer evidence and
does not close the loop. A green run of this package's tests is not a close.

```ts
import { assessApprovedCopyCoverageRate } from "@clossys/writer";

const report = assessApprovedCopyCoverageRate(input);
```

```bash
writer-rate-check assessment.json
```

The command prints JSON and exits `0` for satisfied, `1` for violated, and
`2` for indeterminate, unreadable, or invalid input.

This package declares that command as its first-day assessment surface in
its own manifest:

```json
"foundry": { "assessment": { "bin": "writer-rate-check", "invocation": "single-json-input" } }
```

Onboarding discovers that declaration from the installed manifest and never
infers a surface. `writer-check` remains the multi-mode CLI and is not the
assessment surface. Writer is not a required first-day role; Advisor
remains the only required first-day assessment.

## Public entry points

- `@clossys/writer` exposes both voice and copy-record APIs.
- `@clossys/writer/voice` exposes only the voice contract:
  `checkCopy`, `auditClaimsRegister`, `isCiBlockingSeverity`,
  `checkPatternSafety`, `parseVoiceRecord`, `validateVoiceRecordShape`,
  `VOICE_FIELDS`, `VOICE_SEVERITIES`, and their types — including the rule
  vocabulary described below: `PatternRule`, `VoicePattern`, `VoiceSeverity`,
  `VoiceChannel`.
- `@clossys/writer/voice-record.template.jsonc` is an annotated,
  unbound template to copy into a consumer repository and fill in.

```ts
import {
  createCopyResolver,
  checkCopy,
  checkCopyRecord,
  type CopyRegistry,
  type VoiceRecord,
} from "@clossys/writer";

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

`writer-check` scans a source tree and checks its user-facing literals against a
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
import { createCopyResolver, type CopyRef, type CopyRegistry } from "@clossys/writer";

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

Both `resolveCopyRef` and `createCopyResolver` take an optional third
argument, `CopyResolveOptions`:

```ts
import { createCopyResolver, type CopyRegistry, type CopyResolveOptions } from "@clossys/writer";

declare const registry: CopyRegistry;
const options: CopyResolveOptions = { target: "preview", acceptDelegateInProduction: false, now: new Date() };
const resolve = createCopyResolver(registry, options);
```

- `target` (`CopyResolveTarget`, `"preview" | "production"`, default
  `"production"`) — which audience this resolution is for. An owner-approved
  entry resolves on either target. A delegate-approved entry resolves freely
  on `"preview"` but is refused on `"production"`
  (`"delegate-approval-refused"`) unless the caller opts in.
- `acceptDelegateInProduction` (default `false`) — only meaningful when
  `target` is `"production"`; set it to `true` to accept a delegate's
  sign-off as sufficient to publish, not just to preview.
- `now` (default `new Date()`, evaluated per call) — the clock staleness and
  expiry are measured against; a test fixes it to make an assertion
  deterministic.

Three new refusal reasons follow directly from an entry's approval record
(see "Delegated approval" below for what the record itself contains):
`"approval-stale"` (the recorded fingerprint no longer matches the entry's
current text), `"approval-expired"` (a delegate record's `expiresAt` has
passed), and `"delegate-approval-refused"` (a delegate record on
`"production"` without `acceptDelegateInProduction: true`). A malformed
`CopyResolveOptions` itself is `"invalid-options"`, checked and refused
before anything else so a broken options object never silently falls back
to defaults. An `approved` entry that carries no `approval` record at all
resolves exactly as it always has, on either target, with no `approval` key
on the returned `CopyResolution` — this is unchanged, on-by-default
behavior, not an opt-in.

The default `writer-check` command also runs two registry-only gates against
the same `CopyRegistry` file a surface renders from:

- **Render-store parity** (`checkRenderRegistryParity`): `record-file` must be
  a `CopyRegistry` — the store `createCopyResolver` reads at render, not a plain
  `CopyRecord` or a second in-memory-only store. `--render-registry <file>` may
  name the path the surface passes to `createCopyResolver`; after realpath it
  must be the same file as `record-file`.
- **Treatment word budgets** (`checkTreatmentWordBudgets`, `countCopyWords`,
  `DEFAULT_TREATMENT_WORD_BUDGETS`): registry entries may declare `treatment`
  and optional `maxWords`. Approved copy that exceeds the budget fails the
  gate (built-in defaults for `display-heading`, `eyebrow`, and `button` when
  `maxWords` is omitted).

## Site identity copy (`site.name` / `site.tagline`)

A site's name and tagline are a reserved copy kind: two entries in the same
`CopyRegistry` a surface renders from, under the ids `SITE_NAME_COPY_ID`
(`"site.name"`) and `SITE_TAGLINE_COPY_ID` (`"site.tagline"`, both listed in
`SITE_IDENTITY_COPY_IDS`). `resolveSiteIdentity` resolves both through
`resolveCopyRef`, so the approval policy in "Resolving copy for a surface"
applies to each without a second code path: the entry must be `approved`, a
recorded approval must still match the entry's current text, a delegate
approval must not have expired, and a delegate approval is refused on
`"production"` unless `acceptDelegateInProduction` is set.

```ts
import { resolveSiteIdentity, type CopyRegistry } from "@clossys/writer";

declare const registry: CopyRegistry;
const result = resolveSiteIdentity(registry, { target: "production", locale: "en" });

if (!result.complete) {
  for (const issue of result.issues) console.error(issue.field, issue.reason, issue.message);
} else {
  const { name, tagline } = result.identity;
}
```

The second argument is `CopyResolveOptions` (`target`, `acceptDelegateInProduction`,
`now`) plus an optional `locale`, which is passed to the resolver as the
requested locale of each entry. A malformed options object, or a blank or
non-string `locale`, is reported as `"invalid-options"` rather than thrown.

The result is all-or-nothing. Both entries are always attempted, and every
problem is returned in one pass, each `SiteIdentityIssue` tagged with the
`field` (`"name"` or `"tagline"`) it belongs to. `identity` (the two strings)
and `resolutions` (each field's `CopyResolution`, with its registry, revision,
locale, source and approval provenance) are present only when both resolved;
when either fails neither is returned, so a caller cannot end up with half an
identity. An issue's `reason` is any `CopyResolveIssueReason`, or one of two
reasons specific to this kind:

- `"site-identity-placeholder"` — the entry declares placeholders, or its text
  contains braces the resolver would rewrite. A name and a tagline are literal
  text, not templates.
- `"site-identity-blank"` — the resolved text is empty after trimming.

`resolveSiteIdentity` does not modify the registry and returns the same result
for the same registry and options (pass `now` to fix the clock). Consuming it
is a separate change: a publisher page-metadata builder is not part of this
package, and nothing here reads a brand-facts record.

## Delegated approval — who approved this copy, and is it still that text?

`status: "approved"` says an entry may render. It does not say who decided
that, when, or whether the sentence has since changed underneath the
decision. `CopyRegistryEntry.approval` (`CopyApproval`) answers all three.
`writer-check approve` writes the record, so nobody has to hand-edit it into
a registry or into code; `writer-check approval-state` reports approval state
set in source instead. `textFingerprint` is a content hash rather than a
human-maintained counter for the same reason `fingerprint.ts` gives for
translation provenance.

```json
{
  "id": "site.home.title",
  "text": "Home title copy.",
  "context": "home hero",
  "status": "approved",
  "approval": {
    "approvedBy": "delegate",
    "approvedAt": "2026-09-27T00:00:00.000Z",
    "textFingerprint": "bb46f6c7794911342f760f6e9e46f1f6ca31d0d306c9b301a1069f4b6ff6966c",
    "fingerprintAlgorithm": "sha256",
    "delegate": { "id": "delegate-a", "scope": ["site.home"] },
    "pendingOwnerReview": true,
    "expiresAt": "2026-10-27T00:00:00.000Z"
  }
}
```

(`textFingerprint` above is `computeCopyFingerprint("Home title copy.")` —
a 64-character `sha256` hex digest of that entry's own `text`, computed by
`writer-check approve`.)

- **`approvedBy`** (`CopyApprover`, `"owner" | "delegate"`) — who recorded
  this approval.
- **`textFingerprint`**/**`fingerprintAlgorithm`** — pin the record to the
  EXACT text that was approved. The moment `text` changes, a fresh
  `computeCopyFingerprint(entry.text)` no longer matches, and the record is
  `"approval-stale"` — an error, not a warning — until it is approved again.
  This is the same content-derived-over-hand-maintained argument
  `fingerprint.ts` already makes for translation staleness, applied to
  approval staleness instead.
- **`delegate`** (`CopyDelegateScope`, `{ id, scope }`) — required when
  `approvedBy` is `"delegate"`, forbidden when it is `"owner"`. `id` is an
  opaque identifier, never a personal name. `scope` is one or more
  dot-separated entry-id namespaces the delegate may approve: an entry is in
  scope when its id equals a scope item or starts with `item + "."` —
  `["site.home"]` covers `site.home` and `site.home.title`, never
  `site.homepage.title`. `isEntryInDelegateScope(entryId, scope)` is the
  exported predicate.
- **`pendingOwnerReview`** — required (and only meaningful) on a delegate
  record. A delegate's approval is enough for the entry to resolve — see
  `target`/`acceptDelegateInProduction` above — but it is a warning
  (`"approval-pending-owner-review"`), not an error, until an owner durably
  confirms it. Approving the SAME entry again with `--by owner` REPLACES the
  delegate's record with the owner's own — that replacement, not a separate
  "review" action, is how a pending delegate approval is durably confirmed.
- **`expiresAt`** — delegate records only, an ISO 8601 UTC timestamp
  strictly after `approvedAt`. Once `now` reaches it, the record is
  `"approval-expired"` — an error, mutually exclusive with `"approval-stale"`
  (staleness, the more fundamental problem, takes priority when a record is
  somehow both).

### `writer-check approve` — write or revoke a record

```bash
writer-check approve <registry-file> <entry-id>... --by owner
writer-check approve <registry-file> <entry-id>... --by delegate --delegate <id> --scope <ns>[,<ns>...] [--expires <ISO>]
writer-check approve <registry-file> <entry-id>... --revoke
```

Every field the command writes is either computed (`approvedAt` from the
clock, `textFingerprint` from the entry's current `text`) or copied from an
argument the command validated. Approving sets `status: "approved"`; a
delegate record is written with `pendingOwnerReview: true`. Multiple entry
ids are **all-or-nothing**: if any named id is unknown, retired, or (for a
delegate approval) outside `--scope`, every problem is printed and nothing
is written, including for the ids that would otherwise have succeeded. The
command leaves every other field, the key order and `revision` as they
were, and writes 2-space JSON to a temp file in the same directory before
renaming it into place. `--revoke` returns every named entry to `"draft"`
and removes its `approval` record.

Exit codes: `0` written (every named entry approved or revoked, the file on
disk now reflects it), `1` refused (an unknown, retired, or out-of-scope
entry id was named; nothing written), `2` could not run (bad arguments, or
the registry file is missing/unreadable/not valid JSON/fails schema
validation; nothing written).

### `writer-check approval-state` — is the registry current, and does source respect it?

```bash
writer-check approval-state <registry-file> <scan-dir> [--extensions <ext>[,<ext>...]] [--format json] [--now <ISO>]
```

Reports approval state from two independent angles in one run, because
either can fail without the other noticing:

- **Registry findings** (`assessCopyApprovals`, above): `"approval-stale"`
  and `"approval-expired"` are errors; a missing record
  (`"approval-record-missing"`) or a delegate record still
  `pendingOwnerReview` (`"approval-pending-owner-review"`) is a warning —
  legitimately approved for now, just not yet durably so.
- **Source findings** (`scanApprovalBypass`/`checkApprovalBypass`,
  `approval-bypass.ts`): does consumer code in `scan-dir` route copy through
  the resolver, or around it? `"approval-set-in-code"` — the code itself
  declares approval (`status: "approved"`, an `approvedBy`/
  `pendingOwnerReview` property or member assignment) — and
  `"copy-read-without-resolver"` — the code imports the registry file and
  reads its content some way other than passing it whole to
  `createCopyResolver`/`resolveCopyRef`/`validateCopyRegistryShape`, or
  calling `parseCopyRegistry` only when its return value is passed to
  `createCopyResolver` or `resolveCopyRef` — are both errors. An unresolvable registry
  load (a dynamic `import()`/`require()`, an unbound `require`, a
  re-export) or a string that merely names the registry file is reported as
  `unchecked`, not a finding: an incomplete picture, never assumed clean.

**The coupled-file limit, stated plainly**: only files that import
`@clossys/writer` (any subpath) or import the registry file itself are
examined. A file that copies registry data without importing either —
pasted JSON, data fetched at runtime, a registry handed in from an
uncoupled module — is not examined by this gate. Other known gaps: specifier
matching is exact (an extension-less or aliased specifier is not
recognised) and the registry-file match is by basename, which is broad
enough that a distinctive registry filename (not `index.json`) is worth
choosing; there is no scope tracking, so a local variable that happens to
share a flagged binding's name is flagged too; a type assertion or `satisfies`
between the registry binding and the closing `)` of an allowed resolver call
is refused (for example `createCopyResolver(registry as CopyRegistry)` is not
a pass — the resolver accepts `unknown`, so no cast is needed); and only a directly written `"approved"` string
literal is caught — a value built at runtime is not.

**Verdict precedence**: the same "a violation outranks an incomplete
picture" ternary `checkAddressability` and `checkPassageComposition` both
use. `"violated"` whenever at least one error-severity finding exists
(registry or source), regardless of what is unchecked; `"indeterminate"`
only with zero error findings and something left unchecked, unparseable, or
zero files scanned; `"satisfied"` otherwise. Warnings are reported but do
not change the verdict.

Exit codes: `1` any error-severity finding (a registry error or any
approval-bypass finding); else `2` any unchecked registry load/reference,
any file that failed to parse, or zero files scanned; else `0`. Warnings
never change the exit code.

`--format json` prints exactly one object to stdout:

```
{
  verdict: "violated" | "indeterminate" | "satisfied",
  findings: Array<
    | { source: "registry", rule, severity, entryId, message }
    | { source: "source", rule, severity, file, line, message }
  >,
  unchecked: Array<{ file, line, kind, detail }>,
  counts: { errors, warnings, unchecked, filesScanned, coupledFiles }
}
```

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

`writer-check locale-coverage <registries-file> <source-locale>
[declared-locale...]` (see `cli.ts` — a THIRD subcommand of the existing
`writer-check` bin, dispatched on an explicit `argv[0] === "locale-coverage"`,
never by installed `bin` name or invoking path, the same dispatch shape
`cli.ts` already uses for its `voice-derivation-coverage` and
`addressability` subcommands) runs `checkLocaleCoverage` from the command
line. `registries-file` is a JSON file: a plain object mapping each
locale to its `CopyRegistry` (`{"en": {...}, "fr": {...}}`).
`declared-locale` defaults to every key `registries-file` itself declares,
in file order, when omitted; pass it explicitly to also assert that some
OTHER locale — declared, but with no registry present in the file at
all — is missing. Exit code is the exact mapping
`LocaleCoverageReport.complete`'s own doc comment states as its caller
contract: `0` when every declared locale was evaluated and no
`"error"`-severity finding was produced (a `"warning"`-only run — orphaned
entries, stale translations, missing provenance — still exits `0`), `1`
when every declared locale was evaluated but at least one `"error"`-severity
finding was produced, `2` when any declared locale was NOT actually
evaluated (bad input, an unreadable/unparseable/non-object registries-file,
zero declared locales, or a missing/invalid/empty source locale).

### Voice glossary vs. i18n glossary — two different axes, easy to conflate

`@clossys/writer/voice`'s `GlossaryEntry` (`term`/`status`/`reason`/
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
import { checkCopy, type VoiceRecord } from "@clossys/writer/voice";

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
pre-pattern-rule behavior exactly. `packages/writer/src/voice/checker.test.ts`
pins this explicitly.

## Path exclusions for the scanning surface

The mention-vs-use failure: a style guide that documents this voice's own
banned terms — "never say X, say Y instead" — necessarily contains the
literal banned text, as a MENTION, not a USE. Scanned like any other file,
that mention looks identical to real, unregistered product copy.
`ScanOptions.pathExclusions` fixes this for `scanCopySourceTree`'s scanning
surface (the walk that feeds `checkCopyTraceability`):

```ts
import { scanCopySourceTree } from "@clossys/writer";

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

## Machine-readable output: `writer-check --format json`

The default `writer-check` command takes `--format <text|json>`, defaulting to
`text`. Under `json` it prints exactly one object to stdout and nothing else —
every diagnostic that would normally go to stdout is suppressed, so the output
is always parseable — and writes nothing to stderr on a successful run.

The contract that matters is what the object carries, and when:

```
{
  recordFile, scanDir,
  verdict: "clean" | "findings" | "indeterminate",
  exitCode: 0 | 1 | 2,
  reason?,                     // present when the verdict needs explaining
  filesScanned, candidatesScanned, matched,
  findings:       CopyGateFinding[],
  ignored:        CopyGateIgnored[],
  unchecked:      UncheckedItem[],
  parseFailures:  { file, detail }[]
}
```

**`verdict`, `findings` and `unchecked` are always present together, on every
path** — the clean path, the findings path, and the total-failure path alike.
That is the whole point of the shape. A single construct the scanner cannot
classify makes the run `indeterminate` and exits `2`, but the findings it did
produce are still in `findings`, recoverable by any caller that reads past the
exit code.

That mattered concretely: before this shape existed, one unclassifiable JSX
comment between attributes forced exit `2` and discarded **292 real findings**
from the same scan (issue #753). The exit code and the verdict still refuse to
read as clean — an indeterminate must never look like a pass — but "I could
not evaluate THIS ITEM" is no longer collapsed into "I could not evaluate
ANYTHING."

A caller keying only on `exitCode` or `verdict` therefore never mistakes an
indeterminate run for a clean one; a caller that reads `findings` recovers
everything the run measured regardless of how it ended.

This mirrors `@clossys/inspector`'s `VerifyStandardsReport` (per-row verdict
plus one overall verdict and exit code) and `@clossys/observer`'s
`CoverageCellState` three-state union, rather than inventing a fourth
convention.

## Copy addressability — is prose resolved from the registry, or typed inline?

`checkCopyTraceability` above answers "does this literal match a registered
entry, or carry a `copy:<id>` citation?" — but a literal that matches is
still a literal: the sentence sits in the component's own source, so a
marketing rename means editing every component that typed it, not one
registry entry. `checkAddressability` (`addressability.ts`) answers the
stricter question traceability does not: is this prose actually resolved
from the registry by id? There is no citation or text-match escape hatch.

```ts
import { scanAddressabilitySources, checkAddressability } from "@clossys/writer";

const scan = scanAddressabilitySources(sourceDir);
const result = checkAddressability(scan);
// result.verdict: "satisfied" | "violated" | "indeterminate"
```

Four positions are classified:

1. **Markup text nodes** (`<span>Hello</span>`'s `Hello`) — always a
   violation when it carries real prose.
2. **The four user-facing attributes** — `aria-label`, `placeholder`,
   `alt`, `title` — carry prose a person reads and are NOT text nodes; a
   scanner that only understands text nodes reports zero on a component
   whose entire user-facing surface is `<input aria-label="..." />`.
   A violation when the value is literal prose ON A JSX ELEMENT — but NOT
   when the same shape is actually a destructuring-pattern default or a
   plain parameter default (`{ "aria-label": ariaLabel = "Pagination" }`,
   `{ placeholder = "Search" }`, `function f(alt = "...")`): the consumer
   can override a default, so the component's own source does not lock
   the sentence in the way a hardcoded JSX attribute does, and flagging
   one would invert the verdict on an already-addressable construct.
3. **Copy-bearing object-literal values** — chrome config bags
   (`{ label: "Request access", href: "/join" }`, `items[].label`, nav
   link tables) are Writer surfaces. A literal on keys such as `label`,
   `title`, `cta`, `caption`, `heading`, `kicker`, `body`, `description`,
   or `aria-label` is a violation with file and key path. Allowlisted keys
   (`href`, `to`, `path`, `icon`, …) and route-shaped values (`/pricing`)
   are not copy — a `SiteHeader` labels array is not an escape hatch.
4. **Everything else** — a template literal (in any position, including
   one of the four attributes above), or a prop that is none of the four —
   this gate cannot confidently tell
   whether it is resolved-through-an-id or genuinely non-user-facing, so it
   is reported as `unchecked` (indeterminate), never silently treated as
   clean — UNLESS the string is itself shaped like a CSS/Tailwind utility
   class list (`"border-t border-line-base pt-xs"`), which is definitively
   not prose and is excluded outright, the same way `scan.ts` already
   excludes that shape when it has an actual `className` attribute name to
   key off.

**Verdict precedence (changed in 0.2.0 — see issue #407).**
`AddressabilityGateResult.verdict` is `"violated"` whenever at least one
violation was found, REGARDLESS of how many string positions are
unclassified. It is `"indeterminate"` only when there are zero violations
AND `unchecked` is non-empty, zero components were scanned, or the tree
could not be read. This is deliberately the OPPOSITE of
`checkCopyTraceability`'s "a `2` gates before findings are counted"
precedence: on a real tree, hundreds of string positions are token data this
gate cannot classify by design, so letting unclassified-count outrank a
violation made `"violated"` unreachable outside a fixture — every real run
had *some* unclassified positions, so it always read `2`. A caller that had
learned to treat that `2` as "coverage is never complete, ignore it" would
never see the violations a run actually found. The coverage gap itself is
still fully reported: `unchecked`/`reasons` stay populated and
`writer-check addressability`'s own accounting output still prints them
unconditionally, independent of verdict — only the verdict (and the exit
code a `1` maps to) changed.

Before 0.2.0, a caller that treated exit `2` from `writer-check
addressability` as "flaky, coverage is never complete, ignore it" will now
see exit `1` on trees that used to report `2` — that is the fix, not a
regression: those trees had a real violation the old precedence was hiding
behind a coverage-gap exit code.

`writer-check addressability [scan-dir]` (see `cli.ts` — a subcommand of the
existing `writer-check` bin, dispatched on an explicit `argv[0] ===
"addressability"`, never by installed `bin` name or invoking path) exits
`0` clean / `1` at least one violation (regardless of unclassified count) /
`2` zero violations but could not fully evaluate — deliberately a SEPARATE
exit code from `writer-check`'s default command rather than folded into it,
since the two gates' natural test fixtures are structurally incompatible (a
literal traceability needs to prove a registry match is exactly a literal
addressability cannot confirm is safe).

Options:

- `--extensions <ext>` (repeatable, and each occurrence may be a
  comma-separated list) — file extensions to scan, each including the
  leading dot (for example `.mjs`, or `.mjs,.cjs` in one flag). Values
  union across both repeats and comma-separated entries. When omitted, the
  default is `.ts`, `.tsx`, `.js`, and `.jsx`. When any `--extensions` flag
  is present, that default set is replaced. Every value must include the
  leading dot, and a flag that resolves to zero extensions (a bare comma,
  or an empty string) is a usage error (exit `2`) — it never falls back to
  the default set, which would be a vacuous pass on an explicit-but-empty
  request.
- `--chrome <file>` (repeatable) — persistent chrome (site header, footer,
  skip link, nav labels) shell or layout file to scan in addition to
  `scan-dir`. Paths are relative to `scan-dir` unless absolute. Each file
  must exist.
- `--require-chrome` — refuse to run (exit `2`) when no `--chrome` file was
  declared. Use when the surface mounts persistent chrome outside `scan-dir`.

This supplier repository does not ship a copy-registry subject for
addressability to run against. The `writer-check` CLI strings in this tree
are inline operator messaging on purpose, not product UI copy. Consumers
run addressability on their own product UI source trees, not on this
package's own CLI sources.

## The passage layer — the missing middle between an entry and a document

`@example/copy` (now `writer`) has terms (a glossary) and entries
(single addressable strings) and nothing between them. `@clossys/designer`
has tokens, atoms, **and blocks**. In practice nobody reuses one string —
they reuse a whole empty-state (title + body + action), a whole FAQ item
(question + answer), a whole error (message + recovery). `Passage`
(`passage.ts`) is that missing middle: it composes entry/term REFERENCES
the way a block composes atoms, never a raw sentence of its own. Terms ≈
tokens, entries ≈ atoms, passages ≈ blocks; documents (a later,
composition-layer concern, mirroring how a view composes blocks) are out
of scope here — see [issue #373](https://github.com/clossys/foundry/issues/373).

```ts
import { checkPassageComposition, readPassageRecord } from "@clossys/writer";

const read = readPassageRecord("passages.json");
if (read.complete && read.record) {
  const result = checkPassageComposition(read.record);
  // result.verdict: "satisfied" | "violated" | "indeterminate"
}
```

A `Passage` has a stable, dot-separated `id`, a required `context` (an
unlocatable passage is not reviewable — the same rule `CopyEntry.context`
already enforces one layer down), and `fields`: named slots, each of which
should hold a `PassageReference` — `{ ref: "entry", id }` or `{ ref: "term",
term }` — never a literal string, and never a pointer into another
passage's own fields (`{ ref: "passage", ... }`).

**The gate, with the ternary:**

- **`0` (satisfied)** — every passage references only entries and terms,
  at least one passage evaluated.
- **`1` (violated)** — a passage inlines a literal string instead of
  referencing an entry (the verbal equivalent of a hardcoded value instead
  of a token), or references another passage's own internals. Wins over an
  incomplete picture in the same run — the same "a real violation must
  outrank an incomplete scan" precedence `checkAddressability` settled on
  for issue #407/#433, applied here from the start rather than discovered
  later.
- **`2` (indeterminate)** — the registry could not be
  read/parsed/validated, zero passages were registered, or a field's value
  could not be confidently classified, with zero violations found. Fails
  CLOSED with a machine-readable reason (`PassageGateResult.reasons`);
  never a silent pass.

**What this gate deliberately does not do**: verify a referenced entry id
or term actually EXISTS in a real `CopyRecord`/glossary. That is a
different, weaker question ("does this id resolve") than the one this gate
answers ("is this field a reference at all, or a smuggled-in literal") —
the same split `checkAddressability` already draws from
`checkCopyTraceability`. `passage.adversarial.test.ts` proves the
separation directly: a weaker tool that only checks "every referenced
entry id exists" passes a passage built entirely from inline literals
(zero references means nothing to check), while `writer-check passages`,
spawned as the compiled CLI exactly the way this repository invokes every
gate, correctly exits `1` on the identical fixture — plus the sanity check
that the weak tool is not simply broken (both agree when references
genuinely are valid).

**Not ported**: `@clossys/designer/tokens`' `brandable` boolean. In
tokens, `brandable` marks a subset WITHIN one namespace (154 ship, 42 are
brandable). The voice record's own consumer/machinery split runs between
FILES instead — forcing a boolean into a `Passage` field here would be
false symmetry with a split that does not exist at this layer. This
package mirrors the LADDER (terms/entries/passages/documents), never the
binding mechanism.

`writer-check passages <registry-file>` (see `cli.ts` — a subcommand of the
same `writer-check` bin, dispatched on `argv[0] === "passages"`, the same
fully-separate dispatch `addressability` already uses) exits `0` satisfied
/ `1` violated / `2` indeterminate.

## API

The root entry point exports the copy registry and traceability surface:

- Registry and schema: `parseCopyRecord`, `validateCopyRecordShape`,
  `parseCopyRegistry`, `validateCopyRegistryShape`, `readCopyRecord`,
  `createCopyResolver`, `resolveCopyRef`, `checkCopyRecord`, `CopyRecord`,
  `CopyRegistry`, `CopyEntry`, `CopyRegistryEntry`, `CopyRef`, `CopyResolution`,
  `CopyResolver`, `CopySource`, `CopyLocale`, `CopyValue`, `CopyEntryStatus`,
  `CopyResolveIssue`, `CopyResolveIssueReason`, `CopyResolveOptions`,
  `CopyResolveResult`, `CopyResolveTarget`,
  `CopyEntryId`, `CopyFinding`, `CopyRegistryReadIssue`,
  `CopyRegistryReadIssueReason`, `CopyRegistryReadResult`,
  `CopyEntryCheckResult`, `CopyEntrySkip`, `CopyRecordCheckOptions`,
  `CopyRecordCheckReport`, `CopyRecordFinding`, and
  `CopyRecordWaivedFinding`.
- Site identity (see above): `resolveSiteIdentity`, `SITE_NAME_COPY_ID`,
  `SITE_TAGLINE_COPY_ID`, `SITE_IDENTITY_COPY_IDS`, `SiteIdentityField`,
  `SiteIdentityIssue`, `SiteIdentityIssueReason`, `SiteIdentityOptions`, and
  `SiteIdentityResolution`.
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
- Charter close metric: `assessApprovedCopyCoverageRate`,
  `ApprovedCopyCoverageRateAssessment`, `ApprovedCopyCoverageRateFinding`,
  and `ApprovedCopyCoverageRateState`. Not `checkCopyRecord` or
  `checkCopyTraceability`.
- Addressability (see above): `scanAddressabilitySources`,
  `extractAddressabilityCandidates`, `checkAddressability`,
  `AddressabilityGateResult`, `AddressabilityPosition`,
  `AddressabilityScanOptions`, `AddressabilityScanResult`,
  `AddressabilityUncheckedItem`, `AddressabilityVerdict`, and
  `AddressabilityViolation`.
- Render-store parity (see above): `checkRenderRegistryParity`,
  `RenderRegistryParityReason`, and `RenderRegistryParityResult`.
- Treatment word budgets (see above): `checkTreatmentWordBudgets`,
  `countCopyWords`, `DEFAULT_TREATMENT_WORD_BUDGETS`,
  `TreatmentWordBudgetFinding`, `TreatmentWordBudgetResult`, and
  `TreatmentWordBudgetRule`.
- Locale-coverage governance: `checkLocaleCoverage`, `LocaleCoverageFinding`,
  `LocaleCoverageReport`, `LocaleCoverageSkip`, and
  `LocaleCoverageSkipReason` — see "Where this package sits on i18n" above.
- The passage layer (see above): `checkPassageComposition`,
  `classifyPassageField`, `parsePassageRecord`, `readPassageRecord`,
  `validatePassageRecordShape`, `Passage`, `PassageEntryReference`,
  `PassageFieldClassification`, `PassageFinding`, `PassageGateResult`,
  `PassageId`, `PassageRecord`, `PassageReference`,
  `PassageRegistryReadIssue`, `PassageRegistryReadIssueReason`,
  `PassageRegistryReadResult`, `PassageTermReference`,
  `PassageUnclassifiedItem`, `PassageVerdict`, `PassageViolation`, and
  `PassageViolationRule`.
- Delegated approval (see above): `CopyApproval`, `CopyApprover`,
  `CopyDelegateScope`, `assessCopyApprovals`, `isEntryInDelegateScope`,
  `CopyApprovalFinding`, `CopyApprovalFindingRule`, `checkApprovalBypass`,
  `extractApprovalBypass`, `scanApprovalBypass`, `ApprovalBypassExtractResult`,
  `ApprovalBypassFinding`, `ApprovalBypassGateResult`, `ApprovalBypassRule`,
  `ApprovalBypassScanOptions`, `ApprovalBypassScanResult`,
  `ApprovalBypassUncheckedItem`, and `ApprovalBypassVerdict`. The commands
  that write and report on this state, `writer-check approve` and
  `writer-check approval-state`, are CLI-only and not exported from
  `index.ts`.

The voice names described under Public entry points are re-exported from the
root and from `@clossys/writer/voice`, including the rule-vocabulary
additions: `PatternRule`, `VoicePattern`, `VoiceSeverity`, `VOICE_SEVERITIES`,
`VoiceChannel`, `isCiBlockingSeverity`, `checkPatternSafety`,
`PatternSafetyIssue`, and `PatternSafetyResult`.

## Changelog

Release notes for every version are in the [changelog](https://github.com/clossys/foundry/blob/main/docs/changelogs/writer.md), kept in the public repository rather than in the installed package.
