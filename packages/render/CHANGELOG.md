# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - Unreleased

### Added

- **`./image` and `./slides`** (`src/image/`, `src/slides/`): render a
  fixed canvas with absolutely-positioned slots — one canvas for
  `./image`, an ordered sequence of the same canvas for `./slides` — as
  self-contained SVG. Never raster bytes: `ImageMeta.format` may ask for
  `"png"`/`"jpeg"`/`"webp"`, but both channels always emit SVG and say so
  honestly in their result (`requestedFormat` plus a warning that
  rasterization is the caller's own job) — see the README, "Architectural
  decision: SVG, never raster bytes".
  - **`renderImageDocument(doc, options?)`** — resolves a
    `channel: "image"` `ComposeDocument` against `doc.layout` (via
    `@vespeneventures/compose`'s `resolveDocument` then `resolveCopy` —
    never hand-rolled, closing the exact #43 gap that function exists to
    close) and emits SVG sized to `ImageMeta.width`/`height`, scaled per
    `ImageMeta.scale` (`viewBox` stays at LOGICAL units; only the emitted
    `width`/`height` attributes scale — the standard retina-SVG shape,
    asserted in a golden test). `ImageMeta.alt` is emitted as `<title>`
    plus `role="img"`/`aria-label`. Throws `RenderError` (`"wrong-channel"`,
    `"resolution-failed"`, `"empty-output"` — all reused from `./web`'s own
    set, no new reasons needed for this channel) rather than silently
    rendering an incomplete image.
  - **`renderSlidesDeck(deck, options?)`** — takes a `SlidesDeckInput`
    (`{ id, slides: ComposeDocument[], notes?: Record<string,string> }`):
    a plain, ORDERED array of real `channel: "slides"` `ComposeDocument`s
    (array index is deck order, never inferred) plus deck-wide speaker
    notes keyed by slide id. Canvas size is fixed by `SlidesMeta.aspect`:
    `16:9` -> 1920x1080, `4:3` -> 1024x768. A notes key matching no slide
    is reported in `unknownNoteKeys` (never dropped, never thrown — it
    doesn't block an otherwise-good render); a failing slide (wrong
    channel, failed resolution, empty required output, or an aspect that
    disagrees with the rest of the deck — the new
    `"inconsistent-deck-aspect"` reason) fails the WHOLE deck, naming the
    offending slide's index/id.
  - **The shared canvas engine** (`src/image/engine.ts`,
    `src/image/resolveCanvasLayout.ts`, `src/image/renderSlots.ts`) — built
    once for `./image`, imported directly by `./slides` rather than
    duplicated: `frameToCanvasRect` (reuses `@vespeneventures/compose`'s
    `frameToInches`, which is unit-agnostic in practice), `wrapText`
    (deterministic line-breaking via a documented average-character-width
    approximation — no font-metrics dependency; overflow is always
    reported as a named warning, never silent), `escapeXml` (all five
    XML-significant characters; `>` escaping neutralizes a literal `]]>`
    as a byproduct), and `resolveColorRole` (every color resolves to a
    literal hex via `internal/tokens.ts` — never `oklch(...)`, never
    `var(--...)`). Deliberately placed under `src/image/`, not
    `src/internal/` — see `engine.ts`'s own top comment for why, and this
    package's PR description for the "candidate for later extraction"
    note.
  - `internal/errors.ts`'s `RenderErrorReason` union grew one member:
    `"inconsistent-deck-aspect"` (a `SlidesDeckInput` whose slides don't
    all declare the same `SlidesMeta.aspect`).
  - Zero new dependencies. Package-wide `"exports"` grew `"./image"` and
    `"./slides"` entries alongside `"./web"`.

- Initial release: `@vespeneventures/render`, renderers built against
  `@vespeneventures/compose`'s `ComposeDocument` contract, one subpath per
  output channel. Ships `./web` first; `./email`, `./print`, `./slides`,
  and `./image` are the same shape, built later. No root `.` export —
  every import names its channel, the same convention
  `@vespeneventures/ui`'s own subpaths already set.
- **`./web`** (`src/web/`): `renderWebDocument(doc, options?)` — resolves
  a `channel: "web"` `ComposeDocument`'s `bindings` into the named
  `@vespeneventures/ui` view (`AuthView`, `ErrorView` today, via
  `src/web/internal/webTemplates.ts`'s registry) and builds its head
  metadata, returning `{ element, head }`. Refuses to render silently:
  throws `RenderError` with a `reason` of `"unknown-template"`,
  `"wrong-channel"`, `"resolution-failed"` (delegated to
  `@vespeneventures/compose`'s own `resolveDocument`), or `"empty-output"`
  (a strengthening on top of `resolveDocument`'s own `ok` flag — a
  required slot whose `copyId` did not resolve to real text).
- **The `copyId` seam, resolved**: `RenderWebOptions.resolveCopyId` — a
  synchronous `(copyId: string) => string | undefined` the caller supplies
  when any binding uses `copyId` rather than a literal `value`. Documented
  explicitly as this package's own decision on the seam
  `@vespeneventures/compose` deliberately leaves open.
- **Head metadata** (`src/web/headMetadata.ts`): `buildWebHeadMetadata`
  turns a `WebMeta` into `WebHeadMetadata` — a plain, JSON-serialisable
  object, not any framework's own `Metadata` type — including OpenGraph,
  Twitter card, and JSON-LD.
- **JSON-LD, escaped** (`src/web/internal/jsonLd.ts`): `serializeJsonLd`
  and `escapeJsonForScriptTag` — every `<`/`>`/`&` and the Unicode LINE
  SEPARATOR/PARAGRAPH SEPARATOR code points are escaped so a `</script>`
  sequence inside untrusted JSON-LD content can never terminate the real
  `<script type="application/ld+json">` tag it's embedded in. JSON-LD was
  entirely unhandled in a prior 40-package attempt at this ecosystem; see
  this package's README, "JSON-LD — escaped, and why that matters".
- **Golden-output tests** (`src/web/golden-render.test.ts`): real
  `ComposeDocument` fixtures rendered through the real
  `@vespeneventures/ui` views via `react-dom/server`'s
  `renderToStaticMarkup`, asserted against the exact emitted HTML string —
  including an explicit case proving a `</script>` sequence inside
  JSON-LD content is escaped correctly.
- **Optional peer dependencies, established as this package's precedent**:
  `react`, `react-dom`, and `@vespeneventures/ui` are `./web`'s own
  dependencies, declared as `peerDependencies` with
  `peerDependenciesMeta.optional: true` on every one of them — not
  because they're optional to use `./web` (they aren't), but because npm
  has no per-subpath peer dependencies, and marking them optional is what
  keeps a future single-channel consumer's install clean. `./email`'s
  `react-email`-or-equivalent, `./print`/`./slides`'s Puppeteer, and
  `./image`'s image library should all follow this exact pattern. See the
  README, "The package shape — read this before adding a second channel".
- `@vespeneventures/compose` is a real (non-peer, non-optional)
  dependency, pinned with a tilde range (`~0.1.0`), never caret — a caret
  range on a pre-1.0 package has broken this repository's CI more than
  once.
- Root `package.json`'s `build` script now explicitly builds `tokens` and
  `ui` (in that order) ahead of the general `--workspaces` pass, for the
  same reason `catalog`/`policy`/`voice` are already there: `render` <
  `tokens` and `render` < `ui` alphabetically, so the general pass would
  otherwise try to compile `@vespeneventures/render/web` (which imports
  `@vespeneventures/ui/views`, which imports `@vespeneventures/tokens`)
  before either had a `dist/` yet.
- **Shared foundation for every channel: `src/internal/tokens.ts`** —
  flattens `@vespeneventures/tokens`' `TOKENS` registry (154 entries,
  colors declared as CSS `oklch(...)`) into literal, email-and-SVG-safe
  values, so `./email`, `./image`, and `./slides` (none of which can read
  an `oklch()` cascade or a `var()` custom property) don't each build this
  independently:
  - `oklchToHex(css)` — a real OKLCH -> OKLab -> linear-sRGB ->
    gamma-encoded-sRGB -> `#rrggbb`/`#rrggbbaa` conversion. Out-of-gamut
    input is gamut-mapped by binary-searching the largest in-gamut chroma
    (holding lightness and hue fixed), never by clamping each channel
    independently — the latter silently produces a plausible-looking
    wrong color. Throws `RenderError("invalid-oklch", ...)` for anything
    unparseable.
  - `flattenTokens(overrides?)` — every `TOKENS` entry resolved to a
    literal value: an override wins over the default, every `var()`
    reference (including chains, and ones embedded inside a composite
    value like a resolved box-shadow) is fully resolved, and every
    `oklch(...)` occurrence is converted through `oklchToHex`. An
    override naming an unknown slot, or a non-`brandable` one, throws
    (`"unknown-token-override"` / `"non-brandable-override"`) rather than
    being silently ignored or silently accepted.
  - `resolveTokenRef(value, flat)` — resolves `var(--name)` /
    `var(--name, fallback)` references (including chains and multiple
    references in one string) against an already-flattened map. Detects
    cycles and throws (`"token-ref-cycle"`) rather than looping forever;
    an unresolvable reference with no fallback throws
    (`"unknown-token-ref"`).
  - `internal/errors.ts`'s `RenderErrorReason` union grew six members for
    this module: `"invalid-oklch"`, `"non-brandable-override"`,
    `"unknown-token-override"`, `"unknown-token-ref"`, `"token-ref-cycle"`,
    `"invalid-token-ref"`.
  - `@vespeneventures/tokens` (`~0.5.0`) is now a real (non-peer,
    non-optional) dependency — every channel needs it, unlike
    `react`/`react-dom`/`@vespeneventures/ui`, which only `./web` does.
    See the README, "Shared internals" and the tokens-dependency note
    alongside the `compose` one.
  - Not part of `./web`'s (or any subpath's) public API — a plain module
    under `src/internal/`, imported by relative path from whichever
    channel needs it, per this package's own "shared internals live in
    `src/internal/`" convention.
