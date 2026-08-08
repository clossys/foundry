# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0] - Unreleased

### Added

- **`SlotBinding.assetId?: string`** (`src/types.ts`) — the missing visual
  half of the `copyId` seam. `ElementKind`'s `"image"`/`"logo"` members
  have existed since this package's first release, but `SlotBinding`
  could only ever carry text (`copyId`/`value`), so every renderer built
  against those kinds could only render a styled word. `assetId` is a
  plain, opaque string seam into a `@vespeneventures/assets`
  `AssetRecord` — deliberately **not** an import of that package; this
  package remains zero-dependency, and works whether or not `assets` is
  installed. See the README, "The `assetId` seam".
- **`resolveAssets`** (`src/resolve-assets.ts`) — the symmetric companion
  to `resolveCopy`, added alongside `assetId`. Takes the same
  `ResolveResult` `resolveCopy` does and turns matched `assetId` bindings
  into actual assets via a caller-supplied `AssetLookup: (assetId:
  string) => unknown`. Same discipline as `resolveCopy`: a non-function
  `lookup`, a `lookup` that throws, or one that returns `undefined`/`null`
  all land the affected slot in `unchecked` and force `ok: false` — never
  a silent pass. A binding whose source is `copyId`/`value` instead of
  `assetId` is deferred into `deferredToCopy`, never treated as a failed
  asset lookup.

### Changed

- **`binding-source-exclusive` is now exactly-one-of-THREE**
  (`src/validate.ts`), not exactly-one-of-two. `SlotBinding` gaining
  `assetId` meant the old "both present / neither present" binary check
  no longer covered every bad combination — a binding with `copyId` AND
  `assetId` (and no `value`) previously passed this rule entirely, since
  neither the old `copyIdPresent === valuePresent` comparison nor
  anything else in that check ever looked at a third field. Rewritten to
  count how many of `copyId`/`value`/`assetId` are present and require
  exactly 1, covering every one of the 8 possible presence combinations
  (3 valid, 5 invalid) — see `validate.ts`'s own doc comment for the full
  truth table. New rule: `"binding-asset-id-shape"`, mirroring
  `binding-copy-id-shape`, for a present-but-empty `assetId`.
- **`resolveCopy` no longer treats an `assetId`-only binding as failed
  text** (`src/resolve-copy.ts`). Before this change, a binding with no
  `copyId`/`value` — which, before 0.3.0, meant EVERY `assetId` binding,
  since `assetId` did not exist — landed in `unchecked`, forcing
  `CopyResolveResult.ok: false`. Left unchanged, this would have made
  every document containing so much as one image report a resolution
  failure the moment a renderer started honoring `assetId`. `resolveCopy`
  now recognizes "exactly one source present, and it is `assetId`" as its
  own case and records it into a new `CopyResolveResult.deferredToAssets:
  string[]` field, contributing to neither `texts` nor `unchecked`.
  `ok`'s formula changed to match: `true` when `unresolvedCopyIds` and
  `unchecked` are both empty AND (`texts.length > 0` OR
  `deferredToAssets.length > 0`) — so a document made entirely of assets
  is `ok: true` from `resolveCopy`'s own point of view, while a
  `resolved` list that is empty, or that contains only unresolvable
  bindings, still reports `ok: false`. Every existing call site (a
  document with only `copyId`/`value` bindings, `deferredToAssets` always
  `[]`) is unaffected — this is a strictly additive behavior change,
  confirmed by re-running this package's and `@vespeneventures/render`'s
  full test suites unmodified.

### Migration notes for `render` and any other consumer

- Bump the `@vespeneventures/compose` dependency range from `~0.2.0` to
  `~0.3.0` — this is a real minor bump (new field, new export, a
  strictly-additive validation change), and npm `0.x` ranges are
  patch-only: neither `~0.2.0` nor `^0.2.0` resolves `0.3.0`.
- No renderer changes are required or made in this release. Every
  existing document (no `assetId` bindings) resolves identically to
  0.2.0; `resolveCopy(...).ok` is unchanged for any document that has
  none. Emitting real image elements from a resolved `assetId` binding is
  deliberately left to a follow-up change, one renderer at a time.

## [0.2.0] - Unreleased

### Fixed

- **Issue #43**: `resolveDocument` reported `ok: true` for a binding that
  matched a real slot key but produced no actual text — a binding with
  neither `copyId` nor `value`, with both, or with an empty/whitespace-only
  `value`, all resolved "successfully". `@vespeneventures/render`'s `web`
  renderer already had to work around this locally with its own
  `RenderError("empty-output", ...)`; four more renderers were about to
  each reinvent the same strengthening. `resolveDocument` now runs every
  binding that matched a real slot through `validate.ts`'s own
  `validateSlotBindingShape` (the same per-binding check
  `validateComposeDocument` already uses — reused, not re-implemented) and
  surfaces the result as the new `ResolveResult.bindingFindings:
  ComposeFinding[]`. Any `severity: "error"` entry there now forces
  `ok: false`, the same way `missingRequired`/`unknownBindings` already do.
- **`validate.ts`'s `binding-value-shape` rule accepted a
  whitespace-only `value`** (`"   "`) — found while fixing #43. The rule
  only checked `.length > 0`, so a `value` that was all whitespace passed
  as if it were real copy. Fixed with a dedicated
  `isNonEmptyNonWhitespaceString` check, scoped to `binding-value-shape`
  only (the package's other `isNonEmptyString` uses are unchanged).

### Added

- **`resolveCopy`** (`src/resolve-copy.ts`) — the second resolution pass:
  turns the slots `resolveDocument` already matched into actual text, via
  a caller-supplied `CopyLookup: (copyId: string) => string | undefined`.
  A literal `value` resolves without ever calling `lookup`. A `copyId` is
  looked up; `undefined`, `""`, or a whitespace-only result is UNRESOLVED
  — never a fallback to the `copyId`, the slot key, or an empty string.
  A binding with no source of text, one with two conflicting sources, a
  non-function `lookup`, and a `lookup` call that throws, all land the
  affected slot in the new `unchecked` field — an explicit third state,
  distinct from both "resolved" and "resolved to nothing", that alone
  forces `ok: false` (this repo's standing rule: a check that "could not
  check" must never be indistinguishable from a pass). `ok` is `true`
  only when `texts.length > 0` AND `unresolvedCopyIds` is empty AND
  `unchecked` is empty. New exports: `resolveCopy`, `CopyLookup`,
  `ResolvedText`, `CopyResolveResult`.

### Changed

- `ResolveResult` gained `bindingFindings: ComposeFinding[]` (see
  "Fixed" above). Existing consumers reading only `ok`,
  `missingRequired`, `unknownBindings`, or `resolved` are unaffected; a
  consumer that previously constructed a full `ResolveResult` literal
  (e.g. in a test) needs to add the new field.

## [0.1.0] - Unreleased

### Added

- Initial release: the join point where `@vespeneventures/ui`'s visual
  vocabulary meets `@vespeneventures/copy`'s verbal one, plus everything a
  specific output channel needs to know.
- **The frozen contract** (`src/types.ts`): `ComposeDocument`, `Channel`,
  `SlotBinding`, `Frame`, `ElementKind`, `StyleBinding`, `SlotSpec`,
  `LayoutSpec`, and the five `ChannelMeta` variants (`WebMeta`,
  `EmailMeta`, `PrintMeta`, `SlidesMeta`, `ImageMeta`) — plain TypeScript
  types, no schema library.
- **Validation** (`src/validate.ts`): `validateComposeDocument` —
  hand-rolled type-guard validation, in the style of
  `@vespeneventures/strategy`'s `validation.ts` and
  `@vespeneventures/copy`'s `schema.ts`. Enforces the channel/`meta`
  discriminant agrees; `layout` present exactly when the channel requires
  it (`print`/`slides`/`image`) and absent exactly when forbidden
  (`web`/`email`); every `SlotBinding` has exactly one of `copyId`/`value`;
  every `Frame` is within 0..1, has nonzero area, and fits inside the
  canvas; `EmailMeta.preheader` is at most 140 characters; `ImageMeta`
  dimensions are positive; every `SlotSpec.key` is unique within a
  `LayoutSpec`.
- **Resolution** (`src/resolve.ts`): `resolveDocument(doc, layout)` —
  matches a document's bindings against a real layout's slots, reporting
  `missingRequired` and `unknownBindings` explicitly rather than silently
  dropping either. `ok` is `true` only when at least one slot actually
  resolved and neither list has any entries — an empty layout, an empty
  binding list, or a document that matched no slots is `ok: false`, never
  a silent clean pass on having resolved nothing.
- **Unit conversion** (`src/frame.ts`): `frameToPercent` and
  `frameToInches` — the two conversions a renderer needs out of a
  fractional `Frame`.
- **Slot helpers** (`src/slots.ts`): `listSlotKeys`, `requiredSlotKeys`,
  `getSlotSpec`.
- Zero runtime dependencies — matching `@vespeneventures/catalog`,
  `@vespeneventures/policy`, `@vespeneventures/tokens`, and
  `@vespeneventures/voice`'s own precedent. No dependency on
  `@vespeneventures/ui` or `@vespeneventures/copy` either: `copyId` and
  `template` are both plain-string seams, never imports.
- Full test coverage in `src/*.test.ts`, entirely hermetic: every function
  in this package is pure (no I/O, no filesystem, no network), so every
  test runs against inline literal fixtures only.
