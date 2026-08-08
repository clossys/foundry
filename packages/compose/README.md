# @vespeneventures/compose

The join point where `@vespeneventures/ui`'s visual vocabulary meets
`@vespeneventures/copy`'s verbal one and `@vespeneventures/assets`'s
visual-registry one, plus everything a specific output channel needs to
know. A `ComposeDocument` is the document that says: *this template, these
slots filled from these copy ids, asset ids, or literal values, targeting
this channel, with this metadata.*

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
dependency on `@vespeneventures/ui`, `@vespeneventures/copy`, or
`@vespeneventures/assets` themselves** — see "The `copyId` seam", "The
`assetId` seam", and "The `template` seam" below for why the coupling to
all three is a plain string convention, never an import.

## The frozen contract

```ts
type Channel = "web" | "email" | "print" | "slides" | "image";

/** Content going into a named slot. Exactly one of copyId | value | assetId. */
interface SlotBinding {
  slot: string;
  copyId?: string;   // id into a CopyRecord — plain string, no code dependency on the copy package
  value?: string;    // literal, for content that isn't registry-owned
  assetId?: string;  // id into an AssetRecord — plain string, no code dependency on the assets package
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

### The `assetId` seam

`SlotBinding.assetId` (0.3.0) is the identical seam, one binding field
over: a **plain string**, never a typed import of
`@vespeneventures/assets`. Added to close the gap `ElementKind`'s
`"image"`/`"logo"` members left open since this package's first release —
until 0.3.0, `SlotBinding` could only ever carry text (`copyId`/`value`),
so an `"image"`/`"logo"` slot could only ever render as a styled word.
Resolving an `assetId` against a real `AssetRecord` is a later gate's job
(`resolveAssets`, or a renderer's own lookup) — one with visibility into
both this package's documents and a real `AssetRecord`, which this
package deliberately does not have. See "The `copyId` seam" above; this
is that argument, restated for images instead of words.

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
  console.error(`malformed bindings: ${result.bindingFindings.map((f) => f.message).join("; ") || "(none)"}`);
  process.exit(2);
}
for (const { key, spec, binding } of result.resolved) {
  // spec.frame, spec.element, spec.style — what to draw and where.
  // binding.copyId / binding.value — what to draw it with.
}
```

Then, turning those matched bindings into actual text once a caller has a
real `copyId -> text` lookup (see issue #43: `resolveDocument` alone can
tell you a binding is *shape-valid*, never whether its `copyId` resolves
to real content — that's this second pass's job):

```ts
import { resolveCopy } from "@vespeneventures/compose";

const copyResult = resolveCopy(result, (copyId) => myCopyRegistry.get(copyId)?.text);
if (!copyResult.ok) {
  console.error(`unresolved copy ids: ${copyResult.unresolvedCopyIds.join(", ") || "(none)"}`);
  console.error(`slots this pass could not decide on at all: ${copyResult.unchecked.join(", ") || "(none)"}`);
  process.exit(2);
}
for (const { key, text, source } of copyResult.texts) {
  // key — the slot; text — the final, non-empty string; source — "literal" or "copy".
}
```

`resolveCopy` never treats an `assetId` binding as failed text — it
defers those slot keys into `copyResult.deferredToAssets`, and a document
made entirely of images can still report `copyResult.ok: true`. The
symmetric companion, `resolveAssets`, resolves the `assetId` bindings
`resolveCopy` deferred, given a real `assetId -> asset` lookup:

```ts
import { resolveAssets } from "@vespeneventures/compose";

const assetResult = resolveAssets(result, (assetId) => myAssetRegistry.get(assetId));
if (!assetResult.ok) {
  console.error(`unresolved asset ids: ${assetResult.unresolvedAssetIds.join(", ") || "(none)"}`);
  console.error(`slots this pass could not decide on at all: ${assetResult.unchecked.join(", ") || "(none)"}`);
  process.exit(2);
}
for (const { key, assetId, asset } of assetResult.assets) {
  // key — the slot; assetId — what was looked up; asset — whatever the lookup returned (opaque to this package).
}
```

Both functions take the SAME `ResolveResult` from `resolveDocument` and
each independently defers the other's bindings — neither needs to run
before the other, and a caller with a text-only or asset-only document
only needs to call the one function it actually needs. A mixed document
combines both: `resolveCopy(result, copyLookup).ok && resolveAssets(result, assetLookup).ok`.

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

### Issue #43: a matched binding that produces no actual text

The same failure mode reappeared one layer deeper, filed as issue #43:
`resolveDocument` treated a binding as resolved the moment its `slot`
matched a real `SlotSpec.key`, without ever asking whether the binding
itself carried anything to render. A binding with neither `copyId` nor
`value` — or with both, or with a `value` that was empty or
whitespace-only — came back `ok: true`, resolved, clean, and every
renderer built against this package would have had to reinvent the same
strengthening locally (`@vespeneventures/render`'s `web` renderer already
had to, before this fix — see its own `RenderError("empty-output", ...)`).

The fix reuses `validate.ts`'s own `validateSlotBindingShape` — the exact
function `validateComposeDocument` already calls per binding — rather
than hand-rolling a second, parallel "is this binding well-formed" check
that could drift from it. `resolveDocument` now runs every binding that
matched a real slot through that same check and surfaces the result as
`ResolveResult.bindingFindings: ComposeFinding[]`; any `severity: "error"`
entry there forces `ok: false`, the same way `missingRequired` and
`unknownBindings` already do. While fixing this, a real gap in
`validateSlotBindingShape` itself came to light: its `binding-value-shape`
rule accepted a whitespace-only `value` (`"   "`) because it only checked
`.length > 0`, not whether the string held any real content — fixed
alongside this issue, since a whitespace `value` is exactly the kind of
"resolved to nothing" case this bar exists to catch.

Whether a `copyId` string actually resolves to real text — as opposed to
merely being a well-formed string — is a different question, one
`resolveDocument` still can't answer (it has no copy dictionary; see "The
`copyId` seam" below). That's `resolveCopy`'s job: given a `ResolveResult`
and a caller-supplied `CopyLookup`, it turns every matched, well-formed
`copyId`/`value` binding into real text, and holds itself to the
identical bar — `ok: true` only when at least one slot actually resolved
to text OR was legitimately deferred to asset resolution, AND no `copyId`
came back unresolved AND nothing was left in the explicit third state,
`unchecked` (for a binding this pass couldn't even attempt to decide on,
a `lookup` that isn't a function, or a `lookup` call that threw). See
`resolve-copy.ts`'s own doc comment for the fuller argument, and its
entry in the API table below. `resolveAssets` is `resolveCopy`'s
symmetric companion for `assetId` bindings — see "Usage" above.

### `binding-source-exclusive`: exactly one of three, since 0.3.0

Adding `assetId` turned this rule from exactly-one-of-two into
exactly-one-of-three, which is a strictly harder rule to get right — the
old "both present / neither present" binary check does not cover every
bad combination once there are three fields, not two. The full truth
table `validate.ts` is built against (P = present, meaning
`!== undefined`; emptiness of a present field is a separate rule):

| `copyId` | `value` | `assetId` | count | `binding-source-exclusive` fires? |
| --- | --- | --- | --- | --- |
| P | – | – | 1 | no |
| – | P | – | 1 | no |
| – | – | P | 1 | no |
| P | P | – | 2 | **yes** |
| P | – | P | 2 | **yes** |
| – | P | P | 2 | **yes** |
| P | P | P | 3 | **yes** |
| – | – | – | 0 | **yes** |

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
| `SlotBinding` | type | `{ slot, copyId?, value?, assetId? }`. Content going into a named slot; exactly one of `copyId`/`value`/`assetId` (0.3.0 — see "`binding-source-exclusive`: exactly one of three" above). |
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
| `ResolveResult` | type | `{ ok, missingRequired, unknownBindings, resolved, bindingFindings }` — what `resolveDocument` returns. See "The bar" and "Issue #43" above for exactly what `ok` means. |
| `CopyLookup` | type | `(copyId: string) => string \| undefined`. A caller-supplied `copyId -> text` lookup — `resolveCopy`'s second argument. |
| `ResolvedText` | type | `{ key, text, source: "literal" \| "copy", copyId? }` — one slot `resolveCopy` turned into real text. One entry of `CopyResolveResult.texts`. |
| `CopyResolveResult` | type | `{ ok, texts, unresolvedCopyIds, unchecked, deferredToAssets, literalCount, lookupCount }` — what `resolveCopy` returns. `deferredToAssets` (0.3.0) lists slot keys whose only source is `assetId` — deliberately not counted as failed text. See "Issue #43" above and `resolve-copy.ts`'s own doc comment for exactly what `ok` and `unchecked` mean. |
| `AssetLookup` | type | `(assetId: string) => unknown`. A caller-supplied `assetId -> asset` lookup — `resolveAssets`'s second argument. Returns `unknown`, not a typed `AssetEntry` — this package stays zero-dependency; see `resolve-assets.ts`'s own doc comment, "Why this function does not know what an asset looks like". |
| `ResolvedAsset` | type | `{ key, assetId, asset }` — one slot `resolveAssets` turned into a real asset. `asset` is whatever the lookup returned, opaque to this package. One entry of `AssetResolveResult.assets`. |
| `AssetResolveResult` | type | `{ ok, assets, unresolvedAssetIds, unchecked, deferredToCopy }` — what `resolveAssets` returns (0.3.0). Mirrors `CopyResolveResult` field-for-field; `deferredToCopy` lists slot keys whose source is `copyId`/`value`, deliberately not counted as failed assets. |

### Validation (`validate.ts`)

| Export | Kind | Purpose |
| --- | --- | --- |
| `validateComposeDocument(value)` | function | Hand-rolled structural validation of a candidate `ComposeDocument` — no schema library. Enforces the channel/`meta` discriminant agrees; `layout` present exactly when the channel requires it and absent exactly when forbidden; every `SlotBinding` has exactly one of `copyId`/`value`, and when present each is a non-empty, non-whitespace-only string; every `Frame` is within 0..1, has nonzero area, and fits inside the canvas (see "Validation beyond the contract's literal wording" above); `EmailMeta.preheader` is at most 140 characters; `ImageMeta.width`/`height` are positive; every `SlotSpec.key` is unique within a `LayoutSpec`. Returns a `ComposeFinding[]`; `[]` means `value` is a well-formed `ComposeDocument`. Never throws, on any input. |
| `validateSlotBindingShape(value, path)` | function | The per-binding half of `validateComposeDocument` above (rules `binding-shape`/`binding-slot-shape`/`binding-source-exclusive`/`binding-copy-id-shape`/`binding-value-shape`/`binding-asset-id-shape`), exported so `resolve.ts`'s `resolveDocument` can reuse it rather than re-implementing the same rule — see issue #43. `binding-source-exclusive` is exactly-one-of-three as of 0.3.0 — see the truth table above. Not part of the package's `index.ts` public surface; imported directly from `./validate.js` within this package. |

### Resolution (`resolve.ts`, `resolve-copy.ts`, `resolve-assets.ts`)

| Export | Kind | Purpose |
| --- | --- | --- |
| `resolveDocument(doc, layout)` | function | Matches `doc.bindings` against `layout.slots`. A binding whose `slot` matches no real slot is collected into `unknownBindings`; a `required: true` slot with no matching binding is collected into `missingRequired`; every real match becomes one `ResolvedSlot` in `resolved`, and is also run through `validateSlotBindingShape`, with any finding collected into `bindingFindings`. `layout` is a separate argument from `doc.layout` because `web`/`email` documents carry no `layout` at all — a caller resolving one of those supplies the real slot list its template defines from wherever that lives (a `@vespeneventures/ui` view's props, in practice). `ok` is `true` only when `resolved.length > 0`, `missingRequired`/`unknownBindings` are both empty, AND `bindingFindings` has no `severity: "error"` entry — see "The bar" and "Issue #43" above. Unchanged by the `assetId` seam — this function does not distinguish a `copyId` binding from an `assetId` one; that split happens one pass later. |
| `resolveCopy(result, lookup)` | function | The second resolution pass: turns `result.resolved` (from `resolveDocument`) into actual `ResolvedText[]` via a caller-supplied `CopyLookup`. A literal `value` resolves without ever calling `lookup`. A `copyId` is looked up; `undefined`/`""`/whitespace-only is UNRESOLVED (collected into `unresolvedCopyIds`, never a fallback to the `copyId` or slot key). A binding whose only source is `assetId` is DEFERRED into `deferredToAssets` — never treated as failed text (0.3.0). A binding with no source, or two/three conflicting ones, a non-function `lookup`, or a `lookup` call that throws, lands the affected slot key in `unchecked` — an explicit third state that forces `ok: false` on its own, same as the other lists. `ok` is `true` only when `unresolvedCopyIds` is empty AND `unchecked` is empty AND (`texts.length > 0` OR `deferredToAssets.length > 0`). See "Issue #43" above and `resolve-copy.ts`'s own doc comment. |
| `resolveAssets(result, lookup)` | function | (0.3.0) The symmetric companion to `resolveCopy`: turns `result.resolved` into actual `ResolvedAsset[]` via a caller-supplied `AssetLookup`. An `assetId` is looked up; `undefined`/`null` is UNRESOLVED (collected into `unresolvedAssetIds`). A binding whose only source is `copyId`/`value` is DEFERRED into `deferredToCopy` — never treated as a failed asset lookup. A binding with no source, two/three conflicting ones, a non-function `lookup`, or a `lookup` call that throws, lands in `unchecked`. `ok` is `true` only when `unresolvedAssetIds` is empty AND `unchecked` is empty AND `assets.length > 0` — a document with no `assetId` bindings correctly reports `ok: false` here, the intended counterpart to `resolveCopy` reporting `ok: true` for an asset-only document. See `resolve-assets.ts`'s own doc comment. |

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
No dependency on `@vespeneventures/ui`, `@vespeneventures/copy`, or
`@vespeneventures/assets` either, despite this README's comparisons to
all three — see "The `copyId` seam", "The `assetId` seam", and "The
`template` seam" above for why every coupling is an opaque string
convention, not an import.

## Licence

MIT
