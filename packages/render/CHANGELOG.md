# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - Unreleased

### Changed

- `@vespeneventures/tokens` dependency range bumped `~0.5.0` -> `~0.6.0`:
  that package's `0.6.0` is a MINOR release (a `0.x` caret/tilde range is
  patch-only, so the old range would not have matched it) adding
  `checkBrandCoverage`/`readBrandCss` — this package does not use either
  new export in its own source, but `src/internal/
  tokens-brand-coverage-agreement.test.ts` (new) imports
  `checkBrandCoverage` from `@vespeneventures/tokens` to assert it agrees
  with this package's own `flattenTokens` on the non-brandable-override and
  unknown-slot rules, run against every real non-brandable token in
  `TOKENS`.

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
- **`./email`** (`src/email/`): `renderEmailDocument(doc, options?)` —
  resolves a `channel: "email"` `ComposeDocument`'s `bindings` into a
  complete, self-contained, table-based HTML document plus a
  deterministically-derived plain-text alternative, returning
  `{ html, text, subject, preheader, warnings }`. Zero new runtime
  dependencies, and no `react`/`@vespeneventures/ui` peer at all — email
  HTML is built as a plain string (`src/email/internal/emailDocument.ts`),
  following this package's own "prefer zero new dependencies" guidance.
  - **Uses `@vespeneventures/compose`'s `resolveDocument`/`resolveCopy`
    directly** — no hand-rolled copyId resolution (see `compose`'s own
    `resolve-copy.ts`, written specifically so every renderer in this
    ecosystem shares one answer to issue #43 rather than re-deriving it).
  - **The geometry problem, made visible, not hidden**: `LayoutSpec.slots`'
    `frame` is an absolute canvas position email cannot express at all —
    every slot degrades to a single vertical stack, ordered by `frame.y`
    then `frame.x` (`src/email/internal/geometry.ts`). Every real loss of
    fidelity that causes — two side-by-side slots now stacked, a
    less-than-full-width slot now rendering full width — is reported in
    the result's `warnings: RenderWarning[]`, never silently absorbed. A
    document with no `options.layout` at all (the common case for
    `EmailMeta`-bearing documents — see `compose`'s own `LayoutSpec` doc
    comment) degrades further, to binding order with zero warnings, since
    there is no real geometry to lose in the first place.
  - **A strengthened resolution bar versus `./web`**: `./web` only
    requires slots marked `required: true` to resolve; `./email` requires
    `resolveCopy`'s own `ok` flag — EVERY bound slot must resolve to real
    text, `required` or not — treating anything less as
    `RenderError("empty-output", ...)`. Flagged explicitly in
    `renderEmailDocument.ts`'s own doc comment as a deliberate,
    channel-specific strengthening, not an oversight.
  - **Duplicate-slot-key policy**: `resolveDocument` deliberately does not
    pick a winner when more than one binding targets the same slot key
    (see its own doc comment). `./email`'s policy: last write wins — every
    binding is still resolved and validated, but only the last-encountered
    text is emitted, once, at that slot's row position.
  - **Every color/size/font a literal value** — no CSS custom properties,
    no `oklch()`, ever, anywhere in the emitted HTML — via this package's
    shared `internal/tokens.ts` `flattenTokens`, read through
    `src/email/internal/styles.ts`'s per-`ElementKind` style map.
    Font-family token values (which quote multi-word names the standard
    CSS way, e.g. `"Segoe UI"`) are rewritten to single quotes before
    substitution, since the surrounding `style="..."` HTML attribute is
    itself double-quoted.
  - **MSO conditional comments**: a ghost centering `<table>` plus
    `<o:OfficeDocumentSettings>` for Outlook's Word-based rendering
    engine, and `mso-line-height-rule:exactly` on every text cell.
  - **A hidden preheader** (`src/email/internal/escapeHtml.ts`'s
    `buildHiddenPreheaderContent`): the real, escaped `EmailMeta.preheader`
    text followed by 20 `&zwnj;&nbsp;` filler pairs, so an inbox preview
    pane can't scavenge real body text into the preview line.
  - **All resolved text HTML-escaped** (`escapeHtml`) before it ever
    reaches the emitted document — `&`/`<`/`>`/`"`/`'`, `&` first so
    nothing is double-escaped.
  - **The plain-text alternative is derived from the same resolved texts
    as the HTML** (`src/email/internal/plainText.ts`), never by stripping
    tags off the HTML output — one shared source of truth, so the two
    parts cannot silently drift apart.
  - **Golden-output tests** (`src/email/golden-render.test.ts`): a real
    `ComposeDocument` rendered end to end, asserted against the exact
    emitted HTML string, plus an explicit `<script>alert(1)</script>`
    escaping fixture and a regex assertion that no `oklch(` or `var(--`
    ever survives into the output.
  - No new `RenderErrorReason` members — `./email` reuses
    `"wrong-channel"`, `"resolution-failed"`, and `"empty-output"`
    unchanged from `./web`'s own set.
- **`./print`** (`src/print/`): `renderPrintDocument(doc, options?)` —
  resolves a `channel: "print"` `ComposeDocument`'s `bindings` (against
  `doc.layout` directly — print has no template registry the way `./web`
  does, since `compose`'s own contract requires `layout` on every print
  document) into a deterministic, paged-media HTML+CSS document string.
  Returns `{ html, page }`. Zero new dependencies, peer or otherwise —
  every heavy dependency this package carries (`react`/`react-dom`/
  `@vespeneventures/ui`) is scoped to `./web` alone; `./print` needs only
  `@vespeneventures/compose`'s `resolveDocument`/`resolveCopy`/
  `frameToPercent`, already real dependencies of this whole package.
  - **Paged HTML+CSS, never a PDF, never a headless browser** — the
    key architectural decision this channel is built on. A PDF golden
    test asserts nothing meaningful (a binary blob with no stable
    byte-for-byte diff); a headless-browser dependency (Puppeteer,
    ~300MB) is a cost no consumer of this package should have to pay for
    "produce an HTML string." Rasterizing/printing this HTML to an
    actual PDF is a downstream caller's job. See the README, "The key
    architectural decision".
  - **`pageSize: "Custom"` with no explicit dimensions is an ERROR, not
    a default** — `RenderPrintOptions.customPageSize: { width, height }`
    is required whenever `doc.meta.pageSize === "Custom"` (`PrintMeta`
    itself carries no dimensions for that state); `renderPrintDocument`
    throws `RenderError("missing-custom-page-size", ...)` rather than
    silently falling back to A4.
  - **`@page`, driven by `PrintMeta`** (`internal/page.ts`): the real CSS
    Paged Media Module Level 3 `size`/`margin-*`/`bleed`/`marks`
    descriptors — named-size + orientation keyword for A4/Letter
    (`size:A4 portrait;`), raw length pair for `"Custom"` (the CSS
    grammar cannot pair explicit lengths with an orientation keyword).
  - **Geometry survives here — unlike `./web`**: a print page is a fixed
    physical canvas, so `SlotSpec.frame` (a 0..1 fraction of the page's
    printable area) is converted via `@vespeneventures/compose`'s own
    `frameToPercent` into an absolutely-positioned percentage box
    (`internal/geometry.ts`), inset from the page's own edges by
    `meta.margins` with no `calc()`/unit arithmetic
    (`internal/document.ts`).
  - **Colours flattened to literal hex, argued explicitly rather than
    inherited**: even though a browser's print pipeline DOES support
    `oklch()`/`var()` (unlike `./email`'s target), `SlotSpec.style.color`/
    `.background` and `LayoutSpec.background`'s same two fields are
    resolved through the shared `internal/tokens.ts`'s `flattenTokens()`
    (`internal/style.ts`) — because the tooling that turns this HTML into
    a printed page or a PDF is frequently not a browser at all, and a
    flattened document is safe in both. `.border`/`.typography`/`.weight`
    are deliberately NOT resolved yet — see the README, "Found but not
    fixed".
  - **Page-break control**: every slot defaults to
    `break-inside:avoid;page-break-inside:avoid;` (modern CSS
    Fragmentation Module Level 3 property paired with the legacy CSS 2.1
    one); `RenderPrintOptions.allowBreakInside`/`breakBefore`/
    `breakAfter` (slot-key lists) opt out of that default or force a
    fresh page before/after a slot.
  - **Refusal paths, never a silent partial page**: `"wrong-channel"`,
    `"missing-layout"`, `"missing-custom-page-size"` (all new — see
    `internal/errors.ts`'s `RenderErrorReason`, which grew exactly these
    three members plus `"unknown-style-role"`), `"resolution-failed"` and
    `"empty-output"` (reused from `./web`'s own vocabulary — the latter
    via `@vespeneventures/compose`'s `resolveCopy`, the exact fix issue
    #43 shipped so every renderer stops hand-rolling this check).
  - **Golden-output tests** (`src/print/golden-render.test.ts`): two real
    `ComposeDocument` fixtures (an A4 flyer with bleed/crop
    marks/background/break-after/vAlign, and a `"Custom"`-sized landscape
    business card with HTML-escaped text) asserted against their exact
    emitted HTML string, byte for byte — the same bar `./web`'s own
    golden test is built against.
