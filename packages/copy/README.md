# @vespeneventures/copy

The vocabulary layer over `@vespeneventures/voice`'s verbal contract — the
exact same split `@vespeneventures/ui` draws over `@vespeneventures/tokens`,
one layer over. Voice is the machinery for a voice's rules, glossary, and
claims, plus a checker. Copy is the machinery for registering a consumer's
own copy as addressable, reviewable, versioned entries, and running every
one of them through that checker.

```bash
npm install @vespeneventures/copy
```

## The single most important constraint

**This package ships no actual copy.** Not one sentence, not one label, not
one error message a real product would show a real user. It ships a schema
for registering copy (`CopyEntry`/`CopyRecord`), a reader that loads a
consumer's real registry file, and a checker that runs every entry through
`@vespeneventures/voice`'s own `checkCopy`.

```
the CopyEntry/CopyRecord shape   machinery      types.ts + schema.ts, this package
your registered copy              binding        your entries, your text, your context, your own repo
what your copy sounds like         downstream     @vespeneventures/voice's VoiceRecord, checked against it
```

There is no example copy shipped in `src/` beyond obviously fictional
fixtures inside `*.test.ts` files (a placeholder called "Acme", never a real
company, product, person, or domain — the same placeholder
`@vespeneventures/voice`'s own README and tests already use). If a doc
comment, a test fixture, or a README example in this package ever reads like
something a product would actually show a user, that is a bug in this
package, not a feature of it. See `@vespeneventures/voice`'s README, "The
single most important constraint", for the fuller version of this argument
— this package's version is the same argument, one layer over.

## The frozen contract

```ts
/** Dot-separated, lowercase, e.g. "pagination.no-results". */
type CopyEntryId = string;

interface CopyEntry {
  id: CopyEntryId;
  text: string;
  context: string;
  placeholders?: string[];
  factRef?: string;
}

interface CopyRecord {
  id: string;
  entries: CopyEntry[];
}
```

`context` is required, deliberately not optional: an entry with no stated
location — a screen, a component, a route, a notification type — cannot be
found by a human reviewer skimming a report, which makes it unreviewable in
practice even though it is structurally present. "Unlocatable copy is not
reviewable copy" is the one-line version of why this field exists at all.

## Usage

```ts
import { checkCopyRecord, type CopyRecord, type VoiceRecord } from "@vespeneventures/copy";

// A consumer repo owns both of these — never this package. "Acme" here is
// an obviously fictional placeholder, the same one already used in this
// repository's own packages/voice and packages/ui READMEs.
const acmeVoice: VoiceRecord = {
  id: "acme-app",
  rules: {
    person: { description: "second-person, you-voice", forbiddenPronouns: ["I", "me", "my"] },
    tense: { description: "present tense, no future promises", forbiddenMarkers: ["will", "shall"] },
    formality: "neutral",
    tone: ["direct", "no jargon"],
  },
  glossary: [
    { term: "revolutionary", status: "forbidden", reason: "overused buzzword", alternative: "new", caseSensitive: false },
  ],
  claims: [],
};

const acmeCopy: CopyRecord = {
  id: "acme-app",
  entries: [
    {
      id: "pagination.range",
      text: "Showing {start}–{end} of {total} results.",
      context: "search results page, pagination footer",
      placeholders: ["start", "end", "total"],
    },
  ],
};

const report = checkCopyRecord(acmeCopy, acmeVoice);

for (const finding of report.findings) {
  console.error(`[${finding.severity}] ${finding.entryId ?? "(record)"}: ${finding.rule}: ${finding.message}`);
}
if (!report.complete) {
  console.error(`warning: ${report.skippedCount} of this record's entries were not checked this run`);
}
if (report.findings.some((f) => f.severity === "error")) process.exitCode = 1;
```

Loading a registry file from disk instead of an inline literal:

```ts
import { readCopyRecord } from "@vespeneventures/copy";

const result = readCopyRecord("./content/copy.json");
if (!result.complete || !result.record) {
  for (const issue of result.issues) console.error(`${issue.reason}: ${issue.detail}`);
  process.exit(2);
}
const report = checkCopyRecord(result.record, acmeVoice);
```

## What `checkCopyRecord` actually does

For every entry in a `CopyRecord`, it calls `@vespeneventures/voice`'s
`checkCopy(voiceRecord, entry.text, options)` and flattens the result into
one report: every finding tagged with the `entryId` it came from, every
waived finding likewise, and one nested `VoiceCheckReport` per entry under
`report.checked` for anyone who wants the full per-entry detail. It never
invents a second checking mechanism — every real violation this package can
report is a violation `@vespeneventures/voice`'s own checker already knows
how to find; see that package's README for exactly what `checkCopy` does and
does not attempt (forbidden glossary terms, forbidden person/tense markers,
unsupported claims — never tone, never grammar, never paraphrase detection).

`checkCopyRecord` additionally validates the `CopyRecord` and `VoiceRecord`
it is given, itself, before doing anything else — see "Fails closed" below.

## Fails closed

An unhelpful "0 findings" can mean two very different things: nothing was
wrong, or nothing was actually checked. This package's design brief was
written the morning after five agents independently shipped a first draft
that could not tell those two apart — so every situation that could
otherwise look like a clean pass is instead surfaced as an explicit,
visible incompleteness:

- **An invalid `CopyRecord`.** `checkCopyRecord` runs
  `validateCopyRecordShape` on its own `record` argument before checking
  anything — it does not trust its own TypeScript type, because a
  plain-JS caller (or a value that merely satisfies the type at compile
  time) can hand it something that does not actually conform. Every entry
  is recorded in `report.skipped`, best-effort attributed by id (or a
  positional label like `"$1"` for an entry too malformed to have a
  usable id at all — see `schema.ts`'s `bestEffortSkipList`), and
  `report.findings` names exactly what was wrong.
- **An invalid `VoiceRecord`.** Same treatment, via
  `@vespeneventures/voice`'s own `validateVoiceRecordShape` — this is a
  deliberate difference from `voice`'s own `checkCopy`, which does NOT
  self-validate its `VoiceRecord` argument (see that function's doc
  comment). This package chooses the stricter behavior for its own entry
  point, because "did you validate the voice record before calling this"
  is exactly the kind of caller discipline a check should not have to
  assume.
- **Zero entries.** A `CopyRecord` with `entries: []` is well-formed as
  far as `validateCopyRecordShape` is concerned (see that function's own
  doc comment for why), but `checkCopyRecord` still refuses to call it a
  clean pass: `report.findings` carries a `"record:no-entries"` error,
  `report.complete` is `false`, and `report.checkedCount` is `0`.

In every one of these cases, `report.complete` is `false` — meaning "this
run could not vouch for having checked everything it was asked to", not
"something failed a rule". Independently, `report.checkedCount` and
`report.skippedCount` are always populated as their own fields (not just
inferable from `checked.length`/`skipped.length`), so a caller reading only
those two numbers, without inspecting either array, still cannot mistake a
"nothing checked" run for a "nothing wrong" one.

The reverse matters just as much: `report.complete: true` says nothing about
whether the copy is clean — a `CopyRecord` full of real voice violations is
still `complete: true` once every entry has actually been run, exactly
mirroring `@vespeneventures/voice`'s own `VoiceCheckReport.complete`. Check
`report.findings`, not `report.complete`, to ask "did anything go wrong".

## What `checkCopyRecord` does not attempt

- **Per-entry waiver scoping.** `options.waivers` applies uniformly to
  every entry's `checkCopy` call — a waiver for `glossary:forbidden-term`
  matching `"revolutionary"` waives that finding in every entry that
  triggers it, not just one. A caller that needs true per-entry scoping
  can call `@vespeneventures/voice`'s `checkCopy` directly, per entry,
  with its own waiver list — this is exactly what `checkCopyRecord` does
  internally, just with one shared list.
- **Resolving `factRef`.** Identical seam to `@vespeneventures/voice`'s
  `Claim.factRef` — see below.
- Anything `@vespeneventures/voice`'s own `checkCopy` does not attempt
  either (tone, real grammatical parsing, paraphrase detection). See that
  package's README for the full list; this package adds no mechanism of
  its own on top of it.

## The `factRef` seam

`CopyEntry.factRef` is a **plain, optional string** — never a typed import,
never a runtime dependency on `@vespeneventures/strategy`. This mirrors
exactly how `@vespeneventures/voice`'s `Claim.factRef` refers to a
`strategy` package's facts without importing it: the coupling is an opaque
string convention, not a code import, so this package works today, before
`strategy` (or a consumer's own facts registry) exists at all, and keeps
working unchanged after it does. Neither `schema.ts` nor `checker.ts` ever
resolves a `factRef` against anything — that is a later gate's job, one with
visibility into both this package's entries and a real facts registry,
which this package deliberately does not have.

## Placeholders

`placeholders` names the interpolations a `CopyEntry.text` must contain,
checked against the literal `{name}` convention — brace-delimited, the same
syntax already familiar from ICU MessageFormat and most i18n libraries. This
is presence-detection over an already-authored string, never a formatting
engine: `Intl.PluralRules`, `Intl.ListFormat`, `Intl.RelativeTimeFormat`, and
`Intl.NumberFormat.prototype.formatRange` already exist natively in Node
20+ for the actual work of pluralization, list joining, relative time, and
number ranges, and this package does not re-wrap any of them — doing so
would repeat a mistake this repository's own package history has already
made once and undone: a small, evidence-picked icon package that re-packaged
something the platform and ecosystem already provided was built and then
retired. That door stays shut here on purpose.

A placeholder declared in `placeholders` but missing from `text` — copy was
edited and an interpolation was dropped, or the list drifted from the
sentence — is a real, mechanically-checkable bug, not a formatting
concern, so `validateCopyRecordShape` reports it as
`"placeholder-missing-from-text"`.

## The copy scanner and gate

Registering copy by hand only works if every user-facing string actually
gets registered. `scanCopySourceTree` walks a real source tree and extracts
every string/template literal, AND — in a `.tsx`/`.jsx` file — every raw
JSX text node (`<span>Hello</span>`'s `Hello`), that looks like user-facing
copy — as opposed to a class name, an import specifier, an object key, an
`aria-*`/`data-*` attribute, an enum/variant token, or a developer-facing
diagnostic (`console.error`, `throw new Error(...)`). `checkCopyTraceability`
is the pure gate that checks every extracted candidate against a
`CopyRecord`: it either matches a registered entry's `text` (compared by
STATIC SHAPE, every `{name}`/`${...}` interpolation collapsed to the same
sentinel on both sides, so a source expression's actual content and a
registered entry's placeholder names never need to agree — source code
carries JS template syntax while a registry entry carries this package's
`{name}` convention, and only structure can match across that boundary) or
carries a `copy:<id>` comment on its own line citing a real entry — anything
else is reported as untraced.

```ts
import { checkCopyTraceability, readCopyRecord, scanCopySourceTree } from "@vespeneventures/copy";

const scan = scanCopySourceTree("./src"); // .ts, .tsx, .js, .jsx by default
const { record } = readCopyRecord("./content/copy.json");
const result = checkCopyTraceability(scan.candidates, scan.citations, record!, scan.filesScanned, scan.unchecked);

for (const finding of result.findings) {
  console.error(`[${finding.rule}] ${finding.file}:${finding.line} — ${finding.message}`);
}
if (result.unchecked.length > 0) process.exitCode = 2; // see "Exit codes" below — never let this read as a pass
else if (result.findings.length > 0) process.exitCode = 1;
```

`checkCopyTraceability` is pure — it takes already-extracted
`CopyCandidate[]`/`Citation[]` and an already-loaded `CopyRecord`, does no
I/O, and never throws on any input shape. `scanCopySourceTree` is the I/O
half (and, unlike `@vespeneventures/strategy`'s own `scan.ts`/gate split,
also the hard-analysis half — see `scan.ts`'s own doc comment for why
finding which literals are copy is a problem about source text, not about a
file tree). **Fails closed**: an unreadable directory or file throws rather
than being silently treated as empty.

### JSX text nodes

`<span>Hello</span>`'s `Hello` — a bare word between tags, never inside a
quote at all — is found too, in a `.tsx`/`.jsx` file (a `.ts`/`.js` file is
never scanned for JSX). This closed a real gap: `@vespeneventures/ui` in
this same repo is entirely JSX, so a scanner that only understood string/
template literals reported a clean pass over files that were, in large
part, untracked user-facing copy (see issue #37). The tractable core is
exactly what it sounds like — text between the `>` that closes an opening
tag and the next `<` — with the same care this package's string/template
handling already takes: mixed content (`<p>Hello <strong>there</strong>
friend</p>`) becomes separate candidates, never concatenated across an
element boundary and never dropping the tail; `{expression}` children
(including a `{/* JSX comment */}`) are code, not text, and are skipped;
common named (`&amp;`, `&nbsp;`, ...) and every numeric (`&#8212;`,
`&#x2014;`) JSX entity is decoded; whitespace-only text between sibling
tags is dropped without even being counted (ordinary indentation, not
authored content); a punctuation/symbol-only text run is excluded the same
way a decorative string literal already was. A `<` that is really a
generic type argument (`Map<string, string>`) or a comparison (`a < b`) is
never mistaken for JSX — see `scan.ts`'s own doc comment, "JSX TEXT NODES",
for exactly how.

What the scanner genuinely cannot resolve — an unclosed element, an
unterminated attribute value or expression, JSX nesting deep enough to
trip a safety bound — is reported via `ScanResult.unchecked`, never
silently dropped. See "Exit codes" below for what a non-empty `unchecked`
list means for `copy-check`.

### What the scanner does not catch

- **A fully general regex-vs-division disambiguation** for a bare `/`. If
  the scanner's heuristic desyncs badly enough that quote balance goes
  wrong by end of file, the file is reported as a parse failure and
  contributes zero candidates — never silently mis-scanned.
- **Full escape-sequence decoding.** Only the common escapes are unescaped
  for matching/reporting; an exotic escape (`\u{1F600}`, `\x41`) may be
  very slightly off in the reported text.
- **An unrecognized named JSX entity** (something outside the common set
  `&amp;`/`&lt;`/`&gt;`/`&quot;`/`&apos;`/`&nbsp;`/a handful of
  typographic entities) is left verbatim in the candidate's text, not
  guessed at.

Every excluded literal, skipped file, parse failure, and unresolved JSX
construct is counted and reported by reason
(`ScanResult.excluded`/`skippedByDesign`/`parseFailures`/`unchecked`) —
never silently dropped, matching this package's "fails closed" discipline
for the registry half above.

### Citations and the escape hatch

Same two-marker convention `@vespeneventures/strategy`'s facts gate uses,
checked on the same line as the candidate (an HTML comment, a block
comment, a JSX comment, or a line comment all work):

- `copy:<id>` — cites a real entry in the `CopyRecord` by its `id`. Traces
  the candidate on that line. Citing an id that does **not** exist is
  itself a finding (`unknown-copy-citation`) — a rotted or misspelled id
  can't silently satisfy the gate.
- `copy-gate:ignore` — suppresses the candidate on that line without
  requiring a citation. Recorded into `result.ignored`, never silently.

```tsx
const label = "Legacy placeholder copy"; // copy-gate:ignore
const heading = "Showing results"; // copy:search.heading
```

### The `copy-check` CLI

```bash
npx copy-check ./content/copy.json ./src
```

```
Usage: copy-check <record-file> [scan-dir] [options]

  record-file    Path to a CopyRecord JSON file (see this README's frozen contract above). Required.
  scan-dir       Directory to scan for user-facing string/template literals. Defaults to the current working directory.

Options:
  --help         Print this message and exit 0.
```

Exit codes — the same three-state contract `@vespeneventures/strategy`'s
`strategy-facts-check` and `@vespeneventures/gates`' `foundry-check` use:

| Code | Meaning |
| --- | --- |
| `0` | Ran cleanly: the copy record loaded, at least one file was actually scanned, zero findings, and `unchecked` is empty. |
| `1` | Ran cleanly, at least one finding (an unregistered copy candidate, or a citation to a copy id that does not exist), and `unchecked` is empty. |
| `2` | **Could not run** — bad input, the copy record missing/unreadable/invalid, the scan directory does not exist, the walk matched zero files, every matched file failed to tokenize, an unreadable directory during the walk, OR at least one `ScanResult.unchecked` entry: a JSX construct the scanner recognized but could not reliably classify. That last case is not a `1`-severity finding — it means part of an otherwise-matched file was never actually examined, the same "could not check" shape `parseFailures`/zero-files-scanned already are, just at finer grain. Every real finding is still printed first; `unchecked` only refuses to let the run read as clean or fully accounted-for. Never conflated with `0`: a gate that reports "clean" after failing to actually check everything is worse than no gate at all. |

## API

### Registry (`types.ts`, `schema.ts`, `registry.ts`, `checker.ts`)

| Export | Kind | Purpose |
| --- | --- | --- |
| `checkCopyRecord(record, voiceRecord, options?)` | function | Runs every `CopyEntry.text` in `record` through `@vespeneventures/voice`'s `checkCopy` against `voiceRecord`. Throws a plain `TypeError` for a non-object `record` or `voiceRecord` (a caller-input problem, not a finding). Fails closed on an invalid `record`, an invalid `voiceRecord`, or zero entries — see "Fails closed" above. Returns a `CopyRecordCheckReport`. |
| `validateCopyRecordShape(value)` | function | Hand-rolled structural validation (plain `typeof`/shape checks, no schema library — see "Requirements"), in the style of `@vespeneventures/strategy`'s `validation.ts` and `@vespeneventures/voice`'s own `validateVoiceRecordShape`. Returns a `CopyFinding[]` with descriptive rule ids (`"id-shape"`, `"id-well-formed"`, `"id-unique"`, `"text-shape"`, `"context-shape"`, `"placeholders-shape"`, `"placeholder-missing-from-text"`, `"fact-ref-shape"` — see `schema.ts` for the full list), always `"error"` severity. `[]` means `value` is a well-formed `CopyRecord`, once defaults are applied. Never throws, on any input. A record with `entries: []` is well-formed as far as this function is concerned — see `checkCopyRecord` for why zero entries is still treated as a failure one layer up. |
| `parseCopyRecord(value)` | function | Same validation as `validateCopyRecordShape`, but throws a plain `Error` (listing every issue) instead of returning findings — for a fail-fast config-loading call site. Returns a `CopyRecord` with this schema's one default applied (`placeholders: []`) on success. |
| `readCopyRecord(path)` | function | Reads and validates the `CopyRecord` JSON file at `path`, in the shape of `@vespeneventures/strategy`'s `readStrategy` — the one place in this package that touches a filesystem. Never throws: an unreadable file, unparseable JSON, or a schema violation are each recorded into the returned `CopyRegistryReadResult.issues`, never thrown. Returns a `CopyRegistryReadResult`. |
| `CopyEntryId` | type | `string`. Dot-separated, lowercase, kebab-case within each segment, at least one dot — e.g. `"pagination.no-results"`. |
| `CopyEntry` | type | `{ id, text, context, placeholders?, factRef? }`. One addressable, reviewable piece of copy. |
| `CopyRecord` | type | `{ id, entries }`. One consumer's whole registered set of entries — the "brand.css" of this package. |
| `CopyFinding` | type | `{ rule, severity: "error" \| "warning", message, path? }` — deliberately the same shape as `@vespeneventures/voice`'s `VoiceFinding`. What `validateCopyRecordShape` returns. |
| `CopyRegistryReadIssueReason` | type | `"unreadable" \| "unparseable" \| "invalid-schema"`. Why a file did not become a usable `CopyRecord`. |
| `CopyRegistryReadIssue` | type | `{ reason, detail }`. One entry of `CopyRegistryReadResult.issues`. |
| `CopyRegistryReadResult` | type | `{ path, record?, issues, complete }` — what `readCopyRecord` returns. `complete` is `true` exactly when `issues` is empty and `record` is populated. |
| `CopyRecordCheckOptions` | type | `{ waivers?: VoiceCheckWaiver[] }` — `checkCopyRecord`'s third argument, applied uniformly to every entry. See "What `checkCopyRecord` does not attempt". |
| `CopyRecordCheckReport` | type | `{ recordId, checked, skipped, checkedCount, skippedCount, findings, waived, complete }` — what `checkCopyRecord` returns. See "Fails closed" for what each field means and why both count fields exist alongside their arrays. |
| `CopyEntryCheckResult` | type | `{ entryId, report }` — one entry `checkCopyRecord` actually ran, and its own, unmodified `VoiceCheckReport` (from `@vespeneventures/voice`). One entry of `CopyRecordCheckReport.checked`. |
| `CopyEntrySkip` | type | `{ entryId, reason }` — one entry `checkCopyRecord` did NOT run, and why. One entry of `CopyRecordCheckReport.skipped`. |
| `CopyRecordFinding` | type | A `VoiceFinding` plus an optional `entryId` — `undefined` for a record-level finding (an invalid record/voice record, or zero entries), set for a finding that came from one specific entry's `checkCopy` run. What `CopyRecordCheckReport.findings` holds. |
| `CopyRecordWaivedFinding` | type | A `CopyRecordFinding` plus the `VoiceCheckWaiver` that covered it — mirrors `@vespeneventures/voice`'s `WaivedVoiceFinding`. What `CopyRecordCheckReport.waived` holds. |
| `VoiceRecord`, `VoiceCheckReport`, `VoiceCheckWaiver`, `VoiceFinding` | re-exported | From `@vespeneventures/voice`, so a caller building or reading a `checkCopyRecord` call never needs a direct dependency on `voice` just for the types its own signature and report shape use — mirrors `@vespeneventures/gates`' own re-export of `@vespeneventures/catalog`/`policy` types for the same reason. |

### Scanner (`scan.ts`)

| Export | Kind | Purpose |
| --- | --- | --- |
| `scanCopySourceTree(root, options?)` | function | Walks `root` and extracts every string/template literal, and (in a `.tsx`/`.jsx` file) every JSX text node, that looks like user-facing copy from each matching file (default extensions `.ts`, `.tsx`, `.js`, `.jsx`) into a `ScanResult`. **Fails closed** — throws rather than silently skipping an unreadable directory or file. |
| `extractCopyCandidates(content, filePath)` | function | Pure — no I/O. The classification half `scanCopySourceTree` calls per file: tokenizes `content` and sorts every literal/JSX text node into a copy candidate or an excluded literal, with a stated reason; `filePath`'s extension (`.tsx`/`.jsx` vs. anything else) decides whether JSX scanning runs at all. Exported so a test (or a consumer with its own file-gathering, e.g. only the files touched by a diff) can exercise it directly against source text, without a real directory walk. |
| `PLACEHOLDER_SENTINEL` | const | The private-use-area code point every `${...}` interpolation (and, in `copy-gate.ts`, every `CopyEntry.text` `{name}` placeholder) is collapsed to before two literals' shapes are compared. Exported for a consumer normalizing text the same way outside `checkCopyTraceability`. |
| `ScanOptions` | type | `{ extensions?: string[]; skipDirs?: string[] }` — `skipDirs` defaults to `node_modules`, `.git`, `dist`, `build`, `coverage`. |
| `ScanResult` | type | `{ filesScanned, candidates, excluded, citations, skippedByDesign, parseFailures, unchecked }` — what `scanCopySourceTree` returns. `filesScanned` is the count `cli.ts` requires to be `> 0` for a clean pass. `unchecked` is never omitted — empty is the ordinary, expected outcome for a well-formed file. |
| `CopyCandidate` | type | `{ file, line, kind: "string" \| "template" \| "jsx-text", raw, normalized, placeholderCount, citedIds, hasIgnoreMarker }` — one string/template literal or JSX text node `scanCopySourceTree` decided is in-scope. `"jsx-text"` has no quote/backtick delimiters in `raw` — it is the JSX-whitespace-collapsed, entity-decoded text itself. One entry of `ScanResult.candidates`. |
| `ExcludedLiteral` | type | `{ file, line, raw, reason }` — one literal or JSX text run deliberately excluded from `candidates`, and why. One entry of `ScanResult.excluded`. |
| `ExclusionReason` | type | `"import-or-require-specifier" \| "object-or-destructuring-key" \| "type-or-interface-context" \| "aria-or-data-attribute-value" \| "denylisted-attribute-or-prop-value" \| "classname-builder-argument" \| "developer-diagnostic-argument" \| "no-letters" \| "enum-or-token-shaped"`. The last one, `"enum-or-token-shaped"`, is never applied to a `"jsx-text"` candidate — see "JSX text nodes" above. |
| `Citation` | type | `{ file, line, id }` — one `copy:<id>` marker found anywhere in a scanned file, independent of whether a candidate shares its line. One entry of `ScanResult.citations`. |
| `SkippedFile` | type | `{ file, reason: "test-or-check-file" }` — a file matched by extension but never tokenized at all (`*.test.ts(x)`, `*.spec.ts(x)`, `*.check.ts(x)`, `*.d.ts`). One entry of `ScanResult.skippedByDesign`. |
| `ParseFailure` | type | `{ file, detail }` — a file that was read but could not be reliably tokenized (unbalanced quote/comment/regex state at EOF). Contributes zero candidates. One entry of `ScanResult.parseFailures`. |
| `UncheckedItem` | type | `{ file, line, kind, detail }` — one JSX construct the scanner recognized but could not reliably classify (an unclosed element, an unterminated attribute value/expression, JSX nesting past the depth safety bound, ...). One entry of `ScanResult.unchecked`. |

### Gate (`copy-gate.ts`)

| Export | Kind | Purpose |
| --- | --- | --- |
| `checkCopyTraceability(candidates, citations, record, filesScanned, unchecked)` | function | Pure. Evaluates every `candidate` against `record` — matched by registered text shape or a valid `copy:<id>` citation — and every `citation` against `record`'s real ids. `unchecked` (see `ScanResult.unchecked`) is required and passed straight through onto the result, unmodified. Never throws. Returns a `CopyGateResult`. |
| `CopyGateResult` | type | `{ findings: CopyGateFinding[]; ignored: CopyGateIgnored[]; filesScanned: number; candidatesScanned: number; matched: number; unchecked: UncheckedItem[] }`. |
| `CopyGateFinding` | type | `{ rule: CopyGateRule; severity: "error"; file; line; message; snippet }`. |
| `CopyGateRule` | type | `"unregistered-copy" \| "unknown-copy-citation"`. |
| `CopyGateIgnored` | type | `{ file; line; snippet }` — one candidate suppressed via `copy-gate:ignore`. |

The `copy-check` CLI (`bin`, built from `cli.ts`) is documented in its own
section above.

## Non-goal: resolving `factRef`

Same non-goal, same reasoning, as `@vespeneventures/voice`'s own README
section of this name: this package checks that a `factRef` is *present*
when one is declared, and never validates that it actually names a real
fact in any registry. That check needs visibility into both this package's
entries and a `strategy` package's (or a consumer's own) facts, which is a
different, deliberately separate tool's job.

## Requirements

Node 20+. ESM only. **One runtime dependency: `@vespeneventures/voice`**,
pinned with a `~0.1.0` range — not a caret range. Caret ranges on a `0.x`
package are patch-only (`^0.1.0` does not match a real `0.2.0`), which has
broken this repository's own CI twice; a tilde range is the correct way to
say "any patch of 0.1" without silently refusing a legitimate later 0.x of
this repository's own sibling package.

Otherwise, zero runtime dependencies — matching
`@vespeneventures/catalog`, `@vespeneventures/policy`,
`@vespeneventures/tokens`, and `@vespeneventures/voice`'s own precedent.
`types.ts` and `schema.ts` in particular carry no dependency on
`@vespeneventures/voice` at all (only `checker.ts` does) and hand-roll their
own validation with plain type guards, in the style of
`@vespeneventures/strategy`'s `validation.ts`, rather than reaching for a
schema library. That matters more than usual for a *public* package: this
package's only consumers are external installers, and a schema-library
dependency would force every one of them onto that library's major version
(or a duplicate install, if their own code already depends on a different
one) for the sake of validating a handful of nested objects. In particular,
zero dependency on `@vespeneventures/policy`, `@vespeneventures/tokens`, or
any `strategy` package, despite this README's comparisons to several of
them.

## Licence

MIT
