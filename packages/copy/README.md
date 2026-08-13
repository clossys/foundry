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
  `checkCopy`, `auditClaimsRegister`, `parseVoiceRecord`,
  `validateVoiceRecordShape`, `VOICE_FIELDS`, and their types.
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
  does). It does **not** check staleness — a target-locale entry whose
  translation is behind a since-edited source entry — because
  `CopyRegistryEntry` carries no per-entry revision to compare, and
  `CopyRegistry.revision` is a whole-registry, unordered provenance string
  (the same opacity `CopySource.reference` already claims) that cannot
  safely stand in for one. `checkLocaleCoverage` says so in its own report,
  every run, rather than silently reporting a dimension it cannot evaluate
  as passing — see `locale-coverage.ts`'s doc comment for the full argument.

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
- Source discovery: `extractCopyCandidates`, `scanCopySourceTree`,
  `PLACEHOLDER_SENTINEL`, `Citation`, `CopyCandidate`, `ExcludedLiteral`,
  `ExclusionReason`, `ParseFailure`, `ScanOptions`, `ScanResult`,
  `SkippedFile`, and `UncheckedItem`.
- Traceability: `checkCopyTraceability`, `CopyGateFinding`,
  `CopyGateIgnored`, `CopyGateResult`, and `CopyGateRule`.
- Locale-coverage governance: `checkLocaleCoverage`, `LocaleCoverageFinding`,
  `LocaleCoverageReport`, `LocaleCoverageSkip`, and
  `LocaleCoverageSkipReason` — see "Where this package sits on i18n" above.

The voice names described under Public entry points are re-exported from the
root and from `@vespeneventures/copy/voice`.
