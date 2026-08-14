# @vespeneventures/ui

Design tokens, theme CSS, and React components for Tailwind CSS v4. This
package ships reusable visual vocabulary built on its own token layer:

## Package structure

```
tokens → icons → atoms → blocks
                       ↘ shell
                       ↘ charts
                       ↘ theme
```

`atoms`, `blocks`, `shell`, `charts`, and `theme` all ship today, alongside
`icons` — pure glyph DATA sitting BELOW `atoms`, not a sixth rung of content
(see "Icon glyph data" below for the full reasoning; the short version: a
`[tag, attrs]` tuple has no rendering logic and depends on nothing else in
this package, so it sits even more foundational than `atoms` itself, the
same way `tokens` sits below all of `ui`). See "Placement rules" below for
what distinguishes reusable atoms and blocks. Whole-page compositions are
surfaces and live in `@vespeneventures/surface/web`.

- **`icons`** — glyph data only, no components: 32 `IconNode` exports
  (`AlertTriangle`, `BookOpen`, `Box`, `Building2`, `Calendar`, `Check`,
  `CheckCircle`, `ChevronDown`, `ChevronLeft`, `ChevronRight`, `ChevronUp`,
  `Clock`, `CreditCard`, `ExternalLink`, `FileText`, `Folder`, `Grid3x3`,
  `Home`, `Info`, `List`, `Lock`, `Monitor`, `Moon`, `Plug`, `Receipt`,
  `Search`, `Settings`, `Sun`, `User`, `Users`, `X`, `XCircle`) — each a
  `ReadonlyArray<readonly [tag: string, attrs: Record<string, string>]>`,
  meant to be passed to the `Icon` atom's `glyph` prop. See "Icon glyph
  data" below.
- **`atoms`** — single-purpose: composes no other atom, or its parts are
  homogeneous repeats rather than named regions. Thirty-one ship, the
  complete set for this layer: `Button`, `Icon`, `TextField`, `Badge`,
  `Card`, `Breadcrumb`, `Link`, `Checkbox`, `Switch`, `Select`, `Textarea`,
  `Avatar`, `Spinner`, `Menu`, `Dialog`, `Tabs`, `Table`, `Field`,
  `Skeleton`, `Tooltip`, `Banner`, `RadioGroup`, `Popover`, `DateField`,
  `ComboBox`, `SearchField`, `FileTrigger`, `Disclosure`, `ProgressBar`,
  `Separator`, `Chip`.
- **`blocks`** — owns the internal layout of multiple named regions,
  typically by composing one or more atoms (and/or layout) into something
  with a real job on a page. Eighteen ship: `PageHeader`, `EmptyState`,
  `DataTable`, `DetailView`, `Pagination`, `Stat`, `Form`, `FieldGroup`,
  `ConfirmDialog`, `Toolbar`, `NavGrid`, `SectionHeader`, `Hero`,
  `FeatureGrid`, `Faq`, `PricingTable`, `Testimonial`, `ArticleBody` — the
  last six are marketing/editorial content blocks, completing this layer
  (see "Blocks" below).
- **`shell`** — the persistent frame around content (nav, layout chrome)
  that provides the slots content fills. One per app; survives route
  changes that swap out the content underneath it. `Shell` ships with five
  slots (`Header`, `SideNav`, `Main`, `Rail`, `Footer`) for an
  authenticated-app frame; `SiteHeader`, `NavShell`, `SiteFooter`, and
  `SkipLink` ship alongside it for the simpler persistent chrome a public
  SITE (as opposed to an app behind auth) needs — a brand/nav/actions
  header, a responsive nav with a mobile drawer, grouped footer link
  columns, and the keyboard affordance to bypass either. `Toaster` — a
  runtime service, not itself a rung of this ladder — ships alongside both.
  See "Shell" below.
- **`charts`** — dependency-free SVG chart primitives: `ChartFrame` (the
  shared plot/axes/grid/legend/table container), `BarChart`, `LineChart`,
  and `Sparkline`. A sibling of `shell`, not a sixth rung of the ladder —
  see "Charts" below.
- **`theme`** — the JavaScript half of this package's theming contract
  (the CSS half already ships from `tokens.css`/`theme.css` — see "CSS
  layers, fallbacks, and themes" below): `getThemeInitScript`, a
  self-contained head script that stamps `data-theme` before first paint;
  `ThemeProvider`/`useTheme`, which hold and persist the three-state
  preference at runtime; and `ThemeToggle`, an accessible control built
  from this package's own `Button`/`Icon` atoms. A sibling of `shell` and
  `charts`, not a sixth rung — see "Theme" below.

A layer may only import toward something more foundational: blocks may
import atoms, never the reverse. `shell`, `charts`, and `theme` are
narrower sibling domains built from those primitives. `charts` is a
narrower sibling: it may import `atoms`, and nothing else in this package
imports from it. `theme` is the same shape: it may import `atoms` and
`icons` (its `Button`/`Icon` atoms and `Sun`/`Moon`/`Monitor` glyphs), and
nothing else in this package imports from it. `icons` sits at the very
bottom: `atoms` may import `icons` (and does — `atoms/Icon.tsx` imports the
`IconNode` type from `icons/types.ts`), and nothing under `icons/` may
import from anywhere else in this package. `src/ladder.test.ts` enforces
every one of these directions structurally, not just by convention: it
scans every file under `src/atoms/`, `src/blocks/`, `src/shell/`,
`src/charts/`, `src/theme/`, and `src/icons/` for an import referencing a
layer it isn't allowed to reach, and fails the build if it finds one.

The token layer is part of this package — every class its components render
(`bg-accent`, `text-ink-primary`, `rounded-control`, ...) is a Tailwind
utility generated from its tokens. Without the token CSS imported, those
class names don't correspond to anything and every
component renders unstyled, with no error anywhere to explain why.

## Public contract

There is deliberately no `@vespeneventures/ui` root export. Import the
smallest stable subpath that owns what you need:

| Subpath | Owns |
| --- | --- |
| `@vespeneventures/ui/tokens` | Typed `TOKENS`, brand CSS parsing, the brand-coverage gate, WCAG colour math (`contrastRatio` and friends), the contrast gate (`checkTokenContrast`, `CONTRAST_PAIRS`), and `assertTokenStylesLoaded` (dev-only token-CSS presence check — see "Setup" below). No React runtime. |
| `@vespeneventures/ui/tokens.css` | Neutral primitive custom-property defaults; works without Tailwind. |
| `@vespeneventures/ui/theme.css` | Optional Tailwind v4 wiring; imports `tokens.css` itself. |
| `@vespeneventures/ui/compiled.css` | GENERATED, precompiled utility CSS for `atoms` — the framework-portable path for a consumer with no Tailwind pipeline. Imports nothing itself; load after `tokens.css`. See "Framework-portable components, without Tailwind" below. |
| `@vespeneventures/ui/brand-template.css` | Copy-and-fill template for a consumer brand binding. |
| `@vespeneventures/ui/icons` | Tree-shakeable glyph data. |
| `@vespeneventures/ui/atoms`, `/blocks`, `/shell`, `/charts` | Reusable React visual primitives. |
| `@vespeneventures/ui/theme` | `getThemeInitScript`, `ThemeProvider`/`useTheme`, `ThemeToggle` — the runtime half of theming. Not to be confused with the CSS `/theme.css` subpath above. |
| `@vespeneventures/ui/gate` | Token-purity scanner and gate. |

`ui` never exports page views, routes, metadata, strategy facts, or copy.
Components receive resolved `ReactNode`s, labels, data, callbacks, and URLs
through props. Product/page composition belongs to
`@vespeneventures/surface`; audience-facing words belong to
`@vespeneventures/copy`.

### Token-only use

Tokens can be the only thing a consumer installs and imports:

```bash
npm install @vespeneventures/ui
```

```css
@import "@vespeneventures/ui/tokens.css";
```

The package has no regular runtime dependencies. React, React DOM, React
Aria, Tailwind, Tailwind Merge, and the date helpers are optional peers:
install them only when importing the React component subpaths. `tokens.css`
is ordinary CSS custom properties, so it has no React or Tailwind requirement.

For React components, install the peers used by the subpaths you import:

```bash
npm install @vespeneventures/ui react react-dom react-aria-components \
  tailwind-merge tailwindcss @internationalized/date
```

`@internationalized/date` is only needed when using `DateField`; the other
component peers support the interactive primitives and their Tailwind classes.

### CSS layers, fallbacks, and themes

The visual contract is ordered:

1. `tokens.css` defines neutral light defaults and automatic/explicit dark
   overrides. Every token has a literal primitive default.
2. A consumer brand file copied from `brand-template.css` overrides only
   brandable roles under `:root[data-brand-bound]`.
3. Consumer extension CSS can add product-specific values under its own
   prefix; it must not redefine UI's token vocabulary.

For Tailwind v4, use `theme.css` instead of importing `tokens.css`
separately: it imports the primitives and exposes supported token families
through `@theme inline`, keeping utilities live against later brand overrides.
The emitted utilities and UI fallbacks use `var(--token, default)`, so an
unbound token layer remains legible rather than failing invisibly. With no
`data-theme`, CSS follows the OS; set `data-theme="light"` or
`data-theme="dark"` on the document root to force a theme. Put that
attribute in server-rendered markup to avoid a flash.

**Breakpoints are the one family that is NOT overridable this way.** Every
other family in `theme.css`'s `@theme inline` block is deliberately
`--token: var(--token, default)` so a later `:root[data-brand-bound]` rule
redefining the plain custom property is still picked up. `--breakpoint-*`
(and, if this package ever ships one, `--container-*`) cannot use that
pattern: `@theme inline` substitutes the declared value directly into the
generated utility's `@media`/`@container` condition, and a media-query
condition cannot contain `var()` — a self-referential breakpoint compiles to
literally invalid CSS (`@media (width >= var(--breakpoint-tablet, 768px))`),
which fails to parse and can take down every rule that follows it in a
consumer's stylesheet. `theme.css` therefore declares `--breakpoint-*` as
plain literal lengths, not the self-referential form. If your product needs
different breakpoints than this package's defaults (`375`/`480`/`768`/
`1024`/`1280`/`1440px`), redeclaring `--breakpoint-tablet` as a plain custom
property anywhere (`:root { --breakpoint-tablet: ...; }`, a brand file,
`data-brand-bound`) has no effect on the generated `tablet:` utility —
`@theme inline` only listens for `@theme` blocks, not arbitrary `:root`
declarations, and by the time it does, the media condition is already a
literal. What DOES work, verified against a real compile: declare your own
`@theme { --breakpoint-tablet: 900px; }` block AFTER importing this
package's `theme.css` in your CSS entry point — Tailwind v4 merges `@theme`
blocks in source order, so a later block's value for the same key wins over
an earlier one, `theme.css`'s own declaration included. Put it before, and
this package's value wins instead. Order matters here in a way it doesn't
for any other token family in this file.

`tokens.css`'s own declarations live in a named `@layer foundry-ui-tokens`
rather than unlayered `:root` — an unlayered rule always outranks a layered
one regardless of import order, which would make these tokens win over a
host app's own Tailwind v4 `@layer theme` unconditionally. Layering it puts
the two on ordinary layer-order footing instead: a host app that wants the
final say can put its own override in an unlayered rule, or in a layer it
declares later than `foundry-ui-tokens`.

Until `data-brand-bound` is set, `tokens.css` also renders a fixed
"No brand binding" badge on every page — deliberately: an unbranded render
should never quietly pass as finished. Set `data-suppress-brand-banner` on
`<html>` (same placement rule as `data-theme`/`data-brand-bound` — in
server-rendered markup, not a post-hydration effect) to suppress it for a
consumer that's shipping unbranded primitives on purpose.

### React SSR, hydration, and accessibility

The component subpaths support React 18+ server rendering and hydration:
they do not read browser globals while rendering. The test suite hydrates a
representative `Shell` + `PageHeader` + `Button` tree without a recoverable
mismatch. In a Next.js 16 App Router consumer, render structural markup in
the server layout/page as usual and place an explicit client boundary around
the interactive component tree; set `data-theme` and `data-brand-bound` in
the root document/layout, not in a post-hydration effect.

Interactive controls use React Aria for keyboard, focus, and semantic
contracts. Noninteractive components expose semantic labels where needed,
the token suite checks contrast in light and dark themes, and every shipped
animation or transition has a Tailwind `motion-reduce` override.

### Framework-portable components, without Tailwind

Everything above (`theme.css` + `@source`) assumes a Tailwind v4 pipeline —
this package's deliberate, opinionated, and still the only *required* setup
(see [CONTRIBUTING.md](../../CONTRIBUTING.md)'s "Supported configurations:
the default answer is also no"). A consumer whose build has no Tailwind
pipeline at all — and does
not want to add one solely for this dependency — can still render this
package's **`atoms`** with real styling, no Tailwind, no `@source`:

```css
@import "@vespeneventures/ui/tokens.css";
@import "@vespeneventures/ui/compiled.css";
```

```bash
npm install @vespeneventures/ui react react-dom react-aria-components \
  tailwind-merge @internationalized/date
# tailwindcss itself is NOT needed on this path
```

That's the whole setup. No `@source` line, no bundler-specific symlink-
following behavior to get right, no Tailwind dependency at all.

**Scope: `atoms` only.** `compiled.css` covers this package's 31 atoms — the
self-contained base layer that composes no other component (see "Placement
rules" below). `blocks`, `shell`, `charts`, and `theme` remain Tailwind-native
only for now; a consumer on this path composes layout from `atoms` and plain
markup the same way any consumer already assembles blocks from atoms (see
"Placement rules" — "most page-level composition belongs to the consumer").
Extending this same generator to `blocks`/`shell`/`charts`/`theme` is a
same-shape, incremental follow-up once this narrower contract has real
production mileage — see the introducing PR (#174) for the full reasoning
behind starting here.

**What `compiled.css` is.** A GENERATED file — never hand-edited, checked by
`npm run check:compiled-css` (also runs as part of `npm test`, so CI catches
drift automatically) and regenerated with `npm run generate:compiled-css`.
It is produced by a REAL Tailwind v4 compile (`src/compiled-css/generate.ts`,
using the real `tailwindcss` package's own `compile()` API) of every class
candidate `src/compiled-css/class-scan.ts` finds by statically scanning
`src/atoms/`'s own source — the same `VARIANT_CLASSES`/`SIZE_CLASSES`-style
tables every atom already uses (see "No `class-variance-authority`" below).
It is not a second, hand-maintained approximation of what `bg-accent` means:
it is Tailwind's own real compiled answer for the SAME tokens, precomputed
once instead of recompiled at every consumer's own build time.

**Override precedence.** Every declaration `compiled.css` emits lives inside
a single named CSS layer, `foundry-ui-compiled`, declared after this
package's own `foundry-ui-tokens` layer (`tokens.css`) — never a bare/
unlayered rule, for the exact reason `tokens.css` itself moved off unlayered
`:root` in #148 (an unlayered rule always outranks ANY layered rule
regardless of import order). Per the CSS Cascading Layers spec:

- A consumer's own **unlayered** CSS (a plain stylesheet, CSS Modules,
  most component-scoped styling systems) always wins on a conflicting
  property, regardless of source/import order.
- A consumer's own CSS inside a **named layer declared after**
  `foundry-ui-compiled` wins too.
- A consumer's own `className` prop is merged the same way it always is on
  this package's atoms — via the internal `cx()`/`tailwind-merge` helper —
  independent of which stylesheet path is loaded; this behavior is already
  covered by every atom's own tests (e.g. `Button.test.tsx`) and does not
  change under the compiled-CSS path.

**Load exactly one path, never both.** `compiled.css` and the Tailwind-native
path (`theme.css` + a consumer's own `@source`-driven Tailwind build) both
generate declarations for the same class names, in different layers. Loading
both is not verified to be safe or idempotent — this repository has no
headless browser to check the resulting cascade in a real engine (see
below), so rather than claim untested double-load safety, the rule is
explicit: pick ONE path per project. There is no runtime double-load
detector (considered and deliberately not built — there is no reliable,
low-false-positive signal available without inspecting live CSSOM rules in a
real browser, the same cost this repository already declined elsewhere for
`@vespeneventures/ui`'s own test setup; see the introducing PR).

**What is and is not verified.** `src/compiled-css/coverage.test.tsx` renders
real atoms and cross-checks every class actually in the DOM against a fresh
`compiled.css`; `override.test.ts` proves — structurally, from the text of
the generated CSS itself — that 100% of its declarations sit inside the
named layer, which is what makes the override precedence above a spec
guarantee rather than a claim. What is **not** verified anywhere in this
package's test suite: the actual resolved `getComputedStyle` value a real
browser produces for a component under this path, in either theme, with or
without a brand binding. jsdom (this package's test environment) has no CSS
engine — it does not parse or apply stylesheets at all — and this repository
has no headless browser (declined elsewhere, in #163, for the same
dependency-cost reason [CONTRIBUTING.md](../../CONTRIBUTING.md)'s "the
default answer is no" states generally). Because `compiled.css` is a real
Tailwind compile of the
same tokens the Tailwind-native path already compiles, its declarations are
byte-identical to what a consumer's own Tailwind build would produce for the
same classes — this is a structural argument about how the file is produced,
not a substitute for a real-browser visual check a consumer cannot get from
this package's own CI today.

### Migration from split packages

| Legacy import | Use now |
| --- | --- |
| `@vespeneventures/tokens` | `@vespeneventures/ui/tokens` |
| `@vespeneventures/tokens/tokens.css` | `@vespeneventures/ui/tokens.css` |
| `@vespeneventures/tokens/theme.css` | `@vespeneventures/ui/theme.css` |
| `@vespeneventures/tokens/brand-template.css` | `@vespeneventures/ui/brand-template.css` |
| `@vespeneventures/ui/views` | `@vespeneventures/surface/web` for generic rendered views, or compose UI primitives in a surface. |

`atoms`, `blocks`, `icons`, `charts`, `shell`, and `gate` retain their UI
subpaths. There is no compatibility root barrel: importing the owning
subpath keeps dependencies and bundle boundaries explicit.

## Placement rules

Read this before adding a component. Where it goes on the ladder follows
from what it structurally does, not from how it feels while you're writing
it — run it through these tests, in order.

**1. Does it survive a route change?** If a component's whole job is to
still be on screen after the route underneath it changes — a nav rail, a
top bar, an app frame — it belongs to the **shell** layer, not to content.
The shell provides slots; views (and the blocks/atoms inside them) fill
those slots. A component whose entire point is to be *replaced* on every
navigation is never shell.

**2. Does it own multiple named regions?** If a component lays out several
regions that differ **in kind** — a title region, a description region, an
actions region, each doing a different job from the others — it's a
**block**. Otherwise it's an **atom**. The trap: a *list* of similar things
is not "multiple regions." A breadcrumb trail is a list of crumbs; a tab
bar is a list of tabs. Every item in that list plays the same role as
every other item — swap two crumbs and nothing about the component's job
changes. That's a homogeneous repeat, and it stays one atom no matter how
many items are in it. A page header's title, description, and actions
aren't interchangeable that way — each is a different kind of thing, and
the component's job is specifically to keep those different kinds apart.
That's a block.

**3. Can one page contain two of them?** This is what separates a **block**
from a **view**. If a page could reasonably show two of the thing at once —
two lists side by side, two forms on a settings page, three summary panels
in a row — it's a region of a page, so it's a **block**. If a second one on
the same page is incoherent, because the component *is* the page, it's a
**view**: a page can't have two 404s, and a sign-in page either is one or
isn't.

The consequence is that genuine views are rare, and that's correct rather
than a gap. A page's structure encodes what a product actually is, so most
page-level composition belongs to the consumer, assembled from blocks.
Only pages that are genuinely product-neutral — an error page, an
authentication page — are the same shape everywhere and worth shipping as
views. Shipping a view for something like a list page would mean
pre-assembling the exact thing a consumer is supposed to compose, and
every consumer whose layout differs would immediately need an escape
hatch — which is the variant-rule failure below, one rung up.

Size is not the test. A data table is large and intricate and is still a
block, because a page can hold two of them.

**4. Does it have a portal, a queue, and an imperative API?** A toast
stack, a modal manager, a global tooltip layer — anything that renders
outside the normal component tree, queues its own items, and is driven by
an imperative call rather than by props in the render tree — is a
**runtime service**, not a layout component. It doesn't sit on the
atoms/blocks/views/shell ladder at all; it needs its own home.

**The variant rule — does the variant change the SET of named regions?**
If yes, it is a different component, not a prop. A slim header (just a
title) and a full header (title, description, actions) have different
regions — they are two blocks, not one block with `variant="slim"`. If the
difference is padding, font size, or colour — the region set is identical,
only its styling changes — that's a prop, not a new component.

This is the rule most worth enforcing, because skipping it does the most
damage. A `variant`/`mode` prop that starts out covering a purely visual
difference is easy to reach for again the next time a *structural*
difference shows up — and once it does, the prop has to keep absorbing
every future consumer's divergence as a new named mode. The prop grows
without bound, and the component's internals accrete conditionals for
combinations that were never meant to compose and that nothing tests. Two
components that each compose the same atoms, in two separate files, share
no logic that can break that way — there's no shared branch for an
untested combination to hide in, because there's no shared branch.

**Slots beat mode props.** The same principle applies one level down,
inside a single component's own API: prefer a `ReactNode` slot (`actions`,
`icon`, `breadcrumb`) over a prop that switches the component's internal
structure. A slot lets the component own layout and styling around the gap
while the consumer owns what fills it — nothing either side does can
produce a combination the other has to guard against. A structural mode
prop instead makes the component itself responsible for every shape a
consumer might ever want inside it, which is the same unbounded-growth
problem as the variant rule above, just scoped to one component's props
instead of to which component to reach for.

## Setup

Two things have to both be true before an atom looks like anything: the
token CSS has to be imported, and Tailwind has to be told to scan this
package's compiled output for the classes it uses.

**1. Import the tokens' Tailwind wiring**, on top of Tailwind itself, in
your CSS entry point:

```css
@import "tailwindcss";
@import
  "@vespeneventures/ui/theme.css";
```

(`theme.css` already pulls in the base token file, so you don't need a
second line for that. The token layer's `brand-template.css` provides the
full three-layer contract, including how to bind brand colors over the
neutral greyscale default.)

**2. Point Tailwind's `@source` at this package's built output**, in the
same CSS file. This is the single highest-risk step in this whole setup: if
Tailwind never scans `dist/`, it never sees `bg-accent` or `rounded-control`
as classes anyone used, so it never generates them — every atom renders with
zero applied styling, and nothing in your build fails or warns about it.

```css
@source "./node_modules/@vespeneventures/ui/dist";
```

That exact line was compiled for real before it was written down here: a
built copy of this package was installed into a scratch project from its
packed tarball, a CSS entry importing `tailwindcss` + `theme.css` +
that `@source` line was compiled with the real Tailwind v4 CLI, and the
output was grepped for classes these components actually render —
`.bg-accent`, `.text-ink-on-accent`, `.rounded-pill`, `.px-md`,
`.text-body`, and more all came back present, each resolving to the real
token value with its fallback (for example
`.bg-accent { background-color: var(--color-accent, oklch(0.4748 0 0)); }`).
Adjust the path if your CSS entry file doesn't sit next to `node_modules` —
the target is always this package's `dist` directory, wherever
`node_modules/@vespeneventures/ui` resolves from where your bundler runs.

If your bundler's default content scan already covers everything under
`node_modules/@vespeneventures/ui` (some do), the `@source` line is
redundant but harmless. If you're not sure, add it — a redundant `@source`
costs nothing; a missing one costs every component's styling.

**pnpm + Turbopack:** a consumer integration reported that the plain-path
`@source` form above produces zero generated utility classes under Next.js
Turbopack specifically when the project uses pnpm — no error, no warning,
components just render unstyled, the same silent failure this whole section
warns about, but with the `@source` line already present and seemingly
correct. Their diagnosis: pnpm installs `node_modules/@vespeneventures/ui`
as a symlink into its content-addressable store, and Turbopack's file
watcher/source scanner does not follow that symlink, so it never sees
`dist/` at all. This repository has not independently reproduced that
Turbopack + pnpm interaction — treat it as a reported constraint, not a
verified one, and confirm against your own Turbopack version before relying
on it. Their workaround was `@source inline(...)` with the literal class
names instead of a path:

```css
@source inline("bg-accent text-ink-on-accent rounded-pill px-md text-body ...");
```

`@source inline(...)` takes a space-separated list of literal class names
(brace-expansion like `{sm,md,lg}` is supported for generating variants of
the same base) rather than a directory to scan, so it sidesteps file/symlink
resolution entirely — at the cost of having to enumerate every class you
actually use instead of Tailwind discovering them from `dist/`. If the
directory form above silently produces no styling under Turbopack + pnpm in
your project, try this instead.

**3. If a component still renders unstyled, call `assertTokenStylesLoaded`
first** — before chasing your Tailwind `@source` config or bundler setup.
Both steps above can silently fail to do anything (a missed import, a
`@source` path that resolves to nothing, the Turbopack + pnpm symlink case
just above) with no error and no warning anywhere; the result looks
identical to "I styled this component wrong" from inside your own code.
`assertTokenStylesLoaded`, from `@vespeneventures/ui/tokens`, tells you
which failure you actually have:

```ts
import { assertTokenStylesLoaded } from "@vespeneventures/ui/tokens";

// Call once, near your app's root — never as a side effect of importing
// the package, and never something that renders into the page.
assertTokenStylesLoaded();
```

It reads back a sentinel custom property (`--ui-tokens-loaded`) that
`styles/tokens.css` declares for exactly this purpose, and reports once,
via `console.error`, if that property is missing — meaning the CSS file
itself was never imported at all (step 1 above), a different failure than
an `@source` misconfiguration (step 2), which imports the CSS fine but
never generates the utility classes it needs. Dev-only (a no-op once
`process.env.NODE_ENV === "production"`), SSR-safe (a no-op wherever
`document` doesn't exist), and never renders anything into the page — pass
your own `onMissing` callback instead of the default `console.error` if you
want to route the signal elsewhere. See `assert-token-styles-loaded.ts`'s
own header for the full contract, including why this is a console signal
only and not the kind of injected page banner #148 removed.

### Wiring up a theme toggle

`tokens.css` already defines the three-state contract (see "CSS layers,
fallbacks, and themes" above): no `data-theme` follows the OS, and
`data-theme="light"`/`"dark"` force one regardless of the OS.
`@vespeneventures/ui/theme` is the JavaScript that drives that attribute.
Three pieces, used together:

**(a) The head script — before anything else in `<head>`.** A React
component cannot run before the document paints, so `ThemeProvider`
(below) necessarily corrects the theme one tick too late for a
server-rendered page: it would render the OLD theme for one frame, then
visibly flip. `getThemeInitScript()` returns a small, self-contained
script (as a string, ready for `dangerouslySetInnerHTML`) that reads the
same stored preference and applies the same three-state rule
SYNCHRONOUSLY, before the browser paints anything — there is no
component-based way to get this timing, which is why it's a separate
piece rather than something `ThemeProvider` does automatically:

```tsx
// app/layout.tsx (Next.js App Router) — first thing in <head>
import { getThemeInitScript } from "@vespeneventures/ui/theme";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <head>
        <script dangerouslySetInnerHTML={{ __html: getThemeInitScript() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

**(b) `ThemeProvider` — wrap your tree once, near the root.** Holds the
three-state preference in React state, persists it, and keeps
`<html data-theme>`/`color-scheme` in sync as it changes:

```tsx
import { ThemeProvider } from "@vespeneventures/ui/theme";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
```

**(c) `ThemeToggle` — an accessible control, anywhere inside the provider.**
Cycles System → Light → Dark → System (see `ThemeToggle.tsx`'s own doc
comment for why a cycling control rather than a switch-plus-reset pair):

```tsx
import { ThemeToggle } from "@vespeneventures/ui/theme";

function HeaderActions() {
  return <ThemeToggle />;
}
```

Reach for `useTheme()` directly when a component needs the current
preference or resolved theme without rendering a toggle itself:

```tsx
import { useTheme } from "@vespeneventures/ui/theme";

function CurrentThemeLabel() {
  const { preference, resolvedTheme } = useTheme();
  return <span>{preference} ({resolvedTheme})</span>;
}
```

`(a)` and `(b)` must agree on the same `storageKey` (default `"ui-theme"`
for both) — pass `{ storageKey: "..." }` to `getThemeInitScript` and
`storageKey="..."` to `ThemeProvider` together if you override it, or the
head script will stamp the theme from one key while the provider persists
to another.

## Why these dependencies

- **`react-aria-components`** — every interactive atom (`Button`,
  `TextField`, `Link`, `Checkbox`, `Switch`, `Select`, `Textarea`, `Menu`,
  `Dialog`, `Tabs`, `Table`, `Tooltip`, `RadioGroup`, `Popover`, `DateField`,
  `ComboBox`, `SearchField`, `FileTrigger`, `Disclosure`, `ProgressBar`) is
  built on its primitives rather than a hand-rolled `<button>`/`<input>`/`<a>`. It
  supplies keyboard interaction (Enter/Space activation, focus management,
  arrow-key navigation), the ARIA attributes a screen reader needs
  (`aria-invalid`, `aria-describedby` linking an input to its error text,
  label association, `role="menu"`/`aria-checked`/`aria-expanded` and the
  rest), and disabled-state semantics — the kind of behavior that is easy to
  get subtly wrong by hand and hard to notice is wrong without a screen
  reader or a keyboard-only pass. `Badge`, `Card`, `Avatar`, `Spinner`,
  `Skeleton`, and `Banner` compose no other atom and aren't interactive, so
  they're plain markup — there's no react-aria-components primitive for any
  of them; `Field` renders no react-aria-components primitive of its own
  either, since the whole point of it is wrapping a control that doesn't
  have one. `Breadcrumb`, `Select`, and `Menu` build on it for their
  collection components specifically: `Breadcrumbs`/`Breadcrumb`/`Link`
  supply correct nav semantics and automatic `aria-current` placement;
  `Select`/`ListBox`/`ListBoxItem`/`Popover` supply a listbox's open/close,
  typeahead, and selection behavior; `MenuTrigger`/`Menu`/`MenuItem`/
  `Popover` supply a menu's open/close, arrow-key navigation, and
  disabled-item skipping. `Dialog` builds on `DialogTrigger`/`ModalOverlay`/
  `Modal`/`Dialog`/`Heading` for a focus-trapped, scroll-locked,
  Escape-to-dismiss overlay with automatic focus restoration; `Popover`
  builds on that same `DialogTrigger`/`Dialog` pairing with an anchored,
  scrim-less `Popover` standing in for `Dialog`'s centered
  `ModalOverlay`+`Modal`; `Tabs` builds on `Tabs`/`TabList`/`Tab`/`TabPanel`
  for roving-tabindex arrow-key navigation between panels; `Table` builds on
  `Table`/`TableHeader`/`TableBody`/`Column`/`Row`/`Cell` for real grid
  semantics, sorting, and row selection (including the indeterminate
  select-all state, via this package's own `Checkbox` atom — see `Table`'s
  own section below); `Tooltip` builds on `TooltipTrigger`/`Tooltip` for
  hover-AND-focus opening, Escape-to-dismiss, and the warm-up/cool-down
  delay between tooltips shown in quick succession; `RadioGroup` builds on
  `RadioGroup`/`Radio` for roving-tabindex arrow-key navigation between
  options and `role="radiogroup"`/`role="radio"`/`aria-checked` wiring;
  `DateField` builds on `DateField`/`DateInput`/`DateSegment` for
  per-segment keyboard editing, auto-advance between segments, and
  locale-correct segment order; `ComboBox` builds on `ComboBox`/`Input`/
  `Button`/`Popover`/`ListBox`/`ListBoxItem` for live filtering plus every
  behavior `Select` already gets from the same underlying popover/listbox
  shape; `SearchField` builds on `SearchField`/`Input`/`Button` for
  `type="search"` semantics, a clear button wired through context, and
  Escape-to-clear; `FileTrigger` builds on `FileTrigger` for OS file-picker
  access from an arbitrary pressable trigger; `Disclosure` builds on
  `Disclosure`/`DisclosurePanel` for `aria-expanded`/`aria-controls` wiring
  and keeping collapsed content in the DOM (toggling `hidden`, not
  mounting/unmounting); `ProgressBar` builds on `ProgressBar` for
  `role="progressbar"`/`aria-valuenow`/`aria-valuetext` wiring, including
  correctly omitting `aria-valuenow` while indeterminate. `Chip`'s remove
  control is react-aria-components' own `Button` (unstyled, no props of its
  own beyond `onPress`/`aria-label`), for the same Enter/Space/focus-visible
  handling every other interactive control here gets; `Separator` builds on
  `Separator` for a real `<hr>` (horizontal) or `role="separator"` `<div>`
  (vertical) rather than a `<div>` styled to look like a rule. None of that
  behavior is reimplemented here — it would be easy to get subtly wrong
  hand-rolled, which is the whole reason this package leans on
  react-aria-components for every interactive atom rather than building any
  of it from scratch.
- **`@internationalized/date`** — `DateField`'s `value`/`defaultValue` are
  react-stately `DateValue`s (a `CalendarDate`, `CalendarDateTime`, or
  `ZonedDateTime`), not a native JS `Date` or an ISO string: a plain `Date`
  has no way to represent "just a date" without smuggling in a timezone,
  which is exactly the ambiguity a calendar-aware type exists to avoid.
  react-aria-components' own date primitives are built around this type
  internally regardless of whether a consumer ever imports the package
  directly — but constructing an initial or controlled value at all
  (`parseDate("2024-01-15")`, `new CalendarDate(2024, 1, 15)`) means a
  consumer of `DateField` needs it too, so it is a documented optional peer
  rather than an unlisted transitive of `react-aria-components`.
- **`tailwind-merge`** — every atom accepts a `className` prop, and a
  consumer's value has to reliably win over this package's own default
  classes. Two Tailwind utilities that set the same CSS property have
  identical specificity, so which one wins is otherwise decided by source
  order in the generated stylesheet, not by which one you passed last. This
  package's internal `cx()` helper resolves that with `tailwind-merge`,
  additionally taught this package's own spacing/radius/font-size/tracking
  scale (`px-md`, `rounded-pill`, `text-body`, ...) via
  `extendTailwindMerge` — `tailwind-merge`'s own default configuration only
  recognizes Tailwind's built-in scale names, so out of the box it would
  neither merge `px-md` against a consumer's `px-8` nor (worse) correctly
  keep a font-size class like `text-body` and a color class like
  `text-ink-on-accent` both applied at once. Both of those exact failures
  are pinned as regression tests in this package's test suite.

These packages are optional peers so a token-only consumer installs none of
the component runtime. A component consumer must install the matching peers
alongside `@vespeneventures/ui`; npm can then report a missing peer instead
of allowing a hidden transitive dependency to decide the runtime version.

No `class-variance-authority` or similar: each atom's variants are a plain
object literal mapping a variant name to a class string.

## Atoms

Every example below assumes the setup above is done. `variant`/`size` are
shown at their defaults for clarity; omitting them is equivalent.

### `Button`

```tsx
import { Button } from "@vespeneventures/ui/atoms";

function SaveButton() {
  return (
    <Button variant="primary" size="md" onPress={() => save()}>
      Save
    </Button>
  );
}
```

`variant`: `"primary" | "secondary" | "ghost" | "danger"` (default
`"primary"`). `size`: `"sm" | "md" | "lg"` (default `"md"`). Accepts every
prop react-aria-components' own `Button` does — `isDisabled`, `onPress`,
`type`, and so on.

### `Icon`

```tsx
import { Icon } from "@vespeneventures/ui/atoms";
import { Clock } from "@vespeneventures/ui/icons";

function LastUpdated({ label }: { label: string }) {
  return (
    <span>
      <Icon glyph={Clock} decorative /> {label}
    </span>
  );
}

function SearchTrigger() {
  return <Icon glyph={Clock} label="Search" />;
}
```

The render CONTRACT for an icon — size, colour, accessibility — applied to
either structured glyph DATA (`glyph`, the shape `@vespeneventures/ui/icons`
ships) or arbitrary `children` (raw SVG elements, or a component that
renders them, for a one-off brand mark). Exactly one of the two is required
at the type level; supplying both, or neither, is a compile error, not a
silent default — see "Accessibility" below for the identical enforcement
shape applied to `decorative`/`label`.

**No name lookup.** There is no `<Icon name="clock" />` string-keyed
registry — a NAME string would itself be a mode prop in disguise, making
`Icon` responsible for knowing every glyph a caller might ever want, the
same unbounded-growth failure "Placement rules" → "Slots beat mode props"
above describes for a structural mode prop. `glyph`/`children` are ordinary
`ReactNode`-shaped slots instead: a consumer's own glyph — vendored from
`@vespeneventures/ui/icons`, hand-copied from a design tool, or a whole
custom brand mark — is a first-class input with no extension mechanism to
learn, the same way `Menu`'s `trigger` or `PageHeader`'s `actions` already
are.

**Colour** always inherits `currentColor` — there is no `color`/`fill`/
`stroke` prop (`IconProps` `Omit`s those keys from the SVG props it
otherwise forwards), so passing one is a compile-time error, not a
silently-ignored prop. Set CSS `color` on the icon itself or an ancestor
instead, the same mechanism `Spinner` and `Skeleton` already use above.

**Size** (`size`: `"sm" | "md" | "lg"`, default `"md"`) reads
this package's `--ui-icon-sm`/`-md`/`-lg` tokens (`16px`/
`24px`/`32px` by default), each with a literal pixel fallback so `Icon`
still renders at a sensible size even in a project that hasn't imported
`@vespeneventures/ui/tokens.css`. **Stroke weight** reads
`--ui-icon-stroke` (default `2`) the same way — a real brand lever (the
token is `brandable: true`, the same category as `--radius-default`), not
a per-instance prop: there is no `strokeWidth`/`width`/`height` prop either,
for the same "the token is the only lever" reason colour has none.

**Accessibility** is enforced at compile time, ported from this scope's
own pre-merge, standalone `icons` package's own contract:

```tsx
// Decorative — adds no information beyond text already next to it.
<Icon glyph={Clock} decorative />

// Meaningful — the ONLY signal of what this is. Carries an accessible name.
<Icon glyph={Clock} label="Last updated 3 hours ago" />

// Compile error: TypeScript rejects this before it ever reaches a browser.
// <Icon glyph={Clock} />
```

`decorative: true` and `label` are mutually exclusive (also a compile
error together). `src/atoms/internal/icon-contract.check.tsx` is a small
file, compiled by the same `tsc` run as everything else in this package
(unlike a `*.test.tsx` file — see that file's own header comment, and
issue #24, for why that distinction matters here), that fails the build if
either the accessibility contract or the `glyph`/`children` content
contract ever regresses.

`className`/`style` merge with `Icon`'s own defaults the same way every
other atom's do — a consumer's value always wins on conflict.

### `TextField`

```tsx
import { TextField } from "@vespeneventures/ui/atoms";

function EmailField() {
  return (
    <TextField
      label="Email"
      description="We'll never share this."
      placeholder="you@example.com"
      isRequired
    />
  );
}
```

`label` is required and renders a real `<label>`, associated with the input
by id — not a `placeholder` standing in for it. `description` and
`errorMessage` are both wired to the input via `aria-describedby`;
`errorMessage` (string, or a function of react-aria-components'
`ValidationResult`) only renders while the field `isInvalid`.

### `Badge`

```tsx
import { Badge } from "@vespeneventures/ui/atoms";

function Status() {
  return <Badge variant="success">Active</Badge>;
}
```

`variant`: `"neutral" | "success" | "warning" | "danger" | "info"` (default
`"neutral"`).

### `Card`

```tsx
import { Card } from "@vespeneventures/ui/atoms";

function Panel() {
  return <Card className="max-w-sm">Plain content, raised off the page.</Card>;
}
```

Accepts every prop a plain `<div>` does. No variants — a single raised
surface, styled with this package's elevation token.

### `Breadcrumb`

```tsx
import { Breadcrumb } from "@vespeneventures/ui/atoms";

function PromptTrail() {
  return (
    <Breadcrumb>
      <Breadcrumb.Item href="/">Home</Breadcrumb.Item>
      <Breadcrumb.Item href="/prompts">Prompts</Breadcrumb.Item>
      <Breadcrumb.Item>Untitled prompt</Breadcrumb.Item>
    </Breadcrumb>
  );
}
```

Built on react-aria-components' `Breadcrumbs` + `Breadcrumb` + `Link`
collection components, not hand-rolled. Whichever `Breadcrumb.Item` is LAST
among its siblings is automatically rendered as the current page — inert
text carrying `aria-current="page"` instead of a clickable `<a>` — purely
from its position in the list; there's no separate "is this the current
one" prop to set or forget. The whole trail is wrapped in a `<nav>` landmark
(`aria-label="Breadcrumb"` by default, overridable) so it's reachable as a
landmark, not just an unlabeled list.

`Breadcrumb.Item` takes an optional `href` — omit it for a step with no
navigable target. Composable JSX children rather than a flat
`items={[...]}` array: react-aria-components' `Breadcrumbs` is itself built
to take real JSX children, and breadcrumb labels are usually already
`ReactNode`s (an icon + text, a truncated title) rather than plain strings.
A genuinely data-driven trail can still `.map()` an array into
`Breadcrumb.Item`s — ordinary React, nothing about this API needs to change
to support it.

`Breadcrumb` ships as an atom, not a block, even though it's composable and
built from a `.Item` sub-component: its items are a homogeneous repeat (any
crumb plays the same role as any other) rather than a set of regions that
differ in kind. See "Placement rules" above.

### `Link`

```tsx
import { Link } from "@vespeneventures/ui/atoms";

function PromptsLink() {
  return (
    <Link href="/prompts" variant="default">
      Prompts
    </Link>
  );
}
```

`variant`: `"default" | "muted" | "standalone"` (default `"default"`).
`default` reads as inline text (colored, underlined on hover) — the right
choice inside a sentence or paragraph. `muted` is lower-emphasis, for
secondary chrome that shouldn't compete with primary content. `standalone`
is for a link that IS the whole clickable unit on its own (a card title, a
nav item), where a permanent underline would read as noise.

Renders a real `<a href="...">` by default. A consumer whose app uses a
router with its own link component can render that instead via
react-aria-components' own `render` prop, rather than a bespoke `as` prop of
this component's own:

```tsx
<Link href="/prompts" render={(props) => <RouterLink {...props} to="/prompts" />}>
  Prompts
</Link>
```

### `Checkbox`

```tsx
import { Checkbox } from "@vespeneventures/ui/atoms";

function SelectAllRows({ isAllSelected, isSomeSelected, onToggle }: {
  isAllSelected: boolean;
  isSomeSelected: boolean;
  onToggle: (isSelected: boolean) => void;
}) {
  return (
    <Checkbox isSelected={isAllSelected} isIndeterminate={isSomeSelected} onChange={onToggle}>
      Select all
    </Checkbox>
  );
}
```

`isIndeterminate` is presentational only — react-aria-components' own
contract, not this component's addition: it doesn't change `isSelected`, so
a select-all checkbox like the one above is still responsible for setting
both from its own row-selection state. This is the state `DataTable`'s own
select-all checkbox needs — see `DataTable` under "Blocks" below — and the
reason `Checkbox` was prioritized ahead of it.

### `Switch`

```tsx
import { Switch } from "@vespeneventures/ui/atoms";

function EmailNotificationsToggle() {
  return <Switch onChange={(isOn) => save(isOn)}>Email notifications</Switch>;
}
```

Semantically distinct from `Checkbox` even though both toggle a boolean: a
switch takes effect immediately (turning a setting on/off), while a
checkbox marks a pending selection that typically waits for a separate
submit/save action. `role="switch"` (not `role="checkbox"`) is what
communicates that to assistive tech, which is why this is its own component
rather than `Checkbox` with different styling.

### `Select`

```tsx
import { Select } from "@vespeneventures/ui/atoms";

function FavoriteFruitField() {
  return (
    <Select
      label="Favorite fruit"
      description="Used for the weekly snack order."
      placeholder="Pick one"
      options={[
        { id: "apple", label: "Apple" },
        { id: "banana", label: "Banana" },
        { id: "cherry", label: "Cherry", isDisabled: true },
      ]}
      onChange={(id) => setFavoriteFruit(id)}
    />
  );
}
```

A labeled dropdown of mutually-exclusive options — the same label/
description/error surface as `TextField`, for a closed, single-choice set
instead of free text. `options` is a plain array (`{ id, label, isDisabled?,
textValue? }`) rather than JSX children: a select's option set is close to
always already data, rather than something a consumer hand-writes as
markup. Built on react-aria-components' `Select` + `Button` (its OWN
`Button`, not this package's atom — see "Atoms compose no other atom"
below) + `Popover` + `ListBox`/`ListBoxItem`, which supply opening on click
or ArrowUp/ArrowDown/Enter/Space, closing on Escape or an outside click,
arrow-key navigation that skips disabled options, typeahead, and the
`aria-expanded`/`aria-haspopup`/`role="listbox"` wiring a screen reader
needs.

### `Textarea`

```tsx
import { Textarea } from "@vespeneventures/ui/atoms";

function DescriptionField() {
  return (
    <Textarea
      label="Description"
      description="Markdown supported."
      rows={6}
      placeholder="What is this prompt for?"
    />
  );
}
```

`TextField`'s sibling for content that runs longer than one line — the same
label/description/error surface, built the same way on
react-aria-components' `TextField` + `Label` + `TextArea` + `FieldError`. A
separate component from `TextField` rather than a `multiline` prop on it:
the two render different DOM elements (`<textarea>` vs `<input>`) with
different native behavior, a structural difference rather than a purely
visual one (see the README's "variant rule").

### `Avatar`

```tsx
import { Avatar } from "@vespeneventures/ui/atoms";

function UserAvatar() {
  return <Avatar src={user.imageUrl} alt={user.fullName} size="md" />;
}
```

`size`: `"sm" | "md" | "lg"` (default `"md"`). Shows the image at `src`; if
`src` is omitted, or the image fails to load, falls back to initials
derived from `alt`. Not interactive and composes no other atom — plain
markup, like `Badge`/`Card`.

### `Spinner`

```tsx
import { Spinner } from "@vespeneventures/ui/atoms";

function LoadingPrompts() {
  return <Spinner label="Loading prompts" size="md" />;
}
```

`size`: `"sm" | "md" | "lg"` (default `"md"`). Plain SVG using
`currentColor`, so it inherits whatever text color is already in effect at
its render site (correct by default inside a colored `Button`, with no
`variant` prop of its own to keep in sync with the parent's). `label` is
optional: provide it when the spinner is itself the only signal that
something is loading — it then renders `role="status"` with that as its
accessible name. Omit it when the spinner is purely decorative (e.g. next
to a button's own "Saving…" text, which already announces the state) — it
then renders `aria-hidden="true"` instead.

### `Menu`

```tsx
import { Menu } from "@vespeneventures/ui/atoms";
import { Button } from "@vespeneventures/ui/atoms";

function RowActionsMenu() {
  return (
    <Menu trigger={<Button variant="ghost">Actions</Button>}>
      <Menu.Item onAction={() => edit()}>Edit</Menu.Item>
      <Menu.Item onAction={() => duplicate()}>Duplicate</Menu.Item>
      <Menu.Separator />
      <Menu.Item onAction={() => remove()} isDestructive>
        Delete
      </Menu.Item>
    </Menu>
  );
}
```

A dropdown menu of actions, opened from a `trigger` slot. Built on
react-aria-components' `MenuTrigger` + `Menu` + `MenuItem` + `Popover` — the
most involved composition in this package, for the same reason it was
built last: opening on click or ArrowUp/ArrowDown/Enter/Space, closing on
Escape/an outside click/selecting an item, arrow-key navigation that skips
disabled items entirely (never just visually dimmed), typeahead, and the
`role="menu"`/`role="menuitem"`/`aria-expanded`/`aria-haspopup` wiring —
none of it reimplemented here.

`Menu.Item` takes an `isDestructive` prop for actions like "Delete" —
danger-colored styling, purely visual, doesn't change keyboard/selection
behavior. `Menu.Separator` is a visual divider between item groups.

There is deliberately no `aria-label` prop on `Menu` itself:
react-aria-components' `MenuTrigger` always wires the menu's
`aria-labelledby` to the trigger element, and per the ARIA accessible-name
computation, `aria-labelledby` on an element always wins over an
`aria-label` on that same element — a hypothetical `aria-label` prop here
would render into the DOM but never actually be announced. Give the
TRIGGER its own accessible name instead (visible text, or `aria-label` for
an icon-only trigger) and the menu inherits it automatically through that
same link:

```tsx
<Menu trigger={<Button aria-label="More actions">⋯</Button>}>
  <Menu.Item onAction={() => edit()}>Edit</Menu.Item>
</Menu>
```

`Menu` composes no other atom of its own, even though its `trigger` slot is
commonly filled with this package's own `Button` atom by a consumer (as
above): that's the consumer's own composition, in their code, the same way
a `Button` can be passed into `PageHeader`'s `actions` slot without
`PageHeader` importing `Button` itself.

`Menu` ships as an atom, not a block, despite composing a trigger and a
list of items: unlike `PageHeader`'s simultaneously-visible title/
description/actions regions, `Menu`'s trigger and its item list are never
both "on" at once — closed shows only the trigger, open shows only the
popover — the same single-control-with-two-states shape as `Select` (also
an atom here), not a layout of multiple simultaneous named regions.

### `Dialog`

```tsx
import { Dialog } from "@vespeneventures/ui/atoms";
import { Button } from "@vespeneventures/ui/atoms";

function SettingsDialog() {
  return (
    <Dialog trigger={<Button variant="secondary">Settings</Button>}>
      <Dialog.Heading>Settings</Dialog.Heading>
      <p>Configure your workspace preferences here.</p>
    </Dialog>
  );
}
```

A modal dialog, opened from a `trigger` slot — the same composable shape
`Menu` uses (a trigger plus content, rather than a fixed prop shape). Built
on react-aria-components' `DialogTrigger` + `ModalOverlay` + `Modal` +
`Dialog`, which supply everything a modal overlay needs to be safe to use:
a focus trap (Tab/Shift+Tab never leave the dialog while it's open), focus
restoration to the trigger when it closes, Escape to dismiss (always —
never gated behind any prop this component exposes), and a page-level
scroll lock for as long as the dialog is open. None of it reimplemented
here.

`size`: `"sm" | "md" | "lg"` (default `"md"`), controlling the dialog
surface's max width. A legitimate prop rather than three separate
components under this package's variant rule: the region set — one dialog
surface, one scrim — is identical at every size; only the width changes.

`Dialog.Heading` wraps react-aria-components' own `Heading`, rendered into
the internal `"title"` slot `Dialog` provides. That slot is what wires the
dialog's `aria-labelledby` to this heading's own generated id — the reason
a `Dialog` needs no separate `aria-label`/`title` prop of its own, the same
way `Menu` needs no `aria-label` because its trigger already supplies one.
Omit `Dialog.Heading` and the dialog falls back to being labelled by its
TRIGGER's own accessible text instead (react-aria-components' documented
fallback for a title-less dialog) — valid, but usually the wrong name (it
announces the button that opened the dialog, not what the dialog itself
is), so every dialog with real title text should render one.

`children` may also be a function, receiving `{ close }` — react-aria-components'
own `Dialog` children shape — for a footer control that closes the dialog
imperatively without threading `isOpen` state back out to wherever the
trigger is rendered:

```tsx
<Dialog trigger={<Button variant="secondary">Delete account</Button>}>
  {({ close }) => (
    <>
      <Dialog.Heading>Delete account?</Dialog.Heading>
      <p>This can't be undone.</p>
      <Button variant="danger" onPress={() => { deleteAccount(); close(); }}>
        Delete
      </Button>
    </>
  )}
</Dialog>
```

`Dialog` ships as an atom, not a block, for the same reason `Menu` does:
its trigger and its content are never both "on" at once (closed shows the
trigger, open shows the dialog), not a layout of simultaneously-visible
named regions. `ConfirmDialog` — `Dialog` composed with a fixed heading +
message + Confirm/Cancel `Button`s — IS that kind of layout (three regions
that differ in kind, always visible together once open), which makes it a
block by the same test; see "Blocks" below.

### `Tabs`

```tsx
import { Tabs } from "@vespeneventures/ui/atoms";

function PromptSections() {
  return (
    <Tabs>
      <Tabs.List aria-label="Prompt sections">
        <Tabs.Tab id="details">Details</Tabs.Tab>
        <Tabs.Tab id="history">History</Tabs.Tab>
        <Tabs.Tab id="settings" isDisabled>
          Settings
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel id="details">Details content.</Tabs.Panel>
      <Tabs.Panel id="history">History content.</Tabs.Panel>
      <Tabs.Panel id="settings">Settings content.</Tabs.Panel>
    </Tabs>
  );
}
```

Tabbed navigation between panels of content, composed from `Tabs.List`
(containing `Tabs.Tab`s) and one `Tabs.Panel` per tab. Built on
react-aria-components' `Tabs` + `TabList` + `Tab` + `TabPanel`, which
supply roving-tabindex focus management (only the selected tab sits in the
page's Tab sequence; the rest are reached with the arrow keys, not Tab),
Left/Right arrow-key navigation with wraparound, Home/End jumping to the
first/last enabled tab, disabled tabs skipped entirely during arrow
navigation (never just visually dimmed, the same as `Menu`'s disabled
items), and the `aria-selected`/`aria-controls`/`aria-labelledby` wiring
between each tab and its panel — none of it reimplemented here. A
`Tabs.Tab`'s `id` must match the `id` of the `Tabs.Panel` it controls;
react-aria-components derives the ARIA pairing from that shared id.

`Tabs` ships as an atom, not a block: its `Tabs.Tab` children are a
homogeneous repeat — any tab plays the same role as any other, a label
that selects a panel — the same shape as `Breadcrumb`'s crumbs, not a set
of regions that differ in kind. See "Placement rules" above, test 2 (the
tab-bar example is called out there by name). `Tabs.List` needs its own
`aria-label` (or `aria-labelledby`) when a page has more than one tab
list, the same way `Breadcrumb`'s `<nav>` does — there's no sensible
default, since "Tabs" describes every tab list equally badly.

### `Table`

```tsx
import { Table } from "@vespeneventures/ui/atoms";

interface PromptRun {
  id: string;
  name: string;
  runs: number;
}

function PromptRunsTable({ rows }: { rows: PromptRun[] }) {
  return (
    <Table aria-label="Prompt runs">
      <Table.Header>
        <Table.Column id="name" isRowHeader allowsSorting>
          Name
        </Table.Column>
        <Table.Column id="runs" allowsSorting>
          Runs
        </Table.Column>
      </Table.Header>
      <Table.Body>
        {rows.map((row) => (
          <Table.Row key={row.id} id={row.id}>
            <Table.Cell>{row.name}</Table.Cell>
            <Table.Cell>{row.runs}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  );
}
```

Table PRIMITIVES — `Table`, `Table.Header`, `Table.Column`, `Table.Body`,
`Table.Row`, `Table.Cell` — not a finished data grid on their own. This is
the substrate `DataTable` (see "Blocks" below) assembles a real table
from, the same way react-aria-components' own docs compose them: no
`columns`/`rows` data props, no built-in pagination, filtering, or toolbar
at this layer. `DataTable` — that finished, opinionated assembly — is a
**block** built on top of these primitives (a page can hold two data
tables, so by this package's own "can one page contain two of them" test
it's a block, not a view).

Built on react-aria-components' `Table`/`TableHeader`/`TableBody`/
`Column`/`Row`/`Cell`, which supply real `<table>`/`<thead>`/`<tbody>`/
`<th>`/`<tr>`/`<td>` semantics (this renders as an actual HTML table, not
a `role="grid"` `<div>` soup); grid-style keyboard navigation (arrow keys
in every direction between cells, plus Home/End and Ctrl+Home/End); and,
via props passed straight through on `Table` itself, sorting
(`sortDescriptor`/`onSortChange`, `Table.Column`'s `allowsSorting`) and row
selection (`selectionMode`/`selectedKeys`/`onSelectionChange`). None of it
reimplemented here.

```tsx
<Table
  aria-label="Prompt runs"
  sortDescriptor={sortDescriptor}
  onSortChange={setSortDescriptor}
  selectionMode="multiple"
  selectedKeys={selectedKeys}
  onSelectionChange={setSelectedKeys}
>
  <Table.Header>
    <Table.Column>
      <Table.SelectAllCheckbox />
    </Table.Column>
    <Table.Column id="name" isRowHeader allowsSorting>
      Name
    </Table.Column>
  </Table.Header>
  <Table.Body>
    {rows.map((row) => (
      <Table.Row key={row.id} id={row.id}>
        <Table.Cell>
          <Table.SelectionCheckbox />
        </Table.Cell>
        <Table.Cell>{row.name}</Table.Cell>
      </Table.Row>
    ))}
  </Table.Body>
</Table>
```

`Table.SelectAllCheckbox` (place inside a `Table.Column`) and
`Table.SelectionCheckbox` (place inside a `Table.Cell`, one per
`Table.Row`) are thin wrappers that render this package's own `Checkbox`
atom with `slot="selection"` — react-aria-components' `Table` provides
`isSelected`/`isIndeterminate`/`onChange` for exactly that slot, computed
from the real selection state, so neither wrapper reads or recomputes any
of it. `Checkbox` already supports the `isIndeterminate` state a
select-all control needs (see `Checkbox`'s own section above) — reusing it
here, rather than a second hand-rolled checkbox, is exactly what that
support was built for. This makes `Table` the one atom in this package
that composes ANOTHER atom of its own; see "Atoms compose no other atom"
above for why that's the ladder's explicitly-permitted direction (a
sibling atom, not a `blocks/` import) rather than an exception carved out
for it.

### `Field`

```tsx
import { Field } from "@vespeneventures/ui/atoms";

function SignatureField() {
  return (
    <Field label="Signature" description="Draw your signature below.">
      {(fieldProps) => <SignaturePad {...fieldProps} />}
    </Field>
  );
}
```

The general form of the label/description/error surface `TextField`
bundles with its own `<input>` — for a control this package doesn't ship an
atom for (a third-party rich-text editor, a `<canvas>`-based signature pad,
any future control not yet built here). `children` is a render prop, not a
fixed element cloned via `React.cloneElement`: an arbitrary control has no
guaranteed prop shape a blind clone could safely merge into, so `Field`
hands the control's own author exactly the id/`aria-describedby`/
`aria-invalid`/`aria-required` values to spread themselves, in their own
code, onto whichever element actually needs them — the same function-prop
shape `Dialog`'s children and `Table.Body`'s `renderEmptyState` already use
in this package. Id generation uses React's own `useId()`, since `Field`
renders no react-aria-components primitive of its own to generate one for
free the way every other field atom here does.

### `Skeleton`

```tsx
import { Skeleton } from "@vespeneventures/ui/atoms";

function LoadingPromptCard() {
  return (
    <div className="flex flex-col gap-sm">
      <Skeleton shape="circle" className="h-10 w-10" aria-label="Loading prompt" />
      <Skeleton shape="text" />
      <Skeleton shape="block" className="h-24" />
    </div>
  );
}
```

A loading placeholder, styled with `--color-skeleton-fill` (the token named
specifically for this purpose). `shape`: `"text" | "block" | "circle"`
(default `"text"`) — a text-height line, a container-filling block, or an
`Avatar`-shaped circle. Every `Skeleton` is `aria-hidden="true"` by default
(purely decorative); provide `aria-label` on the ONE `Skeleton` that stands
in for a whole loading region (not on every piece inside it) and it renders
`role="status"`/`aria-busy="true"` instead, announcing itself the same way
`Spinner`'s own optional `label` does.

### `Tooltip`

```tsx
import { Tooltip, Button } from "@vespeneventures/ui/atoms";

function InfoTooltip() {
  return (
    <Tooltip trigger={<Button aria-label="Why is this required?">?</Button>}>
      Required for tax purposes.
    </Tooltip>
  );
}
```

A short description of another element, shown on hover AND keyboard focus
by default — built on react-aria-components' `TooltipTrigger` + `Tooltip`,
which supply the `aria-describedby` wiring, Escape-to-dismiss, and a
"warm up"/"cool down" delay between tooltips shown in quick succession.
`trigger` must be a react-aria-components-aware element (this package's own
`Button`, or react-aria-components' own) — the same requirement `Menu`'s and
`Dialog`'s own `trigger` slot document, since the open/hover/focus behavior
is wired on via context, not by cloning arbitrary props onto whatever's
passed in. `placement`: any react-aria-components `Placement` (default
`"top"`). `triggerAction`: `"focus"` restricts opening to keyboard focus
only, never hover — react-aria-components' own trigger-mode prop, renamed
here to avoid colliding with this component's own `trigger` (the element),
the identical collision `Menu`'s `triggerAction` already resolves the same
way.

### `Banner`

```tsx
import { Banner } from "@vespeneventures/ui/atoms";

function TrialEndingBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <Banner variant="warning" onDismiss={onDismiss}>
      Your trial ends in 3 days.
    </Banner>
  );
}
```

A persistent inline message region — not a toast (see `@vespeneventures/ui/shell`'s
`Toaster`): this renders exactly where it sits in the page's render tree,
not through a portal or a queue. `variant`: `"info" | "success" | "warning" |
"danger"` (default `"info"`) — the same four status tokens `toast(...)`'s
variants and `Badge`'s status variants already share. `role`/`aria-live`
follow severity: `danger` is an assertive `role="alert"`; every other
variant is a polite `role="status"`, the identical severity-to-live-region
mapping `Toaster`'s own `ToasterContent` already uses. `onDismiss` is
optional — supplying it renders a dismiss control, but `Banner` never
removes itself from the tree on its own; the caller decides whether/when it
stops rendering.

### `RadioGroup`

```tsx
import { RadioGroup } from "@vespeneventures/ui/atoms";

function DeliverySpeedField() {
  return (
    <RadioGroup label="Delivery speed" defaultValue="standard">
      <RadioGroup.Radio value="standard">Standard</RadioGroup.Radio>
      <RadioGroup.Radio value="express" description="Arrives in 2 days.">
        Express
      </RadioGroup.Radio>
      <RadioGroup.Radio value="overnight" isDisabled>
        Overnight (unavailable in your area)
      </RadioGroup.Radio>
    </RadioGroup>
  );
}
```

`Select`'s sibling for a small, fixed set of mutually-exclusive options that
should stay visible side by side rather than living behind a closed
trigger. Built on react-aria-components' `RadioGroup` + `Radio`, which
supply roving-tabindex arrow-key navigation between enabled options,
Space to select the focused one, and the `role="radiogroup"`/`role="radio"`/
`aria-checked` wiring a screen reader needs. `label`, `description`, and
`errorMessage` follow the same convention `TextField`'s and `Select`'s own
do. `children` is composable JSX (`RadioGroup.Radio`s), not a data array
like `Select`'s `options`: a visible set of options routinely differs
option-by-option (a per-option `description`, a disabled option) in a way
that reads more naturally as hand-written markup, the same reasoning
`Menu`'s and `Tabs`' own JSX-children shape already follow.

### `Popover`

```tsx
import { Popover, Button } from "@vespeneventures/ui/atoms";

function FiltersPopover() {
  return (
    <Popover trigger={<Button variant="secondary">Filters</Button>}>
      {({ close }) => (
        <div className="flex flex-col gap-sm">
          <p>Filter controls go here.</p>
          <Button onPress={close}>Apply</Button>
        </div>
      )}
    </Popover>
  );
}
```

The general anchored-overlay primitive — an arbitrary panel of content,
positioned relative to a trigger, for anything `Menu`/`Select`/`Tooltip`'s
own specific content shapes don't already fit (a filter panel with several
controls, a small inline form). Built on react-aria-components'
`DialogTrigger` + `Popover` + `Dialog` — the same composition this
package's own `Dialog` atom uses, with an anchored, scrim-less `Popover`
standing in for `Dialog`'s centered `ModalOverlay`+`Modal`. Supplies a
focus trap, automatic focus-move into the content on open, focus
restoration to `trigger` on close, Escape to dismiss, and dismissal on any
outside click (always — an anchored popover with no scrim has no OTHER way
to signal "click away to close"). `placement` (default `"bottom"`) and
`offset` (default `8`) control positioning; `children` may be a function
receiving `{ close }`, the same shape `Dialog`'s own children accept. While
open, everything outside the popover is `aria-hidden` — the same choice
`Menu`'s and `Select`'s own popovers already make, not overridden here with
react-aria-components' `isNonModal` escape hatch (reserved, per its own
docs, for components "designed to handle this situation carefully", which a
general-purpose overlay primitive is not).

### `DateField`

```tsx
import { DateField } from "@vespeneventures/ui/atoms";
import { CalendarDate } from "@internationalized/date";

function StartDateField() {
  return (
    <DateField
      label="Start date"
      description="When the plan begins."
      defaultValue={new CalendarDate(2024, 1, 15)}
      onChange={(date) => setStartDate(date)}
    />
  );
}
```

Segmented, keyboard-editable date entry — the same label/description/error
surface `TextField` bundles with its own `<input>`, for a date value
instead of free text. Built on react-aria-components' `DateField` +
`DateInput` + `DateSegment`, which render each unit (month/day/year, and
time units for a `granularity` finer than `"day"`) as its own focusable
segment, with arrow-key increment/decrement per segment, automatic advance
to the next segment on a complete entry, and locale-correct segment order
and separators.

`value`/`defaultValue` are react-stately `DateValue`s (`CalendarDate`,
`CalendarDateTime`, or `ZonedDateTime`) from `@internationalized/date`, not
a native JS `Date` — see "Why these dependencies" above for why that
package ships as a real dependency of this one rather than an unlisted
transitive of `react-aria-components`.

A full `DatePicker` (this field plus a calendar-grid popover) was
considered and deliberately NOT built instead: react-aria-components' own
`DatePicker` composes a `Calendar` internally, and `Calendar` isn't one of
this package's atoms (see "What's deliberately not here") — shipping
`DatePicker` would mean building that calendar grid as an unavoidable side
effect of a component this package wasn't asked for. `DateField` alone —
direct keyboard entry, no calendar — is already complete on its own.

### `ComboBox`

```tsx
import { ComboBox } from "@vespeneventures/ui/atoms";

function AssigneeField() {
  return (
    <ComboBox
      label="Assignee"
      placeholder="Search people"
      options={people.map((p) => ({ id: p.id, label: p.name }))}
      onChange={(id) => setAssignee(id)}
    />
  );
}
```

A searchable, filterable single-choice field — `Select`'s sibling for an
option set too large to scan as a closed list. Built on
react-aria-components' `ComboBox` composed with its OWN `Input`, `Button`,
`Popover`, and `ListBox`/`ListBoxItem` (not this package's own `Button`
atom — see "Atoms compose no other atom" below). `options` is a plain array
(`{ id, label, isDisabled?, textValue? }`), the same shape `Select`'s own
`options` uses, passed to react-aria-components as `defaultItems` so its
built-in language-sensitive "contains" filter narrows the list as the user
types; a consumer can supply their own `defaultFilter` for a different
match strategy.

### `SearchField`

```tsx
import { SearchField } from "@vespeneventures/ui/atoms";

function PromptSearch() {
  return <SearchField label="Search prompts" onChange={(value) => setQuery(value)} />;
}
```

A search input with a built-in clear affordance — `TextField`'s sibling for
a query that's typed and then cleared. Built on react-aria-components'
`SearchField` + `Input` + `Button`, which supply a real `type="search"`
input (native OS chrome a plain `type="text"` never gets), a clear button
wired entirely through context (its `aria-label`, its `onPress`, and its
conditional presence — this component only decides WHEN to render it,
based on the field's own `isEmpty` render-prop state), and Escape clearing
the field.

### `FileTrigger`

```tsx
import { FileTrigger, Button } from "@vespeneventures/ui/atoms";

function AttachmentPicker() {
  return (
    <FileTrigger acceptedFileTypes={["image/png", "image/jpeg"]} onSelect={(files) => handleFiles(files)}>
      <Button variant="secondary">Choose photo</Button>
    </FileTrigger>
  );
}
```

File selection wired onto an arbitrary pressable trigger — react-aria-
components' own `FileTrigger`, which manages a permanently-hidden
`<input type="file">`, resets its value before every open (so picking the
SAME file twice in a row still fires `onSelect` a second time), and wires
`acceptedFileTypes`/`allowsMultiple`/`defaultCamera`. Deliberately unstyled
beyond that — it has no visual surface of its own; every visible
affordance, including any disabled state, belongs to whichever trigger
element (this package's own `Button`, as above, or react-aria-components'
own) the consumer supplies. `className` is deliberately NOT accepted here,
unlike every other atom in this package — see `FileTrigger.tsx`'s own doc
comment for why accepting it would be a silent no-op.

Deliberately out of scope: upload progress, drag-and-drop, and any preview
of the selected files. `onSelect` hands back the browser's own `FileList`
and stops there — a block built on top of this (and this package's own
`ProgressBar`, for upload progress) owns the rest.

### `Disclosure`

```tsx
import { Disclosure } from "@vespeneventures/ui/atoms";

function AdvancedOptions() {
  return (
    <Disclosure title="Advanced options">
      <p>Extra configuration goes here.</p>
    </Disclosure>
  );
}
```

A single expandable/collapsible section of content. Built on
react-aria-components' `Disclosure` + `DisclosurePanel` — both ship at the
`react-aria-components@1.20.0` version this package installs, so no
`<details>`-based fallback was needed. Between them these supply
`aria-expanded` on the trigger and `aria-controls` pointing at the panel's
id (with `aria-labelledby` the other direction), toggling on Enter/Space in
addition to a click, and keeping the panel's content in the DOM at all
times (toggling its `hidden` attribute rather than mounting/unmounting).
The trigger is react-aria-components' own `Button`, given `slot="trigger"`
— not this package's own `Button` atom, the same layering reasoning
`Select`'s and `ComboBox`'s own sections above document.

### `ProgressBar`

```tsx
import { ProgressBar } from "@vespeneventures/ui/atoms";

function UploadProgress({ percentComplete }: { percentComplete: number }) {
  return <ProgressBar label="Uploading" value={percentComplete} />;
}

function ProcessingIndicator() {
  return <ProgressBar label="Processing" isIndeterminate />;
}
```

Determinate and indeterminate progress. Built on react-aria-components' own
`ProgressBar` for `role="progressbar"`/`aria-valuenow`/`aria-valuemin`/
`aria-valuemax`/`aria-valuetext` wiring — including correctly OMITTING
`aria-valuenow` entirely while `isIndeterminate`, per the ARIA spec, rather
than reporting a value that doesn't exist. `value`/`minValue`/`maxValue`
(0/100 by default) pass straight through; `label` is required and rendered
via react-aria-components' own `Label`, reading `ProgressBar`'s context the
same way `TextField`'s own `Label` does.

### `Separator`

```tsx
import { Separator } from "@vespeneventures/ui/atoms";

function SectionDivider() {
  return <Separator />;
}

function ToolbarDivider() {
  return <Separator orientation="vertical" decorative />;
}
```

A visual divider between two groups of content. Built on react-aria-
components' own `Separator`, which renders a real `<hr>` for the default
horizontal orientation (an implicit `role="separator"` from the element
itself) and a `<div role="separator" aria-orientation="vertical">` for the
vertical one. `decorative` (default `false`) marks a separator as purely
visual — `aria-hidden`, removing it from the accessibility tree regardless
of role — for a divider with no real content boundary to announce (a
hairline between two icons in a toolbar, say). `Menu.Separator` (see
`Menu` above) builds on this same primitive for the menu-specific case of a
divider between item groups; this is the general one, for anywhere else a
rule is needed.

### `Chip`

```tsx
import { Chip } from "@vespeneventures/ui/atoms";

function TeamFilter({ teams, onRemove }: { teams: string[]; onRemove: (team: string) => void }) {
  return (
    <div className="flex flex-wrap gap-xs">
      {teams.map((team) => (
        <Chip key={team} onRemove={() => onRemove(team)} removeLabel={`Remove ${team}`}>
          {team}
        </Chip>
      ))}
    </div>
  );
}
```

A removable label — distinct from `Badge`, which is purely static. Under
this package's own "does the variant change the SET of named regions?"
test (see "Placement rules" above, the variant rule), `Chip` and `Badge`
are two different components rather than one with a `removable` prop:
`Badge` has exactly one region (the label); `Chip` has two — a label region
AND a remove-affordance region, each doing a different job — so the region
SET differs, a structural difference rather than a purely visual one.

Still ships as an ATOM, not a block, despite having two simultaneously-
visible regions: the label and the remove control are one small,
indivisible interactive unit — removing the chip removes the whole thing,
label included — the same way `Checkbox`'s box + label text, or `Switch`'s
track + thumb + label, already stay one atom despite each having multiple
visually distinct parts. Neither is an independently composable named
region the way `PageHeader`'s title/description/actions are (see
"Placement rules", test 2).

`onRemove` and `removeLabel` are enforced together at the TYPE level, not
just documented: `removeLabel` is required whenever `onRemove` is supplied.
"Remove" alone never says WHICH chip it removes to a screen reader user
tabbing through several at once — the accessible name has to identify the
chip (`"Remove Engineering"`), not just the action. Omit `onRemove`
entirely for a label-only chip with no remove affordance at all. The remove
control is react-aria-components' own `Button` (not this package's own
`Button` atom, the same layering reasoning `Select`'s and `Disclosure`'s
own sections already document), for the same keyboard/focus-visible
handling every other interactive control in this package gets.

## Blocks

A block owns the internal layout of multiple named regions — regions that
differ in kind, not a repeated list of interchangeable items (that's an
atom; see "Placement rules" above). A block typically composes one or more
atoms and/or layout to do it, but doesn't have to: neither block below
imports an atom — their regions are consumer-supplied slots. A block never
reaches outside this package for data or routing — everything it needs
comes in through props, same as an atom.

### Slots, not a `mode`/`variant` prop

Neither block below takes a `variant` or `mode` prop for structural
differences. Instead, wherever a consumer's structure genuinely diverges —
different actions, a different icon, whether a breadcrumb trail exists at
all — the block exposes a `ReactNode` **slot**: `actions`, `breadcrumb`,
`icon`, `action`. A consumer composes what goes in a slot directly, in
their own code, rather than asking this component to grow a new named mode
for it. See "Placement rules" above ("Slots beat mode props") for why.

### `PageHeader`

```tsx
import { PageHeader } from "@vespeneventures/ui/blocks";
import { Button } from "@vespeneventures/ui/atoms";

function PromptsPageHeader() {
  return (
    <PageHeader
      title="Prompts"
      description="Reusable prompt templates for your team."
      actions={<Button onPress={() => createPrompt()}>New prompt</Button>}
    />
  );
}
```

`title` (required `ReactNode`) renders as the page's `<h1>`. `description`
and `actions` are both optional. `breadcrumb` is a third optional slot,
rendered above the title — typically a `Breadcrumb` atom (see "Atoms"
above), but any `ReactNode` works.

### `EmptyState`

```tsx
import { EmptyState } from "@vespeneventures/ui/blocks";
import { Button } from "@vespeneventures/ui/atoms";

function EmptyPromptsList() {
  return (
    <EmptyState
      title="No prompts yet"
      description="Create your first prompt template to get started."
      action={<Button onPress={() => createPrompt()}>Create prompt</Button>}
    />
  );
}
```

The zero-item placeholder for a list, table, or feed — built for views like
`/evals`, `/experiments`, `/prompts`, `/inbox`. `title` (required) renders
as an `<h2>` so the empty state announces itself to assistive tech the same
way any other section heading would. `icon` and `action` are both optional
slots; not every empty state has a recovery action (an empty inbox that's
empty because there's genuinely nothing to do has nowhere to send you).

### `DataTable`

```tsx
import { DataTable, Pagination, type DataTableColumn } from "@vespeneventures/ui/blocks";
import { useState } from "react";
import type { Key, SortDescriptor } from "react-aria-components";

interface PromptRun {
  id: string;
  name: string;
  runs: number;
}

const COLUMNS: DataTableColumn<PromptRun>[] = [
  { id: "name", header: "Name", cell: (row) => row.name, isRowHeader: true, allowsSorting: true },
  { id: "runs", header: "Runs", cell: (row) => row.runs, allowsSorting: true },
];

function PromptRunsTable({ rows }: { rows: PromptRun[] }) {
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>();
  const [selectedKeys, setSelectedKeys] = useState<"all" | Set<Key>>(new Set());
  const [page, setPage] = useState(1);

  return (
    <DataTable
      aria-label="Prompt runs"
      columns={COLUMNS}
      rows={rows}
      rowKey={(row) => row.id}
      sortDescriptor={sortDescriptor}
      onSortChange={setSortDescriptor}
      selectionMode="multiple"
      selectedKeys={selectedKeys}
      onSelectionChange={setSelectedKeys}
      emptyStateTitle="No prompt runs yet"
      footer={<Pagination page={page} pageCount={10} onPageChange={setPage} />}
    />
  );
}
```

The finished, opinionated data grid `Table`'s own section above deliberately
doesn't provide: five regions that differ in kind — an optional `toolbar`
slot, the grid itself (built on `Table`'s primitives), an empty-state
region (reusing `EmptyState` rather than reimplementing it), a loading
region, and an optional `footer` slot for something like `Pagination` — is
what makes this a **block**, not an atom (see "Placement rules", test 2).
A page can hold two `DataTable`s side by side, which is what makes it a
block and not a view (test 3) despite being the largest, most intricate
component this package ships.

**Controlled only, deliberately.** `sortDescriptor`/`onSortChange`,
`selectedKeys`/`onSelectionChange`, and pagination (via the `footer` slot)
all come from props with change callbacks — `DataTable` never re-sorts,
re-selects, or re-paginates `rows` itself, and never fetches data or owns
any async state of its own. Welding the grid to one specific data-fetching
shape (a particular pagination style, a particular cache) would make it
useless to every consumer whose data layer works differently; a consumer
owns the actual sorting/filtering/paging of `rows` and passes the already-
correct slice back in, the same reason `Table`'s own primitives take no
`columns`/`rows` data props at all.

`columns` and `rows` are plain data — `{ id, header, cell, allowsSorting?,
isRowHeader?, width? }` per column, `rowKey` deriving each row's own key —
rather than JSX, so a data-driven grid never needs to hand-write a
`Table.Column`/`Table.Cell` per field. `selectionMode="multiple"` renders
`Table.SelectAllCheckbox`/`Table.SelectionCheckbox` as a leading column,
including the indeterminate select-all state for a partial selection, the
same wiring `Table`'s own section above describes; `selectionMode="none"`
(the default) renders no selection column at all.

`isLoading` renders `loadingRowCount` (default 5) skeleton placeholder rows
in place of `rows`, for a consumer's own fetch in flight — `DataTable`
never tracks that state itself, it only reads the prop. This should read
`Skeleton` cells from this package's own atoms layer; as of this block's
own PR, no `Skeleton` atom ships yet (a concurrent branch may add one), so
the loading state uses a plain `animate-pulse` placeholder div instead.
Swapping that placeholder for a real `Skeleton` atom, once one exists, is
a deliberate follow-up.


### `Form`

```tsx
import { Form, FieldGroup } from "@vespeneventures/ui/blocks";
import { TextField, Button } from "@vespeneventures/ui/atoms";
import { useState } from "react";

function ProfileForm() {
  const [errors, setErrors] = useState<{ fieldId: string; message: string }[]>([]);

  return (
    <Form
      heading="Profile"
      errors={errors}
      onSubmit={(e) => {
        e.preventDefault();
        setErrors([{ fieldId: "email", message: "Enter a valid email address." }]);
      }}
      actions={<Button type="submit">Save</Button>}
    >
      <TextField id="email" label="Email" />
    </Form>
  );
}
```

A form's own layout: an optional heading region, the fields region
(`children`), an error-summary region, and an actions region — four
regions that differ in kind, and a page can hold two `Form`s (two
independent forms on one settings page), which is what makes this a block
rather than a view.

**Implements no validation logic or form state, deliberately.**
react-aria-components already carries validation through each field's own
`isInvalid`/`validationErrors`, and most real consumers layer a form
library of their own choice (React Hook Form, Formik, TanStack Form, ...)
on top of that. A shared UI package that tried to own validation would
have to pick one of those, and every consumer using a different one would
immediately need an escape hatch — the same structural-difference-through-
a-mode-prop failure this README's variant rule warns against, just scoped
to a form library instead of visual styling. `Form` provides three things
only: the region layout, the error-summary region, and native `onSubmit`
passthrough — nothing about *when* a field is invalid or *what* makes it
so.

**The error summary is this component's real accessibility value.** A
sighted user scanning a long form after a failed submit can see which
fields turned red; a screen-reader user tabbing field-by-field cannot
discover that without visiting every one. `errors` (an array of
`{ fieldId, message }`) renders a summary region the moment it's non-empty:
`role="alert"` plus a programmatic focus move onto the region itself (via
a `tabIndex={-1}` ref), so it's both announced and immediately reachable by
keyboard — a screen reader user lands directly on the list of what's
wrong instead of discovering it field-by-field. Each entry is a real
`<a href="#fieldId">`, linking it to the actual invalid control (a
consumer-supplied `id`, matching react-aria-components' own convention of
applying a supplied `id` to the field's real control, not a wrapper); a
click or Enter on that link moves focus straight to the field.

`errors` is controlled: `Form` tracks no validation state of its own, so a
NEW array reference is the only "a submission just failed" signal it has
— that's what triggers the focus move, keyed on `errors`' own identity
rather than a derived count. A consumer must not construct an equivalent
new array on every unrelated render, or the summary steals focus back on
every one of those too.

### `FieldGroup`

```tsx
import { FieldGroup } from "@vespeneventures/ui/blocks";
import { TextField } from "@vespeneventures/ui/atoms";

function ShippingAddressGroup() {
  return (
    <FieldGroup
      legend="Shipping address"
      description="Used for delivery only."
      layout="multi"
    >
      <TextField label="Street" />
      <TextField label="City" />
    </FieldGroup>
  );
}
```

A related set of fields under a shared legend — a shipping address's
street/city/zip, a payment method's card fields, grouped distinctly from
the rest of the form they sit in. Three regions that differ in kind (the
legend, an optional description, the fields themselves), and a single
`Form` routinely holds more than one `FieldGroup` (billing address AND
shipping address on the same checkout form), which is what makes this a
block rather than a view.

**Renders a real `<fieldset>`/`<legend>` pair, not `role="group"` +
`aria-labelledby`.** `<fieldset>` is the native HTML mechanism built for
exactly this: grouping a set of form controls under one shared,
programmatically-associated label. Every mainstream screen reader already
announces the legend as context the moment focus lands on ANY control
inside, automatically, with no id to generate and wire up by hand the way
`aria-labelledby` would need. `role="group"` is the right tool when the
grouped content ISN'T form controls (a `<fieldset>` may only contain form
controls and phrasing content) — that restriction costs nothing here,
since every `FieldGroup` child is a field by definition. The one native
`<fieldset>` cost — browser default chrome (a border, extra padding, a
shrink-to-fit `min-width` that can overflow a flex/grid ancestor) — is
reset to zero, so this renders as plain layout, not a visible box of its
own.

`layout`: `"single" | "multi"` (default `"single"`). The region set —
legend, description, fields — is identical either way; only the fields'
own grid layout changes (one column, or two from the `tablet` breakpoint
up), which is what makes this a legitimate prop rather than two separate
components under this README's variant rule.

### `ConfirmDialog`

```tsx
import { ConfirmDialog } from "@vespeneventures/ui/blocks";
import { Button } from "@vespeneventures/ui/atoms";

function DeletePromptButton() {
  return (
    <ConfirmDialog
      trigger={<Button variant="danger">Delete</Button>}
      heading="Delete this prompt?"
      message="This can't be undone."
      tone="destructive"
      confirmLabel="Delete"
      onConfirm={() => deletePrompt()}
    />
  );
}
```

A confirmation prompt built on the `Dialog` atom: a heading region, a
message region, and an actions region (Cancel/Confirm) — three regions
that always render together and differ in kind, which is what makes this
a block rather than an atom. `Dialog` itself deliberately stops short of
this fixed shape — see its own section above for exactly where its scope
ends and this block's begins.

Composable the same way `Dialog` is: a `trigger` slot, open/close either
uncontrolled or controlled via `isOpen`/`onOpenChange` (both inherited
from `Dialog`). **No imperative `confirm()` API of any kind** — that would
give this a portal-independent queue and an imperative call outside the
render tree, exactly what this README's placement rules call a runtime
service (test 4), not a layout component. A consumer renders
`<ConfirmDialog trigger={...} .../>` in place, the same as any other
block.

**Destructive confirmations never rely on colour alone.** `tone`
(`"neutral" | "destructive"`, default `"neutral"`) controls the confirm
button's `danger` styling, but the ACTION label (`confirmLabel`) is what
actually names the irreversible action — a generic "Confirm" reddened by
`variant="danger"` tells a colorblind user, a screen reader, or anyone on
a greyscale screen nothing a sighted user with color vision doesn't
already get for free from the red fill alone. Naming the action in
`confirmLabel` ("Delete", "Remove") is what carries the same meaning
through every one of those channels, the same reasoning `Stat`'s trend
glyph/screen-reader-text pairing above documents for colour-coded
direction, applied here to a button's label instead of an icon.

**Default focus lands on Cancel for a destructive confirmation, on Confirm
otherwise.** Actions render Cancel-then-Confirm, and each `Button`
requests initial dialog focus via react-aria's own documented mechanism
for it (`autoFocus`, which the dialog's `FocusScope` honors over its own
default of focusing the first tabbable element). For `tone="destructive"`,
an errant Enter press the instant the dialog opens is a real risk for a
keyboard user who fired the trigger with Enter/Space and has residual
"activate" momentum — it must land on the SAFER action, so Cancel gets it;
the cost of one extra keypress to actually delete something is far lower
than the cost of an accidental irreversible action. For the default
`"neutral"` tone that risk doesn't apply (nothing is lost by confirming),
so Confirm gets initial focus instead — the same "Enter activates the
primary action" expectation an ordinary OK/Cancel dialog already sets.

### `Toolbar`

```tsx
import { Toolbar } from "@vespeneventures/ui/blocks";
import { Button, TextField } from "@vespeneventures/ui/atoms";

function PromptsToolbar() {
  return (
    <Toolbar
      aria-label="Prompts"
      leading={<Button variant="secondary">Bulk actions</Button>}
      search={<TextField label="Filter" aria-label="Filter prompts" />}
      trailing={<Button>New prompt</Button>}
    />
  );
}
```

An action bar above content — typically above a `DataTable` (via its own
`toolbar` slot) or any other list/grid region. Three regions that differ
in kind (leading actions, a search/filter control, trailing actions), and
a page can hold two `Toolbar`s (two independent lists, each with its own
toolbar, side by side), which is what makes this a block rather than a
view.

**Built on react-aria-components' own `Toolbar` primitive**, which this
package's installed version (`react-aria-components@1.20.0`) ships — so
this uses it rather than hand-rolling `role="toolbar"` and arrow-key
handling from scratch. Its underlying `useToolbar` hook supplies real
roving focus via a focus manager that walks every focusable descendant in
DOM order: Left/Right (or Up/Down when `orientation` is `"vertical"`) move
focus between them, respecting RTL automatically, and Tab moves focus OUT
of the whole toolbar in one step (jumping internal focus to the first/last
control, then letting the browser's own Tab handling continue from there)
rather than tabbing through every control one at a time — the same "one
Tab stop for the whole control, arrow keys move within it" shape `Tabs`'
own `TabList`/`Tab` and `RadioGroup`'s own roving-tabindex already
establish elsewhere in this package. None of that is reimplemented here:
any real focusable element placed in `leading`, `search`, or `trailing`
(this package's own `Button`, `TextField`, `Select`, `Menu`, or anything
else) is automatically part of that navigation with no per-child wiring
required.

`role="toolbar"` requires its own accessible name; `aria-label` defaults
to `"Toolbar"` and should be overridden by a consumer with more than one
`Toolbar` on a page, the same `aria-label` default pattern `Pagination`'s
own `"Pagination"` already follows. Wraps at narrow widths: the outer
region is `flex flex-wrap`, and `search` grows to fill the space between
`leading` and `trailing`, falling onto its own row rather than overflowing
once the three regions no longer fit on one line.

### `NavGrid`

```tsx
import { NavGrid } from "@vespeneventures/ui/blocks";

function SettingsHub() {
  return (
    <NavGrid
      heading="Settings"
      items={[
        { id: "billing", title: "Billing", description: "Plan and invoices.", href: "/settings/billing" },
        { id: "invite", title: "Invite teammates", onSelect: () => openInviteDialog() },
      ]}
    />
  );
}
```

A grid of navigation cards — an app's "hub" page linking out to its own
sections, a settings landing page's category tiles. An optional heading
and the card grid itself: two regions that differ in kind, and a page can
hold two `NavGrid`s (two separate card groupings under two headings),
which is what makes this a block rather than a view.

**Each card is a real `<a>` or `<button>`, not a `<div>` with an
`onClick`.** `items` is a discriminated union: an item with `href` renders
via this package's own `Link` atom (`variant="standalone"` — the variant
this README's own `Link` section already documents for exactly this case,
"a link that IS the whole clickable unit on its own... a nav item"); an
item with `onSelect` renders via this package's own `Button` atom
(`variant="ghost"`). `href`/`onSelect` are mutually exclusive at the type
level, not just by convention. `icon`, `title`, and `description` are all
rendered INSIDE that single element (not a wrapping `<div>` around a
smaller link), so clicking or tabbing to anywhere on the card — not just
the title text — activates it; `icon` is `aria-hidden`, decorative
reinforcement for a title that's already the card's real accessible name.

Cards lay out one per row on narrow viewports, two from the `tablet`
breakpoint, three from `desktop` — a plain Tailwind responsive grid
generated from this package's own breakpoint tokens, no JS breakpoint
state, the same pattern `DetailView`'s own responsive field grid uses.

### `SectionHeader`

```tsx
import { SectionHeader } from "@vespeneventures/ui/blocks";
import { Button } from "@vespeneventures/ui/atoms";

function NotificationsSection() {
  return (
    <>
      <SectionHeader
        eyebrow="Beta"
        title="Notifications"
        description="Control how you're notified about activity."
        actions={<Button variant="secondary">Reset to defaults</Button>}
      />
      {/* section content */}
    </>
  );
}
```

A heading for a section WITHIN a page — as opposed to `PageHeader`, which
announces the page itself. Up to four regions that differ in kind (an
optional eyebrow, the title, an optional description, an optional actions
slot), and — unlike `PageHeader`, which appears once per page — a single
page routinely holds several `SectionHeader`s (one per section of a long
settings page, one per card in a dashboard). That "can one page hold two
of them?" difference (test 3) is what makes this its own block rather
than a `variant`/`mode` on `PageHeader`: the two are never
interchangeable, so collapsing them into one component with a prop for
"which kind" would be exactly the structural-difference-through-a-mode-
prop failure the variant rule above warns against. `SectionHeader.tsx`
shares no code with `PageHeader.tsx` — the visual rhyme between the two
is coincidental resemblance, not a factored-out implementation either
would break if the other changed.

`level`: `2 | 3 | 4 | 5 | 6` (default `2`) — which heading element `title`
renders as. Real and settable, not fixed: a page's document outline has
to stay unbroken no matter how deep a `SectionHeader` sits (one directly
under a `PageHeader`'s own `<h1>` needs the default `level={2}`; a
`SectionHeader` for a subsection of THAT section needs `level={3}`, and
so on). Getting this wrong — hardcoding one level, or styling a `<div>`
to merely look like a heading — is invisible to a sighted user and breaks
heading-by-heading screen-reader navigation for everyone else.

Renders a plain `<div>`, not a `<header>` the way `PageHeader` does:
`PageHeader` is a page-level singleton, where `<header>` correctly
registers as the page's one `banner` landmark. `SectionHeader` is neither
— it's repeatable, and a bare top-level `<header>` for each one would
register a SECOND `banner` landmark on the page, which isn't valid
document structure. The real structure a `SectionHeader` needs to provide
comes from its heading element (`level`, above), not from a landmark
role.

### Marketing and editorial content blocks

The six blocks below (`Hero` through `ArticleBody`) complete this layer.
They ship **no real words of any kind** — every heading, body line, CTA
label, question/answer pair, tier name, and quote is a required or
optional prop the consumer supplies. Every example below uses obviously-
structural placeholder text ("Heading text", "Body copy goes here") for
exactly that reason: this package owns visual vocabulary, never copy (see
"Public contract" above — audience-facing words belong to
`@vespeneventures/copy`).

### `Hero`

```tsx
import { Hero } from "@vespeneventures/ui/blocks";
import { Button } from "@vespeneventures/ui/atoms";

function LandingHero() {
  return (
    <Hero
      eyebrow="Eyebrow text"
      heading="Heading text"
      description="Subheading copy goes here."
      actions={<Button>CTA label</Button>}
    />
  );
}
```

A page's primary above-the-fold message: an optional eyebrow, a heading,
an optional description, and an optional row of calls to action — the same
title/description/actions shape `PageHeader` gives an application page,
sized for a marketing/content page instead. A page can reasonably contain
two `Hero`-shaped sections (a long landing page routinely has more than
one full-bleed message section), which is what makes this a block rather
than a view (test 3) and is why it renders a plain `<section>` rather than
`<header>` — a second top-level `<header>` would register a second
`banner` landmark, which isn't valid document structure (the same
reasoning `SectionHeader`'s own section documents).

**One visual variant, driven by an optional `media` slot rather than a
`variant` prop** — a hero-only-ever-text-and-button shape is common but
not universal, so `media` (a screenshot, an illustration, an embedded
video) switches the layout to two columns from the `tablet` breakpoint up
when supplied, and stays a single centered column when it's omitted:

```tsx
<Hero
  heading="Heading text"
  description="Subheading copy goes here."
  actions={<Button>CTA label</Button>}
  media={<img src="/media.png" alt="Media description" />}
/>
```

`media` is a plain `ReactNode`, not a `{ src, alt }` data pair the way
`Testimonial`'s avatar (below) is: a hero's media isn't always a single
`<img>` — it's just as often a video embed or an SVG illustration, neither
of which shares one `alt`-shaped contract. If what you place there IS a
plain image, give it real alt text yourself (as above), or compose this
package's own `Avatar`/`Icon` atom, both of which already enforce an
accessible name at the type level.

`headingLevel` (`1 | 2`, default `1`) picks `heading`'s element — `1`
because a marketing page's `Hero` typically IS the page's own top-of-
content heading; a page with its own `<h1>` elsewhere, or a second
`Hero`-shaped section further down the page, needs `headingLevel={2}`
instead, the same document-outline reasoning `SectionHeader`'s `level`
documents.

### `FeatureGrid`

```tsx
import { FeatureGrid } from "@vespeneventures/ui/blocks";

function ProductFeatures() {
  return (
    <FeatureGrid
      heading="Grid heading"
      description="Grid description."
      items={[
        { id: "one", heading: "Feature heading one", description: "Feature description one." },
        { id: "two", heading: "Feature heading two", description: "Feature description two." },
        { id: "three", heading: "Feature heading three", description: "Feature description three." },
      ]}
    />
  );
}
```

A titled collection of features: an optional eyebrow/heading/description
region above a grid of feature items — two regions that differ in kind,
which is what makes `FeatureGrid` a block (test 2), even though the ITEMS
inside it are a homogeneous repeat (each plays the same role as any other,
the same "list of similar things" shape `NavGrid`'s cards already are). A
page can hold two `FeatureGrid`s (two separate feature groupings under two
different headings), which is what makes it a block rather than a view
(test 3).

Each item's `icon` is optional and `aria-hidden` — decorative
reinforcement for a heading that already carries the meaning, the same
treatment `NavGrid`'s own `icon` slot gets. Item headings are deliberately
NOT real heading elements (a homogeneous repeat, not named regions, the
same reasoning `NavGrid`'s cards apply) — the grid's own optional
`heading` (via `headingLevel`, default `2`) is the only real heading
region. Items lay out one per row on narrow viewports, two from `tablet`,
three from `desktop` — the same responsive grid `NavGrid` uses.

### `Faq`

```tsx
import { Faq } from "@vespeneventures/ui/blocks";

function ProductFaq() {
  return (
    <Faq
      heading="FAQ heading"
      items={[
        { id: "one", question: "Question text one", answer: "Answer text one." },
        { id: "two", question: "Question text two", answer: "Answer text two." },
      ]}
    />
  );
}
```

A list of expand/collapse question/answer pairs, under an optional heading
region — two regions that differ in kind (test 2), even though the ITEMS
are a homogeneous repeat. A page can hold two `Faq`s (a general FAQ block
and a product-specific one further down the page), which is what makes it
a block rather than a view (test 3).

**Built on this package's own `Disclosure` atom, one per item** — see
`Disclosure`'s own section above for the accessibility contract it already
supplies (real `aria-expanded`/`aria-controls` wiring, Enter/Space-and-
click toggling, collapsed content kept in the DOM rather than unmounted).
None of that is reimplemented here: `Faq` renders one `Disclosure` per
question and nothing more. Each pair expands and collapses
INDEPENDENTLY — `Faq` holds no shared "which one is open" state and
renders no `DisclosureGroup`, so opening one question never closes
another, unlike a coordinated accordion.

### `PricingTable`

```tsx
import { PricingTable } from "@vespeneventures/ui/blocks";
import { Button } from "@vespeneventures/ui/atoms";

function ProductPricing() {
  return (
    <PricingTable
      heading="Pricing heading"
      tiers={[
        {
          id: "starter",
          name: "Tier name one",
          price: "Price one",
          features: ["Feature one", "Feature two"],
          cta: <Button variant="secondary">CTA label one</Button>,
        },
        {
          id: "team",
          name: "Tier name two",
          price: "Price two",
          features: ["Feature one", "Feature two", "Feature three"],
          cta: <Button>CTA label two</Button>,
          isHighlighted: true,
          badge: "Badge text",
        },
      ]}
    />
  );
}
```

A set of pricing tiers under an optional heading region — two regions that
differ in kind (test 2), even though the TIERS are a homogeneous repeat.
A page can hold two `PricingTable`s (a monthly/annual toggle implemented
as two tables a consumer switches between), which is what makes it a
block rather than a view (test 3).

Each tier's `name`, `price`, `features` (a plain list of `ReactNode`s —
this block has no opinion about how a consumer represents "not included"),
and `cta` slot are required; `description` and `badge` are optional.
`isHighlighted` marks the recommended tier with an accent border ONLY —
pair it with `badge` for a visible, non-colour label, since a border alone
would be invisible to a screen reader and disappear in greyscale, the same
colour-is-never-the-only-channel reasoning `Stat`'s trend indicator
documents. `badge` has no built-in default text ("Recommended" or
similar) — this package ships no copy of its own, so there is nothing
sensible to default it to. Built on this package's own `Card` and `Badge`
atoms (blocks may compose atoms).

### `Testimonial`

```tsx
import { Testimonial } from "@vespeneventures/ui/blocks";

function CustomerQuote() {
  return (
    <Testimonial
      quote="Quote text goes here."
      attributorName="Attributor name"
      attributorRole="Attributor role, Attributor org"
      avatarSrc="/avatar.png"
      avatarAlt="Attributor name"
    />
  );
}
```

A single testimonial: a quote, and who said it. `attributorName` and
`attributorRole` are always separate props, never one blob of text, so a
consumer can style the name and role/affiliation independently. Renders a
real `<figure>`/`<blockquote>`/`<figcaption>` triple — the native elements
built for exactly this — with `quote` set in this package's own
`--text-blockquote` size token. A page can hold two `Testimonial`s (a pair
of quotes side by side, or a longer wall of them), which is what makes
this a block rather than a view (test 3).

**`avatarSrc`/`avatarAlt` are optional together, and required together —
enforced at the type level, not just documented.** Omit both for a
testimonial with no avatar; supply `avatarSrc` and TypeScript requires
`avatarAlt` in the same edit, the identical "no way to supply an image
without its alt text" enforcement `Chip`'s own `onRemove`/`removeLabel`
pairing already establishes elsewhere in this package. Rendered through
this package's own `Avatar` atom, which independently requires `alt` at
its own type level too.

### `ArticleBody`

```tsx
import { ArticleBody } from "@vespeneventures/ui/blocks";

function ArticlePage() {
  return (
    <ArticleBody>
      <h2>Section heading text</h2>
      <p>Body copy goes here.</p>
      <ul>
        <li>List item text</li>
      </ul>
    </ArticleBody>
  );
}
```

A semantic content region for a marketing/editorial page's long-form
body. **Deliberately narrow scope: a styled container, not a content-shape
parser.** This does NOT parse markdown and does NOT enforce a content-
shape schema — it accepts ordinary pre-structured React children (real
`<h2>`, `<p>`, `<ul>`, ... elements, however a consumer produced them) and
applies this package's token-driven typography scale to them via CSS
descendant-selector Tailwind variants (`[&_h2]:text-h2`, ...), nothing
more. A product-neutral structured-document contract — parsing a content
shape into these elements in the first place — is explicitly out of scope
here and belongs to a separate, already-filed proposal in
`@vespeneventures/surface` instead.

Content is constrained to this package's own `--ui-width-prose-max` token
(48rem default) — the same "case 2, no Tailwind namespace" raw `var()`
read `Shell.Main`'s own `--ui-width-content-max` uses, applied via inline
`style` for the same reason. A page can hold two `ArticleBody`s (a main
article plus a sidebar callout, or two comparison columns), which is what
keeps it at this layer rather than being a view (test 3).

### Composing chrome and blocks

Marketing/site chrome (`shell`) and marketing content blocks compose
cleanly — `shell` and `blocks` are independent sibling layers built on
`atoms`, neither depending on the other (see "Package structure" above),
so a real page just renders both together:

```tsx
import { SiteHeader, SiteFooter } from "@vespeneventures/ui/shell";
import { Hero, FeatureGrid } from "@vespeneventures/ui/blocks";
import { Button, Link } from "@vespeneventures/ui/atoms";

function MarketingPage() {
  return (
    <>
      <SiteHeader
        brand={<Link href="/" variant="standalone">Brand name</Link>}
        actions={<Button>CTA label</Button>}
      />
      <main>
        <Hero
          heading="Heading text"
          description="Subheading copy goes here."
          actions={<Button>CTA label</Button>}
        />
        <FeatureGrid
          heading="Grid heading"
          items={[
            { id: "one", heading: "Feature heading one", description: "Feature description one." },
            { id: "two", heading: "Feature heading two", description: "Feature description two." },
          ]}
        />
      </main>
      <SiteFooter
        secondary={<span>Secondary text goes here.</span>}
      />
    </>
  );
}
```

## Views

Page-level views are documented here because they are built entirely from
this visual vocabulary, but they are exported by
`@vespeneventures/surface/web`. UI stops at reusable primitives; surface owns
the page composition and renderer.

A view is a whole PAGE's composition — test 3 from "Placement rules" above,
repeated here because it's the one that defines this layer: **can one page
contain two of them?** If yes, it's a region of a page, so it's a block
(`PageHeader`, `EmptyState`, or a future `DataTable`). If a second one on
the same page would be incoherent — because the component *is* the page —
it's a view. There is no such thing as half a 404 page, and a sign-in page
either is one or isn't.

**Only two generic web views ship from `surface/web`: `ErrorView` and
`AuthView`.** This is deliberate, not an
oversight, and the list is meant to stay this short. A page's structure
encodes what a product actually *is* — a `/prompts` list page, a
`/settings` page, a dashboard — and that structure is close to always the
consumer's own composition of blocks, not something this package could
usefully pre-assemble without either being wrong for most consumers or
growing an escape hatch for every one it's wrong for (the same
variant-prop failure mode "Placement rules" warns about, one layer up).
`ErrorView` and `AuthView` ship because they're the rare exception: an
error page and an authentication page are the same shape in every product
that has them at all — nobody's 404 page or sign-in page is structurally
special to their product the way their dashboard is.

**Explicitly not shipped: `ListView`, `FormView`, `DashboardView`, or
anything shaped like them.** Run each through test 3: a page can hold two
lists side by side, or two forms on a settings page, or three summary
panels in a dashboard — every one of those is a **block**, the same test
that keeps `DataTable` (built on `Table`'s primitives) and `DetailView` out
of this layer and in the block layer's follow-up list instead (see "What's
deliberately not here" below). Shipping any of them as a view would mean
pre-assembling the exact thing a consumer is supposed to compose from
blocks — and the moment one consumer's list page needed a toolbar the
"shipped" `ListView` didn't have, they'd need an escape hatch, and the
prop/variant surface would start absorbing every future consumer's
divergence the same way a bad `mode` prop does on a single component.

Both views below take no router of any kind: every navigable action is a
plain `ReactNode` slot (`action`, `secondaryAction`), so a consumer passes
their own router's link/button rather than either view importing or
assuming one.

### `ErrorView`

```tsx
// ErrorView is exported by @vespeneventures/surface/web.
import { Button } from "@vespeneventures/ui/atoms";

function NotFoundPage() {
  return (
    <ErrorView
      status={404}
      title="Page not found"
      description="The page you're looking for doesn't exist or has moved."
      action={<Button onPress={() => goHome()}>Go home</Button>}
      details={<code>request id: 8f2a-91c0</code>}
    />
  );
}
```

A full-page error state — 404, 500, 403, or any other whole-page failure.
Composes `blocks/EmptyState` rather than reimplementing it: `title`,
`description`, and `action` are passed straight through to it. `status`
(required, `ReactNode` — a number or a string) renders as real text content
in the page's own `<h1>`, never as styling alone (a background image, an
icon-font glyph, a CSS counter) — a screen reader user, and anyone who
searches the rendered page for "404", needs the code to actually be there
as text. `EmptyState`'s own `title` renders as an `<h2>` one level below
it, so a page built from `ErrorView` has exactly one top-level heading (the
status) with the error's description sitting under it — the same
title/subtitle heading structure a `PageHeader` gives an ordinary page.
`details` is an optional slot for diagnostic content (a request id, a
correlation id, a stack trace), rendered inside a native `<details>`,
collapsed by default: for the rare visitor who needs to report the error,
not the page's primary reading order.

### `DetailView`

```tsx
import { DetailView } from "@vespeneventures/ui/blocks";
import { Badge, Button } from "@vespeneventures/ui/atoms";

function OrderDetail({ order }: { order: { id: string; owner: string; status: string; notes: string } }) {
  return (
    <DetailView
      title={`Order #${order.id}`}
      actions={<Button variant="secondary">Edit</Button>}
      fields={[
        { label: "Owner", value: order.owner },
        { label: "Status", value: <Badge variant="success">{order.status}</Badge> },
        { label: "Notes", value: order.notes, span: 2 },
      ]}
    />
  );
}
```

Label/value presentation of a single record — three regions that differ in
kind (an optional title, the field list itself, an optional actions row).
A page can hold two `DetailView`s (e.g. two related records, or a
before/after comparison of the same one), which is what makes it a block
rather than a view.

Fields render inside a real `<dl>`, one `<div>` per field wrapping a
`<dt>`/`<dd>` pair — a label paired with its value IS a term and its
definition, exactly what those elements mean, so a screen reader can
navigate the list pair-by-pair. `value` is a `ReactNode`, not a plain
string, so a consumer renders its own date/currency/badge formatting
rather than this block reformatting a string on the consumer's behalf (the
`Badge` in the example above). `span: 2` spans a field across both columns
of the block's own two-column field grid.

**Responsive:** fields stack in a single column below the `tablet`
breakpoint and lay out two-up from `tablet` up — a plain Tailwind
responsive variant generated from this package's own `--breakpoint-tablet`
token, no JS breakpoint state, the same pattern `Shell.SideNav`'s own
responsive collapse uses (see "Shell" below).

`title` is optional: a consumer already showing the record's name via
`PageHeader` (e.g. `PageHeader title="Order #1042"`) can omit this block's
own title region rather than repeating the same text twice.


### `AuthView`

```tsx
// AuthView is exported by @vespeneventures/surface/web.
import { Link } from "@vespeneventures/ui/atoms";

function SignInPage() {
  return (
    <AuthView
      brand={<img src="/logo.svg" alt="Acme" />}
      heading="Sign in"
      description="Welcome back."
      form={<MyProductsOwnSignInForm />}
      secondaryAction={<Link href="/signup">Don't have an account? Sign up</Link>}
      footnote={<>By continuing you agree to our <Link href="/terms">Terms</Link>.</>}
    />
  );
}
```

A full-page authentication shell — sign-in, sign-up, password reset, email
verification. A centered card (built on `atoms/Card`) with five named
regions: `brand`, `heading` (+ optional `description`), the `form` slot,
`secondaryAction`, and `footnote`. `heading` (required) renders as the
page's `<h1>`; `form` (required) is rendered exactly as given, with no
wrapper.

**`AuthView` implements no authentication of any kind** — no provider, no
form state, no field validation, no submit handling. It renders whatever
`ReactNode` is passed to `form` exactly as given, the same one-way slot
boundary `Dialog`'s `trigger` and `EmptyState`'s `action` already
establish. This is deliberate and non-negotiable: auth providers differ per
product (a magic link here, a password-plus-OAuth flow there, a passkey
flow somewhere else), and a shared UI package that tried to absorb any one
of them would immediately need an escape hatch for every other one — the
same structural-difference-through-a-mode-prop failure "Placement rules"
warns against, just scoped to authentication instead of visual styling.
Composing that shape stays entirely the consumer's own job.

`AuthView` also ships no `BrandLockup` — `brand` is a plain slot, for the
same reason `Shell` ships no `SiteHeader`/`AppHeader` (see "Shell" below):
a brand mark is per-product, and a pre-built one would recreate the
`mode`-prop failure one layer up.

### `Pagination`

```tsx
import { Pagination } from "@vespeneventures/ui/blocks";
import { useState } from "react";

function PromptsPagination({ totalPrompts }: { totalPrompts: number }) {
  const [page, setPage] = useState(1);
  const pageSize = 25;
  return (
    <Pagination
      page={page}
      pageCount={Math.max(Math.ceil(totalPrompts / pageSize), 1)}
      onPageChange={setPage}
      totalItems={totalPrompts}
      pageSize={pageSize}
    />
  );
}
```

Page navigation — a range summary, the page controls themselves, and an
optional page-size selector (built on the `Select` atom, rendered only when
both `pageSizeOptions` and `onPageSizeChange` are given), three regions
that differ in kind. A page can hold two `Pagination`s (two independent
lists side by side), which is what makes it a block rather than a view.

**Controlled only:** `page`/`pageCount` are props, and every navigation —
a page number, "next", "previous" — is reported through `onPageChange`
rather than applied internally, so this composes into whatever paging
mechanism a consumer's data layer already has (offset, cursor, or
otherwise), the same reason `DataTable` above never paginates its own
`rows`.

Wrapped in a real `<nav aria-label="Pagination">` landmark (override the
label via the same `aria-label` prop for a page with more than one
`Pagination`), the current page carries `aria-current="page"`, and every
control is a real `<button>` (this package's own `Button` atom) — there is
nowhere for a page control in a controlled component like this one to
navigate to as a URL, so a link styled to look like a button would be the
wrong element regardless of styling. A large `pageCount` truncates to
`1 … 4 5 6 … 20` rather than a flat row of every page number, via
`siblingCount` (default `1`) page numbers shown on each side of the
current page.

Omit `totalItems`/`pageSize` for a plain "Page X of Y" range summary;
provide both for "Showing 11–20 of 42".

### `Stat`

```tsx
import { Stat } from "@vespeneventures/ui/blocks";

function ActiveUsersStat() {
  return (
    <Stat
      label="Monthly active users"
      value="2,481"
      delta="+12%"
      trend="up"
      description="vs. last 30 days"
    />
  );
}
```

A single metric — a label, the value itself, an optional delta/trend, and
an optional description, regions that differ in kind. A page routinely
holds several `Stat`s in a row (a metrics dashboard, a summary strip above
a table), which is exactly why this is a block and not a view, and not an
atom either: `label` and `value` play different roles (a metric's name vs.
its measurement), not a homogeneous repeat.

`trend` (`"up" | "down" | "neutral"`, default `"neutral"`) drives the
delta's status-token color, but never color ALONE: an aria-hidden glyph
(`▲`/`▼`/`→`, a different shape per direction, not just a different color)
plus screen-reader-only text (`"Increase"`/`"Decrease"`/`"No change"`) both
carry the same direction independently of color, so the delta reads
correctly for a colorblind viewer, on a greyscale screen, or through a
screen reader with no color channel at all.
A full-page authentication shell — sign-in, sign-up, password reset, email
verification. A centered card (built on `atoms/Card`) with five named
regions: `brand`, `heading` (+ optional `description`), the `form` slot,
`secondaryAction`, and `footnote`. `heading` (required) renders as the
page's `<h1>`; `form` (required) is rendered exactly as given, with no
wrapper.

**`AuthView` implements no authentication of any kind** — no provider, no
form state, no field validation, no submit handling. It renders whatever
`ReactNode` is passed to `form` exactly as given, the same one-way slot
boundary `Dialog`'s `trigger` and `EmptyState`'s `action` already
establish. This is deliberate and non-negotiable: auth providers differ per
product (a magic link here, a password-plus-OAuth flow there, a passkey
flow somewhere else), and a shared UI package that tried to absorb any one
of them would immediately need an escape hatch for every other one — the
same structural-difference-through-a-mode-prop failure "Placement rules"
warns against, just scoped to authentication instead of visual styling.
Composing that shape stays entirely the consumer's own job.

`AuthView` also ships no `BrandLockup` — `brand` is a plain slot, for the
same reason `Shell` ships no `SiteHeader`/`AppHeader` (see "Shell" below):
a brand mark is per-product, and a pre-built one would recreate the
`mode`-prop failure one layer up.

## Shell

`atoms`, `blocks`, and `views` are **content**: a `Button`, a `PageHeader`,
an `ErrorView` — whatever fills the page for the route currently on screen.
`shell` is the **frame** that content is rendered inside of. The two differ
on three axes:

| | Content (`atoms`, `blocks`, `views`) | `shell` |
| --- | --- | --- |
| Lifetime | remounts on every route change | persists across navigation |
| Cardinality | many per app | exactly one per app |
| Direction | fills a slot | provides the slots |

In a Next.js App Router application this maps directly onto the framework's
own two file types: `shell` lives in `layout.tsx` (rendered once, wrapping
every route below it); content lives in `page.tsx` (rendered fresh per
route). That mapping is the entire reason this is a separate layer rather
than one more block: if a *page* mounted the frame instead of a *layout*,
the frame would remount on every navigation — collapsing side-navigation
open/closed state, resetting a scroll position mid-list, and discarding any
toast that was queued a moment before the user clicked a link.

### `Shell`

```tsx
// app/layout.tsx
import { Shell } from "@vespeneventures/ui/shell";
import { Link } from "@vespeneventures/ui/atoms";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <Shell>
      <Shell.Header>
        <strong>Acme</strong>
      </Shell.Header>
      <Shell.SideNav>
        <Link href="/prompts" variant="standalone">Prompts</Link>
        <Link href="/evals" variant="standalone">Evals</Link>
      </Shell.SideNav>
      <Shell.Main>{children}</Shell.Main>
      <Shell.Rail>
        <p>Context for the current record.</p>
      </Shell.Rail>
      <Shell.Footer>
        <small>© Acme</small>
      </Shell.Footer>
    </Shell>
  );
}
```

```tsx
// app/prompts/page.tsx — content: remounts per route, fills Shell.Main
import { PageHeader } from "@vespeneventures/ui/blocks";

export default function PromptsPage() {
  return <PageHeader title="Prompts" />;
}
```

`Shell.Main` is the only required slot; `Header`, `SideNav`, `Rail`, and
`Footer` are all optional, and each renders the correct landmark element
(`<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>`) — there is exactly
one `<main>` per `Shell`, and it's the one `Shell.Main` renders. An absent
slot leaves no trace at all: its element simply isn't in the DOM, so there's
no empty grid track or leftover spacing where it would have been. Slots can
be written in any JSX order and still render in the correct visual
position, since each places itself into a named area of `Shell`'s own CSS
Grid rather than relying on source order.

`Shell` also renders a skip-to-content link — the first focusable element on
the page, visually hidden until it receives keyboard focus — so a keyboard
user landing on any route can jump straight past the header and side
navigation to that route's actual content.

`Shell.SideNav` is sized to `--ui-layout-sidebar-w` from the `tablet`
breakpoint up, and collapses — CSS-only, no JavaScript breakpoint state — to
the narrower `--ui-layout-sidebar-rail-w` icon-rail width below it.
`Shell.Rail` hides entirely below the `desktop` breakpoint. Both are plain
Tailwind responsive variants generated from this package's own breakpoint
tokens.

#### How differing chrome is handled

`Shell` takes **no `variant`/`mode` prop.** A marketing route group, a
signed-in member area, and a staff/admin area with three structurally
different headers and navigation are not three values of a prop — they're
three different slot fillings, declared in three different `layout.tsx`
files:

```tsx
// app/(marketing)/layout.tsx
<Shell>
  <Shell.Header><MarketingNav /></Shell.Header>
  <Shell.Main>{children}</Shell.Main>
</Shell>

// app/(member)/layout.tsx
<Shell>
  <Shell.Header><AccountMenu /></Shell.Header>
  <Shell.SideNav><MemberNav /></Shell.SideNav>
  <Shell.Main>{children}</Shell.Main>
</Shell>

// app/(staff)/layout.tsx
<Shell>
  <Shell.Header><StaffToolbar /></Shell.Header>
  <Shell.SideNav><StaffNav /></Shell.SideNav>
  <Shell.Main>{children}</Shell.Main>
  <Shell.Rail><AuditLog /></Shell.Rail>
</Shell>
```

`MarketingNav`, `AccountMenu`, `MemberNav`, `StaffToolbar`, `StaffNav`, and
`AuditLog` are each the CONSUMER's own composition of atoms — `Shell.Header`
itself stays a plain, unopinionated slot, and ships no `AppHeader` block of
its own. A header is where brand lives, and shipping a pre-built one INTO
`Shell` would recreate, one layer up, exactly the `mode`-prop failure
"Placement rules" above warns against: a single component slowly accreting
a named mode for every consumer's structural divergence, with every
combination of those modes untested. Three headers in three files share no
code that can break that way, because there's no shared code to break.

This is a different question from "does this package ship a header
component AT ALL" — it does now, at the narrower, `Shell.Header`-shaped
scope of `SiteHeader` below: unlike the three headers above (each a
one-off composition for ONE route group of ONE app), a public site's own
brand/nav/actions header is close to always the exact same three regions,
site to site, which is what makes it worth shipping as a real component
rather than always-bespoke consumer code — see `SiteHeader`'s own doc
comment for the placement reasoning in full.

### Site chrome: `SkipLink`, `SiteHeader`, `NavShell`, `SiteFooter`

`Shell` above is the app-shell frame — five slots, arbitrary consumer
content in each, built for the header/side-nav/rail/footer shape an
authenticated app tends to need. A public SITE (a marketing page, a docs
site, anything with no side navigation and no per-route chrome swap) needs
a simpler, more opinionated set: a brand/nav/actions header, the
navigation itself with a mobile drawer, grouped footer link columns, and
the skip link that makes either bypassable by keyboard. These four ship
from this same `/shell` subpath — the same placement reasoning `Shell`
itself already establishes applies to every one of them: run each through
this package's own placement test #1 ("does it survive a route change?")
first, and a site header/footer/nav survive it exactly the way `Shell`'s
own regions do, which is what puts all four here rather than in `blocks`.

```tsx
// app/layout.tsx
import { NavShell, SiteFooter, SiteHeader, SkipLink } from "@vespeneventures/ui/shell";
import { Link } from "@vespeneventures/ui/atoms";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SkipLink targetId="main-content">Skip to content</SkipLink>
      <SiteHeader
        brand={<Link href="/" variant="standalone">Acme</Link>}
        nav={
          <NavShell aria-label="Primary">
            <Link href="/products" variant="standalone">Products</Link>
            <Link href="/pricing" variant="standalone">Pricing</Link>
          </NavShell>
        }
        actions={<Link href="/sign-in" variant="standalone">Sign in</Link>}
      />
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter
        columns={
          <>
            <SiteFooter.Column heading="Product">
              <Link href="/products" variant="muted">Products</Link>
              <Link href="/pricing" variant="muted">Pricing</Link>
            </SiteFooter.Column>
            <SiteFooter.Column heading="Company">
              <Link href="/about" variant="muted">About</Link>
            </SiteFooter.Column>
          </>
        }
        secondary={
          <>
            <span>© 2026 Acme</span>
            <Link href="/privacy" variant="muted">Privacy</Link>
          </>
        }
      />
    </>
  );
}
```

Every string above (`"Acme"`, `"Products"`, `"Skip to content"`, ...) is
placeholder content this example supplies — the same "this package ships
no real words" rule every other example in this README follows. Nothing
about the four components themselves hardcodes a label, a brand name, or a
footer line; every one arrives as a prop or a child.

`SkipLink` takes the jump target's `id` (`targetId`) and its own visible
text (`children`) as props — unlike `Shell`'s internal skip link, which is
wired to `Shell.Main`'s own fixed, package-owned id, a site's own page
structure decides what "content" means, so this version assumes nothing
about where it points. Give the target element a matching `id` and
`tabIndex={-1}` (a plain `<main>` isn't natively focusable).

`SiteHeader` renders a real `<header>` — the page's `banner` landmark,
provided it sits at the top level rather than nested inside `<main>`/
`<article>`/`<aside>`/`<nav>`/`<section>` (nesting strips the implicit
role per the HTML/ARIA spec, the same placement rule `Shell.Header` and
`Shell.Footer` already carry). Three slots that differ in kind — `brand`
(required), `nav`, `actions` — the same "Slots, not a `mode`/`variant`
prop" shape every block in this README already follows; see `SiteHeader`'s
own doc comment for why it's `shell`, not `blocks`, despite reading like a
`PageHeader`-shaped composition of named regions.

`NavShell` is the responsive half: an ordinary inline `<nav>` from the
`tablet` breakpoint up, and a trigger-plus-drawer below it — CSS-only
breakpoint switching, no JS media-query state, so the correct layout is
already there on first paint before hydration ever runs. The drawer is
built on the same react-aria-components `DialogTrigger`/`ModalOverlay`/
`Modal`/`Dialog` primitives this package's own `Dialog` atom uses (see
that atom's own doc comment for the underlying mechanism), which is what
gives it, for free: focus moves into the drawer on open and is trapped
there; Escape always closes it; the trigger exposes `aria-expanded`/
`aria-haspopup` automatically; focus returns to the trigger on close;
everything outside the drawer is hidden from assistive technology while
it's open (`ariaHideOutside`, the same mechanism `Menu`'s and `Select`'s
own popovers already rely on); and the whole flow — open, navigate,
close — works with the keyboard alone. See `NavShell`'s own doc comment
for the one real trade-off this design makes (`children` renders twice,
once per breakpoint's own nav, so exactly one is ever visible and
reachable at a time) and why it's the correct one given this package's
"no JS-dependent layout" rule.

`SiteFooter` renders a real `<footer>` — the page's `contentinfo`
landmark, the same top-level-placement rule `SiteHeader` follows. Two
slots that differ in kind: `columns` (a responsive grid of
`SiteFooter.Column`s this component lays out) and `secondary` (a row
below a hairline divider for a copyright line, legal links, a locale
switcher). `SiteFooter.Column` ships as a sub-component — a heading plus
its links — the same `Object.assign` shape `Dialog.Heading`/`Menu.Item`
already use in this package, composed as JSX rather than a data array for
the same reason `RadioGroup.Radio`'s own section documents: real footer
columns differ column-by-column in a way that reads more naturally as
hand-written markup.

### `Toaster` and `toast`

A toast stack is a **runtime service**, not a layout component (see
"Placement rules" → "Does it have a portal, a queue, and an imperative
API?" above) — it doesn't occupy a `Shell` slot, and there is no
`Shell.Toaster`. It ships from this same `/shell` subpath anyway, for one
reason: its lifetime requirement is identical to `Shell`'s. A toast queued a
moment before a navigation has to survive that navigation, the same reason
`Shell` itself has to live in `layout.tsx` rather than `page.tsx`.

Mount `<Toaster />` once, anywhere in the same tree as `<Shell>` — its
on-screen position is fixed and independent of where in the React tree it's
rendered, since it portals straight to `document.body`:

```tsx
// app/layout.tsx
import { Shell, Toaster } from "@vespeneventures/ui/shell";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <Shell>
      <Shell.Main>{children}</Shell.Main>
      <Toaster />
    </Shell>
  );
}
```

Then, from anywhere — an event handler, a data-fetching effect, any code
with no JSX in it at all:

```tsx
import { toast } from "@vespeneventures/ui/shell";

async function save() {
  try {
    await saveDraft();
    toast.success("Saved");
  } catch {
    toast.error("Failed to save", { description: "Check your connection and try again." });
  }
}
```

`toast.success(...)`, `toast.error(...)`, `toast.warning(...)`, and
`toast.info(...)` each add one toast in that status and return a
`ToastHandle` (`{ id, dismiss() }`) the caller can use to close it early
in response to a later event. A plain `toast(...)` call is also
`info`-variant — there's no fifth, "neutral" status token to back a
variant-less style. Every variant is styled from this package's real status
tokens (`status-success`, `status-danger`, `status-info`, `status-warning`,
and each one's `-tint`/`-text` companion).

Each toast auto-dismisses after 5 seconds by default; pass `{ timeout: N }`
for a different duration, or `{ timeout: null }` for a toast that stays
until the user or code closes it. The countdown pauses for as long as the
toast viewport has mouse hover OR keyboard focus anywhere inside it, and
resumes when both end. Every toast is dismissible by keyboard — tab to its
close button, then Enter or Space. A `danger` toast's content is an
assertive live region (`role="alert"`, `aria-live="assertive"`); every
other variant is polite (`role="status"`, `aria-live="polite"`) — an error
should interrupt a screen reader user the way an alert does; a success
confirmation shouldn't interrupt at all.

Built on react-aria-components' `ToastRegion`/`Toast`/`ToastContent` (its
own `UNSTABLE_*` naming for a still-evolving API surface, not a sign the
behavior itself is unreliable) for portal rendering, focus management, and
the pause-on-hover-or-focus behavior described above — none of that is
reimplemented here. One thing IS overridden: react-aria-components' own
`ToastContent` always renders `role="alert"` regardless of variant, which
would make even a `success` toast interrupt a screen reader user; `Toaster`
supplies its own `role`/`aria-live` per variant instead, for the reason
above.

### File-tree shape

```
app/
  layout.tsx          ← Shell + Toaster (persistent frame)
  (member)/
    layout.tsx         ← a different Shell.Header/SideNav slot filling
    prompts/
      page.tsx          ← content, fills Shell.Main, remounts per route
    evals/
      page.tsx
```

## Charts

Dependency-free SVG chart primitives — no charting library is a dependency
of this package. Every mark is hand-drawn SVG, positioned by this package's
own small internal scale helpers, reading color exclusively through
this package's chart-color family (`--color-chart-*`, added in
that package's `0.4.0`) so every chart follows the active theme the same
way every other token-driven surface in this package does.

`charts` is a **sibling** of `shell`, not a rung of the `atoms → blocks →
views` ladder — the same reasoning "Shell" above gives for why `shell`
sits beside `views` rather than above it applies here too, one layer
further: a chart is neither persistent frame nor route content, it's a
different domain of primitive entirely (marks, scales, a plot coordinate
space) built directly on `atoms`. `charts` may import from `atoms` (its
`cx` class-merge helper); nothing in `atoms`, `blocks`, `views`, or `shell`
imports from `charts` — see `src/ladder.test.ts`.

**Non-negotiables every component here follows:**

- **One axis, always.** No component in this layer accepts a second
  y-scale. Two measures of different magnitude are two charts, never one
  chart with a second axis.
- **Color follows the entity, never its rank.** Every series gets a color
  from this package's fixed-order categorical palette, an
  explicit `color` per series always winning outright. By default a
  series' color is its position in the `series` array — which, on its
  own, is exactly the anti-pattern this rule warns about the moment a
  consumer filters `series` down to a subset, since removing an entry
  shifts everyone after it. Pass the stable, full `colorDomain` prop
  (`BarChart`/`LineChart` both accept it — the complete set of possible
  series names, known before any filtering) and each name's position in
  THAT list picks its slot instead, so filtering never repaints a
  survivor.
- **A legend appears for two or more series, never for one** (the title
  already names a single series) — `ChartFrame` enforces this itself, so
  no chart in this layer can accidentally ship a one-swatch legend box.
- **A table-view fallback ships with every chart**, `Sparkline` included —
  a `<details><summary>View as table</summary>` holding the same data as
  an ordinary HTML `<table>`, always reachable, never gated behind a
  screen reader or a hover.
- **A hover layer ships on every chart except `Sparkline`** — a crosshair
  + shared tooltip readout on `LineChart`, a per-mark tooltip on
  `BarChart` — with the same detail reachable on keyboard focus as on
  pointer hover.

### `ChartFrame`

The shared container `BarChart` and `LineChart` both compose: plot area,
axes, grid, an optional legend, an accessible SVG `<title>`/`<desc>`, and
the table-view fallback. Only reached for directly when composing a new
chart type this package doesn't ship; `BarChart`/`LineChart`/`Sparkline`
below are the components most consumers actually render.

```tsx
import { ChartFrame } from "@vespeneventures/ui/charts";

<ChartFrame
  title="Monthly signups"
  table={{ headers: ["Month", "Signups"], rows: [["Jan", 12], ["Feb", 18]] }}
>
  {(plot) => (
    // marks, positioned against `plot.x` / `plot.y` / `plot.width` / `plot.height`
    <rect x={plot.x} y={plot.y} width={20} height={plot.height} fill="var(--color-chart-categorical-1)" />
  )}
</ChartFrame>
```

### `BarChart`

Categorical magnitude — one bar per category, grouped by series when
there's more than one:

```tsx
import { BarChart } from "@vespeneventures/ui/charts";

<BarChart
  title="Revenue vs. cost"
  categories={["Jan", "Feb", "Mar"]}
  series={[
    { name: "Revenue", values: [120, 150, 170] },
    { name: "Cost", values: [80, 90, 95] },
  ]}
/>
```

Bars are capped at 24px thick with a 2px surface-color gap between
adjacent bars/segments, a 4px rounded data-end and a square baseline —
never a border drawn around a bar to separate it. Each bar carries a
native SVG `<title>` (a real hover tooltip) and is independently
keyboard-focusable with an equivalent `aria-label`. 2–4 series additionally
get a direct value label at the last category's cluster; more than 4
series relies on the legend + per-bar tooltip + table instead, so the
chart doesn't turn into a number on every point.

### `LineChart`

Change over time — one line per series, sharing one x scale and one y
scale:

```tsx
import { LineChart } from "@vespeneventures/ui/charts";

<LineChart
  title="Daily active users"
  x={[new Date("2026-01-01"), new Date("2026-01-02"), new Date("2026-01-03")]}
  series={[{ name: "DAU", values: [1200, 1350, 1290] }]}
/>
```

`x` accepts either `Date`s (a real time scale) or plain numbers (a linear
index scale) — `LineChart` picks the right one from the first entry. Lines
are drawn 2px with round joins/caps; the current end of each line carries
an 8px marker with a 2px surface-color ring so it stays legible crossing
another line. Moving the pointer over the plot (or moving keyboard focus
onto it and pressing the arrow keys) shows a crosshair at the nearest x
position plus a readout listing every series' value there — the pointer
never has to land exactly on a line to read it.

### `Sparkline`

A bare inline trend — no axes, no grid, no legend, and (the one exception
in this layer) no hover layer, meant to sit inline in running text or a
stat tile at a size too small for a crosshair to make sense:

```tsx
import { Sparkline } from "@vespeneventures/ui/charts";

<Sparkline title="7-day signups trend" values={[12, 18, 15, 22, 19, 25, 21]} />
```

Still ships its table-view fallback — that requirement has no exception —
collapsed behind the same `<details>` pattern `ChartFrame` uses, so it
costs no layout space until opened.

### The categorical palette, and what happens past 8 series

Every series gets its color from this package's fixed-order
categorical palette (8 slots, validated for color-vision-deficiency
separation — see that package's README), assigned by the series' position
in the array, never generated or cycled. Passing more than 8 series to
`BarChart` or `LineChart` drops everything past the 8th and logs a
`console.warn` naming the cut — per the dataviz method this palette was
built against, a 9th series does not get a generated color; fold the tail
into an "Other" series, or facet into separate charts, before reaching
this layer.

## Theme

`theme` is the JavaScript half of this package's theming contract. The
CSS half already ships from `tokens.css` (see "CSS layers, fallbacks, and
themes" above): a three-state contract, keyed on a `data-theme` attribute
on `<html>`, that `tokens.css`'s own header comment defines precisely —

- attribute **absent** → the OS decides, via `prefers-color-scheme`.
- **`data-theme="dark"`** → forced dark, even on a light OS.
- **`data-theme="light"`** → forced light, even on a dark OS.

Before this subpath shipped, nothing in this package actually DROVE that
attribute — a consumer had to hand-write the storage read, the three-state
branch, and the head script themselves, and get all three exactly right,
just to make a theme toggle work. `theme` is that missing JavaScript,
matching the CSS contract exactly: no fourth state, no class-based
toggle, no different attribute name. See "Wiring up a theme toggle" above
for a complete, runnable setup; this section covers what each piece does
and why it's shaped the way it is.

### `getThemeInitScript`

```tsx
import { getThemeInitScript } from "@vespeneventures/ui/theme";

<script dangerouslySetInnerHTML={{ __html: getThemeInitScript() }} />
```

Returns a small, self-contained script (as a string) that a consumer
injects into `<head>`, before any stylesheet or script that might paint —
see "Wiring up a theme toggle" above for why this can't be
`ThemeProvider`'s job: a React component fundamentally cannot run before
the document paints, so anything React-based corrects the theme one frame
too late, and that one frame is a real, visible flash on every page load
for a visitor whose stored preference disagrees with what the OS/CSS
would otherwise render. The returned script reads the same storage key
(`{ storageKey?: string }`, default `"ui-theme"`) and applies the exact
same three-state rule `ThemeProvider` applies at runtime — not a second,
hand-written copy of that rule: it embeds the compiled source of the same
two functions `ThemeProvider` calls directly, `.toString()`'d into the
returned string, so there is exactly one implementation, used two ways.
`src/theme/theme-script-parity.test.ts` in this package asserts the two
call sites agree, for every input, so they can't silently drift apart
even though nothing in the type system enforces it on its own. Never
throws: if `localStorage` is unavailable (private browsing, blocked
cookies, a disabled-storage policy), it falls back to `"system"` — the
safe default every other decline path in this subpath resolves to.

### `ThemeProvider` and `useTheme`

```tsx
import { ThemeProvider, useTheme } from "@vespeneventures/ui/theme";

function CurrentThemeLabel() {
  const { preference, resolvedTheme, setPreference } = useTheme();
  return (
    <button onClick={() => setPreference("dark")}>
      {preference} (showing {resolvedTheme})
    </button>
  );
}
```

`ThemeProvider` holds the three-state preference (`"system" | "light" |
"dark"`), persists it to `localStorage` under `storageKey` (default
`"ui-theme"`, must match `getThemeInitScript`'s own), and keeps
`<html data-theme>` — plus the native CSS `color-scheme` property, so
browser-drawn form controls/scrollbars/autofill match the theme too — in
sync with it. `useTheme()` returns three things:

- **`preference`** — what the consumer CHOSE. May be `"system"`, which is
  not itself a displayable theme.
- **`resolvedTheme`** — what is actually ON SCREEN right now: always
  `"light"` or `"dark"`, never `"system"`. For an explicit preference this
  equals `preference`; for `"system"` it's the OS's current choice, read
  live from a `prefers-color-scheme` media-query subscription and kept
  updated for as long as `ThemeProvider` is mounted — if the OS theme
  flips while the page is open, `resolvedTheme` updates without a reload.
- **`setPreference(next)`** — persists `next` (best-effort; never throws)
  and applies it.

These two values are kept deliberately distinct rather than collapsed into
one: a component picking a sun/moon icon needs `resolvedTheme`; a
component showing which of three options is currently selected needs
`preference`. Conflating them would leave one of those two, very ordinary
cases with no correct value to read.

**SSR safety.** `ThemeProvider` never reads `window`/`document`/
`localStorage` during render — doing so would make React's client render
diverge from the server's (which has no `localStorage` at all), producing
a hydration mismatch. Both the server and React's first client render use
`defaultPreference` (`"system"` unless overridden); a `useEffect` —
client-only, runs once after mount — then reads the real stored value and
corrects local state if it differs. This does not reintroduce the flash
`getThemeInitScript` solves: the page's actual rendered THEME already
matches the stored preference by the time this runs, because the head
script (which must run) already stamped it before first paint. Only this
hook's own reported `preference` — and anything that visibly depends on it,
like `ThemeToggle`'s icon — settles into its correct value one tick after
mount, the same tradeoff every SSR-safe theme provider makes.

### `ThemeToggle`

```tsx
import { ThemeToggle } from "@vespeneventures/ui/theme";

<ThemeToggle />
```

A single control that cycles System → Light → Dark → System, built from
this package's own `Button`/`Icon` atoms — see `ThemeToggle.tsx`'s own
doc comment for the full reasoning, summarized here: a theme preference is
one of three values, not a bit, so a two-state `Switch` plus a separate
"reset to system" control would need two controls to do one job, and the
switch itself would have no correct on/off position to show whenever the
preference is `"system"` (the OS could be either). A single cycling
control keeps `"system"` a first-class, always-reachable stop on the same
control, reachable through the same public API (`useTheme`'s
`setPreference` accepts any of the three values directly) that a consumer
building their own three-option segmented control or menu would use
instead of `ThemeToggle`.

Keyboard-operable and screen-reader accessible via this package's own
`Button` atom (react-aria-components underneath — see "Why these
dependencies"): `aria-label` states both the current preference and what
activating the control does next, and a visually hidden
`role="status"`/`aria-live="polite"` region announces every change, since
not every screen reader/browser combination reliably re-announces an
`aria-label` that changes on an already-focused element.

## Icon glyph data (`@vespeneventures/ui/icons`)

```tsx
import { Icon } from "@vespeneventures/ui/atoms";
import { Search } from "@vespeneventures/ui/icons";

<Icon glyph={Search} label="Search" />;
```

32 `IconNode` exports — plain data, no components, no rendering logic of
any kind. See "Icon" (above, under "Atoms") for the render contract that
consumes this data; this section covers the data itself: where it came
from, how the 32 were chosen, and how to keep it current.

### A subpath of `ui`, not a separate package

This glyph set shipped for a while as this scope's own standalone `icons`
package, at the same layer as this package's token layer —
deliberately, not a `ui` subpath, specifically so a consumer who wanted
only icons (a marketing site, a docs page, anything with no interactive
components) never had to accept `ui`'s own dependency graph
(`react-aria-components`, `tailwind-merge`) just to reach them.

That reasoning doesn't survive being checked against how ES module
bundlers actually behave, once the render CONTRACT (this package's own
`Icon` atom) is what a consumer needs alongside the data anyway: `ui` is
`"sideEffects": false`, and `@vespeneventures/ui/icons` ships one ES module
per glyph — importing `Search` from it bundles exactly `Search`, the same
elimination `src/icons/tree-shake.test.ts` measures against a real
bundler's OUTPUT, not assumed. An unimported `ui/icons` costs an unrelated
`ui` consumer zero bytes, the identical reasoning that already justifies
`@vespeneventures/ui/charts` living inside this package rather than as its
own. The dependency-weight argument the standalone package's own README
made for keeping icons separate does not hold up under that same scrutiny —
it is not repeated here.

**The argument that DOES hold, and is why this data is still vendored
rather than a direct `lucide-react` dependency:** insulation from upstream
renaming and churn. This set already crossed one Lucide rename in the
version it's pinned at — four of its 32 names resolve to a Lucide glyph
published under a *different* name in the pinned release (`AlertTriangle`
→ `triangle-alert`, `Home` → `house`, `CheckCircle` → `circle-check-big`,
`XCircle` → `circle-x`; see "Third-party notices" below for the full
table). A direct dependency on `lucide-react` would mean either following
Lucide's own renames as they happen (churn a consumer of THIS package never
asked for) or pinning a `lucide-react` version directly (which still drifts
from whatever else in a consumer's own tree might depend on a newer one).
Vendoring the path data once, under this package's own stable names, means
this set's 32 names never move under a consumer's feet regardless of what
Lucide does next — Lucide itself has moved on to 1.30 already; this data
stays pinned at 1.23.0 until a deliberate refresh (see below).

### How the 32 were chosen

The standing instruction for this program is explicit: don't build a
design asset just because an existing consumer repo happens to use it — an
icon that shows up in exactly one consumer is that consumer's domain
vocabulary, not a shared primitive. The method here is the same one
earlier rounds of this program used for components: compute the actual
intersection of what independent consumers use, and treat an icon that
appears in every one of them as the strong candidate.

Three independent icon registries were inspected (read-only reference
material, not a dependency of this package and not named here beyond this
evidence summary):

- Two full-featured, `lucide`-based UI icon registries maintained by two
  separate consumer products. One is a full superset of the other's shared
  baseline — **186 of 186** names in the smaller registry's non-domain
  baseline appear, byte-identical by name, in the larger one. That 186-name
  baseline was itself already a historical existing-wins merge across three
  prior per-product registries, so this comparison is really evidence from
  several products converging on one vocabulary, not two.
- One independently hand-drawn, non-`lucide` SVG icon set (31 names, its
  own bespoke paths, built by a team with no knowledge of the `lucide`-based
  registries above) from a third, unrelated product's demo application.

Matching the third set against the 186-name baseline required semantic
matching rather than exact string matching — its names and glyphs differ
(`"doc"` vs. `"file-text"`, `"gear"` vs. `"settings"`, `"card"` vs.
`"credit-card"`), since it wasn't built with the other two in mind. **26 of
its 31 icons** matched a concept already in the 186-name baseline this way —
strong independent corroboration that the baseline vocabulary really is
common-UI, not an artifact of two products sharing lineage.

From that 3-way intersection, this set excludes anything that reads as
decorative or domain-flavored rather than structural chrome even though it
technically intersected — `sparkle` (a brand/delight accent, not
interactive chrome), `target` ("goals," a marketing concept), `cpu`
(infrastructure-specific), and a handful of fuzzy matches that only worked
by treating two visually distinct concepts as "close enough" (`coins` vs. a
generic dollar sign, `bank` vs. a generic building, `exchange` vs. a
generic left-right arrow). What's left is 22 icons.

That 3-way intersection already happens to fully cover two families this
repository's own other packages commit to elsewhere, worth calling out as
corroboration rather than coincidence: this package's token-layer docs
documents a three-state theme toggle (`"system" | "light" | "dark"`), and
`Sun`/`Moon`/`Monitor` — all three of its canonical icons — are already in
the 22. The token layer also ships exactly four status colors
(`success`/`warning`/`danger`/`info`), already exposed as a `variant` prop
on this package's own `Banner`/`Badge` atoms, and two of the four —
`Info` (`info`) and `AlertTriangle` (`warning`) — are already in the 22 as
well. The other two color-family members are NOT in the 22 (neither
consumer registry with the narrow, independent 31-icon set had a matching
concept), but the same internal-consistency reasoning that explains why the
first two survived intersection argues for completing the family rather
than shipping it two-fifths done: `CheckCircle` (success) and `XCircle`
(danger) are added as this set's one small, individually-justified tier
beyond the raw intersection number.

A second, separate tier addresses the universal interaction primitives this
package's own atoms currently stand in for with plain text: `Select` and
`ComboBox` render a literal `▾` character instead of a chevron icon, and
`Chip`/`Banner` render a literal `×` instead of a close icon — deliberately
(see those atoms' own sections above; migrating them to `Icon` is explicit
follow-up work, not this data set's job). `ChevronDown`/`ChevronUp`/
`ChevronLeft`/`ChevronRight` and `X` are the real glyphs those placeholders
stand in for — present in both full `lucide`-based registries (2-way
evidence), and individually justified by a real, named call site in this
repository rather than intersection alone. `Check`, `Search` (the exact
concept `SearchField` is named after), and `ExternalLink` complete this
tier on the same "present in both full registries, and an unambiguous
interaction primitive rather than domain vocabulary" basis.

22 (3-way intersection) + 2 (status-family completion) + 8 (interaction
primitives) = **32** — the exact number every count in this section and
every test in `src/icons/` checks against; nothing was added and then
quietly dropped to make the arithmetic round.

Bias throughout was toward leaving an icon OUT rather than in: every name
above either survived a genuine 3-way intersection, completes a family this
repository's own `tokens`/`ui` packages already committed to most of, or
replaces a real, named placeholder already living in this package's own
source. Nothing shipped here exists because exactly one consumer happened
to want it.

### Naming convention

No `Icon` suffix (`Clock`, not `ClockIcon`) — two reasons, both deliberate:

1. **These are data, not components.** The suffix-free package this data
   was vendored from (`lucide-react`) exports its own icons the same way
   (`Search`, `Settings`, no suffix) — matching that convention means a
   consumer already familiar with Lucide's names recognizes these
   immediately, while the shape difference (`const Clock: IconNode = [...]`
   here vs. a component there) stays unambiguous from the type alone; a
   `ClockIcon` name, by contrast, reads as "this is a renderable thing,"
   which risks a consumer reaching for `<Clock />` directly instead of
   `<Icon glyph={Clock} .../>`.
2. It shortens the common call site: `<Icon glyph={Clock} label="..." />`
   instead of the redundant `<Icon glyph={ClockIcon} label="..." />`.

The one place this convention has a real cost, not just a stylistic one:
three of the 32 names are now a literal prefix of another (`Check` of
`CheckCircle`, `User` of `Users`, `X` of `XCircle`) — a collision the old
`*Icon`-suffixed names happened to avoid (`UserIcon` is not a contiguous
substring of `UsersIcon`, because the plural's extra `s` sits between
them). `src/icons/tree-shake.test.ts`'s own header comment covers the
concrete consequence (a bare-identifier bundle marker doesn't work for
these three pairs) and the fix used instead.

### Third-party notices

The 32 glyphs here are visually derived from [Lucide](https://lucide.dev)
(ISC License) and, for a subset of those, [Feather](https://feathericons.com)
(MIT License) before that — this package does not depend on `lucide-react`
at runtime (see "A subpath of `ui`, not a separate package" above), but the
SVG path data was copied from it, pinned at Lucide **1.23.0**. Full
attribution, the rename table, and both license texts:
[THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md) — required reading
before touching `scripts/icon-source-data.json`, and shipped in this
package's published tarball (`package.json`'s `files` list) alongside
`LICENSE`, since both licenses require the notice accompany distribution,
not just live in this repository.

### Refreshing the data

`scripts/generate-icons.mjs` reads `scripts/icon-source-data.json` and
writes one `src/icons/<Name>.ts` file per entry plus `src/icons/index.ts` —
mechanically regenerable, never hand-edited (every generated file says so
in its own header comment). To pull a newer Lucide release for an existing
name: find its current kebab-case name in the target version (check
THIRD-PARTY-NOTICES.md's rename table first), copy its `<svg>` children
into `icon-source-data.json` as `[tag, { ...attrs }]` tuples, update the
pinned-version references in THIRD-PARTY-NOTICES.md and this package's
CHANGELOG.md, then run `node scripts/generate-icons.mjs` and `npm test`
— `src/icons/icons.test.ts` and `src/icons/tree-shake.test.ts` both
re-verify the regenerated data. See `scripts/generate-icons.mjs`'s own
header comment for the full procedure, including adding a genuinely new
name (follow "How the 32 were chosen" above first — this set is curated,
not a grab-bag).

## API

| Export | Kind | Description |
| --- | --- | --- |
| `AlertTriangle`, `BookOpen`, `Box`, `Building2`, `Calendar`, `Check`, `CheckCircle`, `ChevronDown`, `ChevronLeft`, `ChevronRight`, `ChevronUp`, `Clock`, `CreditCard`, `ExternalLink`, `FileText`, `Folder`, `Grid3x3`, `Home`, `Info`, `List`, `Lock`, `Monitor`, `Moon`, `Plug`, `Receipt`, `Search`, `Settings`, `Sun`, `User`, `Users`, `X`, `XCircle` | data | The 32 shipped icon glyphs, each an `IconNode` — see "Icon glyph data" above. |
| `Button` | component | Pressable action built on react-aria-components' `Button`. |
| `ButtonProps` | type | Props for `Button`: `variant`, `size`, plus everything react-aria-components' own `Button` accepts. |
| `ButtonVariant` | type | `"primary" \| "secondary" \| "ghost" \| "danger"`. |
| `ButtonSize` | type | `"sm" \| "md" \| "lg"`. |
| `Icon` | component | The glyph render contract: size, colour, accessibility, applied to either `glyph` (structured `IconNode` data) or `children` (raw SVG/a component). |
| `IconProps` | type | `IconAccessibilityProps & { glyph: IconNode; children?: undefined } \| { glyph?: undefined; children: ReactNode } & { size?: IconSize; className?: string; style?: CSSProperties } & Omit<SVGProps<SVGSVGElement>, ...>`. |
| `IconSize` | type | `"sm" \| "md" \| "lg"`. |
| `IconAccessibilityProps` | type | The `{ decorative: true } \| { label: string }` discriminated union. |
| `IconNode` | type | `ReadonlyArray<readonly [tag: string, attrs: Record<string, string>]>` — also re-exported from `@vespeneventures/ui/icons`. |
| `TextField` | component | Labeled single-line text input built on react-aria-components' `TextField` + `Label` + `Input` + `FieldError`. |
| `TextFieldProps` | type | Props for `TextField`: `label`, `description`, `errorMessage`, `placeholder`, `className`, `inputClassName`, plus everything react-aria-components' own `TextField` accepts. |
| `Badge` | component | Small status/label pill. Plain markup — not interactive, composes no other atom. |
| `BadgeProps` | type | Props for `Badge`: `variant`, plus every native `<span>` attribute. |
| `BadgeVariant` | type | `"neutral" \| "success" \| "warning" \| "danger" \| "info"`. |
| `Card` | component | Raised content surface. Plain markup — not interactive, composes no other atom. |
| `CardProps` | type | Props for `Card`: every native `<div>` attribute. |
| `Breadcrumb` | component | Breadcrumb trail built on react-aria-components' `Breadcrumbs`/`Breadcrumb`/`Link`. Carries `Breadcrumb.Item`. An atom: its items are a homogeneous repeat, not distinct named regions. |
| `BreadcrumbProps` | type | Props for `Breadcrumb`: `children`, `className`, `aria-label`, plus react-aria-components' own `Breadcrumbs` props. |
| `BreadcrumbItemProps` | type | Props for `Breadcrumb.Item`: `href`, `children`, `className`. |
| `Link` | component | Navigable link built on react-aria-components' `Link`. |
| `LinkProps` | type | Props for `Link`: `variant`, plus everything react-aria-components' own `Link` accepts (including `render`, for a custom/router link element). |
| `LinkVariant` | type | `"default" \| "muted" \| "standalone"`. |
| `Checkbox` | component | Checkbox with indeterminate support, built on react-aria-components' `Checkbox`. |
| `CheckboxProps` | type | Props for `Checkbox`: `children` (the visible label), plus everything react-aria-components' own `Checkbox` accepts (including `isIndeterminate`). |
| `Switch` | component | On/off toggle built on react-aria-components' `Switch`. |
| `SwitchProps` | type | Props for `Switch`: `children` (the visible label), plus everything react-aria-components' own `Switch` accepts. |
| `Select` | component | Labeled single-choice dropdown built on react-aria-components' `Select`/`Button`/`Popover`/`ListBox`/`ListBoxItem`. |
| `SelectProps` | type | Props for `Select`: `label`, `description`, `errorMessage`, `placeholder`, `options`, `className`, `triggerClassName`, plus everything react-aria-components' own `Select` accepts. |
| `SelectOption` | type | One option: `id`, `label`, `isDisabled?`, `textValue?`. |
| `Textarea` | component | Labeled multi-line text input built on react-aria-components' `TextField` + `Label` + `TextArea` + `FieldError`. |
| `TextareaProps` | type | Props for `Textarea`: `label`, `description`, `errorMessage`, `placeholder`, `rows`, `className`, `textareaClassName`, plus everything react-aria-components' own `TextField` accepts. |
| `Avatar` | component | Person/thing picture with an initials fallback. Plain markup — not interactive, composes no other atom. |
| `AvatarProps` | type | Props for `Avatar`: `alt`, `src`, `size`, plus every native `<span>` attribute except `children`. |
| `AvatarSize` | type | `"sm" \| "md" \| "lg"`. |
| `Spinner` | component | Indeterminate loading indicator. Plain SVG — not interactive, composes no other atom. |
| `SpinnerProps` | type | Props for `Spinner`: `size`, `label`, plus every native `<svg>` attribute except `className`/`children`. |
| `SpinnerSize` | type | `"sm" \| "md" \| "lg"`. |
| `Menu` | component | Dropdown menu built on react-aria-components' `MenuTrigger`/`Menu`/`MenuItem`/`Popover`. Carries `Menu.Item` and `Menu.Separator`. |
| `MenuProps` | type | Props for `Menu`: `trigger`, `children`, `triggerAction`, `className`, `popoverClassName`, plus most of react-aria-components' own `MenuTrigger` props. |
| `MenuItemProps` | type | Props for `Menu.Item`: `children`, `isDestructive`, `className`, plus everything react-aria-components' own `MenuItem` accepts. |
| `MenuSeparatorProps` | type | Props for `Menu.Separator`: `className`. |
| `Dialog` | component | Modal dialog built on react-aria-components' `DialogTrigger`/`ModalOverlay`/`Modal`/`Dialog`. Carries `Dialog.Heading`. |
| `DialogProps` | type | Props for `Dialog`: `trigger`, `children` (may be a function receiving `{ close }`), `size`, `isDismissable`, `className`, `style`, `overlayClassName`, plus most of react-aria-components' own `DialogTrigger` props. |
| `DialogSize` | type | `"sm" \| "md" \| "lg"`. |
| `DialogHeadingProps` | type | Props for `Dialog.Heading`: `children`, `className`, `level`, plus everything react-aria-components' own `Heading` accepts. |
| `Tabs` | component | Tabbed navigation built on react-aria-components' `Tabs`/`TabList`/`Tab`/`TabPanel`. Carries `Tabs.List`, `Tabs.Tab`, `Tabs.Panel`. |
| `TabsProps` | type | Props for `Tabs`: `children`, `className`, plus most of react-aria-components' own `Tabs` props. |
| `TabsListProps` | type | Props for `Tabs.List`: `children`, `className`, plus most of react-aria-components' own `TabList` props (including `aria-label`). |
| `TabsTabProps` | type | Props for `Tabs.Tab`: `children`, `className`, `style`, `id`, `isDisabled`, plus everything react-aria-components' own `Tab` accepts. |
| `TabsPanelProps` | type | Props for `Tabs.Panel`: `children`, `className`, `id`, plus everything react-aria-components' own `TabPanel` accepts. |
| `Table` | component | Table primitives built on react-aria-components' `Table`/`TableHeader`/`TableBody`/`Column`/`Row`/`Cell`. Carries `Table.Header`, `Table.Column`, `Table.Body`, `Table.Row`, `Table.Cell`, `Table.SelectAllCheckbox`, `Table.SelectionCheckbox`. |
| `TableProps` | type | Props for `Table`: `children`, `className`, `style`, plus react-aria-components' own `Table` props (`aria-label`, `sortDescriptor`, `onSortChange`, `selectionMode`, `selectedKeys`, `onSelectionChange`, ...). |
| `TableHeaderProps` | type | Props for `Table.Header`: `children` (`Table.Column`s), `className`, plus react-aria-components' own `TableHeader` props. |
| `TableColumnProps` | type | Props for `Table.Column`: `children`, `className`, `style`, `id`, `allowsSorting`, `isRowHeader`, plus everything react-aria-components' own `Column` accepts. |
| `TableBodyProps` | type | Props for `Table.Body`: `children` (`Table.Row`s), `className`, plus react-aria-components' own `TableBody` props (including `renderEmptyState`). |
| `TableRowProps` | type | Props for `Table.Row`: `children` (`Table.Cell`s), `className`, `style`, `id`, plus everything react-aria-components' own `Row` accepts. |
| `TableCellProps` | type | Props for `Table.Cell`: `children`, `className`, `style`, plus everything react-aria-components' own `Cell` accepts. |
| `TableSelectAllCheckboxProps` | type | Props for `Table.SelectAllCheckbox`: `aria-label` (default `"Select all rows"`), `className`. |
| `TableSelectionCheckboxProps` | type | Props for `Table.SelectionCheckbox`: `aria-label` (default `"Select row"`), `className`. |
| `Field` | component | Label/description/error wrapper for a control this package doesn't ship an atom for. `children` is a render prop receiving `FieldRenderProps` to spread onto that control. |
| `FieldProps` | type | Props for `Field`: `label`, `description`, `errorMessage`, `isInvalid`, `isRequired`, `children`, `className`, `style`. |
| `FieldRenderProps` | type | The `{ id, "aria-describedby"?, "aria-invalid"?, "aria-required"? }` shape `Field`'s `children` render prop receives. |
| `Skeleton` | component | Loading placeholder. Plain markup — not interactive, composes no other atom. |
| `SkeletonProps` | type | Props for `Skeleton`: `shape`, `aria-label`, plus every native `<div>` attribute except `children`/`role`. |
| `SkeletonShape` | type | `"text" \| "block" \| "circle"`. |
| `Tooltip` | component | Hover/focus description built on react-aria-components' `TooltipTrigger`/`Tooltip`. |
| `TooltipProps` | type | Props for `Tooltip`: `trigger`, `children`, `triggerAction`, `placement`, `className`, plus most of react-aria-components' own `TooltipTrigger` props. |
| `Banner` | component | Persistent inline message region built over the status tokens. |
| `BannerProps` | type | Props for `Banner`: `variant`, `children`, `onDismiss`, `dismissLabel`, `className`, `style`, plus every native `<div>` attribute except `role`/`children`. |
| `BannerVariant` | type | `"info" \| "success" \| "warning" \| "danger"`. |
| `RadioGroup` | component | Single-choice control over a visible set of options, built on react-aria-components' `RadioGroup`/`Radio`. Carries `RadioGroup.Radio`. |
| `RadioGroupProps` | type | Props for `RadioGroup`: `label`, `description`, `errorMessage`, `children`, `className`, plus most of react-aria-components' own `RadioGroup` props. |
| `RadioGroupRadioProps` | type | Props for `RadioGroup.Radio`: `children`, `description`, `className`, plus everything react-aria-components' own `Radio` accepts. |
| `Popover` | component | The general anchored-overlay primitive built on react-aria-components' `DialogTrigger`/`Popover`/`Dialog`. |
| `PopoverProps` | type | Props for `Popover`: `trigger`, `children` (may be a function receiving `{ close }`), `placement`, `offset`, `className`, `style`, plus most of react-aria-components' own `DialogTrigger` props. |
| `DateField` | component | Segmented, keyboard-editable date entry built on react-aria-components' `DateField`/`DateInput`/`DateSegment`. |
| `DateFieldProps` | type | Props for `DateField`: `label`, `description`, `errorMessage`, `className`, `inputClassName`, plus everything react-aria-components' own `DateField` accepts (`value`/`defaultValue` as `@internationalized/date` `DateValue`s). |
| `ComboBox` | component | Searchable/filterable single-choice field built on react-aria-components' `ComboBox`/`Input`/`Button`/`Popover`/`ListBox`/`ListBoxItem`. |
| `ComboBoxProps` | type | Props for `ComboBox`: `label`, `description`, `errorMessage`, `placeholder`, `options`, `className`, `inputClassName`, plus everything react-aria-components' own `ComboBox` accepts. |
| `ComboBoxOption` | type | One option: `id`, `label`, `isDisabled?`, `textValue?`. |
| `SearchField` | component | Search input with a built-in clear affordance, built on react-aria-components' `SearchField`/`Input`/`Button`. |
| `SearchFieldProps` | type | Props for `SearchField`: `label`, `description`, `errorMessage`, `placeholder`, `className`, `inputClassName`, plus everything react-aria-components' own `SearchField` accepts. |
| `FileTrigger` | component | File selection wired onto an arbitrary pressable trigger, built on react-aria-components' `FileTrigger`. |
| `FileTriggerProps` | type | Props for `FileTrigger`: `children` (the pressable trigger), plus everything react-aria-components' own `FileTrigger` accepts (`acceptedFileTypes`, `allowsMultiple`, `onSelect`, ...). No `className` — see `FileTrigger.tsx`'s own doc comment for why. |
| `Disclosure` | component | A single expandable/collapsible section, built on react-aria-components' `Disclosure`/`DisclosurePanel`. |
| `DisclosureProps` | type | Props for `Disclosure`: `title`, `children`, `className`, plus most of react-aria-components' own `Disclosure` props. |
| `ProgressBar` | component | Determinate/indeterminate progress built on react-aria-components' own `ProgressBar`. |
| `ProgressBarProps` | type | Props for `ProgressBar`: `label`, `className`, plus everything react-aria-components' own `ProgressBar` accepts (`value`, `minValue`, `maxValue`, `isIndeterminate`, ...). |
| `Separator` | component | Visual divider built on react-aria-components' own `Separator`. |
| `SeparatorProps` | type | Props for `Separator`: `orientation`, `decorative`, `className`, `style`, plus most of react-aria-components' own `Separator` props. |
| `Chip` | component | A removable label: a label region plus a remove-affordance region. Distinct from `Badge`, which is static. |
| `ChipProps` | type | Props for `Chip`: `children`, `isDisabled`, `className`, `style`, plus `onRemove`/`removeLabel` (typed together — `removeLabel` is required whenever `onRemove` is supplied). |
| `PageHeader` | component | Page banner: breadcrumb slot, title, description, actions slot. |
| `PageHeaderProps` | type | Props for `PageHeader`: `title`, `description`, `actions`, `breadcrumb`, plus every native `<header>` attribute. |
| `EmptyState` | component | Zero-item placeholder: icon slot, title, description, action slot. |
| `EmptyStateProps` | type | Props for `EmptyState`: `icon`, `title`, `description`, `action`, plus every native `<div>` attribute. |
| `DataTable` | component | Controlled data grid built on `Table`'s primitives: toolbar slot, the grid itself, empty state, loading state, footer slot. |
| `DataTableProps` | type | Props for `DataTable`: `aria-label`, `columns`, `rows`, `rowKey`, `sortDescriptor`, `onSortChange`, `selectionMode`, `selectedKeys`, `onSelectionChange`, `isLoading`, `loadingRowCount`, `emptyStateTitle`, `emptyStateDescription`, `emptyStateAction`, `toolbar`, `footer`, `className`, `style`. |
| `DataTableColumn` | type | One column definition: `id`, `header`, `cell(row)`, `allowsSorting?`, `isRowHeader?`, `width?`. |
| `DataTableSelectionMode` | type | `"none" \| "single" \| "multiple"`. |
| `DetailView` | component | Label/value presentation of a single record: title slot, a `<dl>` field list, actions slot. |
| `DetailViewProps` | type | Props for `DetailView`: `title`, `fields`, `actions`, `className`, `style`, plus every native `<section>` attribute. |
| `DetailViewField` | type | One field: `label`, `value` (`ReactNode`), `span?` (`1 \| 2`). |
| `Pagination` | component | Page navigation: range summary, page controls, optional page-size selector. |
| `PaginationProps` | type | Props for `Pagination`: `page`, `pageCount`, `onPageChange`, `totalItems`, `pageSize`, `pageSizeOptions`, `onPageSizeChange`, `siblingCount`, `className`, `style`, plus every native `<nav>` attribute. |
| `Stat` | component | A single metric: label, value, optional delta/trend, optional description. |
| `StatProps` | type | Props for `Stat`: `label`, `value`, `delta`, `trend`, `description`, `className`, `style`, plus every native `<div>` attribute. |
| `StatTrend` | type | `"up" \| "down" \| "neutral"`. |
| `Form` | component | Form layout: optional heading, fields region, error-summary region (focused/announced on failure), actions region. No validation logic. |
| `FormProps` | type | Props for `Form`: `heading`, `children`, `errors`, `actions`, `onSubmit`, `className`, `style`, plus every native `<form>` attribute. |
| `FormError` | type | One error-summary entry: `fieldId`, `message`. |
| `FieldGroup` | component | A related set of fields under a shared `<fieldset>`/`<legend>`: legend, optional description, the fields. |
| `FieldGroupProps` | type | Props for `FieldGroup`: `legend`, `description`, `layout`, `children`, `className`, `style`, plus every native `<fieldset>` attribute. |
| `FieldGroupLayout` | type | `"single" \| "multi"`. |
| `ConfirmDialog` | component | Confirmation prompt built on `Dialog`: heading, message, Cancel/Confirm actions. Focus defaults to Cancel for `tone="destructive"`. |
| `ConfirmDialogProps` | type | Props for `ConfirmDialog`: `trigger`, `heading`, `message`, `confirmLabel`, `cancelLabel`, `tone`, `onConfirm`, `onCancel`, `className`, `style`, plus most of `Dialog`'s own props. |
| `ConfirmDialogTone` | type | `"neutral" \| "destructive"`. |
| `Toolbar` | component | Action bar built on react-aria-components' own `Toolbar`: leading actions, search/filter slot, trailing actions, with real roving-focus arrow-key navigation. |
| `ToolbarProps` | type | Props for `Toolbar`: `leading`, `search`, `trailing`, `className`, `style`, plus most of react-aria-components' own `Toolbar` props (`orientation`, `aria-label`, ...). |
| `NavGrid` | component | Grid of navigation cards: optional heading, the card grid. Each card is a real `<a>` or `<button>`. |
| `NavGridProps` | type | Props for `NavGrid`: `heading`, `items`, `className`, `style`. |
| `NavGridItem` | type | One card, as data: `id`, `title`, `description?`, `icon?`, and either `href` or `onSelect` (mutually exclusive). |
| `SectionHeader` | component | Heading for a section within a page (as opposed to the whole-page `PageHeader`): eyebrow, title, description, actions slot. `level` picks its heading element. |
| `SectionHeaderProps` | type | Props for `SectionHeader`: `eyebrow`, `title`, `description`, `actions`, `level`, `className`, `style`, plus every native `<div>` attribute. |
| `SectionHeaderLevel` | type | `2 \| 3 \| 4 \| 5 \| 6`. |
| `Hero` | component | Above-the-fold message: eyebrow, heading, description, actions slot, optional media slot (switches to a two-column layout when supplied). `headingLevel` picks its heading element. |
| `HeroProps` | type | Props for `Hero`: `eyebrow`, `heading`, `description`, `actions`, `media`, `headingLevel`, `className`, `style`, plus every native `<section>` attribute. |
| `HeroHeadingLevel` | type | `1 \| 2`. |
| `FeatureGrid` | component | Titled collection of feature items: optional eyebrow/heading/description region, a grid of icon/heading/description items. |
| `FeatureGridProps` | type | Props for `FeatureGrid`: `eyebrow`, `heading`, `description`, `items`, `headingLevel`, `className`, `style`, plus every native `<div>` attribute. |
| `FeatureGridItem` | type | One item: `id`, `icon?`, `heading`, `description?`. |
| `FeatureGridHeadingLevel` | type | `2 \| 3 \| 4 \| 5 \| 6`. |
| `Faq` | component | Expand/collapse question/answer list, under an optional heading region. Each item is this package's own `Disclosure` atom — independent, not a coordinated accordion. |
| `FaqProps` | type | Props for `Faq`: `heading`, `description`, `items`, `headingLevel`, `className`, `style`, plus every native `<div>` attribute. |
| `FaqItem` | type | One item: `id`, `question`, `answer`. |
| `FaqHeadingLevel` | type | `2 \| 3 \| 4 \| 5 \| 6`. |
| `PricingTable` | component | Pricing tiers under an optional heading region: name, price, feature list, CTA slot per tier, `isHighlighted` plus an optional `badge` slot to mark one as recommended. |
| `PricingTableProps` | type | Props for `PricingTable`: `heading`, `description`, `tiers`, `headingLevel`, `className`, `style`, plus every native `<div>` attribute. |
| `PricingTier` | type | One tier: `id`, `name`, `price`, `description?`, `features` (`readonly ReactNode[]`), `cta`, `isHighlighted?`, `badge?`. |
| `PricingTableHeadingLevel` | type | `2 \| 3 \| 4 \| 5 \| 6`. |
| `Testimonial` | component | Quote plus attribution, rendered as a real `<figure>`/`<blockquote>`/`<figcaption>`: `attributorName` and `attributorRole` are always separate fields. Optional avatar via `avatarSrc`/`avatarAlt`, required together at the type level. |
| `TestimonialProps` | type | Props for `Testimonial`: `quote`, `attributorName`, `attributorRole`, `avatarSrc`/`avatarAlt` (a discriminated pair — both or neither), `className`, `style`, plus every native `<figure>` attribute except `children`. |
| `ArticleBody` | component | Thin, token-styled container for pre-structured long-form content (real `<h2>`/`<p>`/`<ul>`/... children) — no markdown parsing, no content-shape schema. |
| `ArticleBodyProps` | type | Props for `ArticleBody`: `children`, `className`, `style`, plus every native `<article>` attribute. |
| `mergeUiClasses` | function | Merges token-aware Tailwind utility classes with last-argument precedence; used by surface-level compositions built from UI primitives. |
| `Shell` | component | The persistent application frame. Carries `Shell.Header`, `Shell.SideNav`, `Shell.Main`, `Shell.Rail`, `Shell.Footer`. |
| `ShellProps` | type | Props for `Shell`: `children` (any subset of the five slots above, in any order), plus every native `<div>` attribute. |
| `ShellHeaderProps` | type | Props for `Shell.Header`: `children`, plus every native `<header>` attribute. |
| `ShellSideNavProps` | type | Props for `Shell.SideNav`: `children`, plus every native `<nav>` attribute (including `aria-label`, default `"Primary"`). |
| `ShellMainProps` | type | Props for `Shell.Main`: `children`, plus every native `<main>` attribute except `id` (fixed, for the skip link). |
| `ShellRailProps` | type | Props for `Shell.Rail`: `children`, plus every native `<aside>` attribute. |
| `ShellFooterProps` | type | Props for `Shell.Footer`: `children`, plus every native `<footer>` attribute. |
| `SkipLink` | component | Keyboard affordance to bypass nav chrome and jump straight to a page's content. Visually hidden until focused. |
| `SkipLinkProps` | type | Props for `SkipLink`: `targetId` (the jump target's `id`), `children` (the link's own visible text — no built-in copy), `className`. |
| `SiteHeader` | component | Public-site top chrome: brand slot, primary navigation slot, actions slot. Renders the page's `banner` landmark. |
| `SiteHeaderProps` | type | Props for `SiteHeader`: `brand` (required), `nav`, `actions`, plus every native `<header>` attribute. |
| `NavShell` | component | The responsive half of a public site's navigation: an inline `<nav>` from `tablet` up, a trigger-plus-drawer below it. |
| `NavShellProps` | type | Props for `NavShell`: `children` (the nav links, rendered in both the desktop row and the drawer), `aria-label` (default `"Primary"`), `triggerLabel` (default `"Menu"`), `closeLabel` (default `"Close menu"`), `className`, plus most of react-aria-components' own `DialogTrigger` props (`isOpen`, `defaultOpen`, `onOpenChange`). |
| `SiteFooter` | component | Public-site bottom chrome: grouped link columns, a secondary/legal row. Carries `SiteFooter.Column`. Renders the page's `contentinfo` landmark. |
| `SiteFooterProps` | type | Props for `SiteFooter`: `columns`, `secondary`, plus every native `<footer>` attribute. |
| `SiteFooterColumnProps` | type | Props for `SiteFooter.Column`: `heading`, `children` (the column's own links), `className`. |
| `Toaster` | component | The toast viewport — mount once, anywhere in the same tree as `Shell`. |
| `ToasterProps` | type | Props for `Toaster`: `aria-label` (default `"Notifications"`), `className`. |
| `toast` | value | Imperative toast API: `toast(title, options?)`, `toast.success`/`.error`/`.warning`/`.info`, `toast.dismiss`, `toast.dismissAll`. |
| `ToastFunction` | type | The callable shape of `toast` itself. |
| `ToastHandle` | type | Returned by every `toast(...)` call: `{ id, dismiss() }`. |
| `ToastOptions` | type | Options for `toast(...)`: `description`, `timeout` (ms, or `null` to disable auto-dismiss), `onClose`. |
| `ToastRecord` | type | The queued shape of one toast: `title`, `description?`, `variant`. |
| `ToastVariant` | type | `"success" \| "danger" \| "info" \| "warning"`. |
| `ChartFrame` | component | The shared plot/axes/grid/legend/table container `BarChart` and `LineChart` compose. |
| `ChartFrameProps` | type | Props for `ChartFrame`: `title`, `description`, `width`, `height`, `margin`, `xTicks`, `yTicks`, `legend`, `table` (required), `className`, `style`, `children` (render prop receiving the resolved `PlotArea`). |
| `ChartMargin` | type | `{ top, right, bottom, left }`, all `number`. |
| `ChartAxisTick` | type | `{ position, label }` — a pre-scaled pixel position plus its label. |
| `ChartLegendItem` | type | `{ label, color }`. |
| `ChartTableSpec` | type | `{ headers, rows }` — the table-view fallback's data. |
| `PlotArea` | type | `{ x, y, width, height }` — the plot rectangle passed to `ChartFrame`'s `children` render prop. |
| `BarChart` | component | Categorical magnitude: one bar per category, grouped by series. |
| `BarChartProps` | type | Props for `BarChart`: `categories`, `series`, `colorDomain`, `title`, `description`, `width`, `height`, `valueFormat`, `className`, `style`. |
| `BarChartSeries` | type | `{ name, values, color? }`. |
| `LineChart` | component | Change over time: one line per series, one shared x/y scale, a crosshair + tooltip hover layer. |
| `LineChartProps` | type | Props for `LineChart`: `x`, `series`, `colorDomain`, `title`, `description`, `width`, `height`, `valueFormat`, `xFormat`, `className`, `style`. |
| `LineChartSeries` | type | `{ name, values, color? }`. |
| `Sparkline` | component | A bare inline trend — no axes/grid/legend/hover, still ships a table-view fallback. |
| `SparklineProps` | type | Props for `Sparkline`: `values`, `title`, `width`, `height`, `color`, `valueFormat`, `className`, `style`. |
| `getThemeInitScript` | function | Returns a self-contained head script (string) that stamps `data-theme` before first paint. Takes `{ storageKey? }`. |
| `ThemeInitScriptOptions` | type | Options for `getThemeInitScript`: `storageKey?` (default `"ui-theme"`). |
| `ThemeProvider` | component | Holds/persists the three-state theme preference and keeps `<html data-theme>`/`color-scheme` in sync. |
| `ThemeProviderProps` | type | Props for `ThemeProvider`: `children`, `storageKey?`, `defaultPreference?`. |
| `useTheme` | function | Hook returning `{ preference, resolvedTheme, setPreference }` from the nearest `ThemeProvider`. |
| `ThemeContextValue` | type | `{ preference: ThemePreference; resolvedTheme: ResolvedTheme; setPreference(next: ThemePreference): void }`. |
| `ThemePreference` | type | `"system" \| "light" \| "dark"`. |
| `ResolvedTheme` | type | `"light" \| "dark"` — never `"system"`. |
| `THEME_PREFERENCES` | value | `["system", "light", "dark"] as const` — the three valid preference strings. |
| `DEFAULT_STORAGE_KEY` | value | `"ui-theme"` — the default `localStorage` key `ThemeProvider` and `getThemeInitScript` both use. |
| `ThemeToggle` | component | Accessible control cycling System → Light → Dark → System, built from this package's own `Button`/`Icon` atoms. |
| `ThemeToggleProps` | type | Props for `ThemeToggle`: everything `Button` accepts except `children`/`onPress`. |

## Tests

Beyond render/interaction/keyboard/ARIA tests per atom (`Button.test.tsx`,
`TextField.test.tsx`, `Badge.test.tsx`, `Card.test.tsx`,
`Breadcrumb.test.tsx`, `Link.test.tsx`, `Checkbox.test.tsx`,
`Switch.test.tsx`, `Select.test.tsx`, `Textarea.test.tsx`, `Avatar.test.tsx`,
`Spinner.test.tsx`, `Menu.test.tsx`, `Dialog.test.tsx`, `Tabs.test.tsx`,
`Table.test.tsx`, `Field.test.tsx`, `Skeleton.test.tsx`, `Tooltip.test.tsx`,
`Banner.test.tsx`, `RadioGroup.test.tsx`, `Popover.test.tsx`,
`DateField.test.tsx`, `ComboBox.test.tsx`, `SearchField.test.tsx`,
`FileTrigger.test.tsx`, `Disclosure.test.tsx`, `ProgressBar.test.tsx`,
`Separator.test.tsx`, `Chip.test.tsx`), per block
(`PageHeader.test.tsx`, `EmptyState.test.tsx`, `DataTable.test.tsx`,
`DetailView.test.tsx`, `Pagination.test.tsx`, `Stat.test.tsx`,
`Form.test.tsx`, `FieldGroup.test.tsx`, `ConfirmDialog.test.tsx`,
`Toolbar.test.tsx`, `NavGrid.test.tsx`, `SectionHeader.test.tsx`,
`Hero.test.tsx`, `FeatureGrid.test.tsx`, `Faq.test.tsx`,
`PricingTable.test.tsx`, `Testimonial.test.tsx`, `ArticleBody.test.tsx`), per view
(`ErrorView.test.tsx`, `AuthView.test.tsx`), per shell component
(`Shell.test.tsx`, `Toaster.test.tsx`, `SkipLink.test.tsx`,
`SiteHeader.test.tsx`, `NavShell.test.tsx`, `SiteFooter.test.tsx`), per chart component
(`ChartFrame.test.tsx`, `BarChart.test.tsx`, `LineChart.test.tsx`,
`Sparkline.test.tsx`, plus `internal/scale.test.ts` and
`internal/chart-vars.test.ts` for the scale-boundary and
categorical-color-assignment math underneath them), per theme piece
(`ThemeProvider.test.tsx`, `ThemeToggle.test.tsx`, `initScript.test.ts`,
plus `internal/theme-core.test.ts` for the underlying decline-path/
resolution logic), and the
`tailwind-merge` regression tests described above (`internal/cx.test.ts`),
three tests are worth calling out specifically:

- **`token-parity.test.ts`** scans every atom's, block's, AND shell
  component's source (everything under `src/`) for candidate Tailwind
  classes — extracted from a `className="..."` JSX attribute, a `cx(...)`
  call's arguments, and a `Record<Variant, string>` "variant map" object
  literal, the three shapes this package actually writes class lists in —
  and for raw `var(--ui-*)`/`var(--color-*)` reads. Every extracted class is
  compiled for real, against this package's own token CSS, using
  `tailwindcss`'s own `__unstable__loadDesignSystem` JS API: a class that
  produces no CSS rule at all is invented, exactly the way a browser would
  discover the same typo, rather than pattern-matched against a
  hand-maintained list of prefixes and suffixes. Every `var()` read is
  separately checked against a real entry in this package's own
  `TOKENS` export — imported from the real package, not a hand-copied list,
  since an opaque `var(...)` argument inside an otherwise-valid Tailwind
  arbitrary value (`shadow-[var(--ui-elevation-raised)]`) compiles clean
  either way and needs its own check. Without both halves, a typo like
  `bg-surface-elevated` (there is no such token — the real name is
  `surface-raised`) would compile clean and render with zero applied
  background, with no error anywhere to explain why — the same failure mode
  as a missing `@source` line above, just at the level of a single class
  name instead of the whole build. Compiling the real thing, rather than a
  regex guessing at what Tailwind's own vocabulary looks like, is what lets
  this catch that typo with zero false positives on Tailwind's OWN reserved
  utilities (`border-collapse`, `border-b-2`, `text-center`, `mx-auto`,
  `text-inherit`, `bg-transparent`, and everything else Tailwind ships) —
  see the test file's own header comment for the four real workarounds this
  approach let this package undo, and how the previous, allow-list-based
  version of this check forced them in the first place.
- **`ladder.test.ts`** scans every file under `src/atoms/`, `src/blocks/`,
  `src/views/`, `src/shell/`, `src/charts/`, and `src/theme/` for import
  specifiers that climb UP the ladder (or, for `charts`/`theme`, out of
  their narrow sibling lane), and fails the build if it finds one — the
  ladder invariant (`atoms` →
  `blocks` → `views`, with `shell` as the frame `views` fill and `charts`
  as a second, narrower sibling, down only) enforced structurally rather
  than left as a comment that can silently drift. It checks every
  forbidden direction: an atom importing `blocks/`, `views/`, `shell/`, or
  `charts/`; a block importing `views/`, `shell/`, or `charts/`; `shell`
  importing `views/` or `charts/`; `views` importing `shell/` or `charts/`
  — the last two making `views` and `shell` mutually exclusive peers that
  both build on `atoms`/`blocks` without depending on each other; and
  `charts` importing `blocks/`, `views/`, or `shell/`. It also runs the
  same scan for the PERMITTED directions (`blocks` importing `atoms`;
  `views` importing `atoms`; `views` importing `blocks`; `shell` importing
  `atoms`; `charts` importing `atoms`) as a sanity check — proving the
  scan inspects real code rather than passing on zero coverage, without
  asserting those lists are empty, since importing atoms (and, for
  `views`, blocks too) is correct and expected in every one of those
  places. Verified by hand, not just by the sanity checks: a temporary
  import from `views/` into `blocks/index.ts` was added, confirmed to fail
  the corresponding enforcement test, then reverted — proof the check
  fails closed rather than passing vacuously.
- **`theme/theme-script-parity.test.ts`** guards against `getThemeInitScript`
  and `ThemeProvider` silently drifting into two different implementations
  of the same three-state rule. For every input (nothing stored, each of
  the three valid states, a malformed stored value, storage that throws, a
  non-default `storageKey`) it evaluates the STRINGIFIED head script
  exactly the way a browser executing an injected `<head>` script would,
  separately runs `ThemeProvider`'s own underlying calls
  (`readStoredPreference` + `applyThemeDom`), and asserts both leave
  `<html>`'s `data-theme` attribute and `color-scheme` style in the
  identical state.

## Token-purity gate (`@vespeneventures/ui/gate`, `ui-token-check`)

`@vespeneventures/copy` ships a scanner gate that proves every user-facing
string in a source tree is registered. Before this release, this package
had no equivalent for the VISUAL half of the same contract: a hardcoded
`#3b82f6` or `padding: 13px` anywhere in `ui` was invisible in exactly the
way an unregistered string used to be. This package now ships that mirror,
deliberately kept OUT of the component ladder barrel (`src/index.ts`) and
its `"."` export — it is tooling, not a component — reachable instead from
its own subpath and an installable CLI:

- **`scanStyleSources(root, options?)`** (from `@vespeneventures/ui/gate`)
  walks a real source tree and extracts every hardcoded styling literal: a
  hex color (`#rgb`/`#rrggbb`/`#rrggbbaa`), an `rgb()`/`rgba()`/`hsl()`/
  `hsla()`/`oklch()`/`oklab()`/`lab()`/`lch()` color function, a raw CSS
  length (`13px`, `1.5rem`, `2em`, ...), or a Tailwind arbitrary-value
  class (`bg-[#3b82f6]`, `p-[13px]`, `w-[var(--x,64px)]`). A legitimate
  Tailwind TOKEN class (`text-ink-primary`, `bg-surface-base`, `p-4`,
  `z-10`, `rounded-control`) is never a candidate — it carries a NAME, not
  a hardcoded value, so it never matches any extraction pattern in the
  first place. Zero runtime dependencies, matching `@vespeneventures/copy`'s
  own scanner (this repository's CI `safety` job runs gate scripts with no
  `npm ci`) — see `src/style-scan.ts`'s own header for the full boundary
  reasoning, including exactly what is reported as `unchecked` rather than
  silently skipped.
- **`checkTokenPurity(candidates, tokens, filesScanned, unchecked)`** (from
  the same subpath) is the pure gate: every candidate is a finding unless
  it is explicitly waived (`// token-gate:ignore` on its own source line,
  mirroring `copy-gate:ignore` exactly) or — the one legitimate exception —
  a Tailwind arbitrary-value class that is a bare `var(--custom-property)`
  reference with no fallback, the documented "no Tailwind namespace, raw
  `var()` only" escape hatch `atoms/internal/ui-vars.ts` describes. THREE
  rules, not one: a BARE literal (no `var()` at all — the token system is
  never consulted at this call site) is `severity: "error"`
  (`"hardcodes-token-value"` if it matches a real token's value exactly,
  `"raw-value-no-token-backing"` if it matches none); a literal that IS a
  `var(--token, <fallback>)` call's own fallback is `severity: "warning"`,
  `"token-value-duplicated-in-fallback"` — the token wins whenever
  token CSS is loaded, so this is a latent drift risk,
  not a live defeat, and the message states whether the fallback currently
  matches, is consistent with, or has already drifted from the referenced
  token's real value. Which token a fallback belongs to is resolved
  STRUCTURALLY (parsing `var(...)` nesting, peeling through a wrapping
  non-`var` function like `clamp()` to find the true enclosing `var()`,
  always resolving a nested chain to the INNERMOST wrapper) — never by
  searching the registry for a same-valued entry. See `src/token-gate.ts`'s
  own header for the full reasoning, including why a `var(--x, <fallback>)`
  pattern is still a finding (just a lower-severity one) even when
  deliberate and documented.
- **`ui-token-check [scan-dir] [--tokens <path-to-json>]`** is the
  installable CLI, with the same three-state exit contract every gate CLI
  in this repository uses: `0` clean, `1` findings, `2` could not run —
  `2` also covers a non-empty `unchecked` list, the same "could not check
  must never read as a pass" discipline `copy-check` holds to. Without
  `--tokens`, source is checked against this package's own `TOKENS`
  registry — the right default for scanning this package's own source, but
  not for scanning a consumer's, whose own tokens are never registered
  here. `--tokens path/to/tokens.json` checks against a supplied registry
  instead: a JSON object mapping any key to an entry with at least string
  `property` and `value` fields. It REPLACES the default registry for the
  run rather than merging with it, and every finding's message names the
  supplied file rather than `@vespeneventures/ui/tokens`.

## WCAG contrast gate (`@vespeneventures/ui/tokens`, `ui-contrast-check`)

The token-purity gate above and this one check two completely different
axes, and neither substitutes for the other: `checkTokenPurity` asks "does
this styling LITERAL in source code trace back to a registered token?" —
it never asks whether the token it traces back to is actually legible.
This gate asks the other question: "is THIS token's declared value legible
against THAT one?" — it computes real WCAG luminance for a checked-in list
of pairs, and never looks at a single line of component source.

The math existed before this gate did: `src/contrast.test.ts` has long
asserted real AA (4.5:1) / AA-large (3:1) ratios for dozens of token pairs,
across both themes, via a proper `oklch()`/hex -> linear-sRGB ->
relative-luminance -> contrast-ratio pipeline — not an approximation from
the OKLCH lightness channel, which is not a reliable proxy for contrast
once chroma is involved. What that math never had was a GATE: the module
computing it lived at `tokens/internal/color.ts`, explicitly marked "not
part of this package's public API" and reachable only by that one test.

- **`contrastRatio`, `luminanceOf`, `oklchToLinearSRGB`, `hexToLinearSRGB`,
  `relativeLuminance`, `parseOklch`** (from `@vespeneventures/ui/tokens`,
  promoted from that internal module — no behavior change, only
  visibility) — the WCAG colour math itself, pure and zero-dependency.
- **`CONTRAST_PAIRS`** (same subpath) — an EXPLICIT, checked-in list of 25
  `{ foreground, background, level, minimumRatio, compositeOver? }` pairs,
  ratified from `contrast.test.ts`'s own hand-curated pair map rather than
  auto-derived from token names. An earlier design assumed this gate could
  self-extend, deriving one pair per `--<role>-on-<ground>`-shaped token
  name; counted against this package's real 154 tokens, only 5 actually
  follow that shape (`--color-ink-on-accent`, `--color-ink-on-inverse`,
  `--color-accent-on-inverse`, `--color-line-on-inverse`,
  `--ui-ring-on-inverse` — see `contrast-pairs.ts`'s own header for a 6th,
  near-miss token and why it doesn't count). Built that way, the gate would
  have checked almost nothing while reading as though it checked
  everything — the pairs that actually matter (body text on the page
  ground, status text on its own tint, a categorical chart mark on the
  chart surface) are not spelled out in any token NAME at all. Decorative
  roles are excluded per WCAG 1.4.11's own scope (graphical objects
  REQUIRED to understand content or operate the interface, never anything
  purely decorative): hairlines/dividers (`--color-line-*`), a chart
  gridline (`--color-chart-grid` — a reading aid, not itself required to
  read the data; the marks/axis/axis-label ARE checked), the modal/popover
  scrim, elevation shadows, the skeleton loading fill, and the two focus
  rings (composite `box-shadow` values with their own WCAG success
  criterion, 2.4.13, not this gate's 1.4.3/1.4.11 scope) — see
  `contrast-pairs.ts`'s own header for the full list and reasoning behind
  each. A consumer adds a pair by pushing a `ContrastPair` onto their own
  array and handing it to `checkTokenContrast` directly.
- **`checkTokenContrast(pairs, options?)`** (same subpath) — the pure
  gate. Resolves every pair's tokens — including any `var()` ALIAS CHAIN,
  via the new `internal/resolve-token-value.ts` walker, e.g.
  `--color-chart-surface` -> `--color-surface-raised` — computes the real
  ratio, and reports either a genuine threshold miss (`findings`, rule
  `"below-threshold"`) or a pair that could not be evaluated at all
  (`unchecked`: `"unresolvable-token"`, `"cyclic-alias"`,
  `"unparseable-color-value"`), mirroring `checkTokenPurity`'s own
  findings/`unchecked` split exactly. `internal/resolve-token-value.ts`'s
  walker is NOT `style-scan.ts`'s existing `resolveFallbackChain` under a
  different name — that function parses `var()` fallback nesting in SOURCE
  CODE at a character offset inside a real `.tsx` file; this one walks a
  token REGISTRY's own `TokenDefinition.value` entries by property NAME,
  with no source file involved at all. Never passes on an empty run: zero
  pairs, or a token registry with nothing in it, reports `reason:
  "nothing-to-check"`, never `ok: true`.
- **`exception` — WCAG 1.4.11's own relief, carried as data, not a bare
  comment.** A `ContrastPair` may carry a `ContrastException` — a real
  `wcagClause`, a real `compensatingMechanism`, and a real `rationale`,
  all required and non-blank. `checkTokenContrast` treats an excepted
  pair specially in BOTH directions, which is what keeps this from
  becoming a rubber stamp: still under the floor, with a VALID exception,
  is legitimate, documented relief (`relieved`, printed every run, never
  a finding); now CLEARS the floor while still carrying that exception is
  a *different* real finding (`"stale-exception"`) — the relief is no
  longer needed, and a stale claim left in the policy is exactly how an
  exception would otherwise silently outlive the condition that justified
  it. An exception missing any of its three required fields is a THIRD
  real finding (`"invalid-exception"`), checked first and regardless of
  the measured ratio — an unjustified exception is a defect in the policy
  data itself. `contrastPairsForTheme(theme)` (`"light" | "dark"`) is
  what attaches this package's own real relief to `CONTRAST_PAIRS` per
  theme — ported directly from `contrast.test.ts`'s own
  `WARN_SLOTS_BY_THEME` (light-mode categorical slots 3/4/5; dark carries
  none, since the dark palette's own steps were chosen to clear 3:1
  outright) — rather than baking a theme-agnostic exception onto the bare
  array.
- **`ui-contrast-check [tokens-css-file]`** — the installable CLI,
  mirroring `ui-token-check`'s shape and this repository's three-state
  exit contract (`0` clean, `1` at least one pair below threshold, `2`
  could not run — covering bad input, an unparseable file, a zero-pairs
  run, AND a non-empty `unchecked` list, the same "could not check must
  never read as a pass" discipline every gate CLI here holds to). Defaults
  to this package's own `styles/tokens.css`; checks BOTH the light `:root`
  block (against `contrastPairsForTheme("light")`) and, when present, the
  `:root[data-theme="dark"]` block (against `contrastPairsForTheme("dark")`),
  merging each dark declaration on top of the light ones first — the same
  thing a real browser cascade does — because a handful of real alias
  tokens (`--color-chart-surface`, `--color-ink-on-accent`, ...) are
  declared only in `:root` and deliberately never redeclared in the dark
  block (see `styles/tokens.css`'s own header comment). This repository's
  own root `npm run check:contrast` runs it against this package's own
  `styles/tokens.css` directly, wired into `npm run check` and into CI as
  the `WCAG contrast gate (ui-contrast-check)` job — a gate that ships
  only as an installed `bin`, with nothing anywhere actually invoking it,
  is decorative, so this package does not ship one without also running
  it against itself.

**A real, currently-shipping WCAG miss this gate surfaces, reported here
rather than quietly excluded to get a green run — but legitimately
RELIEVED, not hidden:** the light-mode categorical chart marks at slots
3/4/5 (`--color-chart-categorical-3/4/5`, aqua/yellow/magenta) measure
2.82:1, 2.17:1, and 2.69:1 against `--color-chart-surface` — all below
the 3:1 AA-large floor. `contrast.test.ts` already documents this as an
accepted "WARN" band under the dataviz palette method's "relief rule"
(legal only because this package's chart layer ships mandatory direct
labels/legend and a table-view fallback for every chart, never color
alone); `contrastPairsForTheme("light")` carries that SAME relief as gate
policy, so `checkTokenContrast` reports these three as `relieved` — still
visible in every report, never silently hidden — rather than as findings.
Running `npx ui-contrast-check` against this package's own
`styles/tokens.css` with no arguments returns `0`, because the relief is
real and documented, not because the failures were excluded from the
pair list to force a green run. Dark mode's own categorical steps all
clear 3:1 on their own and carry no exception at all — if a future
palette edit ever moved one of dark's slots under the floor, it would
report as a genuine, unrelieved `"below-threshold"` finding.

## What's deliberately not here

**Atoms:** thirty-one ship, and this is the FINAL rung of this layer —
`Button`, `Icon`, `TextField`, `Badge`, `Card`, `Breadcrumb`, `Link`,
`Checkbox`, `Switch`, `Select`, `Textarea`, `Avatar`, `Spinner`, `Menu`,
`Dialog`, `Tabs`, `Table`, `Field`, `Skeleton`, `Tooltip`, `Banner`,
`RadioGroup`, `Popover`, `DateField`, `ComboBox`, `SearchField`,
`FileTrigger`, `Disclosure`, `ProgressBar`, `Separator`, `Chip`. No `Modal` exposed as a public atom of
its own beyond what `Dialog` and `Popover` already compose internally —
that gets added here only once something real needs a bare modal overlay
with neither `Dialog`'s fixed trigger/content shape nor `Popover`'s
anchored one, not speculatively. `Slider`, `Calendar`, `NumberField`,
`Toolbar`, and `Accordion` are all deliberately NOT here either — each is a
real, plausible future atom, but none was asked for by this rung; `Calendar`
in particular is why `DateField` ships alone rather than as a full
`DatePicker` (see `DateField`'s own section above) — adding it
speculatively, just because a related component shipped, is the exact
un-bounded growth this package's own "variant rule" warns against one level
up. They get added here only once something real needs them.

**Blocks:** eighteen ship — `PageHeader`, `EmptyState`, `DataTable`,
`DetailView`, `Pagination`, `Stat`, `Form`, `FieldGroup`, `ConfirmDialog`,
`Toolbar`, `NavGrid`, `SectionHeader`, `Hero`, `FeatureGrid`, `Faq`,
`PricingTable`, `Testimonial`, `ArticleBody` — completing this layer. No
`FilterBar` block:
`DataTable`'s own `toolbar` slot (and `Toolbar`'s own `search` slot) are
deliberately plain `ReactNode`s, not a block with its own opinion about
what a filter bar contains — a consumer composes filter controls from
this package's own atoms (`Select`, `TextField`, `Popover`) directly into
whichever slot fits.

**Views:** `ErrorView` and `AuthView` moved to `@vespeneventures/surface/web`; the list is meant to stay
this short — see "Views" above for the full reasoning. `ListView`,
`FormView`, and `DashboardView` are deliberately NOT here: by test 3, a
page can hold two lists, two forms, or several summary panels at once, so
each of those is a block a consumer composes, not a view this package
could pre-assemble without being wrong for most consumers.

**Shell:** `Shell` itself ships five slots (`Header`, `SideNav`, `Main`,
`Rail`, `Footer`) and nothing else — no `AppHeader`/`AppFooter` block of
its own baked into `Shell.Header`/`Shell.Footer`, no nav-item component,
and no PER-ITEM icon assignment of its own (that's still true even though
this package as a whole now ships a glyph set at `./icons` — `Shell`
doesn't reach for it on a consumer's behalf; a consumer picks and places an
`Icon` in whichever slot needs one, same as any other atom). An
authenticated app's own header/nav are where brand and product-specific
structure live; a consumer composes those from atoms and passes them into
the relevant `Shell` slot (see "Shell" → "How differing chrome is handled"
above). No modal/dialog manager and no command palette either, despite
both being named as runtime-service examples in "Placement rules" above
alongside the toast stack that DOES ship — added only once something real
needs them, the same policy this README states for atoms and blocks.

This package DOES now ship `SiteHeader`/`SiteFooter` — at the narrower,
public-SITE-chrome scope "Site chrome" above describes, alongside
`NavShell` and `SkipLink` — rather than as `Shell`'s own `AppHeader`/
`AppFooter`. The distinction is real, not a loophole around the paragraph
above: `Shell`'s five slots are built for an authenticated app whose
header/nav genuinely differ per route group (see the three-`layout.tsx`
example above), where a single shipped header would need to keep
absorbing every consumer's structural divergence; a public site's own
header/footer are close to always the same three-or-two regions,
site to site, which is what makes THEM worth shipping as real components.
No `AppNavItem`/`AppFooterColumn` or similar per-item component beyond
`SiteFooter.Column` either, for the same reason atoms/blocks stay this
short elsewhere in this README: added only once something real needs it.

**Charts:** four ship — `ChartFrame`, `BarChart`, `LineChart`, `Sparkline`
— no `PieChart`/`DonutChart` (part-to-whole reads reliably only up to
about six segments and a bar communicates the same comparison more
precisely at any count — see the dataviz reference's anti-patterns list),
no `ScatterChart`/`Heatmap` (neither was asked for by this rung), and
deliberately **no dual-axis option on `BarChart`/`LineChart`** — that
omission is not a gap to fill later, it's the one hard rule this layer
does not bend on. No charting library is a dependency, and the scale/color
helpers under `charts/internal/` stay unexported — this ships four
components, not a general-purpose numerical or color library (see
`atoms/internal/cx.ts`/`ui-vars.ts` for the same precedent one layer down).

## Requirements

Node 20+. React 18+. Tailwind CSS v4.

## Licence

MIT
