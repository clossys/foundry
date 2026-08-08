# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - Unreleased

### Added

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
