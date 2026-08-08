# @vespeneventures/assets

The visual-registry layer over `@vespeneventures/compose`'s
`SlotBinding.assetId` seam — the exact same split
`@vespeneventures/copy` draws over `@vespeneventures/voice`'s verbal
contract, one layer over, for images instead of words. `compose`'s
`ElementKind` has always had `"image"` and `"logo"` members, but until
this package existed there was nowhere for a binding to point an image
AT — `SlotBinding` carried only `copyId`/`value`, both text, so an
`"image"` slot could only ever render as a styled word. `assets` is the
missing registry: a schema for registering a consumer's own images as
addressable, reviewable, versioned entries (`AssetEntry`/`AssetRecord`),
a reader that loads a consumer's real registry file, and a coverage
check that reports drift between what a consumer's documents reference
and what is actually registered.

```bash
npm install @vespeneventures/assets
```

## The single most important constraint

**This package ships no actual images, and never calls a generation API.**
Not one URL, not one real photograph, not one AI-generated asset. It ships
a schema for registering images (`AssetEntry`/`AssetRecord`), a reader that
loads a consumer's real registry file, and a coverage checker.

```
the AssetEntry/AssetRecord shape   machinery      types.ts + schema.ts, this package
your registered images               binding        your entries, your src, your alt text, your own repo
what your documents reference        downstream     your compose documents' SlotBinding.assetId values, checked against it
```

**Generation is explicitly out of scope, on purpose.** No Recraft, no
image API, no model calls, no network request anywhere in this package.
A generation adapter that FILLS this registry is a later, separate
concern, and must never become a dependency of this contract — this
repository has already retired two packages for getting that order
backwards ("engine before record"; see the root README's
`../../docs/DECISIONS.md`). If a doc comment, a test fixture, or a README
example in this package ever reads like a real photograph, illustration,
or generated image, that is a bug in this package, not a feature of it.
See `@vespeneventures/copy`'s README section on why it ships no real
copy, for the fuller version of this argument.

## The frozen contract

```ts
/** Dot-separated, lowercase, e.g. "marketing.hero-banner". */
type AssetEntryId = string;

interface AssetEntry {
  id: AssetEntryId;
  src: string;
  width: number;
  height: number;
  alt: string;
  mimeType?: string;
  licence?: string;
  credit?: string;
}

interface AssetRecord {
  id: string;
  entries: AssetEntry[];
}
```

`alt` is **required**, deliberately not optional. An asset registry that
lets alt text be blank or omitted will produce inaccessible output for
every consumer of every entry that slips through — there is no later
point in a rendering pipeline where alt text can be recovered from a URL
and two integers. The precedent is already set one layer up:
`@vespeneventures/compose`'s own `ImageMeta.alt`
(`packages/compose/src/types.ts`) is required for exactly this reason.
Whitespace-only alt text (`"   "`) is rejected too, not just empty
strings — see "Fails closed" below.

`width`/`height` are required positive numbers (intrinsic pixel
dimensions) — a renderer laying out a fixed-canvas document (print,
slides, image) needs real dimensions to reserve space and avoid layout
shift; a zero or negative dimension is never valid image geometry.

`mimeType`, `licence`, and `credit` are optional, and each earns its
place:

- **`mimeType`** — a renderer choosing how to embed an asset (inline
  `<img>` vs. a CID attachment in `./email`, whether an SVG can be
  inlined as markup) needs the content type up front, without fetching or
  sniffing the bytes at `src`.
- **`licence`** — unlike authored copy, an image asset routinely carries
  real usage-rights constraints (`"CC-BY-4.0"`, `"proprietary — internal
  use only"`) a reviewer must be able to see next to the id before
  publication, not track by memory outside the registry.
- **`credit`** — many licences require specific attribution text
  alongside the licence name itself; kept as its own field because a
  licence NAME and the attribution text it obligates are two
  independently-checkable pieces of information.

## Usage

```ts
import { checkAssetCoverage, type AssetRecord } from "@vespeneventures/assets";

// A consumer repo owns this — never this package. Ids and paths here are
// obviously fictional placeholders, the same convention this repository's
// own packages/voice and packages/copy READMEs already use.
const acmeAssets: AssetRecord = {
  id: "acme-app",
  entries: [
    {
      id: "marketing.hero-banner",
      src: "/images/hero-banner.png",
      width: 1600,
      height: 900,
      alt: "Illustration of the Acme dashboard on a laptop screen",
      mimeType: "image/png",
    },
  ],
};

// The asset ids your own compose documents actually reference — in
// practice, every SlotBinding.assetId across your ComposeDocuments.
const referenced = ["marketing.hero-banner"];

const report = checkAssetCoverage(referenced, acmeAssets);

for (const finding of report.findings) {
  console.error(`[${finding.severity}] ${finding.rule}: ${finding.message}`);
}
if (!report.ok) process.exitCode = 1;
```

Loading a registry file from disk instead of an inline literal:

```ts
import { readAssetRecord } from "@vespeneventures/assets";

const result = readAssetRecord("./content/assets.json");
if (!result.complete || !result.record) {
  for (const issue of result.issues) console.error(`${issue.reason}: ${issue.detail}`);
  process.exit(2);
}
const report = checkAssetCoverage(referenced, result.record);
```

## Fails closed

An unhelpful "0 findings" can mean two very different things: nothing was
wrong, or nothing was actually checked. This package's design brief was
written against the same failure mode `@vespeneventures/copy`'s own
`checker.ts` was — so every situation that could otherwise look like a
clean pass is instead surfaced as an explicit, visible incompleteness:

- **An invalid `AssetRecord`.** `checkAssetCoverage` runs
  `validateAssetRecordShape` on its own `record` argument before checking
  anything — it does not trust its own TypeScript type, because a
  plain-JS caller (or a value that merely satisfies the type at compile
  time) can hand it something that does not actually conform. Every
  referenced id is recorded in `report.unchecked` rather than silently
  compared against an empty or partial registry, and `report.findings`
  names exactly what was wrong with the record.
- **A malformed `referencedIds` entry.** Anything in the list that is not
  a non-empty string — `undefined`, a number, an empty string, a
  whitespace-only string — is recorded in `report.unchecked`, described
  by its position, rather than silently skipped or coerced.
- **Zero referenced ids actually checked.** `report.ok` requires
  `checkedCount > 0`. A caller that (by a wiring bug, or simply because
  nothing has shipped yet) hands this function an empty list gets
  `ok: false`, never a silent "0 findings" that reads identically to
  "checked everything, found nothing wrong".
- **Whitespace-only `alt`.** `"   "` passes a naive `.length > 0` check
  while rendering as no alt text at all — the same gap
  `@vespeneventures/compose`'s `validate.ts` closed for
  `SlotBinding.value` (`binding-value-shape`) after a whitespace-only
  value slipped past a first, looser check. `schema.ts` holds the
  stricter line from the start.

In every one of these cases, `report.ok` is `false` — meaning "this run
could not vouch for having checked everything it was asked to, or found
something wrong", not merely "found a rule violation". `report.findings`
being empty is never, by itself, a reason to trust a run; read `.ok`.

## What `checkAssetCoverage` reports

Two finding severities, deliberately different, both required to be empty
for `ok: true`:

- **`"unregistered-asset"` (error)** — a referenced id has no matching
  entry in the `AssetRecord`. This means a renderer wired against this
  registry has nothing to resolve `assetId` to right now.
- **`"unreferenced-asset"` (warning)** — a registered entry that no
  checked id named. Lower severity because it costs nothing to render
  correctly today, but still surfaced: it is either intentional future
  inventory or a stale entry a rename left behind, and only a human
  reviewing the finding can tell which.

## The `assets-check` CLI

```bash
npx assets-check ./content/assets.json ./content/referenced-asset-ids.json
```

`referenced-asset-ids.json` is a plain JSON array of strings — this
package has no scanner of its own (unlike `@vespeneventures/copy`'s
`copy-check`, which walks real source files): a consumer's own build is
the thing that actually knows which `ComposeDocument`s exist and what
they bind, so this CLI's job starts one step later, once that list has
already been gathered into a file.

```
Usage: assets-check <record-file> <referenced-ids-file> [options]

  record-file            Path to an AssetRecord JSON file (see this README's frozen contract above). Required.
  referenced-ids-file    Path to a JSON file containing an array of asset ids referenced by your documents (e.g. every SlotBinding.assetId). Required.

Options:
  --help         Print this message and exit 0.
```

Exit codes — the same three-state contract `@vespeneventures/copy`'s
`copy-check` and `@vespeneventures/tokens`' `tokens-brand-check` use:

| Code | Meaning |
| --- | --- |
| `0` | Ran cleanly: the asset record loaded, the referenced-ids file loaded as a well-formed array, every referenced id was actually checked, zero findings. |
| `1` | Ran cleanly, at least one finding (a referenced id with no registered entry, or a registered entry no id referenced). |
| `2` | **Could not run** — bad input, the asset record missing/unreadable/invalid, the referenced-ids file missing/unreadable/unparseable/not-an-array, at least one referenced-ids entry that was not a non-empty string, OR zero referenced ids actually checked. That last case is not a silent `0` — a coverage check that ran against nothing is "could not run [anything worth trusting]", never "ran and found the registry perfectly covered". |

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `checkAssetCoverage(referencedIds, record)` | function | Compares `referencedIds` (a plain array — validated at runtime, not trusted from its type) against `record`. Never throws. Fails closed on an invalid `record`, a non-array `referencedIds`, malformed individual entries, or zero ids actually checked — see "Fails closed" above. Returns an `AssetCoverageReport`. |
| `validateAssetRecordShape(value)` | function | Hand-rolled structural validation (plain `typeof`/shape checks, no schema library — see "Requirements"), in the style of `@vespeneventures/copy`'s own `validateCopyRecordShape`. Returns an `AssetFinding[]` with descriptive rule ids (`"id-shape"`, `"id-well-formed"`, `"id-unique"`, `"src-shape"`, `"width-positive"`, `"height-positive"`, `"alt-shape"`, `"alt-not-whitespace-only"`, `"mime-type-shape"`, `"licence-shape"`, `"credit-shape"` — see `schema.ts` for the full list). `[]` means `value` is a well-formed `AssetRecord`. Never throws, on any input. |
| `parseAssetRecord(value)` | function | Same validation as `validateAssetRecordShape`, but throws a plain `Error` (listing every issue) instead of returning findings — for a fail-fast config-loading call site. Returns a fully-typed `AssetRecord` on success. |
| `readAssetRecord(path)` | function | Reads and validates the `AssetRecord` JSON file at `path`, in the shape of `@vespeneventures/copy`'s `readCopyRecord` — the one place in this package that touches a filesystem. Never throws: an unreadable file, unparseable JSON, or a schema violation are each recorded into the returned `AssetRegistryReadResult.issues`, never thrown. Returns an `AssetRegistryReadResult`. |
| `AssetEntryId` | type | `string`. Dot-separated, lowercase, kebab-case within each segment, at least one dot — e.g. `"marketing.hero-banner"`. |
| `AssetEntry` | type | `{ id, src, width, height, alt, mimeType?, licence?, credit? }`. One addressable, reviewable image asset. |
| `AssetRecord` | type | `{ id, entries }`. One consumer's whole registered set of entries — the "brand.css" of this package. |
| `AssetFinding` | type | `{ rule, severity: "error" \| "warning", message, path? }` — deliberately the same shape as `@vespeneventures/copy`'s `CopyFinding`. What `validateAssetRecordShape` and `checkAssetCoverage` both report. |
| `AssetRegistryReadIssueReason` | type | `"unreadable" \| "unparseable" \| "invalid-schema"`. Why a file did not become a usable `AssetRecord`. |
| `AssetRegistryReadIssue` | type | `{ reason, detail }`. One entry of `AssetRegistryReadResult.issues`. |
| `AssetRegistryReadResult` | type | `{ path, record?, issues, complete }` — what `readAssetRecord` returns. `complete` is `true` exactly when `issues` is empty and `record` is populated. |
| `AssetCoverageReport` | type | `{ recordId, referencedCount, checkedCount, registeredCount, findings, unchecked, ok }` — what `checkAssetCoverage` returns. See "Fails closed" for what each field means. |

The `assets-check` CLI (`bin`, built from `cli.ts`) is documented in its
own section above.

## The `compose` seam

`@vespeneventures/compose` 0.3.0 added `SlotBinding.assetId?: string` — a
plain, opaque string, deliberately **not** an import of this package.
Same seam as `SlotBinding.copyId` into a `CopyRecord`: the coupling is a
string convention, not a code import, so `compose` works whether or not
`assets` is even installed, and resolving an `assetId` against a real
`AssetRecord` (this package's `checkAssetCoverage`, or a renderer's own
lookup) is a later gate's job, one with visibility into both this
package's entries and `compose`'s documents — deliberately not either
package's own. See `@vespeneventures/compose`'s own README, "The
`copyId` seam", for the fuller argument; this is the identical seam, one
binding field over.

## Requirements

Node 20+. ESM only. **Zero runtime dependencies** — matching
`@vespeneventures/catalog`, `@vespeneventures/policy`,
`@vespeneventures/tokens`, `@vespeneventures/voice`, and
`@vespeneventures/copy`'s own precedent (`copy`'s one runtime dependency,
`voice`, exists because `copy` runs every entry through `voice`'s own
checker — this package's coverage check needs nothing from any sibling
package, so it needs no dependency at all). `types.ts` and `schema.ts`
hand-roll their own validation with plain type guards, in the style of
`@vespeneventures/strategy`'s `validation.ts`, rather than reaching for a
schema library. That matters more than usual for a *public* package: this
package's only consumers are external installers, and a schema-library
dependency would force every one of them onto that library's own
major-version churn for the sake of validating a handful of nested
objects. In particular, zero dependency on
`@vespeneventures/compose` itself — this package works today, before
`compose` 0.3.0's `assetId` seam existed, and keeps working unchanged
after it does.

## Licence

MIT
