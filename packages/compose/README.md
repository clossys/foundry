# @vespeneventures/compose

The join point where `@vespeneventures/ui`'s visual vocabulary meets
`@vespeneventures/copy`'s verbal one, plus everything a specific output
channel needs to know. A `ComposeDocument` is the document that says: *this
template, these slots filled from these copy ids, targeting this channel,
with this metadata.*

```bash
npm install @vespeneventures/compose
```

## What this package is

Five renderers — one per `Channel` (`web`, `email`, `print`, `slides`,
`image`) — are built in a separate package, by separate agents, against
this package's own `ComposeDocument` type. This package ships the contract
those renderers are built against, validation that a candidate document
actually conforms to it, and the slot-resolution logic every renderer needs
before it can draw anything: it never renders anything itself.

```
the ComposeDocument shape        machinery      types.ts, this package
a real template + real bindings   binding        a consumer's own content
what a renderer actually draws     downstream     the five renderer packages, built against this
```

## Zero runtime dependencies

**No React, no zod, nothing.** This is load-bearing, not a style
preference: only one of the five renderers (the `web` one) uses React — if
React leaked in here as a dependency, the `email` and `print` renderers
would inherit a peer they never use, for a package they only need for its
types and pure functions. `validate.ts` hand-rolls its shape validation in
plain type guards, in the style of `@vespeneventures/strategy`'s
`validation.ts`, `@vespeneventures/policy`'s `validate.ts`, and
`@vespeneventures/copy`'s `schema.ts` — the same reasoning all three give:
this package's entire job is dependency-free data validation, and a
package four other packages depend on should not force every one of them
onto one schema library's major version. This package also carries **no
dependency on `@vespeneventures/ui` or `@vespeneventures/copy`
themselves** — see "The `copyId` seam" and "The `template` seam" below for
why the coupling to both is a plain string convention, never an import.

## The frozen contract

```ts
type Channel = "web" | "email" | "print" | "slides" | "image";

/** Content going into a named slot. Exactly one of copyId | value. */
interface SlotBinding {
  slot: string;
  copyId?: string;   // id into a CopyRecord — plain string, no code dependency on the copy package
  value?: string;    // literal, for content that isn't registry-owned
}

/** Fractions of the canvas, 0..1. Never px, never inches. */
interface Frame { x: number; y: number; w: number; h: number; }

type ElementKind =
  | "heading" | "subheading" | "body" | "eyebrow" | "label"
  | "stat" | "list" | "image" | "logo" | "button" | "divider" | "fill";

/** Token ROLE names only. A binding never holds a hex or a font size. */
interface StyleBinding {
  typography?: string; color?: string; background?: string; border?: string; weight?: string;
}

interface SlotSpec {
  key: string; element: ElementKind; frame: Frame;
  style?: StyleBinding; required?: boolean;
  align?: "start" | "center" | "end";
  vAlign?: "top" | "middle" | "bottom";
}

interface LayoutSpec { background?: StyleBinding; slots: SlotSpec[]; }

interface WebMeta {
  channel: "web"; title: string; description: string;
  canonical?: string; robots?: string; keywords?: string[];
  og?: { title?: string; description?: string; image?: string; type?: string };
  twitter?: { card?: "summary" | "summary_large_image"; site?: string };
  jsonLd?: Record<string, unknown>[];
}
interface EmailMeta {
  channel: "email"; subject: string; preheader: string;   // preheader max 140 chars
  replyTo?: string; listUnsubscribe?: string;
}
interface PrintMeta {
  channel: "print"; pageSize: "A4" | "Letter" | "Custom";
  orientation: "portrait" | "landscape";
  margins: { top: string; right: string; bottom: string; left: string };
  bleed?: string; cropMarks?: boolean; dpi?: number;
}
interface SlidesMeta { channel: "slides"; aspect: "16:9" | "4:3"; notes?: Record<string, string>; }
interface ImageMeta {
  channel: "image"; width: number; height: number;
  format: "png" | "jpeg" | "webp" | "svg"; scale?: 1 | 2; alt: string;
}
type ChannelMeta = WebMeta | EmailMeta | PrintMeta | SlidesMeta | ImageMeta;

interface ComposeDocument {
  id: string;
  channel: Channel;
  meta: ChannelMeta;
  template: string;              // a ui view name, or a template id
  bindings: SlotBinding[];
  layout?: LayoutSpec;           // required for print | slides | image
}
```

### Why `Frame` is a fraction, never a px/inch value

`Frame` is fractional 0..1 so the exact same `LayoutSpec` serves a CSS
emitter (which wants percentages) and a slide emitter (which wants inches)
without either renderer needing a different document shape. A prior
40-package attempt validated exactly this design with two real emitters
reading the same spec. `frameToPercent`/`frameToInches` below are the two
conversions a renderer actually performs — this package never picks a
unit for you.

### Why `layout` is channel-gated

Email cannot do absolute positioning — every client forces an ordered
block stack. A web page flows the same way. So `layout` is meaningless for
`channel: "web"` and `"email"`, and `validateComposeDocument` enforces
that: a `layout` on either is an `"layout-forbidden"` error, and its
absence on `print`/`slides`/`image` is a `"layout-required"` error.

### The `copyId` seam

`SlotBinding.copyId` is a **plain string**, never a typed import of
`@vespeneventures/copy`. Same seam `@vespeneventures/voice`'s
`Claim.factRef` and `@vespeneventures/copy`'s own `CopyEntry.factRef` draw:
the coupling is an opaque string convention, not a code import, so this
package works whether or not `copy` is installed at all, and resolving a
`copyId` against a real `CopyRecord` is a later gate's job — one with
visibility into both this package's documents and a real `CopyRecord`,
which this package deliberately does not have.

### The `template` seam

`ComposeDocument.template` is likewise a **plain string** — a
`@vespeneventures/ui` view name, or any other template id a renderer
understands. There is no code dependency on `@vespeneventures/ui` behind
it. Resolving a `template` string against a real view/component is a
renderer's job, not this package's; this package only carries the name.

## Usage

```ts
import { validateComposeDocument, type ComposeDocument } from "@vespeneventures/compose";

// A consumer's own document. "acme" is an obviously fictional placeholder —
// the same one already used across this repository's own README examples.
const doc: ComposeDocument = {
  id: "acme-og-card",
  channel: "image",
  template: "OgCardTemplate",
  meta: { channel: "image", width: 1200, height: 630, format: "png", alt: "Acme" },
  bindings: [{ slot: "headline", copyId: "og.headline" }],
  layout: {
    slots: [
      { key: "headline", element: "heading", frame: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 }, required: true },
    ],
  },
};

const findings = validateComposeDocument(doc);
if (findings.length > 0) {
  for (const f of findings) console.error(`[${f.severity}] ${f.path ?? "(root)"}: ${f.rule}: ${f.message}`);
  process.exitCode = 1;
}
```

Resolving a document's bindings against a real layout — the step every
renderer needs before it can draw anything:

```ts
import { resolveDocument } from "@vespeneventures/compose";

const result = resolveDocument(doc, doc.layout!);
if (!result.ok) {
  console.error(`missing required slots: ${result.missingRequired.join(", ") || "(none)"}`);
  console.error(`bindings with no matching slot: ${result.unknownBindings.length}`);
  process.exit(2);
}
for (const { key, spec, binding } of result.resolved) {
  // spec.frame, spec.element, spec.style — what to draw and where.
  // binding.copyId / binding.value — what to draw it with.
}
```

Converting a `Frame`'s 0..1 fractions into the unit a specific renderer
actually needs:

```ts
import { frameToInches, frameToPercent } from "@vespeneventures/compose";

frameToPercent({ x: 0.1, y: 0.4, w: 0.8, h: 0.2 });
// => { x: 10, y: 40, w: 80, h: 20 }

frameToInches({ x: 0.1, y: 0.4, w: 0.8, h: 0.2 }, { width: 8.5, height: 11 });
// => { x: 0.85, y: 4.4, w: 6.8, h: 2.2 }
```

## The bar: a clean pass must mean something was actually checked

Five agents on this repository recently each shipped a first draft that
reproduced the exact defect it was fixing, every one passing local
verification. The recurring shape was *a check that passes while
asserting nothing*. This package's own `resolveDocument` is built against
that bar directly: `ok: true` only when resolution actually resolved
something — an empty `layout` (`slots: []`), an empty `bindings` list, or
a document whose bindings matched zero slots in the layout are each `ok:
false`, never a silent clean pass on having resolved nothing. See
`resolve.ts`'s own doc comment, and `resolveDocument`'s entry in the API
table below, for the exact rule.

## Validation beyond the contract's literal wording — flagged explicitly

`validateComposeDocument`'s `"frame-out-of-bounds"` rule checks that a
`Frame` fits inside the canvas once placed (`x + w <= 1`, `y + h <= 1`),
not just that each of `x`/`y`/`w`/`h` is individually within `[0, 1]` in
isolation — a frame like `{ x: 0.9, y: 0, w: 0.5, h: 0.5 }` passes the
narrower, literal reading of "each field within 0..1" and still runs a
slot off the edge of every renderer's canvas. This is a validation-only
strengthening, not a change to any field's shape in the frozen contract
above — but it is called out here explicitly, in the delivery report, and
in `validate.ts`'s own top comment, since four renderer agents will build
against this package's judgment calls, not just its types.

## API

### Types (`types.ts`)

| Export | Kind | Purpose |
| --- | --- | --- |
| `Channel` | type | `"web" \| "email" \| "print" \| "slides" \| "image"`. The closed vocabulary of output targets. |
| `CHANNELS` | const | `Channel`'s own members as a runtime array — `["web", "email", "print", "slides", "image"]`. |
| `SlotBinding` | type | `{ slot, copyId?, value? }`. Content going into a named slot; exactly one of `copyId`/`value`. |
| `Frame` | type | `{ x, y, w, h }`, each a fraction 0..1 of the canvas. |
| `Rect` | type | `{ x, y, w, h }` in a concrete unit (percent or inches) — what `frameToPercent`/`frameToInches` return. A distinct type from `Frame` so a converted value can never be mistaken for one still in the 0..1 fractional space. |
| `ElementKind` | type | `"heading" \| "subheading" \| "body" \| "eyebrow" \| "label" \| "stat" \| "list" \| "image" \| "logo" \| "button" \| "divider" \| "fill"`. |
| `ELEMENT_KINDS` | const | `ElementKind`'s own members as a runtime array. |
| `StyleBinding` | type | `{ typography?, color?, background?, border?, weight? }`. Token ROLE names only — never a hex value or a font size. |
| `SlotSpec` | type | `{ key, element, frame, style?, required?, align?, vAlign? }`. One positioned slot in a `LayoutSpec`. |
| `LayoutSpec` | type | `{ background?, slots }`. The full set of positioned slots a `print`/`slides`/`image` template exposes. Meaningless for `web`/`email` — see "Why `layout` is channel-gated". |
| `WebMeta` | type | `{ channel: "web", title, description, canonical?, robots?, keywords?, og?, twitter?, jsonLd? }`. |
| `EmailMeta` | type | `{ channel: "email", subject, preheader, replyTo?, listUnsubscribe? }`. `preheader` max 140 characters. |
| `PrintMeta` | type | `{ channel: "print", pageSize, orientation, margins, bleed?, cropMarks?, dpi? }`. |
| `SlidesMeta` | type | `{ channel: "slides", aspect, notes? }`. |
| `ImageMeta` | type | `{ channel: "image", width, height, format, scale?, alt }`. |
| `ChannelMeta` | type | `WebMeta \| EmailMeta \| PrintMeta \| SlidesMeta \| ImageMeta`, discriminated on `channel`. |
| `ComposeDocument` | type | `{ id, channel, meta, template, bindings, layout? }`. The whole document this package exists to type and validate. |
| `ComposeFinding` | type | `{ rule, severity: "error" \| "warning", message, path? }` — deliberately the same shape as `@vespeneventures/copy`'s `CopyFinding` and `@vespeneventures/policy`'s `Finding`. What `validateComposeDocument` returns. |
| `ResolvedSlot` | type | `{ key, spec, binding }` — one slot a `LayoutSpec` declares that also has a matching `SlotBinding`. One entry of `ResolveResult.resolved`. |
| `ResolveResult` | type | `{ ok, missingRequired, unknownBindings, resolved }` — what `resolveDocument` returns. See "The bar" above for exactly what `ok` means. |

### Validation (`validate.ts`)

| Export | Kind | Purpose |
| --- | --- | --- |
| `validateComposeDocument(value)` | function | Hand-rolled structural validation of a candidate `ComposeDocument` — no schema library. Enforces the channel/`meta` discriminant agrees; `layout` present exactly when the channel requires it and absent exactly when forbidden; every `SlotBinding` has exactly one of `copyId`/`value`; every `Frame` is within 0..1, has nonzero area, and fits inside the canvas (see "Validation beyond the contract's literal wording" above); `EmailMeta.preheader` is at most 140 characters; `ImageMeta.width`/`height` are positive; every `SlotSpec.key` is unique within a `LayoutSpec`. Returns a `ComposeFinding[]`; `[]` means `value` is a well-formed `ComposeDocument`. Never throws, on any input. |

### Resolution (`resolve.ts`)

| Export | Kind | Purpose |
| --- | --- | --- |
| `resolveDocument(doc, layout)` | function | Matches `doc.bindings` against `layout.slots`. A binding whose `slot` matches no real slot is collected into `unknownBindings`; a `required: true` slot with no matching binding is collected into `missingRequired`; every real match becomes one `ResolvedSlot` in `resolved`. `layout` is a separate argument from `doc.layout` because `web`/`email` documents carry no `layout` at all — a caller resolving one of those supplies the real slot list its template defines from wherever that lives (a `@vespeneventures/ui` view's props, in practice). `ok` is `true` only when `resolved.length > 0` and both `missingRequired`/`unknownBindings` are empty — see "The bar" above. |

### Unit conversion (`frame.ts`)

| Export | Kind | Purpose |
| --- | --- | --- |
| `frameToPercent(frame)` | function | Converts a `Frame`'s 0..1 fractions into percentages (0..100) — what a CSS emitter wants. Returns a `Rect`. |
| `frameToInches(frame, canvasInches)` | function | Converts a `Frame`'s 0..1 fractions into inches, given the canvas's real size. Returns a `Rect`. |
| `CanvasInches` | type | `{ width, height }` — the canvas's real size in inches. `frameToInches`'s second argument. |

### Slot helpers (`slots.ts`)

| Export | Kind | Purpose |
| --- | --- | --- |
| `listSlotKeys(layout)` | function | Every `SlotSpec.key` a `LayoutSpec` declares, in declaration order. |
| `requiredSlotKeys(layout)` | function | Every `SlotSpec.key` a `LayoutSpec` marks `required: true`, in declaration order. |
| `getSlotSpec(layout, key)` | function | The `SlotSpec` in `layout` whose `key` matches `key`, or `undefined` if none does. |

## Requirements

Node 20+. ESM only. **Zero runtime dependencies** — matching
`@vespeneventures/catalog`, `@vespeneventures/policy`,
`@vespeneventures/tokens`, and `@vespeneventures/voice`'s own precedent.
No dependency on `@vespeneventures/ui` or `@vespeneventures/copy` either,
despite this README's comparisons to both — see "The `copyId` seam" and
"The `template` seam" above for why both couplings are opaque string
conventions, not imports.

## Licence

MIT
