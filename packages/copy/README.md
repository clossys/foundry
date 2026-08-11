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

The voice names described under Public entry points are re-exported from the
root and from `@vespeneventures/copy/voice`.
