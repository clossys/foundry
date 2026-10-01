# @clossys/publisher

**The publisher role — did we put it out to an audience, and can we prove
what shipped?** This package is named for the job, not the artifact: it is
recut from two donor packages, `@example/surface` (the composer half
— eight subpaths, unchanged) and `@example/ledger` (the record half,
now the `./record` subpath), per
[decision 10](../../docs/DECISIONS.md#10-recutting-the-expression-surface-into-role-shaped-packages).
The vocabulary inside each half is unchanged: renaming the role does not
rename what it composes or what it records.

```bash
npm install @clossys/publisher
```

This package is published to `https://registry.npmjs.org` with public
access; installing it requires no authentication.

## Verified publication rate

Independent consumer evidence shows the position's owned metric meets its
setpoint over the declared review cadence. The owned metric is `verified
publication rate`, computed by `assessVerifiedPublicationRate()`. An empty
evaluated set is `indeterminate`, never a perfect rate of 1.
`publisher-media-check` and `publisher-record-check` remain the gates they
are; neither is this rate. The record half still records and does not
judge. This package does not measure consumer evidence and does not close
the loop. A green run of this package's tests is not a close.

```ts
import { assessVerifiedPublicationRate } from "@clossys/publisher/assessment";

const report = assessVerifiedPublicationRate(input);
```

```bash
publisher-rate-check assessment.json
```

The command prints JSON and exits `0` for satisfied, `1` for violated, and
`2` for indeterminate, unreadable, or invalid input.

This package declares that command as its first-day assessment surface in
its own manifest:

```json
"foundry": { "assessment": { "bin": "publisher-rate-check", "invocation": "single-json-input" } }
```

Onboarding discovers that declaration from the installed manifest and never
infers a surface. `publisher-media-check` and `publisher-record-check`
remain gates and are not the assessment surface. Publisher is not a
required first-day role; Advisor remains the only required first-day
assessment.

## The job

**Aim** — every audience-facing release is accounted for in an immutable
publication record, and nothing in the record names something that never
shipped.

Publisher is a **reconciliation** role, not a gate over a source tree. It
does not scan prose or stylesheets and return a verdict the way `writer-check`
or `designer-fold-check` do. It compares **two records that can disagree**:
what an independent observer reports was released to an audience, and what
the append-only ledger says was published.

## Escape

An **escape** is either:

1. **Unrecorded release** — something reached an audience with no matching
   immutable publication record.
2. **Phantom record** — the ledger names a publication that never shipped, or
   names bytes or strategy citations that no longer match what actually went
   out.

A green run of this package's own tests, or a ledger authored from the same
knowledge that would check it, is **not** evidence of zero escapes — that is
the house failure pattern this role exists to prevent.

## The metric

The charter metric is **`verified publication rate`**: due publication
intents where independent observers report both audience release and a
matching immutable record, divided by all due intents actually evaluated. An
empty evaluated set is **indeterminate**, never a perfect rate of 1. See
[Verified publication rate](#verified-publication-rate) above for
`assessVerifiedPublicationRate()` and `publisher-rate-check`.

`publisher-media-check` reports registry coverage (referenced asset ids vs
registered entries). `publisher-record-check` reports fact drift, append-only
integrity, and join-key completeness on a ledger a consumer already holds.
Those counts are **inputs** to reconciliation; none of them is the charter
rate, and none of them alone proves the escape surface is closed.

## Loop

- **sense** — enumerate due publication intents; collect independent
  observations of audience release; hold the append-only ledger and the fact
  snapshot `publisher-record-check` compares against.
- **judge** — `assessVerifiedPublicationRate()` for the charter metric;
  `publisher-record-check` for drift, append-only violations, and join-key
  gaps on declared ledger entries.
- **act** — append an immutable `PublicationEntry` when something ships;
  remediate drift findings and missing join keys; retract or supersede
  entries when a release is withdrawn.
- **learn** — repeated `indeterminate` or `violated` assessments, or drift
  findings that keep reopening on the same intent, signal that the publish
  path is not emitting a record an observer can match — not that the gate
  needs softer rules.

**Measurer today:** `publisher-rate-check` (charter metric from
consumer-supplied observations) and `publisher-record-check` (ledger gates).
**Blocker:** nothing in this package yet produces a **second**,
publish-path-emitted view of what actually shipped for an automatic
reconcile — issue #502 tracks that gap. Until two independent records exist,
every rate reads **unmeasured** rather than zero; treat silence as
indeterminate, not health.

## Close condition

This loop closes when **`verified publication rate` reads satisfied** from
**independent consumer evidence** over a non-empty set of due intents — each
intent independently observed with both `audienceReleased` and
`matchingImmutableRecord` — and when reconciliation machinery can compare
that evidence to a publish-path-emitted ledger without hand-copying the same
facts into both sides.

It does **not** close when: no observer runs the assessment; the evaluated
set is empty; `publisher` observes itself; or the ledger and the "what
shipped" view share one author. A consumer wiring `publisher-record-check` in
CI proves ledger **shape** integrity, not that the escape surface is zero.

That close is **not claimed today** — the reconciler gap in #502 is the long
pole. This README states the contract so the gap stays visible instead of
reading as a perfect zero escape rate from outside.

## Public entry points

Use explicit subpaths:

- `@clossys/publisher/assessment` — `assessVerifiedPublicationRate`, the charter close metric. Empty evaluated set is indeterminate, never 1. The CLI is `publisher-rate-check`.
- `@clossys/publisher/core` — canonical `SurfaceDocument` contract, validation, copy/media resolution, and output manifests.
- `@clossys/publisher/media` — media registry, reader, and coverage check.
- `@clossys/publisher/web` — web composition, head metadata (including site identity metadata and its head lint), and the dedicated
  resolved-model `SectionedView` renderer. Under React's
  `react-server` export condition it resolves a server-safe target with the
  same runtime export names and Designer's server-only component barrels;
  ordinary imports retain the interactive React Aria FAQ.
- `@clossys/publisher/document` — the product-neutral structured-document contract (sections, paragraphs, lists, tables, callouts, safe links) and its renderer.
- `@clossys/publisher/email`, `/print`, `/image`, `/slides` — channel renderers.
- `@clossys/publisher/record` — the append-only, content-addressed publication ledger and its drift checker. See "`record` — the append-only publication ledger," below.
- `@clossys/publisher/pack` — the v0 Launch pack manifest contract: types, schema validation, needs-graph readiness, adopt-don't-override detection, and the evidence-gated website seal (`publisher-seal`) and the rendered-head lint (`publisher-head-lint`). See "The pack," below.
- `@clossys/publisher/surfaces` — the one-owner-per-file contract for surface documents under `clossys/publisher/surfaces/`. See "Surface documents move to Publisher," below.
- `@clossys/publisher/materials` — the materials mini-site (overviews, pitch decks, audience variants). See "Materials site," below.
- `@clossys/publisher/templates` — the pack's default templates and the channel spec registry. See "Templates and channel specs," below.

The package has no root export. `core` is deliberately framework-agnostic;
the web and document subpaths have optional React peers, while `web` also
declares Designer's optional runtime peers directly so a public-registry
consumer receives a complete, inspectable peer contract. Non-web renderers do
not require them at runtime. `record` is pure and has no peer dependencies of
its own.

The web condition changes only the implementation selected for server
rendering, not the API. `MarketingView` keeps the same props and regional
layout; its server target uses Designer's native `details`/`summary` FAQ while
the ordinary target keeps Designer's React Aria FAQ. `AuthView`, `ErrorView`,
`CaptureView`, `CollectionView`, `DocumentView`, `LegalView`, the renderer functions,
template helpers, error class, and all runtime export names are present in
both targets.

## Why `publisher` is one package, not two

Composition without a record is unprovable, and every time the publisher
runs, the record runs — there is no publish that legitimately skips it. That
argues for one install and one version, which one package with a `./record`
subpath delivers.

The measurement that originally argued for two separate packages is
accommodated rather than overturned: **the record shares no code with the
composer and does not import it**, so the two import surfaces stay genuinely
separate under one version. Fusing the *packaging* was never the same as
fusing the *dependency graph*, and only the second would have cost anything —
see "`record` — the append-only publication ledger," below, for the half
that proves it: a publication record is a DOCUMENT the composer never
imports.

## Scope: this package renders and validates. It does not compose.

Stated plainly because evaluating it and discovering this costs real time:
**there is no compose step here, and there will not be one.** Nothing in this
package takes an intent, a brief, or a content plan and *selects* a template
to put it in. Every export is a `render*`, a `resolve*`, or a `validate*`.

The boundary is: a caller authors a `SurfaceDocument` — naming its template
explicitly — and this package validates it, resolves its copy and assets
against real approved registries, renders it for a channel, and reports what
it did. Deciding *which* document to build, from *what* intent, is the
consumer's job and stays there.

This is a scope decision, not a gap awaiting a contributor. Template selection
is where product judgement lives: which page shape serves which audience at
which moment is exactly the reasoning a shared package cannot hold for someone
else, and a `compose(intent, target)` that guessed would be wrong in a way
that is expensive to discover and impossible to override cleanly. Drawing the
line at "you name the template, we guarantee everything after it" is what lets
this package promise something real — validated content, resolved copy
provenance, deterministic output — instead of promising judgement it does not
have.

What that leaves the consumer owning: intent-to-template selection, and any
catalog of their own templates worth selecting from. What it leaves this
package owning: everything from a named template onward.

Making the *set* of selectable web templates extensible is a separate and
genuinely open question — see the template-registry proposal in this
repository's issues. That is about who may add a template, not about who picks
one; extensibility does not imply composition.

## SurfaceDocument and renderer boundary

`SurfaceDocument` is the canonical authored contract. It replaces the
string-bearing `ComposeDocument` with `CopyRef` values for audience-facing
slots and metadata: web titles/descriptions, email subjects/preheaders, image
alt text, and slide notes. A binding is exactly one of `copy`, `node`, or
`assetId`; `node` preserves an explicit consumer-provided interactive/rich UI
node without pretending it is copy. Use `resolveSurfaceDocument(surface,
copyResolver)` at render time: it
validates the canonical document, resolves every required `CopyRef` against a
real approved registry, returns renderer-facing data plus the full resolution
provenance, and fails closed for invalid, missing, or unsupported node
bindings. New consumer code authors `SurfaceDocument`; `ComposeDocument` is
the renderer-facing shape produced by this package, not a consumer migration
API.

Web and email templates use `FlowLayoutSpec`, which contains ordered keys and
requiredness only. Print, slides, and image surfaces use `CanvasLayoutSpec`
with frames and element kinds. This prevents flowed surfaces from carrying
fictional canvas geometry.

### Repeating-group bindings

A `SurfaceDocument`'s `bindings` array accepts two shapes: a
`SurfaceSlotBinding` (one slot, exactly one of `copy`/`node`/`assetId`, as
above) or a `SurfaceRepeatingSlotBinding` — the same slot, bound to an
**ordered list** of items instead of a single source. This closes part of
issue #166: a template can commit a slot to holding N items (a capability
grid, a stat band, a testimonial list) where N is a run-time fact the
template's own layout cannot encode, since `FlowLayoutSpec`/`CanvasLayoutSpec`
name a slot once, not "this slot, repeated."

A repeating binding still names one explicit slot the consumer already
decided exists — it does not select a template or invent a slot, the same
boundary every other binding in this package holds to (see "Scope," above).
Each item in `items` independently obeys the identical exactly-one-of
discipline a single binding does. For a one-value item, use `copy`, `node`,
or `assetId` as before. For ordinary multi-field editorial content, use one
named `fields` map instead; each field is exactly one `copy` or `assetId`
binding. A field may never be a `node`, so structured copy cannot bypass the
registry, voice checks, locale selection, or output provenance.

```ts
import type { SurfaceDocument } from "@clossys/publisher/core";

const acmeCapabilities: SurfaceDocument["bindings"][number] = {
  slot: "capabilities",
  items: [
    { copy: { id: "acme.capability.one" } },
    { copy: { id: "acme.capability.two" } },
    { assetId: "acme.capability.icon.three" },
  ],
};
```

Templates opt into structured items by declaring their accepted field names
and requiredness in `repeatingSlots`. At render time, an unknown field, a
missing required field, a malformed field map, or a legacy one-value item
against a structured slot fails closed. A field map against a slot that did
not declare fields fails closed too. This keeps the template—not a caller's
ad hoc object—the authority for the repeating item's shape.

`items` may be an empty array. That is a deliberate choice, not an
oversight: this package cannot tell "the consumer configured zero of these
on purpose" (a legitimately-empty testimonial list) apart from "something
upstream failed to populate this," so it validates an explicit `items: []`
as clean rather than guessing. See `types.ts`'s `SurfaceRepeatingSlotBinding`
doc comment for the fuller reasoning.

`resolveSurfaceDocument` resolves a repeating binding's items in order and
returns them on `ResolvedSurfaceDocument.groups` — an array of
`{ slot, items: [{ index, value?, node?, assetId?, fields? }, ...] }` — rather than
folding them into the legacy `ComposeDocument.bindings` shape, which has no
way to carry more than one source per slot. `groups` is omitted entirely
(not an empty array) on a document with no repeating binding, so an existing
single-binding-only `SurfaceDocument` resolves identically to before this
existed. A bad item — an unresolvable `CopyRef`, same as any single
binding's — fails the whole `resolveSurfaceDocument` call with a message
naming the specific item (`bindings.N.items.M`), the same fail-closed,
all-or-nothing contract this function already holds for a single binding;
it does not invent a second, partial-success mode just because the content
is array-shaped. Per-item copy resolutions flow into the same
`resolutions`/`collectCopyProvenance` provenance path a single binding's
does, so a repeating-group slot shows up in manifest provenance per item,
not just per slot — see `output-manifest.ts`. A structured field resolved
from `assetId` instead carries registry-validated asset evidence into the
target renderer; it has no copy provenance because it is not copy.
At the public `RenderWebOptions.groups` boundary, items must retain the
resolver's contiguous source order: item `index` is exactly its zero-based
array position. This prevents a direct caller from silently reordering,
duplicating, or sparsifying the authored group after resolution.

### Structured repeating-item migration and planned semver boundary

Publisher `0.1.10` exposed the FAQ repeat as a legacy one-value/node-shaped
contract. That shape cannot represent two separately governed editorial
fields, and it is not compatible with the structured FAQ contract above.
Migrate each FAQ item from a caller-authored node to explicit approved-copy
fields:

```ts
// Before: legacy node-shaped FAQ item (do not carry this forward).
{ node: { question: "...", answer: "..." } }

// After: every audience-facing field is a CopyRef.
{
  fields: {
    question: { copy: ref("acme.faq.question") },
    answer: { copy: ref("acme.faq.answer") },
  },
}
```

This is a breaking contract correction, so Publisher source is now the planned
`0.2.0` successor; a `^0.1.x` range must not satisfy it. The source is neither
qualified nor published: an exact-head candidate and public dependency
verification remain required before any release action.

### Choosing a shipped view — closed kinds, `defineWebTemplate` for the rest

Name a shipped template when its slots cover the page:

- **`MarketingView`** — pre-auth marketing landing (hero, features, optional
  FAQ, CTA).
- **`SectionedView`** — long public pages whose sections are exactly the
  closed six kinds (`hero`, `feature-grid`, `faq`, `ordered-step-sequence`,
  `status-list`, `stat-grid`).
- **`AuthView`** — one shell for every authentication step (sign-in, sign-up,
  password reset, verification): site header, page header, the form inside
  Designer's `Card`, and site footer. The card holds only the form;
  `secondaryAction` (the alternate-step lines, such as "Forgot password?" or
  "No account? Join the waitlist") renders below it, before the footnote, and
  is always the site's copy. An invitation or activation step never offers
  request-access or sign-up: the view has no mode and no `requestAccess`
  prop, so each site's activation-page test should assert no request-access or
  sign-up link. Pass each `secondaryAction` line as one element: text plus a
  link in one fragment splits onto two lines. When the sign-in provider is
  unavailable, `isDisabled` keeps the form on screen inside a disabled
  `<fieldset>` with the typed values still shown; the explanation goes in the
  form's own `submitError`, and a retry link in `secondaryAction` stays
  enabled. Switching `isDisabled` remounts the form, so the site keeps the
  typed values in its own state. The content column uses the
  `--ui-width-form-max` form measure, and `description` is a required prop
  so every step decides on a supporting line. The form slot is filled with
  Designer's `Form` / `TextField` / `Button`. There is no mode prop, and
  the view does not call an auth provider. The optional `internalNote`
  (`{ label, message }`) renders a badge-labelled development note under the
  footnote, and a site passes it only in development. An auth page's
  `footerSecondary` holds a legal row only, never a locale switcher, because
  auth pages are single-locale. `SignInForm` fills the
  form slot of a sign-in page.
- **`ErrorView`** — error shell, including the sign-in-boundary states: not
  authorized (403), pending, revoked, and provider unavailable (503). It takes
  the same props for each; the status, title, description, and recovery
  action are the caller's copy. A diagnostic reference goes inline in the
  description (`"Something went wrong. Error: 8f2a91c0."`), there is no
  details disclosure, and `action` holds one primary control: a secondary
  destination is a text link inside the description.
- **`BoundaryView`** — `ErrorView` inside one shared frame: Designer's
  `SiteHeader` (`brand`, required), the `ErrorView` filling the main area,
  and `SiteFooter` (`footerSecondary`, optional). It takes every
  `ErrorViewProps` key and forwards it to `ErrorView`, so a site deletes its
  private copy of the header/error/footer shell. It also frames the
  sign-in-boundary states. It is not a built-in web template. See
  [Boundary pages](#boundary-pages).
- **`PackReviewView`** — the dev-only review index: a site's pages, their
  forced states, its exported artifacts and a lazy contact sheet, each entry
  with a `draft`, `delegated` or `approved` badge. It uses the same frame as
  `AuthView`. See [`PackReviewView`](#packreviewview).

If a required band is not a slot on any shipped template and not one of the
six `SectionedView` kinds, **do not flatten** it into a one-item
`feature-grid` or any other shipped kind — that produces a document that
validates while the page is wrong. Register `defineWebTemplate` in the
consumer instead; its `build` function maps resolved slots to Designer
blocks. That registry path is the public custom-page extension.

Composing Designer blocks directly in an unregistered route file can work as
a one-off, but it is a workaround: it bypasses the template registry,
`validateSurfaceDocument`/`resolveSurfaceDocument`, and copy provenance for
that page shape. Prefer `defineWebTemplate` + `createWebRenderer` so the
page stays provable.

### Pre-auth marketing pages — `MarketingView` first

For a pre-auth marketing landing page, use `MarketingView` (header, Hero with
optional `heroMedia` and `heroActions`, feature grid, optional FAQ, CTA band,
shell) and fill its slots. In the first viewport, ship exactly one primary CTA
in `heroActions`; `heroMedia` must be the product surface or original art, not
decorative stock imagery. See
[`MarketingView`](#marketingview--the-flowed-marketing-template) below. When
the page needs a Designer block that is not a MarketingView slot, import that
named block in your page module. Do not flatten into `SectionedView` —
that document assembler is not the pre-auth path.

### `SectionedViewDocument` — Designer-independent long-page core

`@clossys/publisher/core` now owns the closed, data-only source model for a
long public site page: `SectionedViewDocument`. It requires one or more
ordered sections with unique lowercase fragment-safe ids and one of six
named kinds: `hero`, `feature-grid`, `faq`, `ordered-step-sequence`,
`status-list`, or `stat-grid`. Grounds are the closed `base`/`sunken`/`inverse` vocabulary;
status values are the closed `available`/`partial`/`planned` readiness axis,
with a separate `not-offered` disposition for deliberate non-capabilities.
Every audience-facing label, heading, description, question, answer, ordinal,
and status label is a `CopyRef`. There are no React nodes, render callbacks,
router fields, locale overrides, classes, styles, arbitrary colours, or
composition escape hatches.

This is a closed wire model at runtime as well as in TypeScript: structural
objects use only enumerable own data properties (no inherited, symbol, hidden,
or accessor fields), and every ordered section, item, and status-group array
must be dense. A `CopyRef` has only its non-empty `id`, optional non-empty
`locale`, and an optional plain interpolation-value record whose values are
strings, numbers, or booleans. Malformed input is rejected before a custom
resolver is called.

`validateSectionedViewDocument` reports malformed or unknown structure;
`resolveSectionedViewDocument` resolves every CopyRef depth-first in authored
order and returns its ordinary `CopyResolution[]`. Pass that list directly to
`collectCopyProvenance` or existing output-manifest helpers—there is no second
provenance format. A missing or empty resolution fails the entire document and
names the exact authored path. An unknown section kind is refused at validate
and resolve time and names that kind — there is no implicit remap to
`feature-grid` or any other shipped kind. This core stage intentionally imports neither
React nor Designer and does not render a web view. The grounded web renderer
uses Designer `0.4.0`'s server-safe site-block API, including the separate
`not-offered` disposition and its caller-localized `labels.dispositions` map,
the non-hero `eyebrow` slot, the per-row `detail` slot, and the flat `items`
alternative to `StatusList`'s `groups`.

`SectionedView` is now the dedicated web renderer after that Designer floor is
available. Resolve the CopyRef document first, retain its `resolutions` as the
only publication provenance, and pass the resolved model directly:
Here `resolveCopy` is the consumer's approved `CopyResolver`.

```tsx
import { resolveSectionedViewDocument } from "@clossys/publisher/core";
import { SectionedView } from "@clossys/publisher/web";

const resolved = resolveSectionedViewDocument({
  id: "acme-home",
  sections: [{
    id: "welcome",
    kind: "hero",
    ground: "base",
    heading: { id: "acme.home.heading" },
    description: { id: "acme.home.description" },
  }],
}, resolveCopy);

const page = <SectionedView document={resolved} />;
// resolved.resolutions feeds collectCopyProvenance/output-manifest helpers.
```

#### Optional fields the document may also carry

Four slots are optional and additive: a document written without them
validates and renders exactly as it did before they existed.

- **`eyebrow` on every section kind.** `hero` always had one; `feature-grid`,
  `faq`, `ordered-step-sequence`, and `status-list` now carry the same
  optional `CopyRef`, so authored eyebrow copy is no longer dropped at
  conversion time.
- **`actions` on the hero section.** An optional, non-empty list of
  `{ id, label, href }`, where `label` is a `CopyRef` and `href` must be a
  fragment, a one-origin path, an `http(s)` URL, or a `mailto:` link. It stays
  data: there is no node, class, or handler slot, and the view renders
  underlined `<a href>` elements into the Designer `Hero` block's existing
  `actions` slot (not `Button` atoms — the wire model stays href-shaped).
- **`media` on the hero section.** An optional `{ assetId, alt }` pair:
  `alt` is a `CopyRef` (provenance-complete) and `assetId` resolves at render
  time through `SectionedView`'s `resolveAssetId`, the same seam
  `renderWebDocument` uses for `MarketingView`'s `heroMedia`. Presence
  switches `Hero` to the two-column layout (`tablet:grid-cols-2`). Product
  surface or original art only — not decorative stock.
- **`stat-grid` sections.** A titled grid of metrics: each item carries
  `label` and `value` `CopyRef`s plus optional `delta`, closed `trend`
  (`up` | `down` | `neutral`, only with `delta`), and optional `description`.
  The view maps each row onto Designer `Stat`; do not flatten metrics into
  `feature-grid`.
- **`detail` on a status-list item.** An optional `CopyRef` carrying that
  row's own explanation, including the reasoning behind a `not-offered`
  answer. It renders as a second description of the same row, so the
  definition-list semantics stay intact.

```tsx
const resolved = resolveSectionedViewDocument({
  id: "acme-trust",
  sections: [
    {
      id: "welcome",
      kind: "hero",
      ground: "base",
      heading: { id: "acme.trust.heading" },
      actions: [{ id: "contact", label: { id: "acme.trust.contact" }, href: "/contact" }],
    },
    {
      id: "posture",
      kind: "status-list",
      ground: "sunken",
      eyebrow: { id: "acme.trust.eyebrow" },
      heading: { id: "acme.trust.posture" },
      labels: {
        available: { id: "acme.status.available" },
        partial: { id: "acme.status.partial" },
        planned: { id: "acme.status.planned" },
        dispositions: { "not-offered": { id: "acme.status.not-offered" } },
      },
      groups: [{
        id: "core",
        heading: { id: "acme.trust.core" },
        items: [{
          id: "audit",
          label: { id: "acme.trust.audit.label" },
          detail: { id: "acme.trust.audit.detail" },
          disposition: "not-offered",
        }],
      }],
    },
  ],
}, resolveCopy);
```

#### At most one hero, and a status-list may go flat

Two contract rules relaxed additively, both keeping every previously-valid
document valid and unchanged:

- **A hero section is now optional, and may sit anywhere.** The document
  previously required exactly one `hero` section and required it to be
  first. It now permits zero or one — never more than one — in any position.
  A document with a single leading hero, the shape every document authored
  before this change already has, still validates and renders identically:
  `SectionedView` already assigned `headingLevel={1}` only to a hero at
  index 0 and `headingLevel={2}` to any other section, so a non-leading hero
  renders as an `h2`, the same fixed-outline discipline the view has always
  held. This unlocks a closing call-to-action band authored as its own
  section, and a page with no hero section at all.
- **A `status-list` section's `groups` is now optional, with a flat `items`
  alternative.** Provide exactly one of `groups` (unchanged: one heading and
  one definition list per group) or `items` (new: the same row shape with no
  group at all) — the common shape for a short list with nothing to group.
  It renders through Designer `0.4.0`'s `StatusList` `items` prop as a
  single definition list with no group heading.

```tsx
const resolved = resolveSectionedViewDocument({
  id: "acme-trust",
  sections: [
    {
      id: "core",
      kind: "status-list",
      ground: "base",
      heading: { id: "acme.trust.posture" },
      labels: {
        available: { id: "acme.status.available" },
        partial: { id: "acme.status.partial" },
        planned: { id: "acme.status.planned" },
        dispositions: { "not-offered": { id: "acme.status.not-offered" } },
      },
      items: [{ id: "audit", label: { id: "acme.trust.audit.label" }, disposition: "not-offered" }],
    },
    // A closing call-to-action band: a second hero, not first, rendered as h2.
    { id: "cta", kind: "hero", ground: "inverse", heading: { id: "acme.trust.cta" } },
  ],
}, resolveCopy);
```

#### Mounting part of a page: the `landmark` prop

`SectionedView` renders its own `main` landmark by default, which is right
when the whole page is the document. A page that can express only some of its
sections through this contract needs the other option, or its remaining
content ends up outside the page's only `main`:

```tsx
<main>
  <SectionedView document={resolved} landmark="none" />
  <ConsumerOwnedSection />
</main>
```

`landmark="none"` renders the same sections in a plain grouping element with
no landmark role and no accessible name. Default behaviour is unchanged, and
choosing it makes the surrounding page responsible for supplying exactly one
`main` landmark containing this output.

#### Contract holds measured in issue #756

Three 0.2.1 refusals stay deliberate after the additive fixes above; they are
not backlog slots waiting for a loosening pass.

- **Required `labels` on every `status-list` section.** The section must
  carry exactly `available`, `partial`, `planned`, and
  `dispositions.not-offered` as `CopyRef`s. Designer `StatusList` renders
  human-readable readiness names from this caller-localized map, so a surface
  cannot mount a status list until it has merged reader-facing words for all
  four axes. Omit the section when the page has no readiness posture to
  report.
- **Required `ordinal` as a `CopyRef` on each ordered step.** Ordinals
  participate in copy provenance and locale like every other audience field;
  a surface that paints step numbers visually still authors copy entries
  (often `"1"`, `"2"`) rather than relying on presentation-only counters.
- **Non-empty repeating arrays.** Every `items` array, status-list `groups`
  array, group `items` array, and optional hero `actions` array must contain
  at least one entry when present — an explicit `items: []` is refused
  (`sectioned-view-items-shape` / `sectioned-view-status-items-shape`).
  Unlike `MarketingView`'s repeating bindings, this document has no separate
  "slot omitted" vs "slot empty" distinction at the section level: a section
  kind in the wire model is a commitment to render that block with at least
  one row. Express stated absence by omitting the section or by owning an
  empty state outside this contract (`StructuredDocument`, host markup).

The ordinary and `react-server` `@clossys/publisher/web` exports are aligned.
The view owns section markup, source order, unique section ids, grounds, and
the h1/h2/h3 outline; Designer owns visual tokens and block internals. Per
#708, Publisher does not own locale selection, routing, or document-level
`html`, `lang`, or `dir` attributes: the host application supplies those
boundaries around this renderer.

`section-header` and `article-body` remain intentionally outside the closed
`SectionedView` kinds: the former's action region and the latter's full
structured-document rendering still need a grounded view integration to stay
fully data-shaped and provenance-complete without node slots. Compose those
Designer blocks in the consumer renderer or register `defineWebTemplate` for
the page band instead of flattening into `feature-grid` or `stat-grid`.

On its own, this is a repeating-group *binding* primitive only — it says
nothing about which template actually consumes it. `web`'s `MarketingView`
template (below) is that consumer, closing the second and final half of
issue #166.

### `MarketingView` — the flowed marketing template

`web`'s template registry (`listWebTemplateNames()`) knows three names:
`AuthView`, `ErrorView`, and `MarketingView` — an ordinary flowed page with
a persistent header/footer, a hero, a feature grid, an optional FAQ list,
and a closing call-to-action band. Like `AuthView`/`ErrorView`, it is one
more explicit, nameable `SurfaceDocument.template` value, not a mechanism
that picks one — see "Scope," above: this package still does not compose.

`MarketingView`'s fixed slot set: `brand` and `heroHeading` and
`ctaHeading` are required flowed text slots; `heroEyebrow`,
`heroDescription`, `heroActions`, `heroMedia` (an asset slot),
`featuresHeading`, `featuresDescription`, `faqHeading`, `faqDescription`,
`ctaDescription`, `ctaAction`, and `footerSecondary` are optional flowed
slots; `features` (required) and `faq` (optional) are **repeating** slots,
each bound via a `SurfaceRepeatingSlotBinding` and rendered through
`@clossys/designer`'s `FeatureGrid`/`Faq` blocks respectively. An empty
`features` group with no `featuresHeading` or `featuresDescription` omits
the grid; a `faq` binding that
was never authored at all omits the whole FAQ section instead, which is a
different, equally valid outcome (see `MarketingView`'s own `faq` prop doc
comment).

`faq` declares two required structured fields: `question` and `answer`.
Each resolves through the normal `CopyRef` path, so its locale, approved
voice, and provenance stay visible alongside the rest of the page. A FAQ
item authored as a caller-owned `node`, as a legacy single value, or with an
unknown/missing field is refused rather than bypassing editorial governance.

```ts
import type { SurfaceDocument } from "@clossys/publisher/core";
import { resolveSurfaceDocument } from "@clossys/publisher/core";
import { renderWebDocument } from "@clossys/publisher/web";

const ref = (id: string) => ({ id });

const acmeMarketingHome: SurfaceDocument = {
  id: "acme.marketing.home",
  channel: "web",
  template: "MarketingView",
  meta: { channel: "web", title: ref("acme.brand"), description: ref("acme.hero.description") },
  bindings: [
    { slot: "brand", copy: ref("acme.brand") },
    { slot: "heroHeading", copy: ref("acme.hero.heading") },
    { slot: "heroDescription", copy: ref("acme.hero.description") },
    { slot: "ctaHeading", copy: ref("acme.cta.heading") },
    // Required repeating slot; an explicitly empty grid is valid.
    { slot: "features", items: [] },
    // A repeating slot — one CopyRef per placeholder feature, in order.
    {
      slot: "faq",
      items: [
        {
          fields: {
            question: { copy: ref("acme.faq.one.question") },
            answer: { copy: ref("acme.faq.one.answer") },
          },
        },
      ],
    },
  ],
};

const resolved = resolveSurfaceDocument(acmeMarketingHome, myCopyResolver);
const { element, head } = renderWebDocument(resolved.document, {
  groups: resolved.groups, // carries the structured FAQ fields
});
```

`resolved.groups` is exactly `ResolvedSurfaceDocument.groups` — pass it
straight through as `RenderWebOptions.groups`; `renderWebDocument` maps
each declared repeating slot's resolved items onto `MarketingView`'s
`features`/`faq` props in authored order. Passing a group for a slot
`MarketingView` does not declare as repeating, or omitting the required
`features` group entirely, both fail closed with
`RenderError("resolution-failed", ...)` — the same error contract a
missing/unknown single-slot binding already produces for `AuthView`/
`ErrorView`.

### `CaptureView`, `DocumentView`, and `CollectionView` — fixed publisher page shells

These exports are direct, server-safe page shells rather than new
`SurfaceDocument.template` registrations. They deliberately do not select
content, load a CMS, own a router, or add client state.

`CaptureView` provides the site chrome, one heading, a consumer-owned form
inside Designer's `Card`, and a footer. The consumer owns form fields, submission, validation,
and network effects. On a failed client-side submission, pass both
`errorSummary` and `errorSummaryId`, focus that id, and keep the summary
before the form; the view makes it a focusable `role="alert"`. On success,
pass `submitted`: it replaces the form in the same position in a polite live
region. `CaptureView` intentionally does not choose a form library, add spam
handling, or model submission state. `formLabel` is the accessible name of
the region that holds the form or the confirmation, and defaults to
"Capture form".

`DocumentView` accepts a `StructuredDocument` and an approved-copy resolver,
then calls `renderStructuredDocument` itself. A caller cannot supply a
pre-rendered article node or skip heading and in-document-fragment validation
on this path. The document title becomes the page `h1`; optional summary and
effective-date labels remain `CopyRef`s. An effective date is
`{ dateTime, text }`, so its visible approved copy is paired with a semantic
`time` value; `dateTime` must be a real ISO date or date-time, not arbitrary
display text. Invalid document structure, unresolved fragments, missing copy,
and malformed effective-date metadata fail closed with `RenderError`.

`CollectionView` supplies an accessible collection index: each non-empty
entry has a unique linked title, a semantic `time`, optional summary and tag
list, and a navigation landmark for consumer-owned pagination. Its required
`empty` state prevents an empty index from silently becoming a blank region.
Entries use a deliberately small closed shape (`id`, `href`, string `title`,
`date`, optional string `summary`/`tags`); its raw props are consumer-owned
view data and do not themselves carry CopyRef provenance. Consumers that need
editorial provenance resolve structured fields before constructing these
strings, while Publisher's structured renderer continues to retain the
underlying field-level copy/asset evidence. Pagination and empty-state actions
are likewise `{ href, label }` data, not node escape hatches. Route loading,
taxonomy, and paging state remain outside Publisher. If a router replaces collection items in place, it
must move focus to `focusTargetId` (the focusable `PageHeader` region that
contains the view's `h1`); ordinary links retain normal browser route focus
handling. Entry, empty-state, and pagination links accept only a fragment,
a single-root-relative path (never `//`), `http(s)`, or non-empty `mailto:`;
script, data, file, and protocol-relative URLs fail closed.
`entriesLabel` (default "Collection entries"), `tagsLabel` (default
"Tags"), and `paginationLabel` (default "Collection pagination") name the
entry list, each entry's tag list, and the pagination landmark.

`BrandGuideView` names its sections with `lockupLabel` (default "Lockup"),
`downloadsLabel` (default "Downloads"), `colorLabel` (default "Color"),
`typeLabel` (default "Type"), and `factsLabel` (default "Strategy facts").
`SystemAuditView` names its gallery link and sections with `galleryLabel`
(default "Preview gallery"), `brandSectionLabel` (default "Brand file"),
and `contrastLabel` (default "Contrast"), and its coverage status line with
`coverageDescription` (default "Brand file coverage passed." /
"Brand file coverage failed." from `brandOk`).

There is intentionally no `EntryView`. A document-backed entry page uses
`DocumentView`, with its optional header action linking back to the
collection, rather than duplicating the validated document page contract.
This is the narrow disposition for entry pages; it does not add CMS, parser,
or taxonomy behavior. A future Designer-block integration is separately
staged and is not part of these publisher shells.

### `LandingView`

`LandingView`, exported from `@clossys/publisher/web`, is a single-screen
landing page: a transparent banner, one hero centred both ways, and a
transparent legal footer, over an optional backdrop. It is server-safe (it
imports only Designer's `/shell/server` and `/atoms/server` barrels) and ships
no wording of its own: every visible word comes from a prop.

```tsx
import { LandingView } from "@clossys/publisher/web";

declare const brand: React.ReactNode; // the caller's brand mark, for example a Designer `Brandmark`

export function HomePage() {
  return (
    <LandingView
      brand={brand}
      headerAction={<a href="/start">Start</a>}
      heading="A page that says one thing"
      description="One supporting line."
      legal={{ entity: "Example Co", links: [{ label: "Privacy", href: "/privacy" }] }}
    />
  );
}
```

Props, in addition to the standard `div` attributes (minus `children`) and `style`:

- `brand`: the identity slot in the banner.
- `headerAction` (optional): the page's call to action, rendered in the banner.
- `eyebrow`, `description` (optional): the lines above and below the heading.
- `heading`: the page's only `<h1>`.
- `heroAction` (optional): a call to action inside the hero. It is absent by
  default, so the call to action is header-only unless you supply one.
- `media` (optional): rendered after the description.
- `align` (`"center"` or `"start"`, default `"center"`): aligns the hero's
  content and changes only that wrapper's classes.
- `backdrop` (optional): rendered first, absolutely positioned behind the rest,
  with `aria-hidden="true"` and `pointer-events-none`. It is absent from the
  markup when not supplied.
- `legal`: the props of Designer's `SiteFooter.Legal`, passed straight through.

What it guarantees: one banner, one main and one contentinfo landmark; one
`<h1>`; a header and footer with `ground="transparent"`, so they carry no
background, border or width cap and run the full viewport width; and text that
comes only from props.

What it does not do: check the contrast of the page ink over your backdrop
(that contract is issue #1523), or make anything you put inside the backdrop
unfocusable. Keep focusable content out of `backdrop`.

### `ContactView`

`ContactView`, exported from `@clossys/publisher/web`, is a single-screen
contact page: a logo-only transparent banner, a page header, one form in a
card, and a transparent legal footer. The form asks for a topic, a name, an
email, an optional phone and a message, and carries a hidden honeypot field.
It is a client component: it needs Designer's React Aria fields, so import it
from a module that is a client boundary. Under the `react-server` condition
`@clossys/publisher/web` still exports the name, as a stub that throws a
`RenderError` when called. It ships no wording of its own: every visible word
is a `CopyRef` resolved through `resolveCopyId`.

```tsx
import { ContactView } from "@clossys/publisher/web";
import type { ContactResult, ContactViewCopy, ContactViewProps } from "@clossys/publisher/web";

declare const brand: React.ReactNode; // the caller's brand mark, for example a Designer `Brandmark`
declare const resolveCopyId: ContactViewProps["resolveCopyId"]; // the approved-copy resolver
declare const copy: ContactViewCopy; // one approved `CopyRef` per string the view shows
declare function send(values: Record<string, string>): Promise<ContactResult>; // your submit handler: a route or server action that runs `createContactHandler`'s `handle`

export function ContactPage() {
  return (
    <ContactView
      brand={brand}
      legal={{ entity: "Example Co", links: [{ label: "Privacy", href: "/privacy" }] }}
      resolveCopyId={resolveCopyId}
      copy={copy}
      topics={[
        { id: "general", label: { id: "contact.topic.general" } },
        { id: "support", label: { id: "contact.topic.support" } },
      ]}
      initialTopic="support"
      onSubmit={send}
    />
  );
}
```

Props, in addition to the standard `div` attributes (minus `children` and
`onSubmit`) and `style`:

- `brand`: the identity slot in the banner, which holds nothing else.
- `legal`: the props of Designer's `SiteFooter.Legal`, passed straight through.
- `resolveCopyId` and `copy`: the approved-copy resolver and one `CopyRef` per
  string (heading, description, every label, the button, the client-side error
  messages, the confirmation, a short failure label and the three failure messages).
- `topics`: `{ id, label }[]`, at least one. Each `id` must be unique
  kebab-case; the thrown error names the position, never the id. Each `label`
  is a `CopyRef`.
- `initialTopic` (optional): a topic id to preselect. An id that is not in
  `topics` is ignored.
- `devPreview` (optional): `"idle"`, `"submitting"`, `"accepted"`, `"invalid"`,
  `"rate-limited"` or `"unavailable"` (the exported type `ContactViewDevPreview`).
  It pins the view to that state, for a review page that must show each state
  without a real send, and makes it inert: submitting never calls `onSubmit`
  and nothing moves focus on its own. The view never reads the URL or the
  environment to choose a state, and any other value throws a `RenderError`
  naming `devPreview`, never the value. A production page must not pass it.
- `honeypotField` (default `"website"`): the hidden field's name. Match the
  `honeypotField` you gave `createContactHandler`.
- `onSubmit(values)`: resolves to a `ContactResult`. `values` holds `topic`,
  `name`, `email`, `phone` (`""` when empty), `message` and the honeypot field
  under its own name. A rejection or an unknown answer reads as `unavailable`.

What it guarantees: one `<h1>`, which never names the chosen topic; topic, name,
email and message are checked in the browser first, and a failed check sends
nothing and focuses the first invalid field; the honeypot is out of the tab
order, `aria-hidden` and `autocomplete="off"`, and its value reaches
`onSubmit`; the submit button is pending, never `disabled`, while sending;
`accepted` replaces the form with a `role="status"` confirmation and focuses
its heading; `invalid`, `rate-limited` and `unavailable` each show a
`role="alert"` led by the failure label, keep every typed value and focus the submit button; the banner
and footer carry no background, border or width cap; and an entry that does not
resolve throws an error naming its path, never its id.

What it does not do: show which field a server `invalid` result refers to (the
result's `fields` are not rendered yet), send anything itself, or detect bots
beyond the honeypot.

### `defineWebTemplate` / `createWebRenderer` — an extensible, instance-scoped web-template registry

`AuthView`, `ErrorView`, and `MarketingView` are this package's own three
templates. `defineWebTemplate` and `createWebRenderer` let a consumer
register their *own* page shapes against the same `web` renderer pipeline —
the same validation, resolution, and provenance guarantees, extended to a
template this package never shipped.

Consumer templates may also pass `nodeChapterFallbackTitle` (screen-reader
title for a `node-chapter` block with no title slot) and `statGridLabel`
(screen-reader label factory for each `stat-grid` item). Both ship English
defaults on `defineWebTemplate`; document each with `@default` on the
options type when overriding.

**This is still not composition.** `SurfaceDocument.template` remains a
plain string the caller names explicitly on every document — extensibility
here is about *who may add* a template (now: any caller, not just this
package), never about *who picks one* at render time. See "Scope," above:
this package still renders and validates; it does not compose.

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SurfaceDocument } from "@clossys/publisher/core";
import { resolveSurfaceDocument } from "@clossys/publisher/core";
import { createWebRenderer, defineWebTemplate } from "@clossys/publisher/web";
import { DashboardWidget } from "./DashboardWidget.js"; // a consumer's own component

const DashboardView = defineWebTemplate({
  name: "DashboardView",
  flow: { slots: [{ key: "heading", required: true }, { key: "widget", required: true }] },
  // A slot key absent from slotKinds defaults to ["copy", "asset"] — the
  // same two sources AuthView/ErrorView's slots already accept. "widget"
  // opts INTO "node" explicitly, per slot — never a renderer-wide switch.
  slotKinds: { widget: ["node"] },
  build: (content) => createElement("main", null, createElement("h1", null, content.heading), content.widget),
});

// Every renderer instance is isolated — see "Instance-scoped, never a
// global mutable registry" below. `includeBuiltins: true` additionally
// registers AuthView/ErrorView/MarketingView on this same instance.
const renderer = createWebRenderer({ templates: [DashboardView], includeBuiltins: true });

const ref = (id: string) => ({ id });
const acmeDashboard: SurfaceDocument = {
  id: "acme.dashboard.home",
  channel: "web",
  template: "DashboardView",
  meta: { channel: "web", title: ref("acme.dashboard.heading"), description: ref("acme.dashboard.heading") },
  bindings: [
    { slot: "heading", copy: ref("acme.dashboard.heading") },
    // A caller-owned, already-composed React element — never a raw HTML
    // string, never audience-supplied content. See "Rich-node slots" below.
    { slot: "widget", node: createElement(DashboardWidget, { chartId: "acme.chart.mrr" }) },
  ],
};

// Tell resolveSurfaceDocument which of THIS template's slots accept a
// node — derived from the template's own declaration, never hardcoded —
// and which template names this renderer instance knows.
const resolved = resolveSurfaceDocument(acmeDashboard, myCopyResolver, {
  knownTemplates: renderer.listWebTemplateNames(),
  nodeSlots: Object.entries(DashboardView.slotKinds ?? {})
    .filter(([, kinds]) => kinds.includes("node"))
    .map(([slot]) => slot),
});

const { element } = renderer.renderWebDocument(resolved.document, {
  groups: resolved.groups, // repeating slots, if the template declares any
  nodes: resolved.nodes, // resolved single-binding node slots
});
renderToStaticMarkup(element);
```

**What a consumer-defined template is still forced through.** A `build`
function only ever receives already-validated, already-resolved `content` —
it never sees or influences a raw `SurfaceDocument`, so it cannot become a
path around validation:

- `validateSurfaceDocument`/`validateComposeDocument` run unchanged on
  every document, built-in template or not — a custom template does not
  bypass shape validation of `bindings`, `meta`, or `layout`.
- `resolveDocument`'s `ok`/`missingRequired`/`unknownBindings`/
  `bindingFindings` contract (issue #43's "resolved nothing is never
  `ok: true`" bar) is reused as-is for a custom template's `flow`.
- `renderWebDocument`'s "every required slot must resolve to real content
  or the render throws" discipline (`RenderError("empty-output", ...)`)
  applies identically, whether that content came from a `copy` binding, an
  `assetId`, or an authorized `node`.
- `createResolvedOutputManifest`/`collectCopyProvenance` receive the same
  `CopyResolution[]` for a custom template's `copy`-kind slots as they do
  for `AuthView`/`ErrorView`'s — a custom template is never a hole through
  which resolved copy reaches a page without leaving the provenance trail
  every other slot leaves. A `node`-kind slot's content is the one
  documented exception: it never goes through `CopyRef` resolution at all
  (it is not audience-facing copy), so it contributes no `CopyResolution`
  and appears nowhere in `resolutions`/manifest copy provenance — that
  absence is the intended behavior, not a gap.

**Rich-node slots are the dangerous surface, so they are the narrow one.**
A `"node"`-kind slot accepts a real `ReactNode` the caller's *own trusted
code* already constructed — a composed `AuthView` form, a widget built from
`@clossys/designer` atoms, a small caller-authored component. It never
accepts and never interprets a raw HTML string, and there is no
`dangerouslySetInnerHTML` anywhere on this path — React's own
child-rendering already escapes text/attribute values by default, and a
node slot's safety rests entirely on staying inside that path. `"node"` is
opt-in *per slot*, declared explicitly in `slotKinds`; a slot left off
`slotKinds` (or listed without `"node"`) never accepts one, and every
mismatch — a node for an unregistered or non-node-kind slot, a copy/asset
binding against a node-only slot, a node colliding with a slot a copy/asset
binding already filled — fails closed with
`RenderError("resolution-failed", ...)`, never silently coerced or dropped.
`core`'s own `resolveSurfaceDocument` mirrors this at the canonical-document
layer: a single binding's `node` still refuses unconditionally
(`SurfaceResolutionError("unsupported-node", ...)`) unless its `slot` is
named in that call's own `nodeSlots` option — an opt-in allowlist a caller
builds from the target template's own `slotKinds`, never inferred.

**Instance-scoped, never a global mutable registry.** `createWebRenderer()`
with no arguments knows *zero* templates — not the three built-ins.
`AuthView`/`ErrorView`/`MarketingView` remain exported, unchanged; the
module-level `renderWebDocument`/`listWebTemplateNames` functions (this
package's only entry point before this feature existed) keep rendering
them exactly as before — a zero-line diff for every existing caller. Two
independently created `createWebRenderer()` instances never observe each
other's templates, and this package exports no `registerWebTemplate` or
other function that could mutate a shared, module-level map — the
global-mutation alternative is not merely discouraged, it is structurally
absent from this package's exports. See `defineWebTemplate`'s and
`createWebRenderer`'s own doc comments for the full argument (order
dependence on import timing, and cross-consumer/cross-request collision in
a shared process, the same two failure modes a module-level mutable
registry has always risked elsewhere).

**Fails closed on a malformed definition or a duplicate name.**
`defineWebTemplate` validates `flow` (non-empty, unique slot keys — the
same discipline `validateComposeDocument` already holds a `LayoutSpec` to,
applied here to a `FlowLayoutSpec` at definition time instead of first
render), rejects a `slotKinds` entry naming a slot `flow.slots` does not
declare, and rejects a `repeatingSlots` key that collides with a flowed
slot or with itself — every one of these throws
`RenderError("invalid-template-definition", ...)`.
`createWebRenderer` throws `RenderError("duplicate-template", ...)` if two
entries (across `templates`, and the built-ins when `includeBuiltins` is
`true`) share a `name` — never silently keeps the last one registered.
Both reuse this package's existing `RenderError`/`RenderErrorReason`
contract (`internal/errors.ts`) rather than introducing a second error
type — a caller catching errors from this package never needs a second
`instanceof` check depending on whether a failure happened at template
definition time or at render time.

**One `SurfaceDocument` is exactly one canvas — pagination is out of scope
by design, not an oversight.** `LayoutSpec`'s slots are fractional positions
(`Frame = {x, y, w, h}`, 0..1 of a single fixed canvas); there is no flow,
no auto-height, and no array of canvases on the contract. This fits a
single-page artifact — an OG/share-card image, one slide, one print page —
cleanly. A multi-page document (a book, a paginated report) is a
consumer-side concern: compose it as an ordered sequence of
`SurfaceDocument`s, one per page, each resolved and rendered independently,
and assemble the resulting artifacts (e.g. concatenate PDF pages) outside
this package. `surface` has no opinion on pagination, running headers, page
numbering, or cross-page layout — those stay with whatever assembles the
sequence.

`createOutputManifest` is the lower-level hand-off seam to a consumer
publisher. `createResolvedOutputManifest(surface, resolved, artifacts,
strategyProvenance?)` is the normal pipeline entry point: it additionally
records structural copy provenance grouped by registry, revision, locale,
source, and resolved entry identifier. It intentionally excludes rendered
text and `CopyRef.values`, which can contain audience language or
request-specific data. Both helpers describe artifact paths and media types
but never write or upload files. Strategy provenance stays structural, so
this package never imports or depends on the Strategist package.

The package test suite includes a product-neutral reference pipeline fixture:
an approved, versioned `CopyRegistry` resolves all content; flowed web/email
slots avoid canvas placeholders; web, email, image, print, and slide outputs
each receive a manifest with structural strategy provenance. It also asserts
that draft or malformed sources fail closed.

### Site identity metadata — `buildSiteMetadata` and `lintSiteMetadataHtml`

`buildSiteMetadata({ site, page })` turns a site's identity (`name`,
`tagline`, `origin`, `themeColor`, `locale`, and a `shareCard`) and one page's
facts (`kind`, `label`, `description`, `path`, and for a legal page an optional
`status`) into one plain-data head set: `title`, `description`, `canonical`,
`robots`, `themeColor`, `metadataBase`, `locale`, an `openGraph` object, and a
`twitter` object. Every page kind yields the same keys, with no `undefined`
values, and the same input yields a deep-equal result. It takes plain typed
values; it does not read a brand-facts record and does not call the Writer
package.

- **Title.** A `home` page is `${name} · ${tagline}`; every other kind is
  `${label} · ${name}`. The separator is U+00B7 with one space on each side.
  Values are emitted verbatim — nothing is trimmed — so a `name`, `tagline`,
  or `label` with leading or trailing whitespace, or with a tab, a line break,
  or any other control character anywhere in it, is refused rather than
  repaired. A single internal space is fine. For a page that does not go
  through `buildSiteMetadata` (sign-in, admin, error), `formatPageTitle({ page,
  brand })` builds the same `${page} · ${brand}` title under the same rule and
  throws `SiteMetadataError` (`invalid-input`) naming `page` or `brand`;
  `formatPageTitle({ page: "Sign in", brand: "Example Studio" })` is
  `Sign in · Example Studio`. The share-card `alt` stays caller-owned because
  it must describe the image; a per-page card whose image shows the page title
  uses `formatPageTitle` for its `alt` too.
- **Fallbacks.** `canonical` is `origin` plus `path`; `og:url` is the
  canonical; `og:title` and `twitter:title` are the title; `og:description`
  and `twitter:description` are the page description; `og:site_name` is the
  site name; `og:type` is `website`; the Twitter card is
  `summary_large_image`. A root-relative share-card `url` is resolved against
  `origin`; an absolute `http(s)` URL is kept as given.
- **Robots.**

  | Page kind | `status` | `robots` |
  | --- | --- | --- |
  | `home`, `contact`, `custom` | not allowed | `index, follow` |
  | `notFound` | not allowed | `noindex, nofollow` |
  | `legal` | missing or `draft` | `noindex, nofollow` |
  | `legal` | `counsel-reviewed` | `index, follow` |

  `buildSiteMetadata` only maps the `status` it is given to a robots value; it
  does not record or verify counsel review.
- **Refusals.** It throws `SiteMetadataError` (with a closed `reason`) for a
  non-object input, a blank text field, a `name`, `tagline`, or `label` that
  starts or ends with whitespace or contains a control character (a tab or a
  line break included), an `origin` that is
  not an `http(s)` origin equal to `new URL(origin).origin`, a `path` that does
  not start with a single `/`, that contains `?`, `#`, whitespace, a `.` or
  `..` segment (encoded or not), or an empty segment other than a trailing
  slash, or that `new URL` would serialise differently (the path must already
  be in normal form, so it cannot resolve to another address; a non-ASCII path
  such as `/café` is refused, and its percent-encoded form `/caf%C3%A9` is
  accepted), an unknown
  `kind`, a `status` on a non-legal page or outside `draft`/`counsel-reviewed`,
  a share-card `url` that is neither root-relative nor an absolute `http(s)`
  URL exactly as `new URL(url).href` writes it (`https:foo.png` is refused),
  and a share card whose `width` and `height` are not integers equal to
  `OG_SHARE_CARD_SPEC` (1200 by 630; swapped or other dimensions are
  refused).

`lintSiteMetadataHtml(html)` checks a rendered document's `<head>` against the
declared set `SITE_METADATA_REQUIRED_TAGS`: `<title>`; `description`,
`robots`, and `theme-color` metas; `link rel="canonical"`; the `og:title`,
`og:description`, `og:url`, `og:site_name`, `og:type`, `og:locale`,
`og:image`, `og:image:alt`, `og:image:width`, and `og:image:height`
properties; and the `twitter:card`, `twitter:title`, `twitter:description`,
`twitter:image`, and `twitter:image:alt` metas. It reports every problem in
one pass as a `SiteMetadataLintFinding` (`missing`, `empty`, `duplicate`, or
`unreadable`), and `complete` is `true` only when there are no findings. `og:*`
is read from `property`, the other metas from `name`.

The lint is a strict grammar, not a repairing parser: anything it does not
recognise is `unreadable`, never guessed.

- **Accepted.** Before `<head>`: whitespace, comments, one `<!doctype>`, and
  one `<html>`. Inside the head: whitespace, comments, and `meta`, `link`,
  `base`, `title`, `style`, and `script` elements (a `script` whose text
  contains `<!--` is refused). `</head>` is the only end tag. After `</head>`:
  whitespace and comments, then end of input or `<body`; nothing after `<body`
  is read.
- **Refused as `unreadable`.** Any other start or end tag in the head
  (including `template` and `noscript`), any text between tags, a `<` or `</`
  not followed by a letter, a `<!` that is not a comment, `<?`, a comment that
  contains `--!>`, a byte order mark, text or an element before `<head>`, a
  non-string or blank input, no `<head>`, a `<head>` with no `</head>`, a
  second `<head>`, an unterminated comment, tag, attribute quote, `<title>`,
  `<script>`, or `<style>` before the head closes, and anything between
  `</head>` and `<body` other than whitespace and comments (a `meta`, `title`,
  or `link` there is moved into the head by a parser, so it is refused, as is
  any element, text, second `</head>`, or `<head>`).
- **Character references.** Every `&` followed by a letter or `#` must start
  one of `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`, `&#N;`, or `&#xH;`. A
  declared tag whose value has any other reference (`&nbsp;`, `&copy`, `&#32`)
  gets an `unreadable` finding for that tag, and a `name`, `property`, or `rel`
  attribute with one gets an `unreadable` finding for its element. The closed
  set is decoded to read a tag's identity and to decide whether a value is
  empty, so `&#160;` and a raw no-break space are both empty.

**Soundness boundary.** `lintSiteMetadataHtml` judges only heads whose
after-head content is whitespace, comments and `<body`: it reports complete
only when the head consists solely of whitespace, comments and `meta`, `link`,
`base`, `title`, `style` and `script` elements (scripts without `<!--`), with
character references limited to `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;` and
numeric forms, and `</head>` is followed only by whitespace, comments and then
end of input or `<body`. Everything else is `unreadable`, never guessed; that
includes a `meta`, `title` or `link` between `</head>` and `<body`, which a
parser moves into the head. Within that grammar it checks presence, uniqueness
and non-emptiness of the declared set, not whether the values are true, correct
for the page, an absolute URL, or consistent with another tag. Metadata that a
framework streams into the body is reported missing. It does not read what
follows `<body`. Where it says complete, a spec-compliant HTML parser, with
scripting on or off, puts exactly one non-blank copy of each declared tag
directly in the head; the package's tests confirm that against jsdom.

**Input boundary of `buildSiteMetadata`.** A `name`, `tagline` or `label` with
a tab or any other control character inside it is refused, not only one with
leading or trailing whitespace or a line break; a single internal space is
accepted. A non-ASCII path such as `/café` is refused (a safe false reject,
because `new URL` would encode it and the path must already be in normal form);
the percent-encoded form `/caf%C3%A9` is accepted.

**Not part of this change.** The share-card route or image generation, wiring
this head set into `MarketingView` or any other view or template, and how a
legal document's `status` is decided or stored.

### Share card — `buildShareCard`

`buildShareCard(input)` builds the site's one share card as a React element for
an image-response API, and returns the record `buildSiteMetadata` takes for it.
It is exported from `@clossys/publisher/web` and its server entry, and is
framework-neutral: it renders nothing, rasterises nothing, loads no font, and
fetches nothing.

```typescript
import { buildShareCard, buildSiteMetadata } from "@clossys/publisher/web";

const card = buildShareCard({
  name: "Example Studio",
  tagline: "Small tools, well made",
  alt: "Example Studio",
  mark: { src: markDataUrl, width: 96, height: 96 }, // optional inline data URL
});

// card.element     the React element, exactly 1200 by 630
// card.width       1200
// card.height      630
// card.contentType "image/png"
// card.shareCard   { url: "/opengraph-image", alt, width: 1200, height: 630 }

const meta = buildSiteMetadata({
  site: { name: "Example Studio", tagline: "Small tools, well made", origin: "https://example.com", themeColor: "#112233", locale: "en_US", shareCard: card.shareCard },
  page: { kind: "home", label: "Home", description: "A description.", path: "/" },
});
```

- **Text.** `name` and `tagline` are the plain values `buildSiteMetadata` takes,
  under its title-text rule; `alt` is supplied by the caller. Nothing comes from
  a copy registry and no text is built in. Text is emitted verbatim.
- **Colour.** Every colour is a Designer role token resolved through
  `buildFlatTokenMap(tokenOverrides)`. The defaults are
  `SHARE_CARD_DEFAULT_ROLES` (`--color-surface-base` background,
  `--color-ink-primary` name, `--color-ink-secondary` tagline,
  `--color-accent` rule); `roles` picks others. A role that does not resolve to a
  concrete `#rrggbb[aa]` colour is refused.
- **Mark.** Optional. Accepted only as a `data:image/svg+xml` or
  `data:image/png;base64` URL with integer `width` and `height` no larger than
  the card height. Any other source is refused, so the card cannot trigger a
  fetch.
- **Route.** `path` (default `/opengraph-image`) is the card's root-relative
  route, in normal URL form; it becomes `shareCard.url`.
- **Structure.** Inline styles only: no class names, no CSS custom properties,
  and `display: flex` on every element with more than one child. The same input
  renders the same markup.
- **Refusals.** It throws `ShareCardError` with a closed `reason`
  (`invalid-input`, `blank-text`, `surrounding-whitespace`, `control-character`,
  `invalid-path`, `invalid-token-override`, `unresolvable-role`,
  `invalid-mark-source`, `invalid-mark-size`). The error text is fixed per reason
  and never echoes input.

**Soundness boundary.** Guaranteed: the `OG_SHARE_CARD_SPEC` size, colours only
from role tokens, validated caller text, a mark only from inline data,
inline-style structure, and deterministic markup. Not done: no rasterisation
runs here; there is no font, tagline-fit, or contrast check (a long tagline can
overflow the card); an accepted SVG mark's own content is not inspected; and
approving the words on the card is the caller's. The site template
(copied into a consumer repository, and not part of this package's npm files)
carries a pure mapping from `buildSiteMetadata`'s result onto Next.js
metadata and viewport, and an `opengraph-image` route that draws this card from
approved copy in Designer's default roles.

### Brand share card — `buildBrandShareCard`

`buildBrandShareCard(input)` builds one share card for any site, drawn like the
site header: a plated mark beside the wordmark, or the plate alone. It returns
the same `ShareCard` as `buildShareCard`, is exported from
`@clossys/publisher/web` and its server entry, and renders nothing, loads no
font, and fetches nothing.

```typescript
import { buildBrandShareCard } from "@clossys/publisher/web";

const card = buildBrandShareCard({
  markSrc: markDataUrl, // inline data URL
  wordmark: "Example Studio", // omit to draw the plate alone
  kicker: "Small tools",
  headline: "Made well, made to last",
  supporting: "A studio for small, useful tools.",
  alt: "Example Studio",
  displayFontFamily: "Example Display", // optional, for the wordmark and headline
});

// card.element  the React element, exactly 1200 by 630
// card.shareCard { url: "/opengraph-image", alt, width: 1200, height: 630 }
```

- **Text.** `headline` and `alt` are required; `wordmark`, `kicker` and
  `supporting` are optional. All follow `buildShareCard`'s text rule and are
  emitted verbatim; a blank optional value is refused, not dropped.
- **Lockup.** The plate is `BRAND_SHARE_CARD_PLATE_PX` (96) square. Its corner
  radius, the mark's inset, the wordmark size and the gap all come from
  Designer's published badge and lockup ratios rather than numbers kept here.
  The kicker follows the lockup after a 2px rule in its own colour; `headline`
  and `supporting` sit at the bottom.
- **Colour.** Every colour is a Designer role token resolved through
  `buildFlatTokenMap(tokenOverrides)`. The defaults are
  `BRAND_SHARE_CARD_DEFAULT_ROLES` (`--color-surface-base` background;
  `--color-ink-primary` plate, wordmark and headline; `--color-ink-secondary`
  kicker and supporting); `roles` picks others.
- **Truncation.** Long text is cut rather than overflowing the card: the
  wordmark and the kicker each stay on one line and end in an ellipsis (the
  kicker gives way first), and the headline and the supporting line each stop at
  two lines. A mark that is not square keeps its ratio inside the plate.
- **Contrast.** There is no contrast check on `roles`. Keep each text and
  background pair at 4.5:1 or better; the default plate is dark on the light
  surface.
- **Mark.** `markSrc` follows the rule for `buildShareCard`'s `mark.src`: an
  inline `data:image/svg+xml` or `data:image/png;base64` URL, never a remote one.
- **Font.** `displayFontFamily` names a family for the wordmark and headline:
  letters, digits, spaces and hyphens only. No font is loaded; the renderer
  must have it.
- **Refusals.** It throws `ShareCardError` with the existing closed reasons and
  no new one; the error text never echoes input.
- **Route.** `createShareCardRoute` wraps this card as the exports of an
  `opengraph-image` route; see [Share card route](#share-card-route--createsharecardroute).

## `media` — the asset registry contract, responsive images, and video (v2)

`@clossys/publisher/media` registers a consumer's own image and video
assets under a stable `assetId`, the identical role `@clossys/writer`
plays for text: a registry, never a generation engine (it never calls an
image/video API, never talks to a model, never transcodes or extracts a
poster frame — see `src/media/types.ts`'s own top comment).

**v2 (issue #177) added a required `type` discriminator, responsive image
sources, and video — a breaking change from v1.** `AssetEntry` is now a
discriminated union:

```ts
type AssetEntry = ImageAssetEntry | VideoAssetEntry;

interface ImageAssetEntry {
  id: string;
  type: "image";
  src: string;            // primary/fallback source — unchanged from v1
  width: number;
  height: number;
  alt: string;             // required, unchanged from v1
  mimeType?: string;
  licence?: string;        // optional — unchanged from v1, see below
  credit?: string;
  sources?: { src: string; width: number; format?: string }[]; // NEW — responsive <picture>/srcset
}

interface VideoAssetEntry {
  id: string;
  type: "video";           // NEW — this package's first video support at all
  sources: { src: string; mimeType: string }[]; // required, at least one
  width: number;
  height: number;
  alt: string;
  captions?: { src: string; srclang: string; label: string }[];
  transcript?: string;     // at least one of captions/transcript is REQUIRED
  poster?: string;
  reducedMotion: "pause" | "no-autoplay" | "static-poster"; // required
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
  licence?: string;
  credit?: string;
}
```

**Migrating a v1 registry:** add `type: "image"` to every existing entry.
`validateAssetRecordShape`'s new `"type-shape"` rule rejects any entry with
no `type` at all — there is no silent default, on purpose (a registry that
guessed "image" on a caller's behalf would hide the one piece of
information a reviewer most needs to see stated). Every other v1 field
(`src`/`width`/`height`/`alt`/`mimeType`/`licence`/`credit`) is unchanged.

**`licence`/`credit` are not new in v2 and stay optional.** Both already
existed in v1 with real shape validation (`"licence-shape"`/
`"credit-shape"`). v1's actual gap was that a missing licence produced no
signal at all — closed not by making `licence` schema-required (which would
invalidate every already-registered v1 entry the moment its owner upgrades)
but by a new `checkAssetCoverage` finding: `"asset-missing-licence"`
(`severity: "warning"`), reported for every registered entry — referenced or
not — with no `licence`. `AssetCoverageReport` also gained `registeredByType:
{ image: number; video: number }`, so a reviewer can tell what is actually
registered without re-reading the raw JSON; `checkAssetCoverage`'s own
id-matching does not branch on `type` — an id either matches a registered
entry or it doesn't, regardless of kind.

**Video accessibility is enforced at the schema layer, not the renderer.**
A `VideoAssetEntry` with neither `captions` nor `transcript` fails
`validateAssetRecordShape` (`"video-caption-or-transcript-required"`,
`severity: "error"`) and can never reach a renderer at all — the identical
"no later recovery point" reasoning `alt`'s own required-and-non-whitespace
rule already holds images to, restated for captions (recovering one after
the fact means re-transcribing the video, not re-typing a sentence).
`reducedMotion` is similarly required
(`"video-reduced-motion-required"`), and `reducedMotion: "static-poster"`
additionally requires `poster` (`"video-static-poster-requires-poster"`).
`../internal/assets.ts`'s render-time validation (`isRenderVideoAsset`)
enforces the identical bars independently, since a hand-rolled `AssetLookup`
(a CMS, a CDN manifest, a test double) can hand a renderer a video-shaped
value that never passed through this package's own schema at all.

### Per-channel behaviour

| Channel | Responsive images (`sources`) | Video |
| --- | --- | --- |
| `web` | Real `<picture>`/`<source>`/`srcset`, falling back to the primary `<img>` | Real `<video>` with every `<source>`/`<track kind="captions">`, gated by the reduced-motion contract below |
| `email`, `print`, `image`, `slides` | Ignored — `sources` is dropped; the primary `src` renders exactly as a v1 image would | No playback capability of any kind. A video entry's `poster` renders as a plain `<img>`/`<image>`, exactly like an image asset. A video with **no `poster`** is an unresolvable asset — the render refuses (`RenderError("empty-output", ...)`), the identical fail-closed bar an unresolved `assetId` already gets. Never silently rendered as nothing. |

**Reduced motion is a rendering-time decision, not a build-time one.**
`renderWebDocument`/`RenderWebOptions.prefersReducedMotion` (issue #177) is
a caller-supplied boolean — this package has no `window`/DOM access at
render time (it may run on a server, in a build step, or in a browser), so
it cannot itself call `window.matchMedia("(prefers-reduced-motion:
reduce)")`; a caller derives that value from a `Sec-CH-Prefers-Reduced-Motion`
client hint on the server, or a direct `matchMedia` read on the client, and
passes it through. Applied against a resolved `VideoAssetEntry.reducedMotion`:

- Omitted (or `false`) — every video's own `autoplay` renders exactly as
  authored. Regression-safe: unchanged from before this option existed.
- `true` and `reducedMotion` is `"pause"` or `"no-autoplay"` — the entry's
  `autoplay` is force-suppressed; every other attribute (loop/muted/
  poster/sources/captions) renders unchanged, so a viewer can still press
  play.
- `true` and `reducedMotion` is `"static-poster"` — no `<video>` element is
  emitted at all; a static `<img>` built from `poster` renders instead.

### Explicit non-goals

- **No responsive-source or video support on `email`/`print`/`image`/
  `slides`.** `RenderAsset`'s discriminated shape is shared by all five
  channel renderers by construction, so each non-web channel must at
  minimum not crash or silently mis-render a video/multi-source entry — but
  real playback support is `web`-only, and a `<picture>`-equivalent
  construct does not exist in an SVG canvas or reliably in an email client.
- **No licence content-validation.** `licence` stays free text — this
  package has no authority over what licences a consumer's assets actually
  carry, unchanged from v1.
- **No automatic captioning/transcription.** A missing captions/transcript
  pair is a hard validation failure a human must resolve, never something
  this package infers or generates.
- **No video generation, transcoding, or poster extraction** — the
  identical "registry, not an engine" boundary this file's own top comment
  already draws for images.

## `document` — a product-neutral structured-document contract and renderer

A help article, a policy page, a changelog entry, a long-form explainer —
any page whose body is "read this document," not "fill in these five named
regions" — has no shape in `SurfaceSlotBinding` (a single `CopyRef` or a
caller-owned `node`, never an ordered sequence of headings, paragraphs,
lists, tables, and callouts). `@clossys/publisher/document` is that
shape: `StructuredDocument`, `validateStructuredDocument`, and
`renderStructuredDocument`.

```ts
import { validateStructuredDocument, renderStructuredDocument } from "@clossys/publisher/document";
import type { StructuredDocument } from "@clossys/publisher/document";

const ref = (id: string) => ({ id });

const helpArticle: StructuredDocument = {
  id: "acme.help.getting-started",
  title: ref("acme.doc.title"),
  sections: [
    {
      kind: "section",
      id: "overview", // a literal, author-supplied, locale-stable anchor — never derived from `heading`
      level: 2, // h1 is reserved for the page's own title, rendered outside this contract
      heading: ref("acme.overview.heading"),
      blocks: [
        {
          kind: "paragraph",
          content: [
            { kind: "text", text: ref("acme.overview.p1") },
            { kind: "link", text: ref("acme.overview.link"), href: "#pricing" }, // an in-document fragment link
            { kind: "strong", content: [{ kind: "link", text: ref("acme.overview.bold"), href: "https://acme.example/docs" }] }, // a bold link
            { kind: "em", content: [{ kind: "text", text: ref("acme.overview.italic") }] },
          ],
        },
        { kind: "list", style: "ordered", items: [[{ kind: "text", text: ref("acme.overview.item1") }]] },
      ],
    },
    {
      kind: "section",
      id: "pricing",
      level: 2,
      heading: ref("acme.pricing.heading"),
      blocks: [
        {
          kind: "table",
          headers: [ref("acme.pricing.plan"), ref("acme.pricing.price")],
          columnStyles: ["default", "mono"], // one entry per header; a "mono" column's body cells render in <code>
          rows: [[ref("acme.pricing.plan1"), ref("acme.pricing.price1")]],
        },
      ],
    },
  ],
};

const findings = validateStructuredDocument(helpArticle); // [] when clean — see "What is validated" below
const { element, resolutions } = renderStructuredDocument(helpArticle, { resolveCopyId: myCopyResolver });
```

**Every leaf of content is a `CopyRef`, never a literal string** — the same
discipline `SurfaceSlotBinding.copy` already holds document content to.
`DocumentBlock` is a closed, six-member vocabulary (`section`, `paragraph`,
`list`, `definition-list`, `table`, `callout`); `DocumentInline` (inside a
paragraph, list item, or callout — never a block on its own) is `text`,
`link`, `strong`, or `em`. A `DocumentSection` (`id`, `level: 2–6`, `heading`, `blocks`) is the
one block kind that nests, and is also what `StructuredDocument.sections`
is made of at the top level. See `src/document/types.ts` for the full
shape and every field's own doc comment.

`strong` and `em` are inline emphasis: each wraps a non-empty run of further
`DocumentInline` in `content`, so they nest, and a bold link is a `strong`
whose `content` holds a `link`. A table column can be set monospace through
`columnStyles`, one `"default"` or `"mono"` entry per header.
`renderStructuredDocument` renders `strong` as `<strong>`, `em` as `<em>`,
and each body cell of a `"mono"` column as `<code>` around its text (the
`<th>` is left plain); there is no class and no inline style. A table
without `columnStyles` renders as before. The example above shows both.

**What is validated (`validateStructuredDocument(value): ComposeFinding[]`)**
— shape (every block/inline kind checked against its own fields, a
distinct `rule` name per failure, the same `{ rule, severity, message,
path }` shape every other validator in this package uses, attributed to a
precise path like `sections.0.blocks.2.rows.1`), plus four checks worth
calling out:

- **Heading order.** A top-level `sections` entry must be `level: 2`
  (`"section-level-must-be-two-at-top"`); a nested section's `level` must
  equal its parent's `+ 1` — never equal, lower, or skipped ahead
  (`"section-level-skip"`, the exact h2→h4 jump this contract exists to
  catch); a `level: 6` section may not contain a nested section, since
  there is no `level: 7` (`"section-level-max-depth"`).
- **Links.** A `"link"`'s `href` is checked against a closed scheme
  allowlist — `https:`, `http:`, `mailto:` — the same
  `protocol !== "https:" && protocol !== "http:"` shape
  `packages/auth/src/redirect.ts`'s `parseHttpUrl` already uses elsewhere
  in this repository, extended with `mailto:`. A rejected scheme
  (`javascript:`, `data:`, `file:`, or an unparseable value) is
  `"link-scheme-not-allowed"`, **an error finding, never a silent drop**:
  it is never omitted from the block, never replaced with a placeholder,
  and never rendered inert — the finding makes the whole document invalid,
  and `renderStructuredDocument` refuses to render at all.

  Two **schemeless** forms are accepted alongside those three schemes,
  because a prose document overwhelmingly links inside its own site:

  - A `"#fragment"` link skips the scheme check (there is no scheme) but
    must resolve against a real `DocumentSection.id` present anywhere in
    the same document, at any nesting depth — a fragment naming no such id
    is `"link-fragment-unresolved"`.
  - A **root-relative** `"/pricing"` is accepted as-is. It is same-origin
    by construction, so there is no scheme to allowlist, and requiring an
    absolute URL instead would bake the deployment's hostname into content
    the copy registry owns.

  Two forms that *look* relative are rejected, and the distinction is the
  point:

  - `"//host/path"` — **protocol-relative** — is
    `"link-protocol-relative"`. It reads as same-site and is not: it
    inherits only the scheme and resolves to whatever host follows the
    `//`. Write the absolute `https:` URL if that other origin is
    genuinely intended.
  - `"docs/foo"`, `"../sibling"` — **path-relative** — is
    `"link-scheme-not-allowed"`. It resolves against whichever route the
    document is mounted at, and this contract exists precisely so one
    `StructuredDocument` can be rendered in more than one place; a link
    that means different things per mount point is a defect that would
    only surface on the second mount.
- **Emphasis.** The link rules above apply to a `link` inside `strong` or
  `em` the same as to one outside it. Emphasis nests at most four deep
  (`"inline-emphasis-too-deep"`, reported once at the fifth level), an
  empty `content` is `"inline-emphasis-empty"`, and an inline `kind` other
  than `text`, `link`, `strong`, or `em` is `"inline-kind-unknown"`.
- **Tables.** `headers` must be a non-empty `CopyRef[]`
  (`"table-headers-required"`); every row must have exactly
  `headers.length` cells, never padded or truncated
  (`"table-row-length-mismatch"`, reported per offending row index).
  `renderStructuredDocument` renders `headers` as `<th scope="col">` inside
  a `<thead>` and every row as `<td>` inside `<tbody>` — the header-to-cell
  association an accessible table needs is therefore structural (the fixed
  cell count matching a real `<th>` per column), not left to visual
  alignment.
  When `columnStyles` is present it must have `headers.length` entries
  (`"table-column-styles-length-mismatch"`) and each entry must be
  `"default"` or `"mono"` (`"table-column-style-unknown"`; a value that is
  not an array is `"table-column-styles-shape"`).
- **Anchors.** Every `DocumentSection.id`, at every nesting depth, must be
  unique across the **whole document**, not just among siblings — a
  duplicate is `"section-anchor-duplicate"`, reported for the second (and
  every subsequent) occurrence, naming the path of the first. Never
  auto-renamed, suffixed, or dropped to force uniqueness — resolving the
  collision is the author's job.

An empty document (`sections: []`), an empty list (`items: []`), and an
empty table body (`rows: []`, headers still required) are each valid —
"empty is a fact to report, not to hide," the same discipline
`SurfaceRepeatingSlotBinding.items` already holds `surface/core` to —
never a special-cased finding.

**`renderStructuredDocument(doc, options?)` renders to semantic HTML only**
— `<section>`, `<h2>`–`<h6>`, `<p>`, `<ul>`/`<ol>`, `<dl>`, `<table>`/
`<thead>`/`<tbody>`/`<th>`/`<td>`, `<a>`, and `<aside role="note"
data-callout-tone="…">` for a callout (there is no single HTML element for
"callout"; `<aside>` is the closest semantic fit, and `data-callout-tone`
is this subpath's own public, documented attribute naming the closed
`tone` vocabulary — not an internal-convention leak). Every block and every
inline node is a typed primitive this renderer walks explicitly and emits
as a specific element: there is no `"html"` block kind, no markdown string
parsed into markup, and no `dangerouslySetInnerHTML` anywhere on this
path — the same non-goal issue #175 (the web-template registry) states for
its own `"node"`-kind slots, applied here to document content specifically.

It **refuses to render an invalid document at all**:
`validateStructuredDocument` runs first, and any `severity: "error"`
finding throws `RenderError("resolution-failed", ...)` before a single
element is built — reusing this package's existing closed
`RenderErrorReason` vocabulary (`src/internal/errors.ts`) rather than
inventing a parallel one, and never partially rendering a document with
known-invalid content. The same error, and the same reason, is thrown if a
`CopyRef` fails to resolve during rendering (no `options.resolveCopyId`
supplied, an unresolved id, or empty resolved text) — the identical
fail-closed shape `resolveSurfaceDocument` already uses for every other
unresolved/invalid input in this package.

`doc.title` is resolved (and appears in the returned `resolutions`, for
provenance) but is **never rendered into the output tree** — the page's
own `<h1>` stays the caller's job, the same discipline `ErrorView` already
holds between its own `<h1>` and `EmptyState`'s `<h2>`.

**`resolveCopyId`'s type, and the `{ element, resolutions }` return
shape.** `RenderStructuredDocumentOptions.resolveCopyId` is
`@clossys/writer`'s own ref-based `CopyResolver` —
`(ref: CopyRef) => CopyResolution | undefined`, the same type
`resolveSurfaceDocument`'s own `resolver` parameter takes — **not**
`surface/web`'s string-keyed `CopyResolver` (`(copyId: string) => string |
undefined`). Every `CopyRef` this render resolves (`title`, every
`heading`, every inline `text`/`link` text, every table header/cell, every
callout/definition-list text) is collected into a `CopyResolution[]`,
returned as `resolutions` alongside the rendered `element` — feed it to
`collectCopyProvenance` (`surface/core`) exactly as
`ResolvedSurfaceDocument.resolutions` already is.

**Plugging a rendered document into a page.** `renderStructuredDocument`'s
`element` is a plain `ReactNode` a consumer's own `surface/web` template
can accept through a `"node"`-kind slot (`defineWebTemplate`/
`createWebRenderer`, see "`defineWebTemplate` / `createWebRenderer`"
above) — the page shell (header, nav, footer) around the document body is
exactly the kind of thing a consumer's own template already provides, and
this package invents no second, parallel composition seam for document
content specifically:

```ts
import { createElement } from "react";
import { defineWebTemplate, createWebRenderer } from "@clossys/publisher/web";
import { resolveSurfaceDocument } from "@clossys/publisher/core";
import type { SurfaceDocument } from "@clossys/publisher/core";

const HelpArticleView = defineWebTemplate({
  name: "HelpArticleView",
  flow: { slots: [{ key: "heading", required: true }, { key: "body", required: true }] },
  slotKinds: { body: ["node"] },
  build: (content) => createElement("main", null, createElement("h1", null, content.heading), content.body),
});

const page: SurfaceDocument = {
  id: "acme.help.getting-started.page",
  channel: "web",
  template: "HelpArticleView",
  meta: { channel: "web", title: ref("acme.page.title"), description: ref("acme.page.title") },
  bindings: [
    { slot: "heading", copy: ref("acme.page.title") },
    { slot: "body", node: element as object }, // renderStructuredDocument's own `element`, from above
  ],
};

const resolved = resolveSurfaceDocument(page, myCopyResolver, { nodeSlots: ["body"] });
const { element: pageElement } = createWebRenderer({ templates: [HelpArticleView] }).renderWebDocument(resolved.document, { nodes: resolved.nodes });
```

**Non-goals** (see issue #176 for the fuller argument for each): no
clause numbering, no defined-terms glossary, and no
citation/footnote-to-statute primitive — a legal document is a profile
over this structure (see "Legal documents" below), not a separate content
type; no arbitrary HTML passthrough; no pagination (a `StructuredDocument` is one
document — a multi-page work is a caller-side concern composing an ordered
sequence of them, the identical boundary this package's README already
draws for `SurfaceDocument` and canvas channels); no automatic
table-of-contents generation (this contract supplies the addressable
section/anchor structure a TOC would be built from; generating and
rendering the TOC itself is left to the caller).

### Legal documents (Terms and Privacy profile)

A Terms or Privacy page is a `StructuredDocument` with one extra field,
`legal`. `LegalDocument` is `StructuredDocument & { legal: LegalProfile }`,
and `validateLegalDocument` and `gateLegalDocument` check that profile on
top of the ordinary document contract. The profile adds no block kinds and
`renderStructuredDocument` renders a legal document the same way it renders
any other.

```ts
import { LEGAL_SECTION_IDS, validateLegalDocument, gateLegalDocument } from "@clossys/publisher/document";
import type { DocumentSection, LegalDocument } from "@clossys/publisher/document";

const ref = (id: string) => ({ id });

// One section per fixed id, in order. Every string is a CopyRef the caller's registry owns.
const sections = LEGAL_SECTION_IDS.terms.map(
  (id): DocumentSection => ({
    kind: "section",
    id,
    level: 2,
    heading: ref(`acme.terms.${id}.heading`),
    blocks: [{ kind: "paragraph", content: [{ kind: "text", text: ref(id === "indemnity" ? "acme.terms.indemnity.not-applicable" : `acme.terms.${id}.p1`) }] }],
  }),
);

const terms: LegalDocument = {
  id: "acme.legal.terms",
  title: ref("acme.terms.title"),
  sections,
  legal: {
    kind: "terms",
    status: "draft",
    effectiveDate: "2026-01-15",
    lastUpdated: "2026-01-10",
    variables: { entity: "Acme Example Ltd", jurisdiction: "Exampleland", contact: "legal@acme.example" },
    factsToConfirm: [ref("acme.terms.facts.entity-registration")], // a draft needs at least one
    notApplicable: { indemnity: ref("acme.terms.indemnity.not-applicable") },
  },
};

validateLegalDocument(terms); // [] when clean
gateLegalDocument(terms, "preview"); // { ok: true, findings: [] }: a valid draft may be previewed
gateLegalDocument(terms, "production"); // { ok: false, ... }: a draft is refused
```

**Section ids.** The top-level `sections` of a legal document carry these
ids, in this order, with none missing, extra, renamed or reordered. Both
lists are exported as `LEGAL_SECTION_IDS`, keyed by kind.

- `terms`: `about`, `acceptance`, `eligibility`, `using-the-site`,
  `acceptable-use`, `intellectual-property`, `your-submissions`,
  `third-parties`, `no-professional-advice`, `disclaimers`, `liability`,
  `indemnity`, `changes`, `suspension`, `governing-law`, `general`,
  `contact`.
- `privacy`: `about`, `scope`, `what-we-collect`, `how-we-use`,
  `legal-bases`, `cookies`, `sharing`, `international-transfers`,
  `retention`, `security`, `your-rights`, `children`, `changes`, `contact`.

**The profile.** `LegalProfile` carries:

- `kind`: `"terms"` or `"privacy"`, which selects the id list above.
- `status`: `"draft"` or `"counsel-reviewed"`.
- `effectiveDate` and `lastUpdated`: both required, `YYYY-MM-DD`, and
  each must be a real calendar date (`2026-02-30` is refused).
- `variables`: `entity`, `jurisdiction` and `contact`, each a required
  non-empty string.
- `factsToConfirm` (optional): a list of `CopyRef`s naming facts a person
  still has to confirm. A draft needs a non-empty list. `LegalView` renders
  it in a draft callout.
- `notApplicable` (optional): a record from section id to a `CopyRef`. A
  section that does not apply keeps its heading and states so through that
  reference, and the section's only block is a paragraph carrying it.

**Findings and the gate.** `validateLegalDocument(value: unknown)` returns
the base `validateStructuredDocument` findings plus the legal-profile
findings (a missing, extra, renamed or reordered section, the status, the
dates, the variables, and the facts a draft needs). It takes an `unknown`
value and returns findings instead of throwing.

`gateLegalDocument(value: unknown, target: "preview" | "production")`
returns `{ ok, findings }` and is pure. It refuses when the document is
invalid or the target is not one of the two above. For `"production"` it
accepts only a valid `counsel-reviewed` document; for `"preview"` it
accepts any valid document, including a valid draft. It is a function a
caller can call: this package does not wire it into any iteration or
release process.

**Soundness boundary.** The profile checks structure, status, dates and
variables. It does not and cannot judge the legal adequacy of any text,
and a `counsel-reviewed` status is a claim the caller makes, not something
this package verifies. No legal wording ships in this package: every
string in a legal document is a `CopyRef` that the consumer's own registry
owns.

**Not included yet:** a processor list derived from other content, variants
of the `children` section, and reading the brand-facts record for the
variables.

#### `LegalView`

`LegalView`, exported from `@clossys/publisher/web` next to `DocumentView`,
renders a `LegalDocument` in the same site chrome and layout as
`DocumentView`. It is server-safe and has no summary or action props.

```tsx
import { LegalView } from "@clossys/publisher/web";
import type { LegalViewLabels } from "@clossys/publisher/web";
import type { LegalDocument } from "@clossys/publisher/document";

type LegalResolver = React.ComponentProps<typeof LegalView>["resolveCopyId"];

declare const resolveCopyId: LegalResolver; // the caller's approved-copy registry
declare const brand: React.ReactNode; // the caller's brand mark
declare const terms: LegalDocument; // as built in the example above

const labels: LegalViewLabels = {
  effectiveDate: { id: "acme.legal.label.effective-date" },
  lastUpdated: { id: "acme.legal.label.last-updated" },
  draftHeading: { id: "acme.legal.label.draft-heading" },
};

export function TermsPage() {
  return <LegalView brand={brand} document={terms} resolveCopyId={resolveCopyId} labels={labels} locale="en-GB" />;
}
```

Props, in addition to the standard `div` attributes and `style`:

- `brand`: the brand node placed in the page chrome.
- `document`: the `LegalDocument` to render.
- `resolveCopyId`: `@clossys/writer`'s ref-based `CopyResolver`
  (`(ref: CopyRef) => CopyResolution | undefined`) that turns every `CopyRef`
  into traced text, the same type `renderStructuredDocument` takes. It is not
  the string-keyed `CopyResolver` exported from `@clossys/publisher/web`, which
  carries no provenance and does not type-check here.
- `labels`: `LegalViewLabels`, three `CopyRef`s named `effectiveDate`,
  `lastUpdated` and `draftHeading`.
- `locale` (required): the locale passed to `Intl.DateTimeFormat`.
- `footerSecondary` (optional): extra footer content.

What it does:

- It runs `validateLegalDocument` first. Any finding throws a `RenderError`,
  so an invalid document does not render.
- It renders the sections through `renderStructuredDocument` in the fixed
  order of `LEGAL_SECTION_IDS`.
- A section listed in `legal.notApplicable` keeps its heading and renders
  the `CopyRef` given for it.
- The effective and last-updated dates render as
  `<time dateTime="YYYY-MM-DD">`, formatted with
  `Intl.DateTimeFormat(locale)` in UTC and labelled by the `labels` copy
  references, resolved with `resolveCopyId`.
- A `draft` document renders a `role="note"` callout before the first
  section. Its heading comes from `labels.draftHeading` and it holds one
  list item per resolved `factsToConfirm` entry. No prop turns the callout
  off, and a `counsel-reviewed` document renders without it.
- The content variables (`entity`, `jurisdiction`, `contact`) are not
  displayed and no interpolation is applied to copy.
- Every visible string comes from a caller `CopyRef`, so the caller supplies
  a `locale` and the text for every label.

**Soundness boundary.** `LegalView` guarantees the document's structure,
section order, dates and a draft marker that cannot be suppressed. It says
nothing about the legal adequacy of any text. It does not enforce the
production gate: call `gateLegalDocument` separately before publishing.

### Boundary pages

`BoundaryView` is the whole page for a 500, a 404 or a sign-in boundary state: one
retry action, and any second destination as a text link in the description.

```tsx
import { BoundaryView } from "@clossys/publisher/web";

export function ServerErrorPage({ reference }: { reference: string }) {
  return (
    <BoundaryView
      brand="Example Studio"
      status={500}
      title="Something went wrong"
      description={
        <>
          Something went wrong. Error: {reference}. You can also{" "}
          <a href="/contact">contact us</a>.
        </>
      }
      action={<a href="/">Try again</a>}
    />
  );
}
```

### Global error document — `GlobalErrorDocument`

`GlobalErrorDocument`, exported from `@clossys/publisher/web` and its server
entry, is the whole document for a framework's global-error boundary. That
boundary replaces the root layout, so it renders its own `<html>`, `<head>` and
`<body>` and gets none of the layout's stylesheet, theme script or copy. The
component renders a `<title>` built by `formatPageTitle` (`<page> · <brand>`,
and a part with surrounding whitespace throws `SiteMetadataError`), a
`noindex, nofollow` robots meta, one icon link, and an `ErrorView` with every
other prop. It is a component, not a template: it is not in the template
registry, takes no router, and is not a client module.

No theme script runs in this document, so it is pinned to the light theme
(`data-theme="light"` and `color-scheme: light`) and marked `data-brand-bound`.
Brand tokens are not imported here: import your brand stylesheet in the same
global-error file that renders this component, as your root layout does.

```tsx
"use client";

import { GlobalErrorDocument } from "@clossys/publisher/web";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <GlobalErrorDocument
      lang="en"
      documentTitle={{ page: "Something went wrong", brand: "Example Studio" }}
      icon={{ href: "/icon.svg", type: "image/svg+xml" }}
      status={500}
      title="Something went wrong"
      description={error.digest ? `Something went wrong. Error: ${error.digest}.` : "Something went wrong."}
      action={<button type="button" onClick={reset}>Try again</button>}
    />
  );
}
```

Next requires the global-error file to be a client module, so it starts with
`"use client"`; the component itself is not one. The digest has no prop of
its own: put it in `description` as caller copy (`Error: <digest>.`). A
segment `error` boundary keeps the layout, so use `ErrorView` there instead.

### `SignInForm`

`SignInForm`, exported from `@clossys/publisher/web`, is an identifier-first
sign-in form for `AuthView`'s form slot: an identifier step, then a password
step. It imports no identity provider and reads no browser global; the caller
injects the two handlers (an adapter package can supply them) and decides where
to go once signed in. It is a client component, so import it from a module that
is a client boundary. Under the `react-server` condition the name is a stub
that throws a `RenderError` when called. The page's `<h1>` stays `AuthView`'s.

```tsx
import { AuthView, SignInForm } from "@clossys/publisher/web";
import type { SignInResult } from "@clossys/publisher/web";

declare const brand: React.ReactNode;
declare function lookUp(identifier: string): Promise<SignInResult>; // your handler
declare function check(secret: string): Promise<SignInResult>; // your handler
declare function goToApp(): void;

export function SignInPage() {
  return (
    <AuthView
      brand={brand}
      heading="Sign in"
      description="Continue to Acme Console."
      form={<SignInForm identify={lookUp} verify={check} onSignedIn={goToApp} nouns={{ surface: "Acme Console" }} />}
    />
  );
}
```

Props:

- `identify(identifier)` and `verify(secret)`: each resolves to a
  `SignInResult`, `{ status: "ok" }` or `{ status: SignInFailure }`, where
  `SignInFailure` is `"credential"`, `"notFound"`, `"rateLimited"`,
  `"locked"`, `"network"` or `"unavailable"`. The union is closed. `identify`
  receives the identifier trimmed. A handler that throws, or answers anything
  outside the union, reads as `unavailable`.
- `onSignedIn()`: called once after `verify` answers `ok`. The form does not
  navigate, set a cookie or redirect.
- `nouns` (optional): the nouns of the shipped wording. Pass `surface`, which
  the network notice names; every id the form shows is resolved on each render
  through `resolveFrontDoorCopy`, so an incomplete set throws a `RenderError`
  `resolution-failed` naming the id, never a noun. The `identifier` noun is
  the visitor's own entry and is not a prop.

Steps: the identifier step asks for the identifier. After `identify` answers
`ok` the password step shows "Signing in as" the identifier
(`front-door.password.description`), the password field, and one ghost button
(`front-door.password.secondary`) that returns to the identifier step with the
identifier kept and the password cleared. There is no Back control inside the
card. A `verify` answer of `ok` calls `onSignedIn` once and the submit button
stays pending.

Where each failure shows, on the step it happened in:

| Result | Where | Copy id |
| --- | --- | --- |
| empty identifier | inline on the field | `front-door.identifier-required.notice` |
| empty password | inline on the field | `front-door.password-required.notice` |
| `credential` or `notFound`, identifier step | inline on the field | `front-door.identifier-not-found.notice` |
| `credential` or `notFound`, password step | inline on the field | `front-door.password.notice` |
| `rateLimited` | the form's one `role="alert"` | `front-door.rate-limited.notice` |
| `locked` | the form's one `role="alert"` | `front-door.locked.notice` |
| `network` | the form's one `role="alert"` | `front-door.network.notice` |
| `unavailable`, a throw, or an unknown answer | the form's one `role="alert"` | `front-door.unavailable.notice` |

Nothing is validated before a submit or on blur, and an empty submit calls no
handler. An inline error clears when its field changes. The submit button is
pending, never `disabled`, while a call is in flight, and a second submit is
ignored. Each step's `<form>` is labelled with `front-door.sign-in.title` or
`front-door.password.title`, and the form has no error summary.

What it does not do: offer a passkey, single sign-on, sign-up or one-time-code
first factor, show a password-reset link, or choose a return target.

### `PackReviewView`

`PackReviewView`, exported from `@clossys/publisher/web`, is the dev-only
review index for a site release. One page lists every page of the site with its
forced states, every exported artifact, and a contact sheet that renders each
page and state in a lazy frame at 390, 1024 and 1440 px. Each page and export
carries a `draft`, `delegated` or `approved` badge; each forced state and each
contact-sheet frame shows its page's badge. It is server-safe, reads
nothing, and ships no wording: the caller builds the entries with
[`buildPackReviewIndex`](#reviewing-a-pack) and passes every visible string.

The frame is the one `AuthView` uses: Designer's `SiteHeader` with the
text-only surface badge (`surfaceLabel`, required), a `PageHeader`, and
`SiteFooter`, with the page held to `--ui-width-form-max`. The contact sheet
scrolls sideways inside its own section, so the widest frame never widens the
page.

```tsx
import { PackReviewView } from "@clossys/publisher/web";
import type { PackReviewViewLabels } from "@clossys/publisher/web";

declare const labels: PackReviewViewLabels; // every heading, badge, kind and frame name, as approved copy

export function ReviewPage() {
  return (
    <PackReviewView
      brand={<span>Example Studio</span>}
      surfaceLabel="Review"
      heading="Pack review"
      description="Pages, states and exports of this site."
      pages={[
        {
          id: "/contact",
          href: "/contact",
          status: "delegated",
          states: [{ id: "accepted", href: "/contact?preview=accepted" }],
        },
      ]}
      exports={[{ id: "share-card:0", kind: "og-image", path: "out/share/og-image.png", status: "approved" }]}
      labels={labels}
    />
  );
}
```

Props:

- `brand`, `surfaceLabel`, `heading`, `description`, `footerSecondary`
  (optional): the frame, as above.
- `pages`: `{ id, href, status, states: { id, href }[] }[]`. `id` is shown as
  text. Every `href` must be a same-site address (one leading slash, no
  `//`, no backslash, no control character); anything else throws a
  `RenderError` naming the position, never the value.
- `exports`: `{ id, kind, path, status, href?, width? }[]`. `path` is shown as
  plain text and is never a link; `href` is an optional same-site address
  (the same rule as a page's), and when given the kind's name links to it;
  `width` is the review width of an email export.
- `labels`: `pagesHeading`, `exportsHeading`, `sheetHeading`, `none`, the
  `statuses` and `kinds` word for each, `exportWidth(width)` and
  `frameTitle({ page, state?, width })`. The view has no default wording.
- `widths` (default `[390, 1024, 1440]`): positive whole numbers; others throw.

Each section is named by its own `h2` through `aria-labelledby`, and a frame's
caption puts a text separator between the page and the state. An unknown
`status` throws. Entry text is rendered as text: no markup from an
entry is injected, and the frames use `loading="lazy"` and never `srcDoc`. The
view does not know whether it is running in development: gating it is the
caller's job (the site template does, see its README).

## `record` — the append-only publication ledger

`@clossys/publisher/record` is the return path: an append-only
record of what was published, to which channel, when, derived from which
revision of strategy, citing which facts — and a drift checker that answers
whether a cited fact still holds, without ever depending on
`@clossys/strategist`. It ships in the same install as the composer
half above — see "Why `publisher` is one package, not two," above — so there
is no separate `npm install` line here.

### Gate loops, reconciliation loops, and what this repository runs

`publisher` is two loops under one version, and only one of them is a gate.

**Gate loops** (`publisher-media-check`, `publisher-record-check` on a ledger
file plus a current-values map) evaluate a subject and return a verdict.
`npm run stage:strategist-writer-publisher` exercises both compiled CLIs
through their `dist` paths on injected red/control fixtures. That is honest
author-side staging evidence for the gates themselves: the executable
discriminates real violations from clean controls.

**Reconciliation loops** compare two records that can disagree. The record
half's reconciliation is not `checkLedgerDrift` alone — that function only
asks whether cited facts changed since publication, given a caller-supplied
`currentValues` map. Full publication reconciliation needs (1) a ledger entry
**emitted by the publish path** when something actually ships, and (2) an
**independent witness** of what the registry (or another system of record)
reports for the same `name@version`. Hand-writing the ledger in the same
script that runs the check produces two records with one source; that is the
house failure pattern the Foundry repository lifecycle contract refuses (that
write-up lives in that repository's source and is not included in this
package).

This package now ships the producer and the comparison as pure functions:

```ts
import {
  appendEntry,
  checkRegistryPublicationReconciliation,
  proposeRegistryPublicationEntry,
} from "@clossys/publisher/record";

const witness = {
  packageName: "@clossys/publisher",
  version: "1.0.0",
  tarballSha256: "<64-char hex from an anonymous registry read>",
  publishedAt: "2026-08-22T12:00:00.000Z",
};

const entry = proposeRegistryPublicationEntry({
  witness,
  strategyRevision: "<opaque publish-path identity, e.g. qualification id>",
});
const ledger = appendEntry([], entry);

const report = checkRegistryPublicationReconciliation(ledger, witness);
```

`asLedgerDriftSubject` pairs a ledger with a `currentValues` map for
`checkLedgerDrift` — the drift-check subject for fact citations, distinct
from registry reconciliation.

**What Foundry's own publish workflow does today:** retained publication
records plus anonymous registry parity checks compare candidate bytes against
an independent registry read. That reconciliation uses the repository's
governance schema, not a persisted `@clossys/publisher/record` ledger on
disk. Wiring the publish workflow to call `proposeRegistryPublicationEntry`
and persist the resulting ledger — or deliberately keeping `./record` as a
consumer-only contract — is a repository integration choice; this package
ships the contract either way and does not fake a reconciler gate in CI.

### Why this subpath exists

A prior, much larger attempt at this pipeline (strategy → brand → contracts
→ vocabulary → renderers, and a full measurement stack built alongside it)
never connected the two halves. That project's own `strategy` package
stated in its README and `package.json`, as policy: *"the arrow only goes
one way."* Grepping its entire measurement stack for the string `strategy`
returned **zero matches**. The rule itself is correct — brand must derive
from strategy, never the reverse, or the system launders opinion into fact
— but framing the *whole system* as a single arrow is why a return path was
never built at all. Nothing closed the loop from "we published this" back
to "does the thing we claimed still hold?"

The `record` subpath is that return path. Its discipline is the most important thing
about it, more than any function signature below:

> **It records what happened. It does not judge whether that was good.
> Nothing writes back automatically.**

Concretely:

- **This package does not depend on `@clossys/strategist`.** Every fact
  a `PublicationEntry` cites is a plain, opaque `factRef` string — the same
  seam `@clossys/writer/voice`'s `Claim.factRef`,
  `@clossys/writer`'s `CopyEntry.factRef`, and
  `@clossys/strategist`'s own `Market.factRefs`/`Audience.factRefs`
  already use one layer up. `@clossys/strategist` is not in this package's
  `dependencies`, and nothing in `src/` imports it. Resolving a `factRef`
  against a real fact registry — reading `@clossys/strategist`'s
  `readStrategy` bundle
  and reducing it to `{ [fact.key]: fact.value }` — is a caller's job,
  happening in code this package has no visibility into.
- **`checkLedgerDrift` has no opinion about whether an outcome is good.** There is no
  `score`, `threshold`, or `verdict` field on `PublicationEntry`, and no
  function here computes one. `checkLedgerDrift` answers exactly one
  question — has a cited fact's value changed since publication? — and
  stops there. Whether that drift matters, and what (if anything) to do
  about it, is a decision made by whatever reads this package's output,
  human or agent. This package supplies the evidence, never the verdict.
- **The loop closes through a decision, not an import.** Resist the pull
  toward "and then it could automatically…" — retract the page, alert
  strategy, open a ticket. That temptation is the exact failure this
  design exists to avoid: the moment `record` starts acting on drift
  instead of reporting it, it has quietly become a second, unaccountable
  strategy-setting mechanism.

### Usage

#### Recording a publication

```ts
import { appendEntry, citeFact, type Ledger, type PublicationEntry } from "@clossys/publisher/record";

let ledger: Ledger = [];

const entry: PublicationEntry = {
  id: "pricing-page-2026-08-07",
  publishedAt: new Date().toISOString(),
  channel: "web",
  url: "https://example.com/pricing",
  strategyRevision: "strategy@1.4.0",
  factCitations: [citeFact("active-customers", 4200)],
};

ledger = appendEntry(ledger, entry); // returns a NEW, deep-frozen ledger
```

#### Checking for drift

```ts
import { checkLedgerDrift } from "@clossys/publisher/record";
// readStrategy comes from @clossys/strategist — the caller's job, not this package's

const currentValues = { "active-customers": 5000 }; // read from the caller's own facts.json, not from this package

const report = checkLedgerDrift(ledger, currentValues);
if (!report.ok) {
  console.error(`Checked ${report.entriesChecked} entries, ${report.citationsChecked} citations: ${report.citationsDrifted} drifted.`);
  for (const f of report.findings) console.error(`[${f.severity}] ${f.rule}: ${f.message}`);
  process.exitCode = report.citationsDrifted > 0 ? 1 : 2;
}
```

Or from the shell, once built:

```bash
npx publisher-record-check ./ledger.json ./current-values.json
```

#### Guarding storage against a hand-edit

```ts
import { checkAppendOnly } from "@clossys/publisher/record";

const findings = checkAppendOnly(previousLedgerJson, nextLedgerJson); // e.g. base ref vs. head ref in a CI job
if (findings.length > 0) {
  for (const f of findings) console.error(`[${f.severity}] ${f.rule}: ${f.message}`);
  process.exitCode = 1;
}
```

Or from the shell, once built — the same `publisher-record-check` bin `checkLedgerDrift` uses, via its `append-only` subcommand:

```bash
npx publisher-record-check append-only ./previous-ledger.json ./next-ledger.json
```

### Why append-only

A ledger that can be silently edited after the fact is not evidence — it is
just another opinion with better formatting. This package enforces
append-only two ways, deliberately not one, because it owns no storage of
its own (see "Non-goals" below) and therefore cannot guarantee every write
goes through its own API:

1. **Structurally prevented, in process.** `appendEntry` is the only
   exported way to grow a `Ledger`. There is no `updateEntry` and no
   `removeEntry` anywhere in this package — not stubbed out, not marked
   deprecated, simply never written. `appendEntry` itself refuses (throws)
   to append an entry whose `id` already exists, so the one way this
   package's own API could be asked to "replace" an entry is refused
   outright. Every `Ledger` it returns, and every entry inside it, is
   deep-frozen — because this package ships ESM only (always strict mode),
   an attempt to mutate a returned entry throws a real `TypeError` rather
   than failing silently.
2. **Loudly rejected, at rest.** Nothing stops a ledger stored as, say, a
   JSON file checked into git from being hand-edited directly, bypassing
   `appendEntry` entirely. `checkAppendOnly` is built for exactly that gap:
   given two serialized snapshots of a ledger (a CI job's natural inputs
   are a base ref's copy and a head ref's copy), it fails loudly — a
   `LedgerFinding` per entry removed, reordered, or mutated — the moment
   `next` fails to be a pure, order-preserving superset of `previous`.

Chose **prevent** for in-memory use and **loudly reject** for at-rest use
because this package cannot own storage (see below) — there is no lock it
could hold on a consumer's git repository or database, only a check it can
run against whatever that storage produced.

### Why the drift checker fails closed

The whole point of `checkLedgerDrift` is answering "is this still true?"
honestly — and an honest answer requires being just as clear about *what
was not checked* as about what was. A checker that quietly narrows its own
coverage and reports the narrowed result as a clean pass is a check that
passes while asserting nothing, and this repository has hit that exact
failure mode before. `checkLedgerDrift`'s `DriftReport` always carries
`entriesChecked`/`citationsChecked`/`citationsUnchecked`/`citationsDrifted`
— never just a boolean — and `ok` is `false`, with an explicit finding, for
every one of these:

- The ledger itself does not validate (`"ledger-invalid"`).
- The ledger has zero entries (`"empty-ledger"`) — the literal "nothing to
  check" case.
- The ledger has entries, but zero of their citations end up compared to a
  current value — either every citation lacked a supplied current value,
  or no entry cited any fact at all (`"no-citations-checked"`). This is the
  harder case: a *non-empty* ledger that still verified nothing, and the
  one a naive `ok: citationsDrifted === 0` implementation would silently
  report as clean.

A citation with no current value supplied is still reported
(`"fact-unchecked"`, `"warning"`) but does not by itself flip `ok` to
`false` — a caller with partial `currentValues` coverage gets an honest
partial result, visible in the counts, not an all-or-nothing gate.

### Non-goals

- **No I/O.** Every function in this package — `validateEntry`,
  `validateLedger`, `canonicalizeValue`, `citeFact`, `appendEntry`,
  `checkAppendOnly`, `checkLedgerDrift` — is pure. This package does not
  read a file, does not know what a real ledger's storage looks like (a
  JSON file, a database row, a git-committed document), and does not
  decide where a `Ledger` lives long-term. Only `cli.ts` (not part of the
  library's exported surface — see the exports reference below) does any filesystem
  work, and only to read the two JSON files `publisher-record-check` is pointed at.
- **No fact registry.** This package never resolves a `factRef` against
  anything. It does not know what a real fact is, does not validate that a
  `factRef` names one that exists, and does not import
  `@clossys/strategist` to find out. See "Why this package exists"
  above.
- **No judgement.** `checkLedgerDrift` reports drift; it does not decide
  whether drift matters, does not retract anything, does not notify
  anyone, and does not write anything back to a ledger or to strategy. Any
  of those is a decision for the human or agent reading this package's
  output to make deliberately, not something this package should do on
  its own initiative.

### `record` — exports and the CLI

| Export | Kind | Purpose |
| --- | --- | --- |
| `PublicationEntry` | type | One append-only record: `id`, `publishedAt` (ISO 8601 instant), `channel` (a plain string — not `@clossys/publisher/core`'s closed `Channel` vocabulary; a real publication channel is broader than the composer half's five render targets), optional `url`, `strategyRevision` (an opaque string naming the revision of strategy this was derived from), `factCitations: FactCitation[]`, and an optional `contentBinding: PolicyBinding` committing to the published artifact's own bytes. No score, threshold, or verdict field — see "Why this package exists". |
| `FactCitation` | type | `{ factRef: string; valueBinding: PolicyBinding }` — one fact a `PublicationEntry` cites, bound to that fact's value at publication time. `factRef` is opaque, the same seam `@clossys/writer/voice`'s `Claim.factRef` uses. `valueBinding.policyId` always equals `factRef`, enforced by `validateEntry`'s `"citation-policy-id-mismatch"` rule and by construction in `citeFact`. |
| `Ledger` | type | `readonly PublicationEntry[]` — nothing more than an ordered, append-only list. |
| `LedgerFinding` | type | `{ rule, severity: "error" \| "warning", message, path? }` — this package's own finding shape, deliberately the same shape as `@clossys/controller/policy`'s `Finding` (kept as a separate local type, never pulled in from there) and every sibling `*Finding` type across this foundation. |
| `DriftReport` | type | What `checkLedgerDrift` returns: `ok`, `entriesChecked`, `citationsChecked`, `citationsUnchecked`, `citationsDrifted`, `findings: LedgerFinding[]`. See "Why the drift checker fails closed". |
| `PolicyBinding` | type | Re-exported directly from `@clossys/controller/policy`, unchanged, so a consumer never needs its own dependency on `policy` just to read the type `FactCitation.valueBinding`/`PublicationEntry.contentBinding` return. |
| `DigestAlgorithm` | type | Re-exported from `@clossys/controller/policy` — currently just `"sha256"`. |
| `PolicyFinding` | type | `@clossys/controller/policy`'s own `Finding` type, re-exported under a name that does not collide with this package's own `LedgerFinding` when both are named in one statement. |
| `validateEntry(value, path?)` | function | Structural validation of a single `PublicationEntry`: is `id`/`channel`/`strategyRevision` a non-empty string, is `publishedAt` a full ISO 8601 UTC instant, is `url` (when present) a parseable URL, is every `factCitations[i]` a well-formed `FactCitation` (delegating the `valueBinding` shape check to `@clossys/controller/policy`'s own `validateBindingShape`), is `contentBinding` (when present) a well-formed `PolicyBinding`. Returns `LedgerFinding[]`; empty means valid. Never throws. |
| `validateLedger(value)` | function | Validates a whole `Ledger`: must be an array, every element must pass `validateEntry`, every `id` must be unique across the array (`"duplicate-entry-id"` — what an attempted overwrite looks like when it bypasses `appendEntry`). An empty array is a valid *shape* — `validateLedger([])` returns `[]`; `checkLedgerDrift` is what treats an empty ledger as a failure, since "is this ledger well-formed" and "did this check verify anything" are different questions. |
| `canonicalizeValue(value)` | function | Deterministically stringifies a JSON-serializable `value` (string, finite number, boolean, `null`, plain object, array — recursively) so that structurally equal values always canonicalize identically regardless of object-key order. Used by `citeFact` (to digest a fact's value) and `checkAppendOnly` (to compare two entries for real content equality, not just reference equality). Throws on a non-finite number, a function, or a `Symbol` — a producer-side error, the same precedent `@clossys/controller/policy`'s `computeDigest` sets for an unsupported algorithm. |
| `citeFact(factRef, value, algorithm?)` | function | Builds a `FactCitation`: computes `canonicalizeValue(value)`'s digest under `algorithm` (default `"sha256"`) via `@clossys/controller/policy`'s own `computeDigest`, and returns `{ factRef, valueBinding: { policyId: factRef, digestAlgorithm, digest } }`. This package's first real use of `@clossys/controller/policy` outside `policy` itself. Throws on an empty `factRef` or a `value` `canonicalizeValue` cannot handle. |
| `appendEntry(ledger, entry)` | function | The one sanctioned way to grow a `Ledger`. Throws (never returns a `LedgerFinding[]`) on a malformed `entry` or an `entry.id` that already exists in `ledger` — both are caller programming errors at the point of the call, the same distinction `computeDigest` draws. Returns a **new**, deep-frozen `Ledger`; `ledger` itself, and every entry already in it, is left completely untouched. |
| `checkAppendOnly(previous, next)` | function | The at-rest complement to `appendEntry`. Pure diff between two `unknown` values, each validated with `validateLedger` first. Reports `"entry-removed"`, `"entry-reordered"`, or `"entry-mutated"` (compared via `canonicalizeValue`, so a harmless JSON-key-order round-trip is never mistaken for a real change) for anything in `previous` that `next` fails to preserve exactly, in the same position; `"entries-removed"` once, up front, if `next` has fewer entries than `previous`. An empty return means `next` is a valid append-only evolution of `previous`. |
| `checkLedgerDrift(ledger, currentValues)` | function | The drift checker: for each `FactCitation` in `ledger`, compares its recorded `valueBinding` against `currentValues[citation.factRef]` (canonicalized, then run through `@clossys/controller/policy`'s own `verifyBinding` — no digest-comparison logic reimplemented here) and reports a `"fact-drift"` finding on mismatch. `currentValues` is a plain `factRef -> value` map — this function never reads a real fact registry or depends on `@clossys/strategist`. Fails closed on an invalid ledger, an empty ledger, or a non-empty ledger where nothing ends up checked — see "Why the drift checker fails closed". |
| `JoinKeyReport` | type | What `checkJoinKeyCompleteness` returns: `ok`, `liveEntriesChecked`, `completeLiveEntries`, `incompleteLiveEntries`, `identities: JoinKeyIdentity[]`, `findings: LedgerFinding[]`. Mirrors `DriftReport`'s counted shape for the same reason — "checked nothing" and "checked everything and it held" must never print as the same result. |
| `JoinKeyIdentity` | type | `{ contentId: string; windows: Array<{ entryId, publishedAt, supersededAt? }> }` — one content identity with every window it has been published under, in `publishedAt` order. Exposed on the report so a caller can assert on the grouping directly rather than infer it from a pass or fail. |
| `checkJoinKeyCompleteness(ledger)` | function | For everything the ledger currently says is live, is enough recorded here for someone else — an observer-shaped tier holding external engagement signals, never this package — to attribute a signal to the right revision of the right surface? Reports `"join-key-missing-identity"` (a live entry with no `contentId`), `"join-key-window-invalid"` (a `supersededAt` that does not actually close a window), and the cross-entry `"join-key-identity-churn"`. Emits and checks for a KEY only, never a verdict about whether a signal is good — see "Why this package exists". Fails closed on an invalid ledger, an empty ledger, or a ledger with zero live entries. |
| `proposeRegistryPublicationEntry(input)` | function | Publish-path ledger producer: builds one `PublicationEntry` for a scoped `name@version` from an independent `RegistryPackageWitness`. Pure; the caller appends with `appendEntry`. |
| `checkRegistryPublicationReconciliation(ledger, witness)` | function | Reconciliation loop for registry packages: compares the ledger entry for `witness.packageName@witness.version` against the witness tarball digest. Not a gate over arbitrary trees. |
| `asLedgerDriftSubject(ledger, currentValues)` | function | Validates and pairs the drift-check subject (`checkLedgerDrift`'s two inputs). |
| `registryPublicationEntryId(packageName, version)` | function | Stable entry id (`@scope/pkg@1.2.3`) used by the producer and reconciliation check. |

`publisher-record-check` (the CLI, installed as a `bin` when this package is
installed — its argv-handling `cli.ts` is deliberately not part of the
exports above, the same convention `@clossys/strategist`'s
`strategist-check` and `@clossys/writer`'s `writer-check` already
set) has two invocations, dispatched on the literal first `argv` token —
never on the invoked binary's path or filename, since this repository
always invokes a gate by its compiled path (`node .../dist/cli.js`), and a
filename-keyed dispatch would always see `cli.js`:

The default (no subcommand) invocation reads a ledger JSON file and a
current-values JSON file, runs `checkLedgerDrift`, and prints a report:

```bash
npx publisher-record-check ./ledger.json ./current-values.json
```

Exit codes: `0` clean (something was checked, nothing drifted), `1` at
least one cited fact has drifted, `2` could not run — bad arguments, a file
missing/unreadable/not valid JSON, an invalid or empty ledger, or a ledger
whose citations could not be compared against any current value. `1` and
`2` are kept strictly distinct on purpose: "found a real problem" and
"could not check" must never look like the same failure to a CI job
branching on the exit code.

The **`append-only` subcommand** reads two ledger JSON files — a
`previous` and a `next`, e.g. a base ref's copy and a head ref's copy in a
CI job — and runs `checkAppendOnly`:

```bash
npx publisher-record-check append-only ./previous-ledger.json ./next-ledger.json
```

Exit codes follow the same three-state shape: `0` — `next` verified as a
valid, order-preserving append-only evolution of `previous`, over at least
one entry in `previous`; `1` — a real violation (an entry in `previous` was
removed, reordered, or mutated in `next`); `2` — could not evaluate — bad
arguments, a file missing/unreadable/not valid JSON, either ledger failing
its own shape validation, or `previous` having zero entries. Zero entries
is deliberately its own `2`, not folded into `0`: `checkAppendOnly` reports
no findings at all for an empty `previous` (there is nothing in it that
could have been altered), so the CLI checks `previous`'s entry count itself
rather than treating "no findings" alone as proof anything was verified —
"checked nothing" and "checked everything and it held" must stay
distinguishable, the same discipline `checkLedgerDrift`'s empty-ledger case
already holds this CLI to above.

The **`join-key` subcommand** reads one ledger JSON file and runs
`checkJoinKeyCompleteness`:

```bash
npx publisher-record-check join-key ./ledger.json
```

Exit codes, same three-state shape again: `0` — every currently-live entry
carries a complete join key, verified over at least one live entry; `1` — a
live entry is missing its content identity or its window is not
interpretable, or two entries at the same address disagree on identity; `2`
— could not evaluate: bad arguments, a file missing/unreadable/not valid
JSON, an invalid or empty ledger, or **zero entries currently live**. That
last case is deliberately a `2` rather than a `0`, for the same reason
`append-only`'s empty-`previous` case is: a ledger that has retired
everything it ever recorded produces no findings, and "nothing live to
check" must never read as "publishing here is cleanly governed".

Liveness is derived, not read off a field. This package is append-only, so
an already-recorded entry can never be reached back into and marked no
longer current once a successor ships; `supersededAt` is therefore often
absent even on an entry that is, in fact, retired. Entries are grouped by
`contentId`, the latest `publishedAt` in each group is the live candidate,
and it stays live unless it carries a well-formed `supersededAt` strictly
after its own `publishedAt`. An entry with no `contentId` cannot be grouped
against anything, so it is always treated as live — the same fail-closed
choice `checkLedgerDrift` makes for a citation it could not check.

## The pack

`@clossys/publisher/pack` is the v0 Launch pack contract (issue #1204).
Publisher owns the pack: its definition, inventory, readiness, and sealing.
Strategist, Designer, Writer, and Customer own the content and judgments
that feed it. Publisher plans first — it declares each item's `needs` and
those needs pull the required foundation and identity items from their
owners — and seals last, once a Customer keep approves a surface.

The pack is MECE by layer:

| Layer | Item | Content owner |
| --- | --- | --- |
| Foundation | Strategy brief | Strategist |
| Identity | Brand kit | Designer |
| Identity | Voice and messaging | Writer |
| Surface | Website, materials site, email kit, social kit, video-call backgrounds | assembled by Publisher |

`clossys/publisher/pack.json` records, for each item: a pack `status` that
specializes the one shared lifecycle, and a `condition` from it (issue
#1228 — see below), a `v<major>.<minor>` version, `createdAt`/`updatedAt`/`approvedAt`/
`verifiedAt` timestamps, content-fingerprint source pins, output paths,
where it published, and its single next action.

### Lifecycle vocabulary (#1228)

Pack items do not declare a second, pack-specific lifecycle. An item's
`status` is one of the six pack statuses, `PACK_STATUSES`, and each one
resolves to one of the six states the loop engine uses, `LIFECYCLE_STATES`,
through `packStatusToLifecycle`. An item's `condition` is one of the shared
`LIFECYCLE_CONDITIONS`:

- **Pack statuses (`PACK_STATUSES`):** `absent`, `found`, `draft`,
  `in-review`, `kept`, `published`.
- **Shared states (`LIFECYCLE_STATES`):** `absent`, `found`, `draft`,
  `approved`, `verified`, `retired`.
- **Conditions (`LIFECYCLE_CONDITIONS`):** `current`, `stale`, `blocked`.

`absent`, `found`, and `draft` map onto the shared state of the same name.
The other three specialize one: `in-review` is `draft` with a pending
judgment, `kept` is `approved` (the Customer keep), and `published` is
`verified` (sealed and verified live). No pack status maps to `retired`.
Write a pack status, not a shared state, into `pack.json`:
`validatePackManifest` reports `"approved"` as an `invalid-status` finding.

This package declares no copy of either list. `@clossys/publisher/pack`
imports `PACK_STATUSES`, `LIFECYCLE_STATES`, `LIFECYCLE_CONDITIONS`, and
`packStatusToLifecycle` from `@clossys/controller`, which first exports them
in 0.9.14, and re-exports them unchanged. `@clossys/publisher/materials`
also takes its `PackStatus` and `LifecycleCondition` types from there.

### Adopt, don't override

`detectExistingPackItems` is `sense`: it fingerprints (sha256) whatever a
candidate path already holds and registers it `found`, never assuming a
missing item and generating over whatever is actually there. Nothing here
deletes, overwrites, or judges quality — a caller decides what a `found`
registration means for the surrounding manifest, and `foundPackItem` builds
the minimal fresh item record for it.

### Readiness and sealing

`computePackReadiness` derives per-item readiness from the `needs` graph: an
item is ready once every item it needs is itself `approved` or `verified`
and none of them is `blocked` — a missing or unknown need is never silently
treated as satisfied. `planPackOrder` gives the plan a foundation-first,
surfaces-last topological order over the same graph. `sealableItemIds`
answers "what may move from `approved` to `verified` right now": already
approved, not blocked, and every needed item already verified — sealing
itself (writing `verifiedAt` and a publication record) is the caller's job.

`validatePackManifest` is the schema and contract gate: known layers,
owners, visibilities (`internal`/`public` — see the materials site section
below), lifecycle values, version shape, a needs graph free of unknown
references and cycles, timestamp ordering, and no premature `approvedAt`/
`verifiedAt`/`publishedTo` on an item that has not reached that stage yet.

### Importing a v0 pack

An earlier pack index can be imported into a valid `pack.json`.
`LegacyV0Pack` is the documented input type: `{ items }` with one entry for
each of `brief`, `brandKit`, `voice`, `shareCard`, `email`, and `website`
(other top-level keys are ignored). Each entry is
`LegacyV0PackItem`: `{ status, iteration: "v0", approvedAt?, updated?, notes? }`,
where `status` is `LegacyV0PackStatus` (`draft`, `delegated`, or `approved`)
and `delegated` means delegated approval, pending the owner's review.
`LegacyV0PackKey` names the six keys, and `LEGACY_V0_PACK_ITEMS`
(`LegacyV0PackItemSpec` entries, in order) maps each key to its pack item id,
layer, owner, visibility, and `needs`.

`importLegacyV0Pack(value)` is pure. It returns
`LegacyV0PackImportResult`: `{ ok: true, manifest }` or
`{ ok: false, issues }`, where each `LegacyV0PackIssue` is a `path` and a
`message` that never repeats the input's value.

- `draft` becomes `draft`, `delegated` becomes `in-review`, and `approved`
  becomes `kept`. No item becomes `published`.
- An `approved` item needs `approvedAt`; a `draft` or `delegated` item that
  carries one is refused.
- Timestamps are `YYYY-MM-DD` (written as `T00:00:00Z`) or a UTC timestamp;
  any other form and any impossible date is refused. `updated` becomes
  `updatedAt`, and `notes` is dropped.
- A missing or extra item, an unknown key inside an item, an unknown status,
  or an `iteration` other than `"v0"` is refused by path, as is any finding
  from `validatePackManifest` on the result.

`writeLegacyV0PackImport(rootDir, value)` returns `LegacyV0PackWriteResult`
and writes the manifest to `LEGACY_V0_PACK_OUTPUT_PATH`
(`clossys/publisher/pack.json` under `rootDir`). It writes nothing when the
import is refused or the file already exists.

```ts
import { importLegacyV0Pack } from "@clossys/publisher/pack";

const result = importLegacyV0Pack({
  items: {
    brief: { status: "approved", iteration: "v0", approvedAt: "2026-09-20" },
    brandKit: { status: "delegated", iteration: "v0" },
    voice: { status: "draft", iteration: "v0" },
    shareCard: { status: "draft", iteration: "v0" },
    email: { status: "draft", iteration: "v0" },
    website: { status: "draft", iteration: "v0" },
  },
});
if (!result.ok) throw new Error(result.issues.map((issue) => issue.path).join(", "));
console.log(result.manifest.items.length);
```

### Reviewing a pack

`buildPackReviewIndex(manifest, { routes, states })` enumerates what a review
visits, for [`PackReviewView`](#packreviewview). It is pure and returns
`PackReviewIndexResult`: `{ ok: true, index }` or `{ ok: false, issues }`,
where each `PackReviewIssue` is a `rule` and a `path`, never a value from the
input.

- **Pages** are the `routes` the caller lists, in order, each with the
  `states` (kebab-case slugs) the caller declares for it. Each carries the
  `website` item's badge; a pack with no `website` item reports `draft`.
- **Exports** come from `outputPaths` of `share-card` (an `og-image`),
  `brand-kit` (`favicon`, `app-icon`, `logo`, or `other`, by file name) and
  `notification-email` (an `.html` output is listed at 600 and 375 px, as
  `email-html`, and a `.txt` output is `email-text`), in that order. A
  directory output (a trailing `/`) is not an export. Each carries the badge of
  its own item.
- `packReviewStatus(status)` folds a pack status onto `draft`, `delegated` or
  `approved`: `absent`, `found` and `draft` are `draft`, `in-review` is
  `delegated`, and `kept` and `published` are `approved`.
  `PACK_REVIEW_WIDTHS` (390, 1024, 1440) and `PACK_REVIEW_EMAIL_WIDTHS` (600,
  375) hold the widths.
- A manifest that does not pass `validatePackManifest`, an output path that is
  not a plain relative path (a leading `/`, a `..` or empty segment, a
  backslash, a scheme, a query or a control character), and a route or state
  that is not a plain path or slug are all refused.

```ts
import { buildPackReviewIndex } from "@clossys/publisher/pack";
import type { PackManifest } from "@clossys/publisher/pack";

declare const manifest: PackManifest; // read from clossys/publisher/pack.json

const result = buildPackReviewIndex(manifest, {
  routes: [{ id: "/" }, { id: "/contact" }],
  states: { "/contact": ["idle", "accepted"] },
});
if (!result.ok) throw new Error(result.issues.map((issue) => issue.rule).join(", "));
console.log(result.index.pages.length, result.index.exports.length);
```

### Sealing a website

A website item moves from `kept` to `published` only on evidence. The caller
supplies the evidence; Publisher checks it and never calls a provider. Only
the pack's `website` item can be sealed, and only on evidence that names it.

`WebsiteSealEvidence` (`schemaVersion: 1`) is one bundle:

- `itemId`: the pack item the evidence was taken for. It must equal the item
  being sealed.
- `commit`: the 40-hex commit being sealed, and `observedAt`, when the
  evidence was taken. `observedAt` must be a real calendar date and time:
  `2026-09-31T00:00:00Z` is refused as a bad shape.
- `delivery`: `{ state: "ready", deployedCommit, productionUrl }`, with an
  `https` production URL in canonical form: exactly the string
  `new URL(productionUrl).href` writes, with no username or password. A URL
  that carries a username or password, or any non-canonical spelling (a
  backslash, an empty userinfo, a control character or space, an upper-case
  scheme or host, a default port, no path, dot segments), is refused as
  `production-url-shape`, because the value is written as given to the ledger
  `url` and the manifest `publishedTo` and other URL readers parse those
  spellings differently. A path, query string or fragment is not refused when
  it is already canonical; one with a character the parser would
  percent-encode (a double quote, an angle bracket, a raw space, a non-ASCII
  character) is refused.
- `pages`: one `WebsiteSealPage` per observed page, each
  `{ path, status, servedCommit, desktopDigest, mobileDigest }`, the digests
  being sha256 hex.
- `contactIntake` (`WebsiteSealContactIntake`): either
  `{ kind: "present", path, submissionDigest }` or
  `{ kind: "none", reason }`. It is always stated; a missing value is refused
  and `none` needs a non-empty `reason`.

`checkSealEvidence(evidence, { map, now, itemId })` returns `SealFinding[]`,
each a `rule` and a `path`, and never throws. `itemId` is required: the
evidence's own `itemId` must equal it, and a missing or empty `itemId` is
refused as `item-id-invalid`. It refuses when:

- the evidence's `itemId` is missing, or differs from the item being sealed;
- `delivery.state` is not `ready`, or `deployedCommit` differs from `commit`;
- a path on the `PublicationMap` has no page, or a page is not status 200, or
  its `servedCommit` differs from `commit`;
- a digest is not sha256 hex;
- `observedAt` is in the future or more than 24 hours before `now`;
- `contactIntake` is missing or malformed, or the map has no path entries.

There is no waiver flag, option, or environment switch. A finding never
repeats any text from the input: it names a fixed rule and a fixed field path
or array index such as `pages[1].servedCommit`. A successful seal does return
the entry id, which is derived from the item id and the commit.

`sealWebsite({ manifest, ledger, itemId, evidence, map, now, strategyRevision })`
is pure and returns `SealWebsiteResult`: `{ ok: true, manifest, ledger, entryId }`
or `{ ok: false, findings }` (`resumed` is explained below). It refuses unless the evidence is clean, `itemId`
is `website` and in `sealableItemIds(manifest)`, and the item is `public`
(`item-not-website` otherwise). On accept the item
is `published` with `verifiedAt` set to `now` and `publishedTo` set to the
production URL, and the ledger gains one `web` entry through `appendEntry` with
id `website-<itemId>-<first 12 of commit>`; the inputs are not changed. Sealing
the same commit again is refused as `seal-already-recorded`, and a refusal
returns no manifest or ledger.

One existing entry is finished instead of refused. A run stopped after its
ledger write and before its manifest write leaves the ledger ahead of a
manifest whose item is still `kept`. If the ledger entry is identical to the
one this evidence would record (same id, `web` channel, url and strategy
revision, no fact citations, and a `publishedAt` that is a real instant not
before the evidence's `observedAt` and not after `now`) and every other check passes on the current evidence, the result
is `{ ok: true, resumed: true }`: the ledger is returned as given and the
manifest item is `published` with `verifiedAt` set to the entry's
`publishedAt`. An entry that differs in any of those is
`seal-already-recorded`, and stale evidence is still refused.

The `publisher-seal` command runs it over files:

```sh
publisher-seal clossys/publisher/pack.json clossys/publisher/record.json evidence.json map.json \
  --item website --strategy-revision rev-1
```

It exits 0 when it sealed and wrote both files, 1 when it refused and wrote
nothing, and 2 when it could not run: a missing or unreadable file, invalid
JSON, a manifest, ledger, or map that is not itself valid, a manifest or
ledger that is a symbolic link or has a second hard link, the manifest and
ledger being one file under two spellings of its directory, a lock held by
another run or one that could not be created, a file that changed while the run
was deciding, a failed write, or bad arguments.

The seal is made at the current time. There is no `--now`: a settable time
would let a caller backdate the 24 hour evidence window, so passing it is an
unknown flag and exits 2.

Nothing is written before the gate has accepted. Then the command takes
`<name>.seal.lock` on the manifest and the ledger, created exclusively in the
real directory of each file (the directory is resolved first, so two spellings
of one directory, such as a symbolic-linked parent, contend for the same lock),
re-reads both, and refuses if either changed since the gate looked. Only an
existing lock is reported as another run holding it; any other failure to
create the lock is reported with its own error code. It writes each output,
and a copy of the previous ledger, to a temp file created exclusively with the
permissions of the file it replaces, then renames the ledger first and the
manifest second. If the manifest rename fails, the previous ledger is renamed
back and the run can be repeated; if that fails too, the error says the ledger
was written and names the file that holds the previous ledger.

A run that is stopped between the two renames leaves the ledger ahead of the
manifest, both lock files, and a restore copy of the previous ledger. Remove
the two `.seal.lock` files once no run is active, then run the same command
again with the same evidence and `--strategy-revision`. The ledger already
holds the identical entry and the item is still `kept`, so the command leaves
the ledger alone, writes only the manifest (its `verifiedAt` is the entry's
`publishedAt`), prints that the entry was already recorded, and exits 0. The
restore copy can then be deleted. If the entry differs, the run is refused as
`seal-already-recorded` and changes nothing. A run removes only the temp and
lock files it created.

Known limit: the evidence is supplied by the caller. The commit and the host it
names are checked against each other and against the clock, but not against an
independent source, so a caller that supplies false evidence can still seal.
The production URL check refuses credentials and non-canonical spellings only;
it does not inspect the path, the query string or the fragment, so a secret
placed in any of them by the caller is written to the ledger and the manifest
as given.

```ts
import { checkSealEvidence } from "@clossys/publisher/pack";

const commit = "b".repeat(40);
const digest = "a".repeat(64);
const findings = checkSealEvidence(
  {
    schemaVersion: 1,
    itemId: "website",
    commit,
    observedAt: "2026-09-30T11:00:00Z",
    delivery: { state: "ready", deployedCommit: commit, productionUrl: "https://www.example.test/" },
    pages: [{ path: "/", status: 200, servedCommit: commit, desktopDigest: digest, mobileDigest: digest }],
    contactIntake: { kind: "none", reason: "the site has no contact form" },
  },
  {
    map: { entries: [{ id: "home", template: "landing", documentId: "doc-home", location: { kind: "path", path: "/" } }] },
    now: "2026-09-30T12:00:00Z",
    itemId: "website",
  },
);
console.log(findings.length === 0 ? "ready to seal" : findings.map((finding) => `${finding.rule} ${finding.path}`));
```

### Rendered head lint

`lintRenderedHead({ siteName, pages })` checks the head of already rendered
pages (`pages` is `{ path, html }[]`, `path` being the route) and returns
`SealFinding[]`, each a `rule` and a `path` that is a route or `<route>#<tag>`
(for example `/about#og:image`). It is pure, never throws, and a finding never
repeats a title, URL or description taken from the HTML. Scanning is tolerant:
attribute order and quote style do not matter, comments and `<script>`/`<style>`
bodies are ignored, a few character references are decoded, and a value that is
blank after trimming counts as missing. It stops at `</head>` or `<body`.

Rules:

- `head-missing`: a page lacks one of `<title>`, meta `description`, `robots`,
  `theme-color`, `link rel=canonical`, `og:title`, `og:description`, `og:url`,
  `og:image`, `og:site_name`, `twitter:card`, `twitter:title` or
  `twitter:image` (path `<route>#<tag>`).
- `title-format`: the title is not `<siteName> · <tagline>` on route `/` or
  `<label> · <siteName>` on any other route. The separator is U+00B7 with one
  space on each side, used once.
- `title-separator`: the title uses `|` or a dash where the separator belongs.
- `title-duplicate`: the head has more than one `<title>`.
- `canonical-duplicate`: the head has more than one `link rel=canonical`.
- `head-title-mismatch`: any `og:title` or `twitter:title` value differs from `<title>`.
- `canonical-path`: the canonical pathname is not the route (a trailing slash
  is ignored).
- `canonical-origin`: the canonical URL is not absolute `http(s)`, or its origin
  differs from the first page's.
- `input-invalid`: `siteName` is blank, `pages` is not an array or is empty
  (path `input` or `pages`), or a page's `path` is not a non-empty string
  starting with `/` (path `pages[<index>]`).

The `publisher-head-lint` command runs it over a directory:

```sh
publisher-head-lint dist/site --site-name "Example Co"
```

It reads every `.html` file under the directory (`index.html` maps to its
directory's route, `a.html` to `/a`), skips symbolic links, and writes nothing.
It exits 0 when clean, 1 with one `<rule> <path>` line per finding, and 2 when
it could not run: bad arguments, or a missing, empty or unreadable directory.

```ts
import { lintRenderedHead } from "@clossys/publisher/pack";

const findings = lintRenderedHead({
  siteName: "Example Co",
  pages: [{ path: "/about", html: "<html><head><title>About | Example Co</title></head><body></body></html>" }],
});
console.log(findings.map((finding) => `${finding.rule} ${finding.path}`));
```

## Surface documents move to Publisher

Issue #1205: Publisher authors the in-tree `SectionedView`/`MarketingView`
page document — which template, which sections, which copy ids and asset
ids, all by reference — under `clossys/publisher/surfaces/`. Designer and
Writer own everything a surface document references (tokens, atoms, blocks,
copy) in their own folders; they propose changes and review renders, but
they never edit a Publisher surface file directly. Every file under
`clossys/` now has exactly one owner.

`@clossys/publisher/surfaces` exports `PUBLISHER_SURFACES_DIR` (Publisher's
own record of the path it owns) and `validateSurfaceOwnership`, a pure
check — the same shape as `checkWebRoutes.ts`'s `evaluateWebRouteManifest`
— over a flat list of `{ path, owner }` ownership claims (normally assembled
from every role's own folder manifest under `clossys/`). It flags any path
more than one role claims, and any path under `clossys/publisher/surfaces/`
that Publisher itself never claimed.

The shared consumer layout contract (issue #1171) lists
`clossys/publisher/surfaces` as a Publisher-owned folder, and this package's
`package.json` declares it under `foundry.outputs` and `foundry.feeds`
(Customer judges the surfaces Publisher feeds it). `PUBLISHER_SURFACES_DIR`
is the runtime value of the same path; the two must agree. A gate that
checks one owner per file across every role's folder under `clossys/` is
still a follow-up.

## Materials site

`@clossys/publisher/materials` is the materials mini-site (issue #1206):
company overviews (short/medium/long) and pitch decks (with audience
variants), rendered as a browsable, print-friendly static HTML site. This
subpath does not re-author document or slide content — `@clossys/
publisher/document` and `@clossys/publisher/slides` already render a
`StructuredDocument`/`SlidesDeckInput` to HTML/SVG. It takes their
already-rendered output and does the work specific to the materials site:

- `renderMaterialsIndexHtml(entries)` — the browsable index, listing every
  overview and deck version with its status, condition, version, and
  last-published time, read from the pack manifest (#1204).
- `selectAudienceVariant(deck, selections, audience)` /
  `declaredAudiences(selections)` — one source deck, filtered to an
  audience's declared slide selections (#1206: "share one source and
  differ only by declared selections"). A slide with no declared audience
  is shown to every variant.
- `renderPitchDeckHtml(result, options)` — wraps `renderSlidesDeck`'s own
  rendered SVG slides into one self-contained HTML page with keyboard
  navigation and the shared print stylesheet (one slide per printed
  page) — #1206: "HTML slides with keyboard navigation," "no built-in PDF
  pipeline — a print stylesheet makes browser print-to-PDF clean."
- `materialsPrintStylesheet()` — the shared `@media print` rules both the
  deck shell and a company-overview page use.
- `checkMaterialsVisibility(input)` / `MATERIALS_DEFAULT_VISIBILITY` —
  issue #1206's owner decision that materials are internal by default and
  that committing one to a public repository publishes it ("git is a
  publication channel too"). This is the refusal check a caller runs
  before a commit, turning the item `blocked` rather than letting it
  reach a public tree.

**This site is never deployed and never committed to a public repository.**
It is an internal working artifact, opened locally like a PDF and
re-rendered by Publisher; nothing in this subpath writes to a public
domain or a public git remote.

## Templates and channel specs

`@clossys/publisher/templates` is the pack's opinionated defaults (issue
#1207), so every client starts from the same expert baseline rather than
21 hand-made approximations:

- `COMPANY_OVERVIEW_TEMPLATES` / `overviewSectionIds(length)` — the
  default section order for the short/medium/long company overview
  (#1206's own three lengths).
- `PITCH_DECK_SLIDE_ORDER` / `PITCH_DECK_DEFAULT_AUDIENCE_SELECTIONS` —
  the default slide order and a starting audience-selection map (see
  "Materials site," above, for the selection mechanism itself).
- `buildEmailSignatureHtml(person)` / `buildEmailSignatureText(person)` —
  a table-based HTML signature (the same hand-built-HTML discipline
  `@clossys/publisher/email` documents) plus its plain-text alternative,
  from a person's name/role/company/links/logo.
- `SOCIAL_CHANNEL_SPECS` / `getSocialChannelSpec(channel)` — image sizes
  and text limits for LinkedIn, X, Instagram, Facebook, YouTube, TikTok,
  and GitHub, each with a `verified` date. `OG_SHARE_CARD_SPEC` is the
  default Open Graph card size.
- `VIDEO_CALL_BACKGROUND_SPECS` / `getVideoCallBackgroundSpec(platform)` —
  Zoom, Google Meet, and Microsoft Teams background dimensions.
- `staleChannelSpecEntries(now, staleAfterDays)` — every channel spec
  entry whose `verified` date has gone stale, so periodic re-verification
  against each platform's current guidance (#1207's own requirement) has
  something concrete to check.

This subpath ships no PNG export command of its own yet — a real raster
export (social, OG, video-call backgrounds) is a Publisher export command;
left as a followup (see the PR that introduced this subpath for why).
`publisher-preview` (see "Preview gallery," below) does render one SVG per
entry here, but only as a rendered fixture to browse, not an export path a
consumer's own build would call.

## Site template (`apps/site`)

Issue #1208: a Next.js App Router template that ships in this package's
`templates/site/` directory (`files` includes `templates`, so it is part
of the published tarball) — **not compiled, typechecked, or tested by
this repository's own build**, the same way `packages/designer/templates/
brand-type.template.json` is shipped-but-not-compiled content. Launcher
(#1215) copies it into a product repository's own `apps/site`; see
`templates/site/README.md`, shipped alongside it, for the full file list
and what each page reads from that repository's own `clossys/` records.

## Preview gallery (`publisher-preview`)

```
publisher-preview <brand.css> <output-directory> [roster.json]
```

The Launch pack's v0 preview: every off-the-shelf boilerplate view a
consumer relies on until they build custom views, rendered against one
real `brand.css` after Designer's brand-file coverage check passes, into
one flat output directory whose `index.html` links every file written.
Nothing here makes a network call, and the same inputs always produce
byte-identical output. Exit codes are unchanged: `0` = output written,
`1` = the brand file or roster failed its own check (nothing is written),
`2` = bad arguments or an unexpected error.

What it renders, all from fixture copy in `src/preview/fixture-copy-
registry.ts` (never hardcoded in a renderer):

- **Web views** (`gallery.html`) — every shipped view: `MarketingView`,
  `SectionedView`, `AuthView`, `ErrorView`, `CaptureView`, `DocumentView`,
  `CollectionView`.
- **Site** (`site-*.html`) — fixtures for `templates/site`'s routes,
  rendered through `MarketingView` for home/about/contact/privacy/terms and
  a direct `ErrorView` call for `not-found`. The template's own routes now
  render `LandingView` for home, `ContactView` for contact and `LegalView`
  for terms and privacy (`templates/site/web-route-manifest.json`), and the
  gallery keeps rendering the earlier fixtures until it is updated.
  `templates/site/app/robots.ts`/`templates/site/app/sitemap.ts` are Next.js
  metadata route handlers, not page components — there is no view to render for either,
  so neither appears here. `robots` allows crawling on `production` only, and
  `sitemap` lists the manifest's routes there, a legal route once its document
  is counsel-reviewed.
- **Materials** (`materials-*.html`) — the company overview at each of
  the three lengths (`COMPANY_OVERVIEW_TEMPLATES`' own section order),
  the pitch deck (`PITCH_DECK_SLIDE_ORDER`) plus one
  `selectAudienceVariant`-filtered audience variant, and the materials
  index (`renderMaterialsIndexHtml`).
- **Email kit** (`email-*.html`) — the launch announcement, welcome, and
  follow-up emails (`renderEmailDocument`), each shown in a 600px
  email-width frame alongside its plain-text alternative, plus a
  signature (`buildEmailSignatureHtml`/`Text`).
- **Cards** (`cards-*.svg`) — one real-sized SVG per
  `SOCIAL_CHANNEL_SPECS` image, `OG_SHARE_CARD_SPEC`, and each
  `VIDEO_CALL_BACKGROUND_SPECS` entry (`renderImageDocument`).
- **Brand** (`guide.html`, `audit.html`) — written only when a complete
  `roster.json` (`BrandAssetEntry[]`) is also given (issue #1111).

`index.html` links every file above by exact filename — a broken link
there means a file this command claims to write is missing, not a
cosmetic gap.

## API


- `assessment`: `assessVerifiedPublicationRate` and the
  `VerifiedPublicationRateAssessment`, `VerifiedPublicationRateFinding`, and
  `VerifiedPublicationRateState` types. The CLI is `publisher-rate-check`.
  Not `publisher-media-check` or `publisher-record-check`.
- `core`: `CHANNELS`, `ELEMENT_KINDS`, `validateComposeDocument`,
  `validateSurfaceDocument`, `isSurfaceRepeatingSlotBinding`,
  `createOutputManifest`,
  `collectCopyProvenance`, `createResolvedOutputManifest`,
  `resolveSurfaceDocument`, `validateSectionedViewDocument`,
  `resolveSectionedViewDocument`,
  `resolveDocument`, `resolveCopy`, `resolveAssets`, `frameToInches`,
  `frameToPercent`, `getSlotSpec`, `listSlotKeys`, `requiredSlotKeys`, and
  the `Channel`, `ChannelMeta`, `ComposeDocument`, `ComposeFinding`,
  `ElementKind`, `EmailMeta`, `FlowLayoutSpec`, `FlowSlotSpec`, `Frame`, `ImageMeta`, `LayoutSpec`,
  `PrintMeta`, `Rect`, `ResolvedSlot`, `ResolveResult`, `SlidesMeta`,
  `SlotBinding`, `SlotSpec`, `StyleBinding`, `SurfaceDocument`,
  `SurfaceBinding`, `SurfaceSlotBinding`, `SurfaceRepeatingSlotBinding`,
  `SurfaceRepeatingSlotFieldBinding`, `SurfaceSlotBindingItem`, `SurfaceChannelMeta`, `OutputArtifact`,
  `OutputManifest`, `StrategyProvenance`, `CopyProvenance`, `WebMeta`, `CopyLookup`,
  `CopyResolveResult`, `ResolvedText`, `AssetLookup`, `AssetResolveResult`,
  `ResolvedAsset`, `ResolvedSurfaceDocument`, `ResolvedSurfaceGroup`,
  `ResolvedSurfaceGroupField`, `ResolvedSurfaceGroupItem`, `ResolvedSurfaceNode`,
  `ResolveSurfaceDocumentOptions`, `SurfaceResolutionReason`, and
  `CanvasInches`, `SectionedViewAction`, `SectionedViewDocument`, `SectionedViewSection`,
  `SectionedViewSectionKind`, `SectionedViewGround`, `SectionedViewHeroMedia`, `SectionedViewHeroSection`,
  `SectionedViewStatGridSection`, `SectionedViewStatItem`, `SectionedViewStatTrend`, `ResolvedSectionedViewHeroMedia`,
  `SectionedViewFeatureGridSection`, `SectionedViewFeatureItem`, `SectionedViewFaqSection`,
  `SectionedViewFaqItem`, `SectionedViewOrderedStepSequenceSection`,
  `SectionedViewOrderedStep`, `SectionedViewStatusListSection`,
  `SectionedViewStatusGroup`, `SectionedViewStatusItem`, `SectionedViewStatus`,
  `SectionedViewStatusDisposition`,
  `ResolvedSectionedViewAction`, `ResolvedSectionedViewDocument`,
  `ResolvedSectionedViewSection`, and
  `SectionedViewResolutionReason` types. `SurfaceResolutionError` and
  `SectionedViewResolutionError` are thrown when their canonical resolution
  paths fail closed.
- `media`: `parseAssetRecord`, `validateAssetRecordShape`,
  `readAssetRecord`, `checkAssetCoverage`, and the `AssetEntry`,
  `AssetEntryId`, `AssetFinding`, `AssetRecord`, `AssetRegistryReadIssue`,
  `AssetRegistryReadIssueReason`, `AssetRegistryReadResult`,
  `AssetCoverageReport`, `AssetTypeCounts`, `ImageAssetEntry`,
  `ImageSource`, `VideoAssetEntry`, `VideoCaption`, and
  `VideoReducedMotionBehavior` types. The CLI is `publisher-media-check`.
- `web`: `renderWebDocument`, `buildWebHeadMetadata`, `buildSiteMetadata`, `formatPageTitle`,
  `lintSiteMetadataHtml`, `SITE_METADATA_REQUIRED_TAGS`, `SiteMetadataError`,
  `listWebTemplateNames`, `defineWebTemplate`, `createWebRenderer`,
  `AuthView`, `CaptureView`, `CollectionView`, `DocumentView`, `ErrorView`,
  `LegalView`, `MarketingView`, `PackReviewView`, `SectionedView`, `SignInForm`, `RenderError`, and the `AuthViewProps`,
  `CaptureViewProps`, `CollectionViewEmptyState`, `CollectionViewEntry`,
  `CollectionViewLink`, `CollectionViewPagination`, `CollectionViewProps`,
  `DocumentViewEffectiveDate`, `DocumentViewProps`,
  `ErrorViewProps`, `LegalViewLabels`, `LegalViewProps`, `MarketingViewProps`, `MarketingFeatureItem`, `MarketingFaqItem`,
  `SignInFailure`, `SignInFormProps`, `SignInResult`,
  `PackReviewViewExport`, `PackReviewViewLabels`, `PackReviewViewPage`, `PackReviewViewProps`, `PackReviewViewState`,
  `SectionedViewLandmark`, `SectionedViewProps`,
  `RenderErrorReason`, `AssetResolver`, `CopyResolver`, `RenderWebOptions`,
  `RenderWebResult`, `RepeatingWebSlotFieldSpec`, `RepeatingWebSlotSpec`, `ResolvedWebGroupField`, `ResolvedWebGroupItem`,
  `WebSlotContentKind`, `WebTemplate`, `DefineWebTemplateOptions`,
  `CreateWebRendererOptions`, `WebRenderer`, `WebHeadMetadata`,
  `WebOpenGraphMetadata`, `WebTwitterMetadata`, `SiteIdentityInput`,
  `SiteLegalStatus`, `SiteMetadata`, `SiteMetadataErrorReason`,
  `SiteOpenGraphMetadata`, `SitePageInput`, `SitePageKind`, `SiteShareCard`,
  `SiteTwitterMetadata`, `SiteMetadataLintFinding`, `SiteMetadataLintResult`,
  `SiteMetadataLintRule`, `SiteMetadataRequiredTag`, and
  `SiteMetadataTagSelector` types, plus `GlobalErrorDocument` and `GlobalErrorDocumentProps`.
- `document`: `validateStructuredDocument`, `renderStructuredDocument`,
  `RenderError`, and the `DocumentBlock`, `DocumentCallout`,
  `DocumentColumnStyle`, `DocumentDefinitionList`, `DocumentInline`, `DocumentList`,
  `DocumentParagraph`, `DocumentSection`, `DocumentTable`,
  `StructuredDocument`, `RenderStructuredDocumentOptions`,
  `RenderStructuredDocumentResult`, and `RenderErrorReason` types.
- `email`: `renderEmailDocument`, `RenderError`, and the
  `RenderErrorReason`, `EmailRenderResult`, `RenderEmailOptions`, and
  `RenderWarning` types.
- `print`: `renderPrintDocument`, `RenderError`, and the
  `RenderErrorReason`, `CopyResolver`, `CustomPageSize`, `PrintPageInfo`,
  `RenderPrintOptions`, and `RenderPrintResult` types.
- `image`: `renderImageDocument`, `RenderError`, `computeCanvasDimensions`,
  `escapeXml`, `frameToCanvasRect`, `resolveColorRole`, `wrapText`, and the
  `RenderErrorReason`, `RenderImageOptions`, `RenderImageResult`,
  `CanvasDimensions`, `CanvasPixelSize`, `PixelRect`, `TextWrapOptions`, and
  `TextWrapResult` types.
- `slides`: `renderSlidesDeck`, `canvasForAspect`, `RenderError`, and the
  `RenderErrorReason`, `RenderedSlide`, `RenderSlidesOptions`,
  `RenderSlidesResult`, and `SlidesDeckInput` types.
- `record`: see "`record` — exports and the CLI," above, for the full
  reference table. Summary: `validateEntry`, `validateLedger`,
  `canonicalizeValue`, `citeFact`, `appendEntry`, `checkAppendOnly`,
  `checkLedgerDrift`, `checkJoinKeyCompleteness`, and the `PublicationEntry`,
  `FactCitation`, `Ledger`, `LedgerFinding`, `DriftReport`, `JoinKeyReport`,
  `JoinKeyIdentity` types, plus `PolicyBinding`/`DigestAlgorithm`/
  `PolicyFinding` re-exported from `@clossys/controller/policy`. The
  CLI is `publisher-record-check`.
- `pack`: `PACK_STATUSES`, `LIFECYCLE_STATES`, `LIFECYCLE_CONDITIONS`, and
  `packStatusToLifecycle` (re-exported from `@clossys/controller`),
  `PACK_LAYERS`, `PACK_VISIBILITIES`, `isPackLayer`, `isPackVisibility`,
  `isPackVersionString`, `validatePackManifest`, `planPackOrder`,
  `computePackReadiness`, `sealableItemIds`, `detectExistingPackItems`,
  `foundPackItem`, `buildPackReviewIndex`, `packReviewStatus`,
  `PACK_REVIEW_STATUSES`, `PACK_REVIEW_WIDTHS`, `PACK_REVIEW_EMAIL_WIDTHS`, and
  the `PackReviewExport`, `PackReviewExportKind`, `PackReviewIndex`,
  `PackReviewIndexResult`, `PackReviewInput`, `PackReviewIssue`,
  `PackReviewPage`, and `PackReviewStatus` types, and the `PackStatus`, `LifecycleState`,
  `LifecycleCondition`, and `PackStatusLifecyclePosition` types (also
  re-exported from `@clossys/controller`) and the `PackLayer`,
  `PackVisibility`, `PackItem`, `PackManifest`, `PackSourcePin`,
  `PackFinding`, `PackValidationResult`, `PackItemReadiness`,
  `PackReadiness`, `PackAdoptionCandidate`, and `PackAdoptionResult` types.
  See "The pack," above.
- `surfaces`: `PUBLISHER_SURFACES_DIR`, `validateSurfaceOwnership`, and the
  `SurfaceOwnershipClaim`, `SurfaceOwnershipFinding`, and
  `SurfaceOwnershipCheckResult` types. See "Surface documents move to
  Publisher," above.
- `materials`: `renderMaterialsIndexHtml`, `selectAudienceVariant`,
  `declaredAudiences`, `renderPitchDeckHtml`, `materialsPrintStylesheet`,
  `checkMaterialsVisibility`, `MATERIALS_DEFAULT_VISIBILITY`, and the
  `MaterialsIndexEntry`, `DeckAudienceSelections`, `AudienceVariantDeck`,
  `RenderPitchDeckHtmlOptions`, `MaterialsVisibilityCheckInput`, and
  `MaterialsVisibilityFinding` types. See "Materials site," above.
- `templates`: `COMPANY_OVERVIEW_TEMPLATES`, `overviewSectionIds`,
  `PITCH_DECK_SLIDE_ORDER`, `PITCH_DECK_DEFAULT_AUDIENCE_SELECTIONS`,
  `buildEmailSignatureHtml`, `buildEmailSignatureText`,
  `SOCIAL_CHANNEL_SPECS`, `getSocialChannelSpec`, `OG_SHARE_CARD_SPEC`,
  `VIDEO_CALL_BACKGROUND_SPECS`, `getVideoCallBackgroundSpec`,
  `staleChannelSpecEntries`, and the `CompanyOverviewLength`,
  `EmailSignatureLink`, `EmailSignaturePerson`, `ChannelImageSpec`,
  `ChannelTextLimit`, `SocialChannelSpec`, and `VideoCallBackgroundSpec`
  types. See "Templates and channel specs," above.

Web page-level compositions belong here, not in `designer`; they consume
design-system primitives and accept consumer-owned copy through slots.
Generated HTML, SVG, and other files are build artifacts owned by the
consumer, while this package owns the contracts and deterministic renderers
that produce them. `record` composes with none of it: see "`record` — the
append-only publication ledger," above, for why the two halves stay
import-free of each other under one version.

## Requirements and version coupling

Node 20+. This package's own `package.json` declares runtime dependencies on
`@clossys/writer`, `@clossys/designer`, and `@clossys/controller`. Read the
exact ranges from that `package.json`, not from this README: they move
whenever a release follows a sibling's new minor version, and a range
restated here would go stale the moment one did. From `controller`, this
package imports the `./policy` subpath, `@clossys/controller/policy`, for
the publication record, and the shared lifecycle vocabulary
(`packStatusToLifecycle`, `PACK_STATUSES`, `LIFECYCLE_CONDITIONS`, and
`LIFECYCLE_STATES`, with their types) from the package root for
`@clossys/publisher/pack`; `@clossys/publisher/materials` also takes the
`PackStatus` and `LifecycleCondition` types from the root.
Controller first exports that vocabulary in 0.9.14, so the `controller`
range must not admit anything earlier: against an older 0.9.x release,
importing `@clossys/publisher/pack` fails at module load. On a `0.x`
package, caret and tilde ranges both stay within one minor version
(`^0.4.0` and `~0.4.0` both mean `>=0.4.0 <0.5.0`), so a new minor release
of any of the three needs a new range before it resolves. Every declared
range is a real constraint on the dependency graph, not an install-ordering
concern: a package manager resolves the whole graph regardless of what order
packages are requested in, so none of this can be worked around by
installing things in a particular sequence.

Past range moves, kept as history (none of these is necessarily the current
range; later moves are in the CHANGELOG): `writer`'s range first moved from
`^0.1.0` to `^0.2.0` when `writer` 0.2.0 changed `writer-check
addressability`'s exit-code precedence (issue #407), then to `^0.3.0` when
Writer added its passage layer (issue #373). Both were additive or
behavioural minor releases rather than patches, so the older ranges do not
resolve them (0.x ranges are minor-locked). `designer`'s range
first moved from `^0.1.0` to `^0.2.0` when Designer added the
`designer-environment-check` gate (issue #405), then to `^0.2.7`
because Publisher's React-server target imports the server-safe
section-ground, `Faq`, ordered-step, and status-list exports, including the
separate `not-offered` disposition, introduced in Designer 0.2.7, then to
`^0.3.0` because the `eyebrow` and `actions` slots this package's
section contract now renders into are Designer 0.3.0 additions, then to
`^0.4.0` because a `status-list` section's flat `items`
alternative to `groups` renders into Designer 0.4.0's new `StatusList`
`items` prop, then to `^0.4.12` because this package's web
templates compose Designer's `MarketingChapter` block (from
`@clossys/designer/blocks/server`), a Designer 0.4.12 addition. A published
package that only satisfies `^0.4.0` — for example the registry's own
Designer 0.4.7 at the time — resolves cleanly but cannot
actually serve `@clossys/publisher/web`: `import("@clossys/publisher/web")`
throws `SyntaxError: The requested module '@clossys/designer/blocks/server'
does not provide an export named 'MarketingChapter'` under both its ordinary
and `react-server` conditions. This is exactly the failure the pinned-runtime
release-qualification run for 0.4.24 caught; see this repository's own
`src/web/react-server-artifact.test.ts` (not shipped in the published
package) for the regression test's fixture that reproduces it
deterministically. Then to `^0.5.0`, because Designer 0.5.0 is itself a
minor release (the identity-kit generator and its checks, issue #1210), and
a `^0.4.0` range does not resolve a `0.5.x` package under 0.x caret semver.
A move like that last one, which only follows a sibling's new minor release
rather than a new imported contract, is recorded as an "Updated dependency"
entry in this package's [changelog](https://github.com/clossys/foundry/blob/main/docs/changelogs/publisher.md), not here. These ranges are independent;
leaving any one behind would still resolve an older package without any
install failure, silently withholding a required contract.

`writer`, `designer`, and `controller` are regular dependencies of
`publisher`, so a consumer whose own policy is to pin exact versions does not
get an install failure by pinning one of them outside the range this
release's `package.json` declares for it: npm installs a second, nested copy
that satisfies `publisher`'s declared range alongside the consumer's pinned
copy. A consumer should still pin each of the three inside the range this
release declares, to avoid that duplicate copy and to make sure the copy
`publisher` actually uses is the one they pinned. For `designer`
specifically, an out-of-range pin is a real styling risk even though the
install succeeds: Publisher's web views render markup from its own nested
`designer` copy while a consumer's CSS build (`compiled.css`, or Tailwind
`@source` scanning `node_modules/@clossys/designer`) compiles from the
consumer's top-level pinned copy, so a version gap between the two can leave
rendered pages unstyled or wrongly styled with no install-time or runtime
error.
`react` and `react-dom` are optional peer dependencies (`>=18`) required only
by the `web` and `document` subpaths' renderers. The `web` subpath also imports
Designer surfaces, so Publisher directly repeats Designer's optional
`@internationalized/date`, `react-aria-components`, `tailwind-merge`, and
`tailwindcss` peer ranges. This closes the public npm consumer graph instead
of relying on an installer to propagate a dependency's optional peers.
`record` has no peer dependencies of its own.

Marking `react` optional means npm gives no install-time signal if it's
missing or on an incompatible version — importing `./web` or `./document`
now guards against both itself: `renderWebDocument` and
`renderStructuredDocument` each throw a named error (never a silent pass)
stating whether `react` is absent entirely or installed but outside this
package's declared `>=18` range, before `createElement` itself gets a
chance to fail with a less legible error. `react-dom` has no guard of its
own — no file in this package ever imports it directly; only your own
`react-dom/server` or client render call does, downstream of the element
either renderer returns. See `src/internal/peer-version.ts` for the
guard's own contract.

All six peers remain `optional: true` in `peerDependenciesMeta`, correctly
reflecting that `./core`, `./media`, `./email`, `./print`, `./image`,
`./slides`, and `./record` do not need them. A consumer of `./web` must install
the declared peers at compatible versions; the release qualification adapter
does so explicitly and proves both the ordinary and `react-server` entry
points from a clean public-registry install. A legacy registry lane once
omitted `peerDependenciesMeta`; see
[issue #226](https://github.com/clossys/foundry/issues/226) for that retired
registry behavior.

## `web` — contact submission handler

`createContactHandler` in `@clossys/publisher/web` is a framework-neutral,
server-only handler for a public contact form. It takes a parsed submission
and a caller-supplied client key and resolves to a result made of status codes.
It knows nothing about HTTP, routing or rendering, and it delivers by calling
a delivery port you inject, so import it from server code only.

```ts
import {
  createContactHandler,
  createMemoryRateLimiter,
  createStubContactDelivery,
} from "@clossys/publisher/web";

const handler = createContactHandler({
  topics: ["general", "press"],
  from: "Site <site@example.com>",
  to: ["inbox@example.com"],
  subject: "New contact form message",
  limiter: createMemoryRateLimiter({ limit: 3, windowMs: 60_000, now: () => Date.now() }),
  delivery: createStubContactDelivery(), // refused when target is "production"
  target: "preview",
});

const result = await handler.handle(body, { clientKey });
// { status: "accepted" } | { status: "invalid", fields: [...] }
// | { status: "rate-limited" } | { status: "unavailable" }
```

`body` is whatever your framework parsed from the request; the handler reads it
as `unknown`. `from`, `to` and `subject` come from configuration, not from
the submission. The other config fields are `honeypotField`
(default `"website"`), `caps`, `createMessageId`, `onUnavailable` (called
with a reason code only), and the optional `limiterTimeoutMs` and
`deliveryTimeoutMs` (positive integers, at most 2147483647 milliseconds; no
timeout by default). Construction throws on invalid configuration. The
handler reads `delivery.deliver` and `limiter.check` once, at construction, and
calls each with its own port as `this`; reassigning either later has no effect.

### Result codes

| Status | Meaning |
| --- | --- |
| `accepted` | The delivery port's promise resolved, or the honeypot field was filled and nothing was delivered. The two are indistinguishable to the caller. |
| `invalid` | One or more `fields` issues, ordered `topic`, `name`, `email`, `phone`, `message`, then `submission`. Each issue is a field plus a code: `not-a-string`, `too-long`, `control-character`, `required`, `unknown-topic` (topic) or `malformed` (email, phone, and name or message that contain a lone UTF-16 surrogate). The `submission` issue is `too-long` for the total cap. |
| `rate-limited` | The limiter answered `false`. |
| `unavailable` | The handler could not proceed: invalid client key, the limiter threw, rejected or answered a non-boolean, the limiter or delivery did not settle within its timeout, message id generation failed, delivery threw or rejected, or something else threw unexpectedly. The reason goes to `onUnavailable`, not to the client. |

Results carry codes only: no English text, and no part of the input is echoed
back. Mapping codes to words belongs to your rendering layer. Length caps
default to `CONTACT_DEFAULT_CAPS` (topic 100, name 100, email 254, phone 40,
message 5000, total 6000 UTF-16 code units) and can be overridden per field.

### Evaluation order

`handle(submission, { clientKey })` runs these steps in order, and a step that
ends the call skips the rest:

1. Client key check: a missing, non-string, blank or over-long key (more than
   `CONTACT_CLIENT_KEY_MAX_LENGTH`, 256) resolves `unavailable` with no limiter
   call.
2. Honeypot: a filled honeypot field resolves `accepted` with no limiter call
   and no delivery.
3. Validation of the declared fields and the total cap: any issue resolves
   `invalid` with no limiter call, so correcting a typo does not use up the
   allowance.
4. Limiter: `check(clientKey)` is awaited once. `true` continues, `false`
   resolves `rate-limited`, and a throw, rejection, non-boolean or a call that
   has not settled within `limiterTimeoutMs` resolves `unavailable`.
5. Delivery: the outbound message is built and `deliver` is awaited once. A
   resolve is `accepted`; a throw, a rejection or a call that has not settled
   within `deliveryTimeoutMs` is `unavailable`. There is no retry, and the
   limiter use is not refunded.

The outbound message carries a text body and an escaped HTML body. Name, email,
phone, topic and message appear only in those two bodies, and the submitted
email is the sole `replyTo`. Control
characters are refused in every field, except that `message` may contain tab,
line feed and carriage return; single-line fields also refuse U+2028 and U+2029. `name` and `message` also
refuse a lone UTF-16 surrogate as `malformed`, since it cannot be encoded in the
notification; a well-formed pair, such as an emoji, is accepted.

### Timeouts

With no timeout configured, `handle()` waits as long as the limiter or delivery
port takes. `limiterTimeoutMs` and `deliveryTimeoutMs` bound each call
separately. When a call has not settled in time, `handle()` resolves
`unavailable` with the reason `limiter-timeout` or `delivery-timeout`, and an
answer or rejection that arrives later is discarded. The handler does not cancel
the call. A timed-out limiter call delivers nothing. A timed-out delivery may
still complete, so its outcome is unknown, and a client that submits again can
produce a second message. If your delivery port accepts an abort signal or has
its own timeout, set that as well.

### Notification email

`renderContactNotificationEmail(input, options?)`, exported from
`@clossys/publisher/email`, returns `{ html, text }` for one submission
(`topic`, `name`, `email`, `message`, optional `phone`). The handler calls it and
delivers both bodies. `text` is the layout above; `html` is fixed table markup
with inline styles, and no `react`, `@clossys/designer` or other dependency.

Every value passes through the package's HTML escaping exactly once, into
element text only. There are no anchors, images, scripts, comments or remote
resources, so an address or URL in a field is inert text, never a link. Message
line breaks become `<br>` after escaping. `options.labels` renames the `Topic`,
`Name`, `Email`, `Phone` and `Message` labels (the defaults are those English
words); a label is escaped and single-line checked like a value.

The function throws a `TypeError` naming the field, never its value, for a
non-string, for any control character in a single-line field or label (plus
U+2028 and U+2029), and for any control character in `message` other than tab,
line feed and carriage return. In the handler a throw resolves `unavailable`
with nothing delivered. Types: `ContactNotificationInput`,
`ContactNotificationLabels`, `ContactNotificationEmail` and
`RenderContactNotificationEmailOptions`.

Not covered: no mail-client rendering check, no deliverability guarantee, no
link handling.

### Wiring a Messenger email adapter

`ContactDelivery` is a local port, `{ channel: "email", deliver(message) }`, and
Publisher imports no Messenger code. The message it builds is shaped so that an
email adapter from `@clossys/messenger` is assignable to `delivery` without a
wrapper under `strictFunctionTypes`; a delivery whose `deliver` requires more
than the handler supplies, such as a required `headers`, fails to compile.

```ts
import { createContactHandler, createMemoryRateLimiter } from "@clossys/publisher/web";
import type { ContactDelivery } from "@clossys/publisher/web";

// Your Messenger email adapter, constructed elsewhere; it is assignable to
// `ContactDelivery` as it is.
declare const emailAdapter: ContactDelivery;

const handler = createContactHandler({
  topics: ["general", "press"],
  from: "Site <site@example.com>",
  to: ["inbox@example.com"],
  subject: "New contact form message",
  limiter: createMemoryRateLimiter({ limit: 3, windowMs: 60_000, now: () => Date.now() }),
  delivery: emailAdapter,
  target: "production",
});
```

### The stub delivery

`createStubContactDelivery()` returns an in-memory delivery for tests and
previews. Each call to `deliver` appends a frozen copy of the message to
`deliveries` and resolves `{ provider: "stub", messageId }`. Every stub carries
the `STUB_CONTACT_DELIVERY` brand, and `createContactHandler` throws at
construction when `target` is `"production"` and the delivery carries it. A
`target` outside `"production" | "preview" | "development" | "test"` also
throws, so a typo such as `"prod"` does not admit a stub. Detection covers the
stub as returned: a caller who re-wraps it in a new `{ channel, deliver }`
object drops the brand and is not detected.

### What this does and does not guarantee

As constructed, and with a limiter that answers correctly:

- Only a well-formed, capped, control-free, non-honeypot submission that the
  limiter allows reaches `deliver`.
- The recipients, sender and subject come from configuration; submitted text
  reaches a header only as the shape-checked `replyTo` address.
- A stub delivery is not called by a handler whose target is `"production"`,
  including one assigned onto the delivery after construction, because
  `deliver` and `check` are read once at construction.
- Results contain status and field codes and no submitted text.

It does not provide:

- Bot detection beyond the honeypot. A bot that leaves the honeypot empty and
  submits valid input is treated as a person.
- A distributed limiter. `createMemoryRateLimiter` keeps a sliding window in one
  process (`limit`, `windowMs`, an injected `now`, and `maxKeys`, default
  10 000), so several instances or serverless invocations each hold their own
  window. Inject a shared `ContactRateLimiter` for those deployments.
- A limiter that keeps serving new clients when its store is full. Once
  `createMemoryRateLimiter` holds `maxKeys` keys that still have a live window,
  it answers `false` for every new key, so `handle()` resolves `rate-limited`
  for new clients until some window ends. Keys already in the store keep their
  own limit. A flood of distinct client keys can therefore lock new clients out
  for up to `windowMs`; derive the client key from something a client cannot
  vary freely, or inject a shared limiter.
- A check on the caller's client key. The handler does not verify that it
  identifies a real client, so a key taken from a spoofable header gives a
  spoofable limit.
- A deliverability guarantee. `accepted` means the delivery port resolved,
  typically provider acceptance, not that a message reached an inbox.
- Timing equalisation: a honeypot hit skips delivery and may answer faster.

Known limits on input shape: the email check is conservative because the value
becomes a `replyTo` address. It requires an ASCII dot-atom local part of at most
64 characters and a domain of two or more ASCII labels, so internationalised
addresses and quoted local parts are refused as `malformed`. Phone accepts only
ASCII digits, space and `+ - ( ) . / # * x X`, with at least one digit. Bidirectional
formatting characters are not refused.

### Share card route — `createShareCardRoute`

`createShareCardRoute(input)` wraps `buildBrandShareCard` as the exports of an
`opengraph-image` route, so a site no longer writes that route by hand. It is
exported from `@clossys/publisher/web` and its server entry. Publisher does not
depend on `next`: you pass your own `ImageResponse` class, and the module
imports nothing from `next`.

```tsx
import { createShareCardRoute } from "@clossys/publisher/web";
import type { ShareCardRouteInput } from "@clossys/publisher/web";

declare const ImageResponse: ShareCardRouteInput["ImageResponse"]; // your framework's image-response class
declare const markDataUrl: string; // inline data URL

const route = createShareCardRoute({
  ImageResponse,
  card: { markSrc: markDataUrl, wordmark: "Example Studio", headline: "Made well, made to last" },
  alt: (headline) => `Example Studio: ${headline}`,
});

export const alt = route.alt;
export const size = route.size;
export const contentType = route.contentType;
export default route.Image;
```

- **Input.** `{ ImageResponse, card, title?, alt }`. `card` is
  `buildBrandShareCard`'s input without `alt`, so `headline` stays required
  there. `ImageResponse` is
  `new (element, { width, height }) => Response`.
- **Title and alt.** When `title` is given it replaces `card.headline`. `alt` is
  a string, returned as given, or a function called with the headline actually
  drawn. Publisher builds no wording; every word is yours.
- **Result.** `{ alt, size, contentType, shareCard, Image }`. `size` is the
  card's `{ width, height }` (1200 by 630), `contentType` is `"image/png"`,
  `shareCard` is the record `buildSiteMetadata` takes, and `Image()` returns
  `new ImageResponse(element, size)`. Assign each export by name, as above;
  Next reads them by name, so a destructured export is not found.
- **Failure.** The card is built when `createShareCardRoute` is called, so bad
  input fails when the route module loads. Errors are `ShareCardError`,
  unchanged; a blank `title` throws `blank-text`, and an `ImageResponse` that is
  not a function throws `invalid-input`.

## Licence

MIT

## Changelog

Release notes for every version are in the [changelog](https://github.com/clossys/foundry/blob/main/docs/changelogs/publisher.md), kept in the public repository rather than in the installed package.
