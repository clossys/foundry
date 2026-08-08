# @vespeneventures/render

Renderers built against `@vespeneventures/compose`'s `ComposeDocument`
contract — one subpath per output channel. `./web` resolves a web
`ComposeDocument`'s `bindings` into the named `@vespeneventures/ui` view
and emits framework-agnostic head metadata (title, description, canonical,
robots, keywords, OpenGraph, Twitter card, and escaped JSON-LD). `./email`
renders a table-based, inline-styled HTML email plus its plain-text
alternative. `./print` resolves a print `ComposeDocument`'s `bindings` AND
`layout` into a deterministic, paged-media HTML+CSS document string.
`./image` and `./slides` render a fixed canvas with absolutely-positioned
slots — one canvas for `./image`, an ordered sequence of the same canvas
for `./slides` — as self-contained SVG. All five are the same shape,
against the same `ComposeDocument`.

```bash
npm install @vespeneventures/render
```

## What this package is

`@vespeneventures/compose` ships the frozen `ComposeDocument` contract —
*this template, these slots filled from these copy ids or literal values,
targeting this channel, with this channel's own metadata* — and the
slot-resolution logic every renderer needs, but renders nothing itself.
This package is one of the (eventually five) renderers built against that
contract: the one for `channel: "web"`.

```
a ComposeDocument, channel: "web"    input       @vespeneventures/compose's own contract
this package's ./web subpath          machinery   resolves bindings, builds the element + head
a rendered @vespeneventures/ui view   output      what a page actually ships
```

## The package shape — read this before adding a second channel

**Subpath exports, one per channel, no root `.` export.** Exactly the
convention `@vespeneventures/ui` already set for `./atoms`/`./blocks`/
`./views`/`./shell`/`./charts`/`./icons`: every import names its channel
explicitly (`@vespeneventures/render/web`), so nothing is reachable by
accident and a consumer who only ever imports `./web` never even resolves
the module graph the other channels would pull in. When `./email` is
added, it is a new key in `package.json`'s `"exports"` map and a new
`src/email/` directory — never a change to `./web`'s own shape.

**Shared internals live in `src/internal/`; channel-specific internals
live in `src/<channel>/internal/`.** `src/internal/errors.ts` ships
`RenderError` — every channel this package ever grows throws the same
error shape, the same reasoning `@vespeneventures/compose`'s own
`ComposeFinding` gives for being shared across `strategy`/`copy`/`voice`.
Things only `./web` needs (its JSON-LD escaping, its
`@vespeneventures/ui` template registry) live under `src/web/internal/`
instead — nothing outside `./web` imports them, and nothing inside
`./web` reaches into a sibling channel's `internal/` either.

**Every heavy or channel-specific dependency is an OPTIONAL peer
dependency.** This is the precedent this package sets for `./email`
(likely `react-email` or a hand-rolled MJML-shaped renderer),
`./print`/`./slides` (Puppeteer, ~300MB, and/or `pptxgenjs`), and
`./image` (an image-encoding library) — none of those channels exist yet,
but the shape they'll follow is already live in `./web` today:

- `react`, `react-dom`, and `@vespeneventures/ui` are `./web`'s own
  dependencies — nothing else in this package needs any of them.
- All three are declared in `peerDependencies` (the consumer supplies the
  actual installed copy, the same reason `@vespeneventures/ui` itself
  peers `react`/`react-dom`/`tailwindcss`/`@vespeneventures/tokens`
  rather than bundling them) **and** listed in `peerDependenciesMeta` with
  `optional: true`.
- The `optional: true` is the load-bearing part, and it is *not* about
  these three peers being genuinely optional to use `./web` — they are
  not; `./web` cannot render anything without them. It is about npm
  having **no way to scope a `peerDependencies` entry to one subpath**.
  `peerDependencies` is a single, package-wide list. Without
  `peerDependenciesMeta`, npm would warn (and a strict installer would
  fail) on *every* consumer of this package that doesn't have `react`
  installed — including a future consumer who only ever imports
  `@vespeneventures/render/print` and has never heard of React. Marking
  every peer optional is what keeps a single-channel consumer's install
  clean; the real requirement (you cannot call `./web`'s
  `renderWebDocument` without `react`/`react-dom`/`@vespeneventures/ui`
  actually present) is enforced at import/call time by Node's own module
  resolution, not at `npm install` time.
- **Follow this pattern exactly for the next channel.** When `./print`
  needs Puppeteer: add `puppeteer` to `peerDependencies`, add
  `"puppeteer": { "optional": true }` to `peerDependenciesMeta`, and add
  it to `devDependencies` so this package's own build/tests can use it. Do
  **not** add it to `dependencies` — that would force every `./web`-only
  consumer to download it.

**`@vespeneventures/compose` is a real (non-peer) dependency**, unlike
`react`/`ui`: every current and future channel needs `compose`'s
`ComposeDocument` type and `resolveDocument` function, so it belongs in
`dependencies`, not behind a per-channel peer. It is pinned with a
**tilde** range (`~0.2.0`), not caret: `compose` is pre-1.0, and a caret
range on a 0.x package is patch-only in name but has, in practice, let a
breaking pre-1.0 minor bump through unnoticed and broken this repository's
CI more than once. A tilde range is the deliberate, narrower choice here.

**`@vespeneventures/tokens` is a real (non-peer) dependency, for the same
reason `compose` is.** Unlike `react`/`react-dom`/`@vespeneventures/ui` —
which only `./web` needs, hence the optional-peer treatment above — EVERY
channel this package ships or will ship needs a way to turn a design
token into a literal color, because none of them (a browser aside) can
read an `oklch()` cascade: email has no CSS custom properties at all,
and `./image`/`./slides` emit SVG. There is no channel for which
`@vespeneventures/tokens` is optional the way `react` genuinely is for
`./print`, so it is not behind `peerDependenciesMeta.optional` — it is a
plain dependency, installed for every consumer of this package regardless
of which subpath(s) they import. Pinned `~0.5.0` (the real, installed
`@vespeneventures/tokens` version at the time this dependency was added),
tilde rather than caret for the identical reason `compose`'s pin is
tilde: `tokens` is pre-1.0, and this repository's own convention treats a
caret range on a 0.x package as patch-only in name only — it has let a
breaking pre-1.0 minor bump through unnoticed before. See "Shared
internals" below for what this dependency buys: `internal/tokens.ts`'s
`flattenTokens`/`oklchToHex`/`resolveTokenRef`.

## Shared internals — `@vespeneventures/tokens`, flattened for a channel with no CSS cascade

`src/internal/tokens.ts` is not part of `./web`'s (or any channel's)
public API — it is a plain module under `src/internal/`, imported by
relative path from whichever channel needs it — but every channel this
package grows needs the thing it does, so it is documented here rather
than in a subpath's own README section.

`@vespeneventures/tokens`' `TOKENS` registry declares its 154 color
entries as CSS `oklch(...)` strings, meant to be read through a real CSS
custom-property cascade in a browser. That is exactly backwards for a
channel with no cascade and no `oklch()` support at all:

- **email** — no client supports `oklch()`, and none support CSS custom
  properties, so every color a template emits has to be a literal hex
  inlined on the element itself;
- **`./image`/`./slides`** — output is SVG for a rasterizer, which has
  neither `oklch()` nor a `var()` cascade either.

Three exports answer that, in order of how they compose:

| Export | Purpose |
| --- | --- |
| `oklchToHex(css)` | A real OKLCH -> OKLab -> linear sRGB -> gamma-encoded sRGB -> `#rrggbb`/`#rrggbbaa` conversion — not an approximation, not a lookup table. Handles `L`/`C` as a number or percentage, `H` as a number or `none`, and alpha. **Out-of-gamut input is gamut-mapped by reducing chroma toward 0** (binary search, holding lightness and hue fixed) until the color lands inside sRGB, never by clamping each channel independently — a per-channel clip silently produces a different, often wrong-hued color with no signal anything went wrong, which is exactly the failure this function is built to avoid. Throws `RenderError("invalid-oklch", ...)` for anything unparseable; never returns a fallback color. |
| `flattenTokens(overrides?)` | Every `TOKENS` entry, override applied where one is given, fully resolved: every `var()` reference chased to its literal value (including one embedded inside a composite value, like a resolved box-shadow), every `oklch(...)` occurrence converted through `oklchToHex`. An override naming a slot outside `TOKENS`, or a slot whose `brandable` is `false`, throws (`"unknown-token-override"` / `"non-brandable-override"`) rather than being silently accepted or silently ignored. |
| `resolveTokenRef(value, flat)` | Resolves `var(--name)` / `var(--name, fallback)` references — including chains, and multiple references in one string — against an already-flattened map. Detects cycles and throws (`"token-ref-cycle"`) rather than looping forever; an unresolvable reference with no fallback throws (`"unknown-token-ref"`). |

All three throw the same `RenderError` this package already ships (see
"A document that resolves to nothing is an error", below) — `internal/errors.ts`'s
`RenderErrorReason` union grew six new members for this module; see that
file's own doc comment for the full list and when each fires.

## Shared internals — `@vespeneventures/tokens`' typography scale, resolved per `ElementKind`

`src/internal/typography.ts` is `internal/tokens.ts`'s sibling: colour has
`flattenTokens`/`resolveTokenRef`; font size and family have this module.
`@vespeneventures/tokens` DOES ship a real typography scale — 13 `text`
tokens (`--text-caption` through `--text-display-xl`), 3 `font` tokens
(family stacks), 4 `tracking` tokens (letter-spacing) — and every
non-web channel (`./email`, `./print`, `./image`, `./slides`) now resolves
real values from it, rather than each independently guessing or (in
`./print`'s case, before this module existed) emitting no typography at
all.

| Export | Purpose |
| --- | --- |
| `ELEMENT_TYPOGRAPHY_ROLE` | The default `ElementKind` -> `--text-*` size-role mapping. Every value is asserted, in `typography.test.ts`, to be a real key in `TOKENS` — a token rename that isn't mirrored here fails that test loudly rather than shipping a font-size of `undefined`. |
| `ELEMENT_FONT_FAMILY_ROLE` | The default `ElementKind` -> `--font-*` family-role mapping (`--font-display` for `heading`/`subheading`/`stat`/`logo`, `--font-body` for everything else). No `StyleBinding` field overrides this per slot. |
| `resolveElementTypography(element, style, ownerDescription, flat)` | The one entry point every channel calls: `style?.typography` (a token role name) overrides `ELEMENT_TYPOGRAPHY_ROLE[element]` when present. Returns `{ role, css, px }` — `css` is the literal token value (`"28px"`), `px` is that value parsed to a bare number, for `./image`/`./slides`' geometry math. Throws `RenderError("unknown-style-role", ...)` for a role (default OR override) absent from `flat`, or one that resolves to something that isn't a `"<number>px"` string — never a silent fallback size. |
| `resolveElementFontFamily(element, flat)` | `ELEMENT_FONT_FAMILY_ROLE[element]`, resolved to the raw literal family-stack string. Embedding it safely into a double-quoted HTML attribute (`./email`, `./print`) or an XML attribute (`./image`, `./slides`) is each caller's own job — see `./email`'s `readEmailToken`, `./print`'s `toAttributeSafeCss`, and `./image`'s `escapeXml`. |

`StyleBinding.typography` — accepted by `@vespeneventures/compose`'s frozen
contract since that package's first release, but read by nobody until this
module existed — is now the one field of `StyleBinding` every non-web
channel resolves.

## Usage

```ts
import { renderWebDocument } from "@vespeneventures/render/web";

// A ComposeDocument — the type itself ships from @vespeneventures/compose,
// your own document-building code would typically import and annotate
// with it (`const doc: ComposeDocument = { ... }`).
const doc = {
  id: "acme-404",
  channel: "web",
  template: "ErrorView", // a @vespeneventures/ui view export name
  meta: {
    channel: "web",
    title: "Page not found — Acme",
    description: "The page you were looking for does not exist.",
    canonical: "https://acme.example/404",
    jsonLd: [{ "@context": "https://schema.org", "@type": "WebPage", name: "Acme 404" }],
  },
  bindings: [
    { slot: "status", value: "404" },
    { slot: "title", value: "Page not found" },
  ],
};

const { element, head } = renderWebDocument(doc);
// element — a React element: <ErrorView status="404" title="Page not found" />
// head    — plain, framework-agnostic head metadata (see below)
```

### The `copyId` seam — resolved text, via a caller-supplied resolver

`@vespeneventures/compose`'s `SlotBinding.copyId` is deliberately an
opaque string — `compose` never resolves it against a real copy source
(see its README, "The `copyId` seam"). **This package's decision on that
seam: `renderWebDocument` accepts an optional, synchronous
`resolveCopyId(copyId) => string | undefined` function**, not
pre-resolved text baked into the document. A caller who has already loaded
a `@vespeneventures/copy` registry (or any other copy source) passes a
lookup function; a caller with nothing to resolve against — every binding
uses `value`, never `copyId` — omits it entirely.

```ts
const { element } = renderWebDocument(doc, {
  resolveCopyId: (copyId) => myCopyRegistry.get(copyId)?.text,
});
```

Synchronous rather than `Promise`-returning on purpose: this function
builds a React element tree in one pass, and the common case (a copy
source already fully loaded in memory) never needs to await anything. A
caller with a genuinely async copy source resolves every `copyId` a
document needs up front, before calling `renderWebDocument`, and closes
over the results in a synchronous function.

### A document that resolves to nothing is an error, never a silent empty page

Three distinct failure modes, each a thrown `RenderError` with its own
`reason`, never a quietly-rendered blank page:

| `RenderError.reason` | When |
| --- | --- |
| `"unknown-template"` | `doc.template` does not name a template this package knows (`AuthView`, `ErrorView` today). |
| `"wrong-channel"` | `doc.channel` (or `doc.meta.channel`) is not `"web"`. |
| `"resolution-failed"` | `resolveDocument` itself reports `ok: false` — a required slot has no binding, a binding targets an unknown slot, or (for a document with an empty `bindings` array) nothing at all matched. See `@vespeneventures/compose`'s own README, "The bar". |
| `"empty-output"` | Every binding matched a real slot (`resolveDocument` said `ok: true`), but a **required** slot's `copyId` did not resolve to any text — either no `resolveCopyId` was given, or it returned `undefined` for that id. `resolveDocument`'s own `ok` flag only proves a binding matched a slot key; it has no way to know whether that binding's `copyId` produced real text, since resolving `copyId` is this package's job, not `compose`'s. This is a deliberate strengthening on top of what `resolveDocument` itself checks — flagged here the same way `compose`'s README flags its own `frame-out-of-bounds` strengthening. |

```ts
import { RenderError } from "@vespeneventures/render/web";

try {
  renderWebDocument(doc);
} catch (error) {
  if (error instanceof RenderError) {
    console.error(`[${error.reason}] ${error.message}`);
  }
  throw error;
}
```

### Head metadata: a plain object, not a framework type

`renderWebDocument`'s `head` is a plain, JSON-serialisable
`WebHeadMetadata` — never any one framework's own `Metadata` type. A
Next.js consumer (or anyone else's) adapts it in a few lines:

```ts
// app/[page]/page.tsx — Next.js App Router
import type { Metadata } from "next";

export function toNextMetadata(head: WebHeadMetadata): Metadata {
  return {
    title: head.title,
    description: head.description,
    ...(head.canonical ? { alternates: { canonical: head.canonical } } : {}),
    ...(head.robots ? { robots: head.robots } : {}),
    ...(head.keywords ? { keywords: head.keywords } : {}),
    ...(head.openGraph ? { openGraph: head.openGraph } : {}),
    ...(head.twitter ? { twitter: head.twitter } : {}),
  };
}
```

`head.jsonLd` is handled separately from the rest — see the next section.

### JSON-LD — escaped, and why that matters

`WebMeta.jsonLd` was entirely unhandled in a prior 40-package attempt at
this ecosystem (grepping it for `ld+json`/`schema.org` returns nothing).
For an AI-native pipeline this is the conspicuous gap: JSON-LD is how a
machine reads a page. `renderWebDocument`'s `head.jsonLd` is an array of
strings, each already `JSON.stringify`'d **and** escaped safe for
`<script type="application/ld+json">` embedding:

```tsx
{head.jsonLd.map((payload, i) => (
  <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: payload }} />
))}
```

**Why the escaping exists.** `<script>` content is terminated by the
literal byte sequence `</script` — case-insensitively, regardless of
whether it's inside a JSON string, and regardless of whether the tag it
"closes" was ever meant to close there. A JSON-LD payload built from any
untrusted string field (a title, a description sourced from user content,
anything a `copyId` resolves to) can legally contain that sequence as
ordinary text. `JSON.stringify` alone does nothing to prevent this — JSON
escaping only makes a string valid JSON, not safe to embed in HTML. A
payload whose `description` field is the literal text
`</script><script>alert(1)</script>`, embedded unescaped, closes the real
script tag early and runs whatever follows as a fresh one — a real,
documented XSS technique, not a hypothetical one.

**The fix**: every `<`/`>`/`&` in the serialized JSON is replaced with its
Unicode escape (`<`/`>`/`&`), and the Unicode LINE
SEPARATOR / PARAGRAPH SEPARATOR code points are escaped the same way.
`</script` cannot occur once every `<` byte is gone — the escaped form is
still valid JSON (a JSON string may contain a `\uXXXX` escape anywhere),
but it can never be misread as an HTML tag boundary. See
`src/web/internal/jsonLd.ts` for the full reasoning and
`src/web/golden-render.test.ts` for a golden test asserting the exact
escaped byte sequence for a `</script>`-containing payload.

### Only plain text ever fills a slot

`SlotBinding` carries exactly two possible sources — `copyId` or `value`,
both strings (see `@vespeneventures/compose`'s own `types.ts`) — never a
React node, a component, or markup. So every slot `renderWebDocument`
fills, including `AuthView`'s `form` slot (which in a hand-built page
holds a real interactive sign-in form), receives plain resolved text,
never richer content. This is not a shortcut this package took; it's what
the frozen `ComposeDocument` contract itself supports. A consumer who
wants a real form (or any other rich node) in that slot composes
`@vespeneventures/ui`'s `AuthView` directly, outside this document
pipeline.

## `./email` — email is not a small web page

```ts
import { renderEmailDocument } from "@vespeneventures/render/email";

const { html, text, subject, preheader, warnings } = renderEmailDocument(doc, {
  layout,   // the real, positioned LayoutSpec your template defines — omit if you have none
  lookup: (copyId) => myCopyRegistry.get(copyId)?.text,
  brand: { "--color-accent": "oklch(0.55 0.18 250)" },
});
```

`./web` renders into a real DOM a real browser lays out. Email has none of
that: no CSS custom properties, no `oklch()`, no flexbox/grid, and no way
to place anything at an absolute position — every client forces a linear,
top-to-bottom flow of full-width blocks. `renderEmailDocument` is built
around that constraint rather than around approximating a web page:

- **Table-based layout, MSO conditional comments, a hidden preheader.**
  The emitted `html` is a complete document: `<table role="presentation"
  cellpadding="0" cellspacing="0" border="0">` throughout, a ~600px
  content table centered inside a full-width wrapper, a `<!--[if mso]>`
  ghost table so Outlook's desktop renderer centers it too, and a
  `display:none` preheader block (`EmailMeta.preheader`, escaped, padded
  with invisible `&zwnj;&nbsp;` filler) immediately after `<body>` so an
  inbox preview pane can't scavenge real body text into its preview line.
- **Every color/size/font is a literal value.** No email client reads a
  `var()` cascade or `oklch()`, so every value substituted into the
  document comes from this package's shared `internal/tokens.ts`
  `flattenTokens` (colour) and `internal/typography.ts` (font size/family)
  — literal hex, literal `px`, literal font stacks. A font-family token's
  CSS-standard double-quoted family name (`"Segoe UI"`) is rewritten to
  single quotes first, since it lands inside a double-quoted `style="..."`
  HTML attribute.
- **Font size follows `SlotSpec.element`'s `ElementKind`, overridable per
  slot.** Each `ElementKind` has a real default `--text-*` size role
  (`internal/typography.ts`'s `ELEMENT_TYPOGRAPHY_ROLE`) — `heading` at
  `--text-h1`, `body` at `--text-body`, and so on. `SlotSpec.style.
  typography` (a token role name) overrides that default when present; an
  unknown or non-size role throws `RenderError("unknown-style-role", ...)`
  rather than silently falling back.
- **The geometry problem.** `LayoutSpec.slots`' `frame` is an ABSOLUTE
  canvas position — meaningless once nothing can be positioned. This
  channel degrades a `frame` to exactly the one thing email can express:
  an ORDERING hint. Every resolved slot is sorted by `frame.y`, then
  `frame.x`, into one vertical stack of table rows — and every real loss
  that causes (two side-by-side slots now stacked one after another; a
  slot narrower than the full canvas now rendering full width) is named
  in the result's `warnings: RenderWarning[]`, never silently absorbed. A
  document with no `options.layout` at all — the common case; see
  `@vespeneventures/compose`'s own `LayoutSpec` doc comment on why an
  `email`-channel `ComposeDocument` is forbidden from carrying one on
  `doc.layout` itself — degrades one step further, to plain binding
  order, with zero warnings: there is no real geometry to lose when none
  was ever supplied.
- **Resolution reuses `@vespeneventures/compose` directly** —
  `resolveDocument` to match `bindings` against a real slot list, then
  `resolveCopy` to turn those matches into actual text via a
  caller-supplied `lookup`. This channel does not hand-roll a second
  copyId-resolution path; see `compose`'s own `resolve-copy.ts`, written
  precisely so no renderer in this ecosystem has to.
- **A stricter resolution bar than `./web`'s.** `./web` only requires
  slots marked `required: true` to resolve; a bound-but-unresolved
  optional slot silently drops. `./email` requires ALL of them — the same
  `resolveCopy` call this channel makes already reports `ok: false` the
  moment even one bound slot fails to produce real text, and this
  function refuses to render rather than ship a half-empty message. See
  `renderEmailDocument.ts`'s own doc comment for the full reasoning.
- **The plain-text alternative is derived from the same resolved text as
  the HTML** — never by stripping tags off the HTML this package already
  built. One shared, ordered list of `{ key, text }` feeds both outputs,
  so they can only ever differ in formatting, never in content.
- **`options.brand`** is the exact override object
  `internal/tokens.ts`'s `flattenTokens` accepts, passed straight
  through — the same brand-override shape `./web` will eventually expose
  too, once it has a reason to read token colors at all.

Refusal is the same three-reason shape `./web` already documents above:
`"wrong-channel"` (`doc.channel`/`doc.meta.channel` isn't `"email"`),
`"resolution-failed"` (`resolveDocument` itself reports `ok: false`), and
`"empty-output"` (every bound slot matched a real slot key, but
`resolveCopy` did not produce real text for all of them). `./email`
introduces no new `RenderErrorReason` members.
## `./print`

`renderPrintDocument` takes a `channel: "print"` `ComposeDocument` and
returns `{ html, page }`: `html` is a complete, standalone paged-media
HTML+CSS document string, and `page` is the page geometry/metadata the
render actually used.

```ts
import { renderPrintDocument } from "@vespeneventures/render/print";

const doc = {
  id: "acme-flyer",
  channel: "print",
  template: "Flyer",
  meta: {
    channel: "print",
    pageSize: "A4",
    orientation: "portrait",
    margins: { top: "20mm", right: "15mm", bottom: "20mm", left: "15mm" },
    bleed: "3mm",
    cropMarks: true,
    dpi: 300,
  },
  layout: {
    slots: [
      { key: "headline", element: "heading", frame: { x: 0, y: 0.15, w: 1, h: 0.15 }, required: true, align: "center" },
      { key: "body", element: "body", frame: { x: 0.1, y: 0.35, w: 0.8, h: 0.4 }, vAlign: "middle" },
    ],
  },
  bindings: [
    { slot: "headline", value: "Grand Opening" },
    { slot: "body", value: "Join us for the launch event." },
  ],
};

const { html, page } = renderPrintDocument(doc);
// html — a full "<!doctype html>...</html>" string. Hand it to a browser's
// print pipeline, or to a downstream rasterizer/PDF tool.
// page — { pageSize: "A4", orientation: "portrait", width: "210mm", height: "297mm", dpi: 300 }
```

### The key architectural decision: paged HTML+CSS, never a PDF

`renderPrintDocument` emits a deterministic, paged-media HTML document —
it does not shell out to Puppeteer, does not embed a headless browser, and
does not produce PDF bytes itself. Two reasons, both load-bearing:

1. **A PDF golden test asserts nothing meaningful.** This package's whole
   testing bar (see `../web/golden-render.test.ts`'s own doc comment, and
   `src/print/golden-render.test.ts` here) is a golden test that asserts
   the EXACT emitted output, byte for byte. A PDF is a binary blob with
   embedded fonts, compression, and object-offset tables that shift on
   every trivial change — there is no meaningful byte-for-byte assertion
   to write against one. An HTML+CSS string is plain, deterministic text:
   the exact same golden-test discipline `./web` already proves works
   applies to `./print` unchanged.
2. **A headless-browser dependency is a cost this package doesn't need to
   pay.** Puppeteer alone is on the order of 300MB (a bundled Chromium
   download) for every consumer of this package, including ones who only
   ever import `./web` or a future `./slides`. This package's own
   precedent (see "The package shape" above) is that a heavy,
   channel-specific dependency is an optional peer, installed only by a
   consumer who actually calls that channel — but even an *optional*
   300MB peer is a cost a print consumer whose real job is "produce an
   HTML string" should not have to accept. Rasterizing this HTML into a
   real PDF (with Puppeteer, Prince, `wkhtmltopdf`, or any other tool) is
   a downstream caller's decision to make, with the dependency weight that
   entails — not this package's.

`renderPrintDocument`'s contract is exactly "a string a browser's print
pipeline renders correctly" — nothing about pagination, rasterization, or
PDF generation is this function's job.

### `pageSize: "Custom"` with no explicit dimensions is an ERROR, not a default

`@vespeneventures/compose`'s frozen `PrintMeta` (`types.ts`) can express
exactly three `pageSize` states: `"A4"`, `"Letter"`, or `"Custom"` — and
`"Custom"` carries no width/height field of its own. `renderPrintDocument`
refuses to render a `"Custom"` document unless the caller supplies
`options.customPageSize: { width, height }` (two CSS lengths):

```ts
renderPrintDocument(doc); // throws RenderError("missing-custom-page-size", ...)
renderPrintDocument(doc, { customPageSize: { width: "148mm", height: "210mm" } }); // OK
```

There is deliberately no silent fallback to A4 here. A4 and a custom trim
size are different physical objects; defaulting one to the other is not a
convenience, it's the exact failure this whole function exists to prevent
— someone printing 500 copies at the wrong trim size, discovering it only
after the print run, with no error anywhere in the pipeline that produced
it.

### `@page`, driven by `PrintMeta` — the real CSS Paged Media syntax

`internal/page.ts` builds the `@page { ... }` rule from CSS Paged Media
Module Level 3's own `size`/`bleed`/`marks` descriptors
(<https://www.w3.org/TR/css-page-3/>):

- **`size`** — `size:A4 portrait;` / `size:letter landscape;` for a named
  page size (CSS's own keyword for Letter is lowercase `letter`; A4's is
  `A4`), or `size:<width> <height>;` (two raw lengths, no orientation
  keyword) for `"Custom"` — the formal grammar's `<length>{1,2}` and
  `<page-size> || [ portrait | landscape ]` are separate alternatives, so
  an explicit length pair can never be paired with a `portrait`/`landscape`
  keyword. A custom page is therefore rendered exactly as the caller
  oriented it (a landscape custom page passes `{ width: "297mm", height:
  "210mm" }`) — `meta.orientation` is never read for `"Custom"`.
- **`margin-top`/`margin-right`/`margin-bottom`/`margin-left`** — from
  `meta.margins`, emitted as four separate declarations rather than a
  shorthand, for an unambiguous one-to-one mapping from the contract's own
  four named fields.
- **`bleed`** — `meta.bleed` (a CSS length) becomes `bleed:<value>;`
  verbatim. Per the spec's own text, `bleed` "only has effect if the value
  of `marks` is `crop`" — a `bleed` with no `cropMarks` is harmless, inert
  CSS, not a bug this renderer guards against.
- **`marks`** — `meta.cropMarks: true` becomes `marks:crop;`.

### Bleed and crop marks are metadata for prepress tooling, not a rasterizer

`meta.bleed`/`meta.cropMarks` only ever reach the `@page` rule's own
`bleed`/`marks` descriptors — this package makes no attempt to draw crop
marks itself, resize the `.page` box to include a bleed margin, or
otherwise simulate what a real print/prepress pipeline does with those
descriptors. That's the correct division of labour: `@page`'s `bleed`/
`marks` are exactly the CSS vocabulary print tooling already knows how to
read, and reimplementing that reading here would be exactly the kind of
"a rule every renderer must independently remember" issue #43 already
warned this whole package about, one layer up.

### `meta.dpi` is metadata, not behaviour

`meta.dpi` is carried straight through into the returned `page.dpi` —
`renderPrintDocument` never reads it to change anything about the emitted
HTML (there is no `dpi`-driven scaling, no resolution-dependent geometry).
It exists for a downstream rasterizer that DOES need a target resolution
(rendering this HTML to a bitmap or a print-quality PDF), and this
function's only job regarding it is to not lose it on the way through.

### Geometry survives here — unlike `./web`

`./web` never reads `SlotSpec.frame` at all: every slot there is rendered
with a fixed full-canvas placeholder, because a flowed web page has no
coordinate system a `Frame` could describe (see
`src/web/internal/webTemplates.ts`'s own doc comment). A print PAGE is a
fixed physical canvas, so `./print` is the first channel in this package
where `Frame` means something real: `doc.layout.slots[].frame` — a 0..1
fraction of the page's PRINTABLE area (the page minus its margins) — is
converted via `@vespeneventures/compose`'s own `frameToPercent` into an
absolutely-positioned percentage box (`left`/`top`/`width`/`height`).
`internal/document.ts` positions the page's content box (`.page-content`)
inset by `meta.margins` from the page's own edges using CSS's own
over-constrained `position:absolute` + all-four-insets resolution — no
`calc()`, no unit arithmetic on this package's part — so every slot's
percentage resolves against exactly "the page, minus its margins," which
is what makes `Frame`'s own "0..1 fraction of the canvas" promise true for
print specifically.

### Colours: flattened to literal hex, even though a browser's print pipeline supports `oklch()`/`var()`

Unlike `./email` (which targets clients with zero `oklch()`/custom-property
support at all), a real browser's print pipeline DOES understand both. So
flattening every colour through the shared `internal/tokens.ts`'s
`flattenTokens()` here is a genuine decision, not an inherited necessity —
and the argument for it is: this HTML is a paged-media document meant to
be **printed, or turned into a PDF**, and the tooling that performs that
step is frequently **not** a browser at all — prepress software, a
PDF-rasterizing library embedded inside a print pipeline, a
`wkhtmltopdf`-shaped headless renderer — much of which has
patchy-to-nonexistent `oklch()`/custom-property support. A flattened
document (literal `#rrggbb` everywhere) is safe in both a browser and a
non-browser print pipeline; a `var()`/`oklch()`-bearing one is only safe in
the former. `SlotSpec.style.color`/`.background` and
`LayoutSpec.background.color`/`.background` are resolved this way — see
`internal/style.ts`, and "Found but not fixed" below for what's
deliberately not resolved yet.

### Typography: every slot gets a resolved font size/family, always

Unlike colour (optional — a slot with no `style.color` simply inherits the
page's own), typography is never omitted: every slot's `<div>` gets a
literal `font-family`/`font-size` declaration, resolved via the shared
`internal/typography.ts` (see "Shared internals" above) — `SlotSpec.
element`'s `ElementKind` default (`ELEMENT_TYPOGRAPHY_ROLE`/
`ELEMENT_FONT_FAMILY_ROLE`), overridden by `style.typography` (a token
role name) when present. Before this was wired in, `./print` emitted no
typography at all, leaving font size/family to whatever default the
receiving browser or print pipeline happened to pick.

### Page-break control

Every rendered slot gets `break-inside:avoid;page-break-inside:avoid;` by
default (the modern CSS Fragmentation Module Level 3 property, paired with
the legacy CSS 2.1 one for older engines/prepress tooling) — a heading or a
stat splitting mid-way across a page boundary is almost never intentional
in a print document. `RenderPrintOptions.allowBreakInside` (a list of slot
keys) opts specific slots out of that default; `breakBefore`/`breakAfter`
(also slot-key lists) force a slot to start a fresh page
(`break-before:page;page-break-before:always;`) or be immediately followed
by one (`break-after:page;page-break-after:always;`).

### Refusal paths — never a silent partial page

| `RenderError.reason` | When |
| --- | --- |
| `"wrong-channel"` | `doc.channel` (or `doc.meta.channel`) isn't `"print"`. |
| `"missing-layout"` | `doc.layout` is absent or malformed — `compose`'s own contract requires a `LayoutSpec` for `print`. |
| `"missing-custom-page-size"` | `doc.meta.pageSize === "Custom"` with no (or blank) `options.customPageSize`. |
| `"resolution-failed"` | `@vespeneventures/compose`'s `resolveDocument` reports `ok: false` — a required slot has no binding, a binding targets an unknown slot, or nothing matched. |
| `"empty-output"` | `resolveDocument` succeeded but `@vespeneventures/compose`'s `resolveCopy` reports `ok: false` — some matched slot's `copyId` never resolved to real text. `./print` reuses `resolveCopy` rather than hand-rolling a second check — see `compose`'s own `resolve-copy.ts` doc comment and issue #43. |
| `"unknown-style-role"` | A `style.color`/`.background`/`.typography` (slot or page-level) names a token role that isn't in `@vespeneventures/tokens`' `TOKENS` registry, or (for `.typography` specifically) a role that exists but doesn't resolve to a pixel font-size. |

### Found but not fixed

`StyleBinding.border` and `.weight` are still NOT resolved by
`renderPrintDocument` — only `.color`, `.background`, and (as of this
package's typography work) `.typography` are. `border` would need a
width/style this frozen contract has no field for, and `weight` names a
font-weight scale `@vespeneventures/tokens` doesn't ship at all (it has a
`text` size scale and a `font` family scale — see "Shared internals" above
— but no `weight` family). Inventing an unfounded mapping for either risks
exactly the failure `internal/tokens.ts`'s own doc comment warns against
for colour — "a plausible-looking wrong" value is worse than an unhandled
field that says so in code (`src/print/internal/style.ts`). This is
flagged here, not silently shipped, so whoever adds real border/weight
support next knows it's a real gap, not an oversight nobody noticed.
## `./image` and `./slides` — a fixed canvas with absolutely-positioned slots

`./image` and `./slides` are one problem solved once: `ImageMeta` describes
one canvas (`width`/`height`, optionally `scale`d for retina output) and
`SlidesMeta` describes a deck, which is nothing more than an ORDERED
SEQUENCE of the same kind of canvas (one fixed size per `aspect`, `16:9` ->
1920x1080 or `4:3` -> 1024x768). Both channels place a `LayoutSpec`'s
`SlotSpec`s at their `Frame`'s absolute position on that canvas. So the
geometry math, the text-wrapping heuristic, and the XML-escaping rules are
built exactly ONCE, in `src/image/engine.ts` and `src/image/
resolveCanvasLayout.ts`, and `src/slides/` imports them directly rather
than re-deriving any of it — see `engine.ts`'s own top comment for exactly
which two files this is and why they live under `src/image/` rather than
`src/internal/`.

### Architectural decision: SVG, never raster bytes

Neither channel ever produces PNG/JPEG/WebP bytes, and neither ever will.
SVG is a deterministic STRING — a golden test can assert the exact emitted
bytes, exactly as `src/web/golden-render.test.ts` already does for HTML.
Raster output is an opaque binary blob no test can meaningfully assert
against ("it didn't crash" is not a correctness check), and every
rasterizer (a headless browser, `sharp`, `canvas`, `pptxgenjs`) is a
heavyweight native dependency this package's zero-new-dependencies rule
rules out. `ImageMeta.format` may ask for `"png"`/`"jpeg"`/`"webp"` —
`renderImageDocument` still emits SVG, and says so honestly:
`RenderImageResult.requestedFormat` carries the caller's original ask, and
`RenderImageResult.warnings` carries an explicit note that rasterizing the
returned SVG to that format is the CALLER's job. Neither function ever
silently pretends to have produced a raster image it didn't.

### Text wrapping — the hard part, and how this package handles it

SVG 1.1 has no automatic text reflow: a long string in a narrow slot runs
straight past the frame's edge with no complaint from any renderer. This
package implements DETERMINISTIC LINE BREAKING (`src/image/engine.ts`'s
`wrapText`) using a fixed average-character-width-per-`em` constant
(`0.55em`, tuned for a generic sans-serif font) rather than a real
font-metrics dependency — deliberately: the task this package was built
against rules one out. When even the wrapped text needs more lines than
the slot's frame height allows at its element kind's font size, the tail
is truncated with a trailing ellipsis AND reported — every renderer
(`renderImageDocument`, `renderSlidesDeck`) returns the overflow as a
named warning (`slot "<key>" ... text overflowed its frame ... and was
truncated`), never silently. See `wrapText`'s own doc comment for the
accuracy limits this approximation carries (narrow/wide glyphs, non-Latin
scripts, no kerning/ligatures).

**The font size `wrapText` measures against is always the RESOLVED one.**
`renderSlots.ts` resolves each slot's real font size (via `internal/
typography.ts` — see "Shared internals" above; `ElementKind` default,
overridden by `style.typography` when present) BEFORE calling `wrapText`,
so wrapping and overflow warnings reflect the size actually painted onto
the SVG. This used to not be true: a now-deleted `DEFAULT_FONT_SIZE_PX`
placeholder table (with a doc comment that falsely claimed "no real
typography token to resolve instead") fed `wrapText` a made-up number that
could silently disagree with reality — see `engine.test.ts`'s own
"PROOF" test for a concrete fixture where the placeholder size and the
real token size disagree on whether the text overflows at all.

### Typography — resolved font size/family, via `internal/typography.ts`

`SlotSpec.element`'s `ElementKind` selects a default `--text-*`/`--font-*`
role (`internal/typography.ts`'s `ELEMENT_TYPOGRAPHY_ROLE`/
`ELEMENT_FONT_FAMILY_ROLE`); `SlotSpec.style.typography` (a token role
name) overrides the size role when present. Both resolve to literal
values — `font-size` as a bare number matching the token's own pixel value
(`"28px"` -> `28`), `font-family` XML-entity-escaped via `escapeXml` (the
token's own family-stack string carries embedded double quotes, e.g.
`"Segoe UI"`, which must not break the surrounding SVG attribute) — before
either reaches the emitted `<text>` element. An unknown or non-size
`style.typography` role throws `RenderError("unknown-style-role", ...)`,
never a silent fallback to the `ElementKind` default.

### Colors — always a literal hex, via `internal/tokens.ts`

A `StyleBinding`'s `color`/`background`/`border` fields are token ROLE
NAMES (e.g. `"--color-ink-primary"`), resolved through
`internal/tokens.ts`'s `flattenTokens`/`resolveTokenRef` (`engine.ts`'s
`resolveColorRole`) into a literal `#rrggbb[aa]` string before it ever
reaches the emitted SVG — SVG has no CSS custom-property cascade in a
rasterizer and no `oklch()` support, so every color this package emits is
a literal, never `oklch(...)` and never `var(--...)`. See the "Shared
internals" section below for the module itself.

### `./slides`' input shape — an ordered array of real `ComposeDocument`s

`renderSlidesDeck` takes a `SlidesDeckInput`: `{ id, slides:
ComposeDocument[], notes?: Record<string, string> }` — a plain, ORDERED
array of real, individually-valid `channel: "slides"` `ComposeDocument`s
(array index IS deck order, never inferred from `id` or any other implicit
signal), plus deck-wide speaker notes. `SlidesMeta.notes` is typed
`Record<string, string>` KEYED BY SLIDE ID — structurally deck-wide data —
so this package reads notes from `SlidesDeckInput.notes`, the deck-level
input, never from any individual slide document's own `meta.notes`. A
notes key naming no slide in the deck is reported in
`RenderSlidesResult.unknownNoteKeys` (almost always a renamed slide and a
lost speaker note) — never dropped, and never thrown either: it doesn't
block an otherwise-good render. See `renderSlidesDeck.ts`'s own doc
comment, "Deciding the input shape", for why the alternative the task
brief itself named ("one document with multiple layouts") isn't actually
expressible against `compose`'s frozen `ComposeDocument` type.

## API

### `./web`

| Export | Kind | Purpose |
| --- | --- | --- |
| `renderWebDocument(doc, options?)` | function | Resolves a `channel: "web"` `ComposeDocument`'s `bindings` into the named `@vespeneventures/ui` view (`AuthView`, `ErrorView` today) and builds its head metadata. Returns `{ element, head }`. Throws `RenderError` — never silently renders an incomplete or empty page — for an unknown template, a non-web document, a resolution failure, or a required slot that resolved to no text. See "A document that resolves to nothing is an error" above. |
| `buildWebHeadMetadata(meta)` | function | The `WebMeta` → `WebHeadMetadata` half of `renderWebDocument`, exposed standalone for a caller who already has a `WebMeta` and wants just the head, without a full `ComposeDocument`. |
| `listWebTemplateNames()` | function | Every template name this package's web renderer currently knows — `["AuthView", "ErrorView"]` — so a caller can validate a `template` string, or build a picker UI, without hardcoding the list. |
| `RenderError` | class | `extends Error`. Every failure `renderWebDocument` throws is one of these. Carries `reason: RenderErrorReason` alongside the usual `message`. |
| `RenderErrorReason` | type | The closed set of reasons `RenderError` is ever thrown for, ACROSS every channel this package ships (`RenderError` is shared — see `internal/errors.ts`). `renderWebDocument` itself only ever throws `"unknown-template" \| "wrong-channel" \| "resolution-failed" \| "empty-output"` (see the table above); the other six members (`"invalid-oklch"`, `"non-brandable-override"`, `"unknown-token-override"`, `"unknown-token-ref"`, `"token-ref-cycle"`, `"invalid-token-ref"`) belong to `internal/tokens.ts`'s token-flattening helpers — see "Shared internals" below — which `./web` doesn't currently call, but the type is exported whole rather than narrowed per subpath. |
| `CopyResolver` | type | `(copyId: string) => string \| undefined`. The shape `options.resolveCopyId` must have. See "The `copyId` seam" above. |
| `RenderWebOptions` | type | `{ resolveCopyId?: CopyResolver }`. `renderWebDocument`'s second argument. |
| `RenderWebResult` | type | `{ element: ReactNode; head: WebHeadMetadata }`. What `renderWebDocument` returns. |
| `WebHeadMetadata` | type | `{ title, description, canonical?, robots?, keywords?, openGraph?, twitter?, jsonLd: string[] }`. Plain, JSON-serialisable, framework-agnostic — see "Head metadata" above. `jsonLd` is always an array (empty when `WebMeta.jsonLd` was absent), never `undefined`. |
| `WebOpenGraphMetadata` | type | `{ title?, description?, image?, type? }`. `WebHeadMetadata.openGraph`'s shape — the same fields as `@vespeneventures/compose`'s `WebMeta.og`, renamed for clarity in a public, non-`compose`-typed API. |
| `WebTwitterMetadata` | type | `{ card?: "summary" \| "summary_large_image", site? }`. `WebHeadMetadata.twitter`'s shape. |

### `./email`

| Export | Kind | Purpose |
| --- | --- | --- |
| `renderEmailDocument(doc, options?)` | function | Resolves a `channel: "email"` `ComposeDocument`'s `bindings` (via `@vespeneventures/compose`'s `resolveDocument`/`resolveCopy`) into a complete, self-contained, table-based HTML document plus its plain-text alternative. Returns `{ html, text, subject, preheader, warnings }`. Throws `RenderError` for a non-email document, a resolution failure, or any bound slot that resolved to no real text. See "`./email` — email is not a small web page" above. |
| `RenderError` | class | The same class `./web` exports — see that table entry above. |
| `RenderErrorReason` | type | The same shared type `./web` exports — see that table entry above. `./email` throws `"wrong-channel"`, `"resolution-failed"`, or `"empty-output"` from its own resolution pipeline, plus `"unknown-style-role"` when a slot's `style.typography` names an unknown or non-size token role (see "Shared internals" above, `internal/typography.ts`). |
| `RenderEmailOptions` | type | `{ layout?: LayoutSpec; lookup?: CopyLookup; brand?: Record<string, string> }`. `renderEmailDocument`'s second argument — see "The geometry problem" above for `layout`, `@vespeneventures/compose`'s own `CopyLookup` for `lookup`, and `internal/tokens.ts`'s `flattenTokens` for `brand`. |
| `EmailRenderResult` | type | `{ html: string; text: string; subject: string; preheader: string; warnings: RenderWarning[] }`. What `renderEmailDocument` returns. |
| `RenderWarning` | type | `{ code: "slots-stacked" \| "slot-width-lost"; message: string; slots: string[] }`. Every real geometry-fidelity loss `renderEmailDocument` had to accept — see "The geometry problem" above. |
### `./print`

| Export | Kind | Purpose |
| --- | --- | --- |
| `renderPrintDocument(doc, options?)` | function | Resolves a `channel: "print"` `ComposeDocument`'s `bindings` against its own `doc.layout`, and its `copyId`s via `options.resolveCopyId`, into a complete, standalone paged-media HTML+CSS document string. Returns `{ html, page }`. Throws `RenderError` — never silently renders an incomplete page — for a non-print document, a missing/malformed layout, `"Custom"` with no dimensions, a resolution failure, unresolved required text, or an unknown style-token role. See "`./print`" above for the full picture. |
| `RenderError` | class | The same `RenderError` `./web` exports — `extends Error`, `reason: RenderErrorReason`. |
| `RenderErrorReason` | type | The same package-wide closed set `./web` exports — see `internal/errors.ts`. `renderPrintDocument` itself only ever throws `"wrong-channel"`, `"missing-layout"`, `"missing-custom-page-size"`, `"resolution-failed"`, `"empty-output"`, or `"unknown-style-role"` — see "Refusal paths" above. |
| `CopyResolver` | type | `(copyId: string) => string \| undefined`. `./print`'s own declaration of the same shape `./web`'s `CopyResolver` uses — see `src/print/types.ts`'s own doc comment for why it's a separate declaration, not a shared import. |
| `CustomPageSize` | type | `{ width: string; height: string }`. `options.customPageSize`'s shape — required when `doc.meta.pageSize === "Custom"`. |
| `RenderPrintOptions` | type | `{ resolveCopyId?, customPageSize?, tokenOverrides?, breakBefore?, breakAfter?, allowBreakInside? }`. `renderPrintDocument`'s second argument — see "`./print`" above for each field. |
| `RenderPrintResult` | type | `{ html: string; page: PrintPageInfo }`. What `renderPrintDocument` returns. |
| `PrintPageInfo` | type | `{ pageSize, orientation, width, height, dpi? }` — the page geometry/metadata this render actually used; `width`/`height` are the resolved physical dimensions (a named size's real size, or `options.customPageSize` verbatim), and `dpi` is carried through from `meta.dpi` unchanged, present only when supplied. |
### `./image`

| Export | Kind | Purpose |
| --- | --- | --- |
| `renderImageDocument(doc, options?)` | function | Resolves a `channel: "image"` `ComposeDocument`'s `bindings` against `doc.layout`, then emits a self-contained SVG string sized to `ImageMeta.width`/`height` (scaled per `ImageMeta.scale`). Returns `RenderImageResult`. Throws `RenderError` for a non-`image` document, a missing/failed-to-resolve layout, or a required slot that resolved to no text — see "A document that resolves to nothing is an error" (the same three-reason bar `./web` uses: `"wrong-channel"`, `"resolution-failed"`, `"empty-output"`). |
| `RenderImageOptions` | type | `{ resolveCopyId?: CopyLookup; tokenOverrides?: Record<string,string> }`. `resolveCopyId` is `@vespeneventures/compose`'s own `CopyLookup` shape (this package calls `resolveCopy` directly — never a hand-rolled equivalent, see "The #43 gap" in `resolveCanvasLayout.ts`). `tokenOverrides` flows straight into `internal/tokens.ts`'s `flattenTokens`. |
| `RenderImageResult` | type | `{ svg, requestedFormat, width, height, viewBox: { width, height }, scale, warnings }`. `svg` is the complete document; `requestedFormat` is `ImageMeta.format` as asked (this function always emits SVG regardless — see "Architectural decision" above); `width`/`height` are the emitted `<svg>` attributes (`logical * scale`); `viewBox` is always the LOGICAL, unscaled size; `warnings` never blocks a render but is never silently dropped either (overflow truncations, omitted optional slots, the rasterization notice when `requestedFormat !== "svg"`). |
| `wrapText`, `escapeXml`, `frameToCanvasRect`, `computeCanvasDimensions`, `resolveColorRole` | functions | The shared canvas engine — see "The `image`/`slides` architecture" above. Exported for `./slides` to import (and for any caller who wants the same primitives directly). Font-size/font-family resolution (`internal/typography.ts`'s `resolveElementTypography`/`resolveElementFontFamily`) is used internally by `renderSlots.ts` but not re-exported from this subpath — see "Shared internals" above for that module directly. |
| `RenderError` / `RenderErrorReason` | class / type | Shared with every other channel — see `./web`'s own API table. |

### `./slides`

| Export | Kind | Purpose |
| --- | --- | --- |
| `renderSlidesDeck(deck, options?)` | function | Resolves and renders every slide in a `SlidesDeckInput`, one self-contained SVG per slide, all sharing one fixed canvas derived from `SlidesMeta.aspect` (`16:9` -> 1920x1080, `4:3` -> 1024x768). Returns `RenderSlidesResult`. A failing slide (wrong channel, failed resolution, empty required output) throws `RenderError` for the WHOLE deck, naming the offending slide's index and id — see `renderSlidesDeck.ts`, "One failing slide fails the whole deck". An inconsistent `aspect` across slides throws the new `"inconsistent-deck-aspect"` reason. |
| `SlidesDeckInput` | type | `{ id, slides: ComposeDocument[], notes?: Record<string,string> }` — see "`./slides`' input shape" above. |
| `RenderSlidesOptions` | type | `{ resolveCopyId?: CopyLookup; tokenOverrides?: Record<string,string> }` — identical shape to `RenderImageOptions`, applied uniformly to every slide. |
| `RenderedSlide` | type | `{ id, index, svg, notes?, warnings }` — one slide's own result; `index` is its position in `SlidesDeckInput.slides`, carried straight through. |
| `RenderSlidesResult` | type | `{ slides: RenderedSlide[], width, height, aspect, unknownNoteKeys, warnings }`. `unknownNoteKeys` lists every `notes` key matching no slide id — reported, never dropped, never thrown. `warnings` flattens every slide's own warnings, each prefixed `slide "<id>": `. |
| `canvasForAspect(aspect)` | function | `SlidesMeta.aspect` -> `{ width, height }` — the fixed, documented two-entry table (`src/slides/canvas.ts`). |
| `RenderError` / `RenderErrorReason` | class / type | Shared with every other channel. |

## Requirements

Node 20+. ESM only. No root `.` export — import from
`@vespeneventures/render/web`, `/email`, `/print`, `/image`, or
`/slides`. `@vespeneventures/compose` and `@vespeneventures/tokens` are
real dependencies; `react`, `react-dom`, and `@vespeneventures/ui` are
optional peer dependencies of this package as a whole — because npm has no
per-subpath peer dependencies, but in practice all three are required to
use `./web`. NONE of them are needed by `./email`, `./print`, `./image`,
or `./slides`: `./email` and `./print` build their HTML as a plain string,
and `./image` and `./slides` emit SVG as a plain string, all four with
zero new dependencies of their own. Every heavy dependency this package
carries is scoped to `./web` alone. See "The package shape" above for the
full reasoning, and for the pattern the next channel should follow for its
own heavy dependencies.
reasoning, and for the pattern the next channel should follow for its own
heavy dependencies.

## Licence

MIT
