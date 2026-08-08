# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
