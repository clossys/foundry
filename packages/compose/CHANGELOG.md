# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
