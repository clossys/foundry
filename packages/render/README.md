# @vespeneventures/render

Renderers built against `@vespeneventures/compose`'s `ComposeDocument`
contract — one subpath per output channel. Ships `./web` first: resolves a
web `ComposeDocument`'s `bindings` into the named `@vespeneventures/ui`
view and emits framework-agnostic head metadata (title, description,
canonical, robots, keywords, OpenGraph, Twitter card, and escaped
JSON-LD). `./email`, `./print`, `./slides`, and `./image` are the same
shape, built later, by later agents, against the same `ComposeDocument`.

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
**tilde** range (`~0.1.0`), not caret: `compose` is pre-1.0, and a caret
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

## Requirements

Node 20+. ESM only. No root `.` export — import from
`@vespeneventures/render/web` (and, later, `/email`, `/print`, `/slides`,
`/image`). `@vespeneventures/compose` and `@vespeneventures/tokens` are
real dependencies; `react`, `react-dom`, and `@vespeneventures/ui` are optional peer dependencies of
this package as a whole — because npm has no per-subpath peer
dependencies, but in practice all three are required to use `./web`. See
"The package shape" above for the full reasoning, and for the pattern the
next channel should follow for its own heavy dependencies.

## Licence

MIT
