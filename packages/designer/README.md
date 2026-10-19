# @clossys/designer

**The designer role — is it well made?** This package is named for the job,
not the artifact. What it ships is still a visual system, and the vocabulary
inside it (`tokens`, `atoms`, `blocks`, `shell`, `charts`, `theme`, icon glyph
data, and every gate name they compose into) is unchanged: a role owns
artifacts, and renaming the role does not rename what it reasons about.

Design tokens, theme CSS, and React components for Tailwind CSS v4. This
package ships reusable visual vocabulary built on its own token layer:

```bash
npm install @clossys/designer
```

This package is published to the public npm registry, `https://registry.npmjs.org`.
Installing it needs no authentication: no npm token, no `.npmrc` registry
override, and no GitHub credential of any kind.

## Shared atom selection

`ATOM_GUIDANCE`, `ATOM_API_FACTS`, `ATOM_DISPLAY_GROUPS` and `ATOM_COMPARISON` are additive data
exports from `@clossys/designer/atoms`. The barrel remains client-only. Read
the packed [atom selection guide](skill/atoms-guide.md) for purpose, use and
avoidance, alternatives, content, anatomy, block composition, accessibility,
medium evidence, represented configurations and partial token dependencies.
Four display groups and ten families place forty-one established atom/chart leaves
exactly once. Groups and families are navigation; only leaves are selectable.
Existing IDs such as `act.link` and `reveal.tabs` remain unchanged.

Stable conceptual guidance is separate from each medium’s implementation.
Web is implemented with source evidence; email, print and video are unassessed.
`RENDER_ENVIRONMENT` describes import safety, not medium support. Checked facts
are kept separate from curated semantics; scalar options are a bounded selection,
not an exhaustive inherited API or a Cartesian product. Package defaults differ
from consumer preview defaults, and package support differs from consumer-owned
demonstration coverage. Callbacks, arbitrary children and styles are not config
axes. Direct and transitive token claims carry partial source evidence.

`ATOM_COMPARISON` declares preferred finite `columns: { option, values }`,
optional `rows` of the same shape, and `maxCells` bounded at 24. Each axis uses
an existing option and its declared scalar values; atoms without finite options
have no entry. `maxCells` equals the raw axis product before any exclusions.
Its `constraints` is the original guidance rule array by identity, and
`constraintPolicy: "skip-violations"` skips only `requires`, `exclusive` and `paired`
violations against complete authored props. Applicability (`effective-when`),
ignored-option, `derived` and `data` rules never skip cells under this policy;
those rules remain authoring guidance and do not remove default appearances.
Apply a forbidding rule's `when` first. `requires` needs every named required
prop; `exclusive` rejects present `excludes` or enforces `presence: "exactly-one"`
across `props`; `paired` requires all or none of its `props`. Presence means a
value other than `undefined`, so `false` and zero are present.
Some axes may be visually static. Omitted defaults are not representable as
cells: every axis cell supplies an explicit scalar value. Consumers must still
author valid content, callbacks and data; this declaration supplies no renderer
or general-purpose validator.

The public types are `AtomGuidance`, `AtomApiFacts`, `AtomDisplayGroup`, `AtomComparison`,
`AtomMedium`, `AtomMediumState`, `AtomScalar`, `AtomEvidence`,
`AtomOptionGuidance`, `AtomCondition`, `AtomConstraint`, `AtomWebImplementation` and
`AtomMediumGuidance`. Import these from the same existing atoms entry point.
The installed guide is at `node_modules/@clossys/designer/skill/atoms-guide.md`;
the launcher copies the selection essentials from `skill/SKILL.md`, not that
companion file. Consumers should reference the shared records.

Regenerate with `node scripts/generate-atom-docs.mjs` and check with
`node scripts/check-atom-docs.mjs`. These commands are repository tooling and
do not ship in the installed package. The generator reads source, never dist,
and writes the guide and selection section deterministically.

## Design conformance rate

Independent consumer evidence shows the position's owned metric meets its
setpoint over the declared review cadence. The owned metric is `design
conformance rate`, computed by `assessDesignConformanceRate()`. An empty
evaluated set is `indeterminate`, never a perfect rate of 1.
`designer-token-check`, `designer-brand-check`, `designer-contrast-check`,
and `designer-environment-check` remain the gates they are; none is this
rate. This package does not measure consumer evidence and does not close
the loop. A green run of this package's tests is not a close.

```ts
import { assessDesignConformanceRate } from "@clossys/designer/gate";

const report = assessDesignConformanceRate(input);
```

```bash
designer-rate-check assessment.json
```

The command prints JSON and exits `0` for satisfied, `1` for violated, and
`2` for indeterminate, unreadable, or invalid input.

This package declares that command as its first-day assessment surface in
its own manifest:

```json
"foundry": { "assessment": { "bin": "designer-rate-check", "invocation": "single-json-input" } }
```

## Pre-auth page quality

Pre-auth marketing pages use a five-star contract: **done is exceptional (5)**;
mechanical gates (`designer-hero-css-check`, `designer-fold-check`, and
`writer-check --live` on the publishing repo) prove **good (3)** only. The
full rubric — floor, authored great, review keep, and who certifies what — is
in [PRE-AUTH-QUALITY.md](./PRE-AUTH-QUALITY.md).

Band copy for the content blocks (`FeatureGrid`, `Items`, `Matrix`,
`OrderedStepSequence`, `Faq`, `Specimen`) follows the content
cookbook, [CONTENT.md](./CONTENT.md). It covers which block fits which
information, what each slot holds and its word budget, and the page-variety
rules. Publisher's `publisher-preview` writes `content-catalog.html`, which
shows every block filled at a typical length and at the maximum budget.

Onboarding discovers that declaration from the installed manifest and never
infers a surface. The four existing designer bins remain gates and are not
the assessment surface. Designer is not a required first-day role; Advisor
remains the only required first-day assessment.

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
surfaces and live in `@clossys/publisher/web`.

- **`icons`** — glyph data only, no components: 40 `IconNode` exports
  (`AlertTriangle`, `ArrowRight`, `BookOpen`, `Box`, `Briefcase`,
  `Building2`, `Calendar`, `Check`, `CheckCircle`, `ChevronDown`,
  `ChevronLeft`, `ChevronRight`, `ChevronUp`, `Clock`, `CreditCard`,
  `ExternalLink`, `FileCheck`, `FileText`, `Folder`, `Globe`, `Grid3x3`,
  `Home`, `Info`, `Landmark`, `Layers`, `List`, `Lock`, `Monitor`, `Moon`,
  `Plug`, `Receipt`, `Scale`, `Search`, `Settings`, `ShieldCheck`, `Sun`,
  `User`, `Users`, `X`, `XCircle`) — each a
  `ReadonlyArray<readonly [tag: string, attrs: Record<string, string>]>`,
  meant to be passed to the `Icon` atom's `glyph` prop. See "Icon glyph
  data" below.
- **`atoms`** — single-purpose: composes no other atom, or its parts are
  homogeneous repeats rather than named regions. Thirty-three ship:
  `Button`, `Icon`, `TextField`, `Badge`,
  `Card`, `Breadcrumb`, `Link`, `Checkbox`, `Switch`, `Select`, `Textarea`,
  `Avatar`, `Spinner`, `Menu`, `Dialog`, `Tabs`, `Table`, `Field`,
  `Skeleton`, `Tooltip`, `Banner`, `RadioGroup`, `Popover`, `DateField`,
  `ComboBox`, `SearchField`, `FileTrigger`, `Disclosure`, `ProgressBar`,
  `Separator`, `Chip`, `StatusMark`, `Meter`.
- **`blocks`** — owns the internal layout of multiple named regions,
  typically by composing one or more atoms (and/or layout) into something
  with a real job on a page. Forty-one ship: `AccountMenu`, `PageHeader`, `EmptyState`,
  `DataTable`, `DetailView`, `Pagination`, `Stat`, `Form`, `FieldGroup`,
  `ConfirmDialog`, `Toolbar`, `NavGrid`, `SectionHeader`, `Hero`, `ContentSection`, `SectionIntro`, `MediaFigure`, `SectionFrame`,
  `MarketingChapter`, `FeatureGrid`, `Item`, `Items`, `Tree`, `AnatomyCallouts`, `RecordLedger`, `Scene`, `Matrix`,
  `Specimen`, `SpecimenPanel`, `OrderedStepSequence`, `StatusList`, `Faq`,
  `PricingTable`, `Testimonial`, `ArticleBody`, `ConsentBanner`, `Panel`, `Drawer`,
  `ResizablePane`, `CommandMenu` and `AppNavigation` (see "Blocks" below).
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
  `WaterfallChart`, `RangeChart`, `ScatterChart`, and `Sparkline`. A sibling of `shell`, not a sixth rung of the ladder —
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

There is deliberately no `@clossys/designer` root export. Import the
smallest stable subpath that owns what you need:

| Subpath | Owns |
| --- | --- |
| `@clossys/designer/tokens` | Browser-safe typed `TOKENS`, shared `TOKEN_GUIDANCE` and `TOKEN_DISPLAY_GROUPS`, pure brand CSS parsing, the brand-coverage gate, WCAG colour math (`contrastRatio` and friends), the contrast gate (`checkTokenContrast`, `CONTRAST_PAIRS`), and `assertTokenStylesLoaded` (dev-only token-CSS presence check — see "Setup" below). No React runtime. |
| `@clossys/designer/tokens/preview` | `TokenPreview`: opt-in React tooling for an exact token property, using the host token/theme/brand cascade. |
| `@clossys/designer/tokens/server` | Node-only `readBrandCss`, `assertTailwindMergeVersion`, and file-reading result types. Neither helper runs automatically on import. |
| `@clossys/designer/tokens.css` | Neutral primitive custom-property defaults; works without Tailwind. |
| `@clossys/designer/theme.css` | Optional Tailwind v4 wiring; imports `tokens.css` itself. |
| `@clossys/designer/compiled.css` | GENERATED, precompiled utility CSS for `atoms`, `blocks`, and `shell` — the default path for a pre-auth page without Tailwind. Imports nothing itself; load after `tokens.css`. See "Framework-portable components, without Tailwind" below. |
| `@clossys/designer/utilities.css` | GENERATED run of `@source inline(...)` directives, one per line, listing the class candidates this package's components use. Import it after `theme.css` in a Tailwind v4 entry to generate this package's utilities without a path `@source` on `dist`. See "Setup" below. |
| `@clossys/designer/brand-template.css` | Copy-and-fill template for a consumer brand binding. |
| `@clossys/designer/icons` | Tree-shakeable glyph data. |
| `@clossys/designer/atoms`, `/blocks`, `/shell`, `/charts` | Reusable React visual primitives. |
| `@clossys/designer/atoms/server`, `/blocks/server`, `/shell/server`, `/charts/server`, `/theme/server` | The server-safe subset of each sibling subpath, importable from a React Server Component. See "Server Components" below. |
| `@clossys/designer/theme` | `getThemeInitScript`, `ThemeProvider`/`useTheme`, `ThemeToggle` — the runtime half of theming. Not to be confused with the CSS `/theme.css` subpath above. |
| `@clossys/designer/gate` | Token-purity scanner/gate and the environment-conformance gate (`checkEnvironmentConformance`). |
| `@clossys/designer/render-environment` | `RENDER_ENVIRONMENT` — a plain data declaration of every subpath's render environment (`"server-safe"` \| `"client-only"`). See "Server Components" below. |

### Token details and selection

The flat `TOKENS` registry has 188 stable property identities across brand
and supported theme overlays, with zero per-token configuration. Use the
property-keyed `TOKEN_GUIDANCE` for purpose, appropriate use, misuse or an
alternative, the consuming CSS application and its context, and a contextual
specimen kind. Defaults, aliases, brandability, theme dependence and the 31
legacy source families remain authoritative in `TOKENS`.

`TOKEN_DISPLAY_GROUPS` gives nine navigation groups and 37 display families,
with each property appearing once. Group and Family are navigation only;
they do not imply usage or value type, and regrouping does not change legacy
`oldGroup.sourceFamily@token` references or bookmarks. Call the inspector
"Token details"; configurable components start at Atoms. Equal values and
aliases do not make two roles interchangeable. Consumers import the shared
guidance instead of keeping another prose registry.

The additive metadata types are `TokenGuidance`, `TokenApplication`,
`TokenValueType`, `TokenSpecimen`, `TokenDisplayFamily` and
`TokenDisplayGroup`. `TokenDefinition` and `TokenFamily` retain their shape.
See [TOKENS.md](TOKENS.md) for the generated property-by-property reference.
Regenerate it with `node scripts/generate-token-docs.mjs` and verify it with
`node scripts/check-token-docs.mjs` from the repository root. These repository
tools are not shipped in the installed package.

### Node token helper migration

The browser-safe token boundary introduces a breaking source-import change:
`readBrandCss`, `assertTailwindMergeVersion`, `BrandCssReadIssue`,
`BrandCssReadIssueReason`, and `BrandCssReadResult` move from
`@clossys/designer/tokens` to `@clossys/designer/tokens/server`. Pure token
exports, including `parseBrandDeclarations`, `ParsedBrandCss`, and
`BrandCssUnchecked`, retain their imports and behavior. Node callers using
both a pure check and a reader split their imports:

```ts
import { checkBrandFileCoverage } from "@clossys/designer/tokens";
import { readBrandCss } from "@clossys/designer/tokens/server";

const read = readBrandCss("src/styles/brand.css");
const coverage = checkBrandFileCoverage(read.declarations);
```

The new server subpath belongs to the pending minor release; published
`0.7.1` does not provide it. Release application must update dependent package
and packed-template ranges together, and the resulting release cohort still
needs its normal qualification before publication.

`ui` never exports page views, routes, metadata, strategy facts, or copy.
Components receive resolved `ReactNode`s, labels, data, callbacks, and URLs
through props. Product/page composition belongs to
`@clossys/publisher`; audience-facing words belong to
`@clossys/writer`.

### Token-only use

Tokens can be the only thing a consumer installs and imports:

```bash
npm install @clossys/designer
```

```css
@import "@clossys/designer/tokens.css";
```

The package has no regular runtime dependencies. React, React DOM, React
Aria, Tailwind, Tailwind Merge, and the date helpers are optional peers:
install them only when importing the React component subpaths. `tokens.css`
is ordinary CSS custom properties, so it has no React or Tailwind requirement.

For React components, install the peers used by the subpaths you import:

```bash
npm install @clossys/designer react react-dom react-aria-components \
  tailwind-merge tailwindcss @internationalized/date
```

`@internationalized/date` is only needed when using `DateField`; the other
component peers support the interactive primitives and their Tailwind classes.

**Registry note: the token-only path above installs the full peer set
anyway.** All six peers listed in `peerDependencies` — `react`, `react-dom`,
`react-aria-components`, `tailwind-merge`, `tailwindcss`, and
`@internationalized/date` — are correctly declared `optional: true` in
`peerDependenciesMeta`, and that declaration is honored by the tarball this
package publishes. It is not honored by `npm.pkg.github.com`: the registry's
packument omits `peerDependenciesMeta` entirely, so an installer resolving
against this registry sees six required peers, not six optional ones. In
practice that means a consumer who runs `npm install @clossys/designer` to
get only `tokens.css` or `compiled.css` — the two paths that exist
specifically so React and a Tailwind pipeline are *not* required — still has
all six installed. There is no per-subpath way to avoid it from this side;
the fix would have to happen registry-side. See
[issue #226](https://github.com/clossys/foundry/issues/226) for the
full evidence and the decision to document rather than restructure around it.

### CSS layers, fallbacks, and themes

The visual contract is ordered:

1. `tokens.css` defines neutral light defaults and automatic/explicit dark
   overrides. Every token has a literal primitive default.
2. A consumer brand file copied from `brand-template.css` overrides only
   brandable roles under `:root[data-brand-bound]`.
3. A consumer master brand mark — three SVG documents (lockup, mark-only,
   inverse), validated with `validateMasterMark` from `@clossys/designer/tokens`
   — sits alongside the brand binding. This package does not ship a product
   logo, favicon PNGs, or social images.
4. Consumer extension CSS can add product-specific values under its own
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

### Server Components

SSR-safe and importable-from-a-Server-Component are different guarantees.
Every atom, block, and shell component avoids browser globals at render time
(the "React SSR, hydration, and accessibility" section above), but `atoms`,
`blocks`, `shell`, `charts`, and `theme` are each a SINGLE barrel that
re-exports every one of its members eagerly from one module — importing even
one noninteractive member (`Card`, say) pulls in whatever interactive
sibling shares that barrel (`Button`, `Dialog`, ...), and those read
`react-aria-components`' own `useContext` at module scope. That fails to
import under React's `react-server` module-resolution condition, which is
exactly what blocks a React Server Component from reaching `Card` at all —
not because `Card` itself is unsafe, but because of how it's packaged.

Five narrower subpaths exist for exactly this: `@clossys/designer/atoms/server`,
`/blocks/server`, `/shell/server`, `/charts/server`, and `/theme/server`. Each
re-exports ONLY the members of its sibling barrel confirmed, empirically, to
import cleanly under `--conditions=react-server` — never a name inferred from
"looks presentational" or a client-directive grep (see each `*server.ts`
source file's own header for the exact probe and its result). Today that's:

| Subpath | Server-safe members |
| --- | --- |
| `@clossys/designer/atoms/server` | `Avatar`, `Badge`, `Banner`, `Card`, `Field`, `Icon`, `Meter`, `Skeleton`, `Spinner`, `StatusMark`, `buttonLinkClassName`, `iconButtonClassName`, `iconButtonLinkClassName`, `mergeUiClasses` |
| `@clossys/designer/blocks/server` | `AnatomyCallouts`, `ArticleBody`, `Matrix`, `ContentSection`, `DetailView`, `EmptyState`, `Faq`, `FeatureGrid`, `FieldGroup`, `Hero`, `Item`, `Items`, `MarketingChapter`, `MediaFigure`, `OrderedStepSequence`, `PageHeader`, `PricingTable`, `RecordLedger`, `Scene`, `SectionFrame`, `SectionHeader`, `SectionIntro`, `Specimen`, `SpecimenPanel`, `Stat`, `StatusList`, `Tree` |
| `@clossys/designer/shell/server` | `Shell`, `SiteFooter`, `SiteHeader`, `SkipLink` |
| `@clossys/designer/charts/server` | `ChartFrame`, `BarChart`, `LineChart` (static), `WaterfallChart`, `RangeChart`, `ScatterChart`, `Sparkline` |
| `@clossys/designer/theme/server` | `getThemeInitScript` |

Everything not listed above stays reachable only from its original barrel,
inside a client boundary — nothing was removed, renamed, or restructured to
create these subpaths; each is strictly additive, a second, narrower way to
reach bindings that already ship.

`LineChart` also has two implementations. The ordinary `/charts` entry
keeps its pointer and keyboard inspection layer. `/charts/server` renders
static paths from the same geometry helpers, with a visible series legend
and the complete table fallback. It accepts the published line props plus
optional `fit`; `fit="fluid"` uses an intrinsic width of 360 when `width`
is omitted, scaling up to 540. Omitted `fit` retains the fixed 480 preset.

`Faq` deliberately has two implementations behind those entry points. The
ordinary `@clossys/designer/blocks` entry keeps the React Aria disclosure and
its explicit trigger/panel wiring. `@clossys/designer/blocks/server` renders
the same public props as native `details`/`summary`, preserving independent
keyboard-operable disclosures without importing the client-only React Aria
graph.

`@clossys/designer/render-environment` exports `RENDER_ENVIRONMENT`, a
plain `Record<string, "server-safe" | "client-only">` keyed by every
`package.json#exports` subpath this package declares — including the CSS
entries, which carry no JavaScript execution context and are always
`"server-safe"`. It is data only, no resolver logic: a consumer (or a
separate checker package, resolving a real module graph under a declared
export condition) reads it to know which subpath to reach for without
re-deriving the same probe.

This record's own **internal consistency** — that its key set matches
`package.json#exports`' real subpath set, in both directions — is now
verified on every run by the environment-conformance gate; see
"Environment-declaration-consistency gate" below. That gate does **not**
verify the claim itself (that a `"server-safe"` subpath truly resolves
safely under the `react-server` condition) — read that section before
treating a passing gate as more than it is.

### Framework-portable components, without Tailwind (default for pre-auth pages)

**Default CSS path** — one mount, no Tailwind, no `@source`:

```css
@import "@clossys/designer/tokens.css";
@import "@clossys/designer/compiled.css";
/* your brand overlay (from brand-template.css) */
```

```bash
npm install @clossys/designer react react-dom react-aria-components \
  tailwind-merge @internationalized/date
# tailwindcss itself is NOT needed on this path
```

Load **exactly one** styling path per project (see "Load exactly one path,
never both" below). Do not also import `theme.css` or run a Tailwind
`@source` scan on the same page — pick this path OR the advanced path, not
both.

**Scope.** `compiled.css` is generated from `src/atoms/`, `src/blocks/`, and
`src/shell/` — enough for Hero, feature blocks, and site chrome on a pre-auth
marketing page. `charts` and `theme` remain Tailwind-native only.

Verify the stylesheet your app loads with `designer-hero-css-check
path/to/your.css` (or point it at `node_modules/@clossys/designer/styles/compiled.css`
when you import that file unchanged).

Record fold evidence (from your app or a browser script) and verify it with
`designer-fold-check path/to/fold-measurement.json` — optional
`--also path/to/mobile-fold.json` for a second viewport. Missing evidence is
not done; the gate fails closed.

Author a type brief from `templates/brand-type.template.json` (display face,
H1 minimum, measure cap, monospace roles, orphan-word policy) and verify it
with `designer-type-check path/to/brand-type.json` — optional
`--overlay path/to/brand.css` to require a bound `--font-display` in overlay
CSS. Do not invent type pairing ad hoc during the walk that proves 3.

### Tailwind-native path (advanced)

When you already run Tailwind v4 and want the full token surface including
`charts`/`theme`, use `theme.css` + `@source` on `dist` instead of
`compiled.css`. See **Setup** below for that path and its `@source` pitfalls.

**What `compiled.css` is.** A GENERATED file — never hand-edited, checked by
`npm run check:compiled-css` (also runs as part of `npm test`, so CI catches
drift automatically) and regenerated with `npm run generate:compiled-css`.
It is produced by a REAL Tailwind v4 compile (`src/compiled-css/generate.ts`,
using the real `tailwindcss` package's own `compile()` API) of every class
candidate `src/compiled-css/scan-sources.ts` finds by statically scanning
`src/atoms/`, `src/blocks/`, and `src/shell/`.
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

**Base layer.** Ahead of `foundry-ui-compiled`, `compiled.css` emits a
second named layer, `foundry-ui-base`, with two rules: `*, ::before, ::after`
sets `box-sizing: border-box`, and `input, textarea, select, button` sets
`font: inherit`. The Tailwind-native path gets both from Tailwind's own
preflight; this layer gives the `tokens.css` + `compiled.css` path the same
two behaviors while preflight itself stays out, so margin, list and color
resets remain your choice. The blocks set their own spacing and are drawn
against zero default margins on headings, paragraphs, lists and figures, the
way Tailwind's preflight leaves them; on the `compiled.css` path without a
reset, browser default margins add to that spacing (`Specimen` resets its
own). Publisher's preview pages link a preflight copy for this
reason. `foundry-ui-base` is declared before
`foundry-ui-compiled`, so a utility class wins over it, and your own
unlayered CSS wins over both. To override a base rule, write a rule for the
same selector in unlayered CSS, or in a named layer declared after
`foundry-ui-base`.

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
`@clossys/designer`'s own test setup; see the introducing PR).

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
| `@example/tokens` | `@clossys/designer/tokens` |
| `@example/tokens/tokens.css` | `@clossys/designer/tokens.css` |
| `@example/tokens/theme.css` | `@clossys/designer/theme.css` |
| `@example/tokens/brand-template.css` | `@clossys/designer/brand-template.css` |
| `@clossys/designer/views` | `@clossys/publisher/web` for generic rendered views, or compose UI primitives in a Publisher surface. |

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

For a page assembled with Publisher's `SiteFrame`, see
[Consumer frame wiring](../publisher/README.md#consumer-frame-wiring) for the
package-provided chrome and the brand, CSS entry, frame data and content a
consumer supplies.

**Default (pre-auth pages, no Tailwind):** import token + compiled styles and
your brand overlay — see "Framework-portable components, without Tailwind"
above. Run `designer-hero-css-check` on the CSS file your app actually loads.

**Advanced (Tailwind v4 already in the project):** the token CSS has to be
imported, and Tailwind has to be told to scan this package's built output
for the classes it uses. Do **not** also import `compiled.css` on the same
project.

**1. Import the tokens' Tailwind wiring**, on top of Tailwind itself, in
your CSS entry point:

```css
@import "tailwindcss";
@import
  "@clossys/designer/theme.css";
```

(`theme.css` already pulls in the base token file, so you don't need a
second line for that. The token layer's `brand-template.css` provides the
full three-layer contract, including how to bind brand colors over the
neutral greyscale default.)

**2. Point Tailwind's `@source` at this package's built output**, in the
same CSS file. This is the single highest-risk step on the advanced path: if
Tailwind never scans `dist/`, it never sees `bg-accent` or `rounded-control`
as classes anyone used, so it never generates them — blocks render with
zero applied styling, and nothing in your build fails or warns about it.

```css
@source "./node_modules/@clossys/designer/dist";
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
`node_modules/@clossys/designer` resolves from where your bundler runs.

If your bundler's default content scan already covers everything under
`node_modules/@clossys/designer` (some do), the `@source` line is
redundant but harmless. If you're not sure, add it — a redundant `@source`
costs nothing; a missing one costs every component's styling.

**pnpm + Turbopack:** a consumer integration reported that the plain-path
`@source` form above produces zero generated utility classes under Next.js
Turbopack specifically when the project uses pnpm — no error, no warning,
components just render unstyled, the same silent failure this whole section
warns about, but with the `@source` line already present and seemingly
correct. Their diagnosis: pnpm installs `node_modules/@clossys/designer`
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

**Several applications, one product.** Applications that are cuts of one
product share one brand binding and one Designer install:

```text
brand/brand.css        the only overlay, copied from brand-template.css, under :root[data-brand-bound]
brand/extensions.css   optional, product prefix only (--acme-ext-*)
brand/designer.css     the only CSS entry
```

`brand/designer.css` imports, in order, `tailwindcss`,
`@clossys/designer/theme.css`, `./brand.css`, and
`@clossys/designer/utilities.css`:

```css
@import "tailwindcss";
@import "@clossys/designer/theme.css";
@import "./brand.css";
@import "@clossys/designer/utilities.css";
```

`@import "tailwindcss"` resolves from the repository root, so `tailwindcss`
(and `@tailwindcss/postcss`, for a PostCSS build) must be declared in the
root `package.json`; an application's own
dependencies are not consulted.

When the product has an extension file, add one line after `./brand.css`;
an `@import` of a file that does not exist fails the build, so leave it out
otherwise:

```css
@import "./extensions.css";
```

Every application stylesheet imports that one file and every document root
sets `data-brand-bound`. Applications do not copy the block.

`utilities.css` is generated from this package's components and holds
`@source inline(...)` directives listing every class they render. It
generates the utilities from the CSS file's own location, so it does not
depend on a path `@source` resolving through a pnpm symlink (step 2), and the
consumer keeps no class list.

Only the repository root declares `@clossys/designer`. When an application
cannot resolve `@clossys/designer/atoms/server`, `blocks/server`, or
`shell/server` from that dependency under pnpm, add a workspace package that
depends on `@clossys/designer` and re-exports those entries and
the CSS entries `theme.css` and `utilities.css`; applications depend on that
package instead. `designer-brand-check` looks for `brand/brand.css` by
default and, when an `apps/` directory exists (or `--apps <dir>` is given),
exits 1 for any other stylesheet under it that declares a `--color-*`
property.

**3. If a component still renders unstyled, call `assertTokenStylesLoaded`
first** — before chasing your Tailwind `@source` config or bundler setup.
Both steps above can silently fail to do anything (a missed import, a
`@source` path that resolves to nothing, the Turbopack + pnpm symlink case
just above) with no error and no warning anywhere; the result looks
identical to "I styled this component wrong" from inside your own code.
`assertTokenStylesLoaded`, from `@clossys/designer/tokens`, tells you
which failure you actually have:

```ts
import { assertTokenStylesLoaded } from "@clossys/designer/tokens";

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

**4. Optional-peer version guards.** Installing the wrong version of a
component peer used to fail silently too — the same #182 gap
`assertTokenStylesLoaded` closes for the token CSS, extended to
`react`, `react-aria-components`, and `tailwindcss`. You don't call
anything for these three: importing any component subpath
(`@clossys/designer/atoms`, `/blocks`, `/shell`, `/charts`, `/theme`) or
running `generateCompiledCss` checks the relevant peers' installed
versions automatically, and throws a named error — which peer, the range
this package declares, and the version actually found — the moment an
absent or incompatible one would otherwise have crashed somewhere deep
inside a component's own render.

`tailwind-merge` is the one exception, and it needs an explicit call.
Unlike the peers above, it has no way to report its own installed version
that doesn't require Node's filesystem — and the one file that imports it,
`cx.ts`, is reachable from every atom, so checking it automatically would
break bundling this package's components for the browser. Call
`assertTailwindMergeVersion` yourself, once, from Node-side tooling (a
build script, a setup step, or a test — never from component code):

```ts
import { assertTailwindMergeVersion } from "@clossys/designer/tokens/server";

assertTailwindMergeVersion();
```

It throws the same three ways `react`'s automatic guard does — absent,
installed but out of range, or an installed version it cannot parse — and
is Node-only: it throws its own clear error rather than a misleading "not
installed" if it is ever called from real browser code. See
`assert-tailwind-merge-version.ts`'s own header for the full reasoning.

**You do not have to call it just to avoid a crash — but a missing peer is
never fully silent either.** Before #749, an absent `tailwind-merge`
crashed the moment `cx` (this package's internal class-merge helper,
reachable from every atom and therefore from the server-safe barrels too)
was imported at all — `Cannot find package 'tailwind-merge'`, even on a
purely server-rendered path that never mentioned styling. `cx` now
resolves `tailwind-merge` lazily, so importing any component subpath
without this optional peer installed no longer throws, and rendering
completes. What changes is class-conflict resolution: with the peer
absent, `cx` cannot tell that two classes conflict, so BOTH of them are
emitted instead of the later one winning (`bg-accent` passed by this
package and a consumer's own `bg-status-danger` override, say, would both
end up in the rendered `className`, and which one is visually applied
then depends on Tailwind's generated stylesheet order, not on argument
order). That is real, wrong-relative-to-intent output, so `cx` logs a
`console.warn` the first time it actually happens — once per process, not
once per call, so it is not spam — naming the cause and pointing at
installing `tailwind-merge`. Call `assertTailwindMergeVersion` when you
specifically want a loud, thrown error instead (for example to fail a
build or a startup check rather than merely log): its three failure modes
(absent, out of range, unparseable) are unchanged by this.

`react-dom` and `@internationalized/date` are declared, optional peers
with no guard at all — neither has an adapter import site anywhere in this
package's own source to guard. `react-dom` is always the consumer's own
render call (`react-dom/client`, `react-dom/server`), never something this
package imports; `DateField`'s controlled `value` needs
`@internationalized/date` (`parseDate`, `CalendarDate`, ...), but only in
code YOU write to construct that value — `DateField` itself never imports
the package. Install both at the ranges given in "Token-only use" above
regardless; there is simply nothing left for this package to check once
you have.

### Wiring up a theme toggle

`tokens.css` already defines the three-state contract (see "CSS layers,
fallbacks, and themes" above): no `data-theme` follows the OS, and
`data-theme="light"`/`"dark"` force one regardless of the OS.
`@clossys/designer/theme` is the JavaScript that drives that attribute.
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
// Your Next.js app's root layout (the "layout.tsx" file in the App
// Router's "app" directory) — first thing in <head>
import { getThemeInitScript } from "@clossys/designer/theme";

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
import { ThemeProvider } from "@clossys/designer/theme";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
```

**(c) `ThemeToggle` — an accessible control, anywhere inside the provider.**
Cycles System → Light → Dark → System (see `ThemeToggle.tsx`'s own doc
comment for why a cycling control rather than a switch-plus-reset pair):

```tsx
import { ThemeToggle } from "@clossys/designer/theme";

function HeaderActions() {
  return <ThemeToggle />;
}
```

Reach for `useTheme()` directly when a component needs the current
preference or resolved theme without rendering a toggle itself:

```tsx
import { useTheme } from "@clossys/designer/theme";

function CurrentThemeLabel() {
  const { preference, resolvedTheme } = useTheme();
  return <span>{preference} ({resolvedTheme})</span>;
}
```

`(a)` and `(b)` must agree on the same `storageKey` (default `"ui-theme"`
for both) — pass `{ storageKey: "..." }` to `getThemeInitScript` and
`storageKey="..."` to `ThemeProvider` together if you override it, or the
head script will stamp the theme from one key while the provider persists
to another. Also match the script's `defaultTheme` with the provider's
`defaultPreference` when choosing a fallback other than `"system"`.

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
- **`tailwind-merge`** — every atom accepts a `className` prop (the one
  documented exception is `FileTrigger`, which does not — see its own entry
  below), and a consumer's value has to reliably win over this package's own
  default classes. Two Tailwind utilities that set the same CSS property have
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
alongside `@clossys/designer`; npm can then report a missing peer instead
of allowing a hidden transitive dependency to decide the runtime version.

No `class-variance-authority` or similar: each atom's variants are a plain
object literal mapping a variant name to a class string.

## Atoms

Every example below assumes the setup above is done. `variant`/`size` are
shown at their defaults for clarity; omitting them is equivalent.

### `Button`

```tsx
import { Button } from "@clossys/designer/atoms";

function SaveButton() {
  return (
    <Button variant="primary" size="md" onPress={() => save()}>
      Save
    </Button>
  );
}
```

`variant`: `"primary" | "secondary" | "ghost" | "danger" | "outline" |
"tonal" | "quiet"` (default `"primary"`). `size`: `"sm" | "md" | "lg"`
(default `"md"`). `ground`: `"base" | "sunken" | "inverse"` (default
`"base"`), the ground the button sits on; only `tonal` and `quiet` change
with it. Accepts every prop react-aria-components' own `Button` does —
`isDisabled`, `onPress`, `type`, and so on.

The call-to-action ladder, strongest first. Use one T1 per view, and step
down the ladder for every further action:

| Tier | Look | For |
| --- | --- | --- |
| T1 | `primary` | the one main action of a view |
| T2 | `outline` (or `secondary` on a panel) | the second action beside a T1 |
| T3 | `tonal` | a supporting action that still needs a target: a neutral tonal fill, no edge |
| T4 | `quiet` | a low-weight "more" action: a chevron text button |
| text link | `Link` | navigation inside running text |
| icon-only | `IconButton` | a control whose glyph says what it does |

`tonal` (T3) fills the box with the primary ink at low alpha
(`--color-control-tonal`, `--color-control-tonal-hover` on hover), so one
token reads on `base` and `sunken` alike; on `ground="inverse"` it takes the
on-inverse ink at low alpha (`--color-control-tonal-inverse`,
`--color-control-tonal-inverse-hover`) and the on-inverse ink. It draws no
edge.

`quiet` (T4) is a text button with no fill, edge or inline padding, so it
aligns with the text edge. It is set in `--color-control-quiet` (the on-inverse
ink on `ground="inverse"`), keeps a 44px tap block
(`--ui-layout-tap-target`), and ends in a decorative `ChevronRight`. Hover
underlines the label and nudges the chevron 2px toward the inline end (the
other way in a right-to-left page); under reduced motion the chevron does not
move. `trailingIcon` swaps the glyph (any `@clossys/designer/icons` data) or,
as `null`, removes it; other variants ignore it.

```tsx
import { Button } from "@clossys/designer/atoms";

function SupportingActions() {
  return (
    <>
      <Button variant="tonal" onPress={() => compare()}>
        Compare
      </Button>
      <Button variant="quiet" onPress={() => showAll()}>
        See all
      </Button>
    </>
  );
}
```

`outline` is the second call to action beside a `primary` one: a transparent
button with the same box, size, radius and type as `primary`, edged by an
inset ring (one pixel, the `--ui-border-hairline` value; two on hover, the
`--ui-border-rule` value) drawn in the surrounding ink (`currentColor`). It sets no ink of its own, so put it where
the text ink already reads against the ground (a `SectionIntro` actions row
carries its ground's primary ink): the edge then meets the 3:1 non-text
contrast floor on light and dark grounds alike. On `Button`, React Aria's
focus ring replaces the edge while it shows; a link keeps both.

A call to action that navigates is a link, not a button. Give a plain `<a>`
the button look with `buttonLinkClassName(variant, size, ground)` (server-safe, from
`@clossys/designer/atoms` or `/atoms/server`): the same variant and size
classes, the package-standard `focus-visible` outline, and none of the
disabled styling a link never needs.

```tsx
import { buttonLinkClassName } from "@clossys/designer/atoms/server";

<a href="/contact" className={buttonLinkClassName("primary", "lg")}>Book a call</a>;
```

A quiet link carries no chevron of its own (a class string renders no
glyph): put a decorative `Icon` last inside it, and the hover nudge applies
to it.

An icon-only link that navigates (a scroll cue, a back-to-top link) takes
the round look, `iconButtonLinkClassName(ground)` (server-safe, same
entries): a 44px circle (`--ui-layout-tap-target`) on the pill radius with
a hairline edge, drawn for a light (`"base"`, the default), sunken
(`"sunken"`) or dark (`"inverse"`) ground. It is
`iconButtonClassName({ size: "md", shape: "circle", ground })`. Hover shifts the surface and lifts the edge, pressed
takes the ground's strongest edge, and colours ease on
`--ui-duration-fast` (instant under reduced motion). The focus outline is
the package-standard accent outline over a 2px halo in the link's own
surface, so it reads where the circle overlaps a ground of the other tone.
It ships no copy: give the link an accessible name.

```tsx
import { Icon, iconButtonLinkClassName } from "@clossys/designer/atoms/server";
import { ChevronDown } from "@clossys/designer/icons";

<a href="#next" aria-label="Scroll to next section" className={iconButtonLinkClassName("base")}>
  <Icon glyph={ChevronDown} decorative size="md" />
</a>;
```

`scroll-cue` (a `theme.css` utility, Tailwind path) fixes such a cue to the
bottom of the browser window, centred and clear of
`env(safe-area-inset-bottom)` by `--spacing-xl`, so it does not move with the
page. It fades out over the first three tap targets of page scrolling
(132px), using a CSS scroll-driven animation, so the fade follows the scroll
position rather than the clock. At the end it is `visibility: hidden`, so it
leaves the tab order, and inert to the pointer; it never lingers over a later
section. Under reduced motion it does not fade: it stays visible over the same
range, then hides in one step. An engine without scroll-driven animations
(`animation-timeline`) skips the fixed placement and the fade together: the
cue is centred on the top edge of its nearest positioned ancestor and scrolls
away with the page, so it is never fixed without a fade.

### `IconButton`

```tsx
import { IconButton } from "@clossys/designer/atoms";
import { ChevronRight } from "@clossys/designer/icons";

function NextSlide({ onNext }: { onNext: () => void }) {
  return <IconButton icon={ChevronRight} label="Next slide" onPress={onNext} />;
}
```

An icon-only control on react-aria-components' `Button`: one decorative
glyph in a box with a hairline edge. `label` is required and is the
accessible name (the package ships no default copy; `aria-label` and
`aria-labelledby` are not accepted in its place). `icon` is
`@clossys/designer/icons` data. `size`: `"md"` (default, a 44px box, the
`md` icon) or `"sm"` (a 36px box, the `sm` icon, with its hit area padded
back to 44px). `shape`: `"circle"` (default, pill radius) or `"square"`
(control radius). `ground`: `"base" | "sunken" | "inverse"` (default
`"base"`). Pass `aria-pressed` or `aria-expanded` for a toggle: the selected
state fills the box with the ground's opposite surface. Colours ease on
`--ui-duration-fast`, instantly under reduced motion.

The look is `iconButtonClassName({ size, shape, ground })` (server-safe,
from `@clossys/designer/atoms` or `/atoms/server`), for a plain element that
needs it; that element still needs an accessible name.

### `Icon`

```tsx
import { Icon } from "@clossys/designer/atoms";
import { Clock } from "@clossys/designer/icons";

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
either structured glyph DATA (`glyph`, the shape `@clossys/designer/icons`
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
`@clossys/designer/icons`, hand-copied from a design tool, or a whole
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
`@clossys/designer/tokens.css`. **Stroke weight** reads
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
import { TextField } from "@clossys/designer/atoms";

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
import { Badge } from "@clossys/designer/atoms";

function Status() {
  return <Badge variant="success">Active</Badge>;
}
```

`variant`: `"neutral" | "success" | "warning" | "danger" | "info"` (default
`"neutral"`).

### `Card`

```tsx
import { Card } from "@clossys/designer/atoms";

function Panel() {
  return <Card className="max-w-sm">Plain content, raised off the page.</Card>;
}
```

Accepts every prop a plain `<div>` does, plus `variant` and `ground`:

- `variant="raised"` (default, unchanged): raised fill, `rounded-control`,
  the hairline elevation shadow.
- `variant="plate"`: a content plate. It takes the other ground from the
  section it sits on (on a base section a sunken fill, on a sunken section
  a raised fill, on an inverse section the inverse raised fill), with
  `rounded-panel` and no stroke or shadow. The card is made by the change
  of ground, not by a box.
- `variant="outline"`: a product panel. Raised fill, one panel edge
  (`--ui-border-panel` in `line-panel`, or `line-on-inverse` on an inverse
  section), `rounded-panel`, never a shadow of its own.

Plate and outline read the panel identity slots (`--radius-panel`,
`--ui-border-panel`, `--color-line-panel`; see TOKENS.md). Each defaults
to the surface radius and a hairline in the base line, so a brand that
leaves them unset looks exactly as before.

`ground` (`"base" | "sunken" | "inverse"`, default `"base"`) names the
section the card sits on. An atom cannot see its section, so the block
that places a plate passes the ground it already knows.

```tsx
import { Card } from "@clossys/designer/atoms/server";

function Plates() {
  return (
    <div className="grid gap-lg">
      <Card variant="plate" ground="sunken">A plate on a sunken band.</Card>
      <Card variant="outline">A product panel.</Card>
    </div>
  );
}
```

### `Breadcrumb`

```tsx
import { Breadcrumb } from "@clossys/designer/atoms";

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
import { Link } from "@clossys/designer/atoms";

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

`buttonVariant` (`ButtonVariant`, default `"primary"`) and `buttonSize`
(`ButtonSize`, default `"md"`) give a link the look of a `Button`: setting
either one applies exactly the classes `Button` applies for that variant and
size, plus the same disabled opacity and focus ring, in place of the link
`variant` classes. The element stays a link (`role="link"`, `href`,
`render`), because navigation is a link and not a button; `Button` itself
only renders a `<button>`. With neither prop set, `Link` is unchanged. For a
framework link in button style, pass them alongside `render`:
`<Link href="/prompts" buttonVariant="secondary" buttonSize="lg" render={(props) => <RouterLink {...props} to="/prompts" />}>`.

### `Checkbox`

```tsx
import { Checkbox } from "@clossys/designer/atoms";

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
import { Switch } from "@clossys/designer/atoms";

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
import { Select } from "@clossys/designer/atoms";

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
import { Textarea } from "@clossys/designer/atoms";

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
import { Avatar } from "@clossys/designer/atoms";

function UserAvatar() {
  return <Avatar src={user.imageUrl} alt={user.fullName} size="md" />;
}
```

`size`: `"sm" | "md" | "lg"` (default `"md"`). Shows the image at `src`; if
`src` is omitted, or the image fails to load, falls back to initials
derived from `alt`. Not interactive and composes no other atom — plain
markup, like `Badge`/`Card`.

`@clossys/designer/atoms/server` exports a hook-free `Avatar` with the same
props and markup. It shows the image when `src` is given and the initials
otherwise; it cannot switch to initials when an image fails to load (that
needs state), so use the client `Avatar` for image URLs that may break.

### `Spinner`

```tsx
import { Spinner } from "@clossys/designer/atoms";

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
import { Menu } from "@clossys/designer/atoms";
import { Button } from "@clossys/designer/atoms";

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

`Menu.Section` groups entries under a real menu Header. Supply a non-empty
`heading` or `aria-label`; the type requires one and a blank name throws a
`TypeError`. Rich headings need nonblank text or a label in intrinsic elements
or fragments; hidden content and opaque components do not establish a name.
An explicit section `aria-label` names an unverified heading while preserving
its visible content.
Its optional `selectionMode` (`none` or `multiple`), `selectedKeys`,
`onSelectionChange` and `shouldCloseOnSelect` belong to the section. Multiple
selection produces `menuitemcheckbox` preferences; the caller owns checked
values. Normal hover/focus retains the existing selected surface with no outline;
a focused, enabled item adds a current-color outline only in forced colors.


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
import { Dialog } from "@clossys/designer/atoms";
import { Button } from "@clossys/designer/atoms";

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
surface's max width (24rem, 28rem and 42rem). A legitimate prop rather than three separate
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
import { Tabs } from "@clossys/designer/atoms";

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
import { Table } from "@clossys/designer/atoms";

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
import { Field } from "@clossys/designer/atoms";

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
import { Skeleton } from "@clossys/designer/atoms";

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
import { Tooltip, Button } from "@clossys/designer/atoms";

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
import { Banner } from "@clossys/designer/atoms";

function TrialEndingBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <Banner variant="warning" onDismiss={onDismiss}>
      Your trial ends in 3 days.
    </Banner>
  );
}
```

A persistent inline message region — not a toast (see `@clossys/designer/shell`'s
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
import { RadioGroup } from "@clossys/designer/atoms";

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
import { Popover, Button } from "@clossys/designer/atoms";

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
import { DateField } from "@clossys/designer/atoms";
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
import { ComboBox } from "@clossys/designer/atoms";

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
match strategy. The trigger button that opens the suggestion list defaults
its accessible name to `"Show suggestions"`, overridable via `triggerLabel`.

### `SearchField`

```tsx
import { SearchField } from "@clossys/designer/atoms";

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
import { FileTrigger, Button } from "@clossys/designer/atoms";

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
import { Disclosure } from "@clossys/designer/atoms";

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
import { ProgressBar } from "@clossys/designer/atoms";

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
import { Separator } from "@clossys/designer/atoms";

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
import { Chip } from "@clossys/designer/atoms";

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

### `StatusMark`

```tsx
import { StatusMark } from "@clossys/designer/atoms/server";

function ReportState() {
  return <StatusMark tone="success">Received</StatusMark>;
}
```

A small tone mark and a label for one data state in a row, a table cell or
a panel header. `tone`: `"success" | "warning" | "danger" | "info" |
"neutral"`. Each tone has its own shape as well as its own colour (success
a filled circle, warning a triangle, danger a diamond, info an open circle,
neutral a dash), so the states stay apart in a greyscale brand or for a
reader who cannot tell the colours apart. The label is required and always
visible; the mark is an `aria-hidden` SVG, so colour and shape only repeat
what the words say. The label uses
the tone's `status-*-text` colour (neutral: `ink-secondary`), checked at AA
against the raised surface in both themes (`designer-contrast-check`).
Lighter than `Badge`, which has a tinted pill: use `StatusMark` where
several states sit close together. Server-safe.

### `Meter`

```tsx
import { Meter } from "@clossys/designer/atoms/server";

function LeverageRow() {
  return (
    <Meter value={3.4} scaleMax={5} limit={3} direction="max" tone="danger" valueText="3.4x" limitText="limit 3.0x" />
  );
}
```

A value drawn against a scale, optionally against a limit. One row of
visible text (`valueText`, then `limitText`) above a thin bar. `limit`
draws a tick at the `--ui-border-rule` width and shades the disallowed
side: after the limit for `direction="max"` (a cap, the default), before it
for `direction="min"` (a floor). Without a limit it reads as a share.
Supply `previous` with nonblank `previousText` to show a prior measurement.
The prior value must be finite and within zero and `scaleMax`; a dashed
hairline marks its position and the authored history text stays visible
outside the decorative bar. Orphaned history fields are refused.
`tone` (`MeterTone`) is a status tone, `"neutral"` for a plain quantity, or
`"accent"` for a plain quantity in the brand accent (a share or an
allocation, never a state). `warning` fills with diagonal hatching and
`info` with a tinted bar inside a ring (both at the `--ui-border-rule`
weight), so neither depends on colour alone; the other tones fill solid. `emphasis` (`MeterEmphasis`, default
`"default"`) set to `"figure"` makes the value the focal number of its
panel: `text-h1`, `text-h0` via `@md:text-h0` at container widths of 28rem or more, normal weight,
tabular, with the limit beside it in secondary ink and the bar under both.

The bar is `aria-hidden` and there is no `<meter>` element: the visible
text carries the meaning for every reader. Positions use logical inline
properties, so the bar fills from the inline start in both directions. A
value beyond `scaleMax` draws a full bar. A non-finite or non-positive
`scaleMax`, or a non-finite or negative `value`/`limit`, throws a
`RangeError`. Server-safe.

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
import { PageHeader } from "@clossys/designer/blocks";
import { Button } from "@clossys/designer/atoms";

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
import { EmptyState } from "@clossys/designer/blocks";
import { Button } from "@clossys/designer/atoms";

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
import { DataTable, Pagination, type DataTableColumn } from "@clossys/designer/blocks";
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
import { Form, useFormValidation } from "@clossys/designer/blocks";
import { TextField, Button } from "@clossys/designer/atoms";
import { useState } from "react";

// With useFormValidation: timing, focus and pending state come from the hook.
async function sendMessage(values: { name: string; email: string; phone: string }): Promise<void> {
  // Replace with the product's own request; a failure rejects.
  if (values.email.length === 0) throw new Error("empty");
}

function ContactForm() {
  const [sendFailed, setSendFailed] = useState(false);

  const form = useFormValidation({
    initialValues: { name: "", email: "", phone: "" },
    validators: {
      name: (value) => (value.trim() === "" ? "Enter your name." : undefined),
      email: (value) => {
        if (value.trim() === "") return "Enter your email address.";
        if (!value.includes("@")) return "Enter an email address like name@example.com.";
        return undefined;
      },
    },
    onSubmit: async (values) => {
      setSendFailed(false);
      try {
        await sendMessage(values);
      } catch {
        setSendFailed(true);
      }
    },
  });

  return (
    <Form
      heading="Contact us"
      validation={form}
      errorSummaryMessage={(count) => `${count} ${count === 1 ? "field needs" : "fields need"} attention`}
      submitError={sendFailed ? "We could not send your message. Try again." : undefined}
      actions={
        <Button {...form.getSubmitButtonProps()} variant="primary">
          Send message
        </Button>
      }
    >
      <TextField label="Name" {...form.getFieldProps("name")} />
      <TextField label="Email" type="email" {...form.getFieldProps("email")} />
      <TextField label="Phone (optional)" type="tel" {...form.getFieldProps("phone")} />
    </Form>
  );
}

// Without the hook: errors come from the consumer's own validation.
function ProfileForm() {
  const [errors, setErrors] = useState<{ fieldId: string; message: string }[]>([]);

  return (
    <Form
      heading="Profile"
      errors={errors}
      errorSummaryMessage={(count) => `Fix ${count} ${count === 1 ? "field" : "fields"} to continue`}
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
(`children`), an error-summary region, a submit-error region, and an actions
region — five regions that differ in kind, and a page can hold two `Form`s
(two independent forms on one settings page), which is what makes this a
block rather than a view.

**`Form` implements no validation logic or form state, deliberately.**
react-aria-components already carries validation through each field's own
`isInvalid`/`validationErrors`, and most real consumers layer a form
library of their own choice (React Hook Form, Formik, TanStack Form, ...)
on top of that. A shared UI package that tried to own validation would
have to pick one of those, and every consumer using a different one would
immediately need an escape hatch — the same structural-difference-through-
a-mode-prop failure this README's variant rule warns against, just scoped
to a form library instead of visual styling. So `Form` lays out the regions
and renders whatever a consumer's validation already decided; nothing about
*when* a field is invalid or *what* makes it so lives in it. The validation
timing half of the pattern is a separate, optional hook,
[`useFormValidation`](#useformvalidation), that a consumer opts into
through the `validation` prop. Consumers on another form library keep
passing `errors` from it and never call the hook.

**The error summary is opt-in.** It renders only when `errorSummaryMessage`
is passed and there is at least one error; `Form` ships no heading text of
its own, so there is no default in a language the consumer does not render.
`errorSummaryMessage` is called with the number of entries and returns the
heading. Without it, the inline error under each field carries the
messages. When shown, the summary is a `role="alert"` region collecting
every error, each entry a real `<a href="#fieldId">` to the actual invalid
control (a consumer-supplied `id`, matching react-aria-components'
convention of applying a supplied `id` to the field's real control, not a
wrapper); a click or Enter on that link moves focus straight to the field.
That gives a screen-reader user tabbing field-by-field a way to discover
what is wrong without visiting every field.

**Two ways in, two focus rules.**

- With `validation` (the `useFormValidation` return value, or any
  `FormValidationBinding`): `Form` submits through `validation.handleSubmit`,
  sets `noValidate` so the browser's own constraint bubbles do not pre-empt
  the pattern, sets `aria-busy` while a submit is pending, and uses
  `validation.summaryErrors` as `errors` unless `errors` is passed. A failed
  submit moves focus to the first invalid field in document order. If
  `errorSummaryMessage` is also passed, the summary renders and is announced
  through its `role="alert"` without taking focus, because taking focus
  there as well would fight the field for it. The `onSubmit` prop is ignored
  in this mode: the validation source owns submission, and calling both
  would send twice.
- With `errors` alone (no `validation`): `Form` tracks no validation state,
  so a NEW non-empty `errors` array reference is the only "a submission
  just failed" signal it has, and it moves focus to the summary (when
  `errorSummaryMessage` is passed and the summary renders). A consumer must
  not construct an equivalent new array on every unrelated render, or the
  summary steals focus back on every one of those too.

**`onSubmitError` receives a rejected send.** With `validation`, if the
promise returned by `onSubmit` rejects, `Form` catches it, so it never becomes
an unhandled promise rejection, and calls `onSubmitError(error)`. The
pending state clears either way. The prop is optional and does nothing when
omitted. `Form` renders no error text for it: set your own state in the
callback and pass the message through `submitError`. It is not called for
field validation failures.

**`submitError` is for send failures only.** It renders one `role="alert"`
region above the actions while set, with consumer content: the network or
server refused a submission that passed validation. Field-level problems
belong in the fields' own errors and the summary, not there.

**Pending, not disabled.** The actions slot is the consumer's. Give the
submit `Button` the pending state (`validation.getSubmitButtonProps()`),
never `isDisabled`, so it keeps keyboard focus while the send runs.

#### Error placement standard

A failure appears in exactly one place. Where it goes depends on what it is
about:

- **Inline, under the field**: the field's own `isInvalid` plus `errorMessage`
  on `TextField` (and the other fields), for client validation and for a
  server error that names one field. For the second case the consumer maps
  the server's field name to that field's `id` and sets that field invalid.
- **Always inline**: a required field left empty. It never goes in the banner.
- **`submitError`, the form's one banner region**: everything else, meaning an
  account problem, a flow problem, a rate limit, a provider that is
  unavailable, or an unknown failure.

When several things go wrong at once:

- Every invalid field shows its own inline message at the same time.
- There is at most one banner, and only for a failure that is not a field's.
  Several banner messages are nodes inside the one `submitError`, never
  several alert regions.
- A failure is never in a field and in a banner, and never in a summary list
  that repeats the inline messages. A form following this standard therefore
  does not pass `errorSummaryMessage`. The opt-in summary described above
  stays as it is; it falls outside this standard.

The tests in `Form.test.tsx` pin both rules: two invalid `TextField`s render
both inline messages beside exactly one `role="alert"` (the `submitError`),
and a `submitError` holding two nodes still renders one alert region.

#### Error copy

Write failure messages in plain words. Say what happened and give one next
step. Keep status codes, error codes and provider names out of a field
message; a reference code goes only in the banner. Two generic examples:

- "We couldn't find an account for that email. Check it for typos."
- "Sign-in is unavailable right now. Try again in a few minutes."

Designer ships no copy: the words stay in each site.

#### Multi-step forms

For a flow that asks for an identifier first and then continues on later
steps (a pattern only; Designer ships no copy):

- Each later step shows the identifier in a line the consumer writes, for
  example "Signing in as {identifier}" (consumer copy), with one change
  control, a ghost `Button`, that returns to the first step with the value
  still editable.
- The browser Back button stays native. Add no in-card Back control besides
  the change control.
- The card's one primary action advances. Error recovery stays on the current
  step, and there is one resend control where a code is sent.

### `useFormValidation`

The `ContactForm` example under [`Form`](#form) shows the hook end to end.

`useFormValidation` is the validation-timing half of the form pattern. It
renders nothing and holds the values, the errors currently shown, which
fields the user has left, and the submit state. Pass its return value to
`Form`'s `validation` prop, or, without `Form`, attach `formRef` and
`handleSubmit` to your own `<form>`.

**Options.** `initialValues` (also what `reset()` returns to), `validators`
(one optional function per field; a field without one is always valid),
`onSubmit` (called with the values only when every field is valid), and
`idPrefix` (optional; defaults to React's `useId()`, and prefixes every DOM
id the hook generates). A validator receives the field's value and every
current value, and returns the error to show or nothing: `undefined`,
`null`, `false` and `""` all mean valid, anything else is the message. It
re-runs on its own field's change, blur and submit, not when another
field it reads changes.

**Return value.** `values`, `errors` (only those currently shown),
`touched`, `submitCount`, `isSubmitting`, `fieldId(name)` and
`errorId(name)` (stable DOM ids), `getFieldProps(name)`,
`getNativeInputProps(name)`, `getSubmitButtonProps()`, `setFieldValue(name,
value)`, `reset()`, and the `FormValidationBinding` members `Form` reads
(`handleSubmit`, `summaryErrors`, `formRef`).

**Timing.**

- Before the first submit, typing shows no error. A field validates when
  the user leaves it (blur).
- A field that shows an error re-validates on every change, so the error
  clears as soon as the value is valid instead of waiting for the next
  blur.
- After the first submit, every change re-validates.
- A failed submit calls no `onSubmit`, marks every field touched, and shows
  every error.

**Focus.** A failed submit moves focus to the first invalid field in
document order (not validator-key order), after React has committed the
error, so a screen reader announces the field together with its
`aria-describedby` text. The hook finds the field by the DOM id it
generated, inside the form's own document or shadow root.

**Pending state.** The submit button is never disabled. While an async
`onSubmit` is pending, `isSubmitting` is true and `getSubmitButtonProps()`
returns `{ type: "submit", isPending }`, which the `Button` atom maps to a
pending state that stays focusable and is announced by
react-aria-components. A second submit while one is pending is ignored,
including two submits in the same tick before a re-render. Handle a send
failure inside `onSubmit` (catch, then render your own message through
`Form`'s `submitError`). `isSubmitting` is cleared whether `onSubmit`
resolves or rejects, so the submit button is usable again. A rejection is
re-thrown from `handleSubmit`: a caller that attaches `handleSubmit` to its
own `<form>` must catch it, and `Form` catches it and passes it to its
`onSubmitError` prop.

**Error summary and `submitError`.** The summary is opt-in: it appears only
when `errorSummaryMessage` is passed to `Form`. It shows the errors as of
the last failed submit and does not shrink as the user fixes fields, since
each change to a live alert is announced again; the inline error under each
field is what clears live. `submitError` is one alert for send failures
only, never for field errors.

**Accessible error association.** `getFieldProps(name)` returns `id`,
`name`, `value`, `onChange`, `onBlur`, `isInvalid`, `errorMessage` and
`validationBehavior: "aria"`. Spread it on a designer field atom
(`TextField`, `Textarea`, `Select`, ...) and react-aria-components wires
`aria-invalid` and the `aria-describedby` link to the atom's own error
element. `"aria"` keeps the browser's native constraint validation out of
the way, since the hook owns when an error shows. For a plain `<input>`,
`<textarea>` or `<select>`, `getNativeInputProps(name)` gives the same
wiring: `aria-invalid` while the field shows an error, and
`aria-describedby` pointing at `errorId(name)` only while an error shows.
Render the error element yourself with `id={form.errorId(name)}`.

**No built-in strings.** Every user-facing string comes from props or from
validator return values: the hook ships no error text, and `Form` ships no
summary heading. Write messages in the language the product renders, and
say how to fix the problem rather than only that one exists. Mark optional
fields with "(optional)" in the label, not an asterisk on required ones.

**Benchmark.** The pattern follows what leading product sites converge on:
inline errors beside the field, validation on leaving a field, live
clearing once the value is fixed, focus on the first invalid field after a
failed submit, and a submit button that stays focusable while it sends.
WCAG 2.2 AA is the floor. Relevant success criteria: 3.3.1 Error
Identification (the error is identified in text, next to the field), 3.3.3
Error Suggestion (validators return correction guidance, which is consumer
copy), 4.1.2 Name, Role, Value and 1.3.1 Info and Relationships (the error
is programmatically associated with its field), and 2.4.3 Focus Order
(focus moves to the first invalid field in reading order).

### `FieldGroup`

```tsx
import { FieldGroup } from "@clossys/designer/blocks";
import { TextField } from "@clossys/designer/atoms";

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
import { ConfirmDialog } from "@clossys/designer/blocks";
import { Button } from "@clossys/designer/atoms";

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
import { Toolbar } from "@clossys/designer/blocks";
import { Button, TextField } from "@clossys/designer/atoms";

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

### Destination collections

Use `Items` for a bounded list of destinations. Each title is the item's one
link; descriptions and icons stay outside its accessible name. Rows support
plain, rule or plate treatment and preserve authored reading order.

```tsx
import { Items } from "@clossys/designer/blocks/server";

<Items
  arrangement="rows"
  treatment="plate"
  items={[
    { id: "guides", heading: "Guides", description: "Find instructions by topic.", href: "/guides" },
    { id: "support", heading: "Support", description: "Get help with your next step.", href: "/support" },
  ]}
/>;
```

### `NavGrid`

```tsx
import { NavGrid } from "@clossys/designer/blocks";

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

**Each item has a real link or button.** `items` is a discriminated union.
An ordinary item with `href` has one title-named `<a href>` with a visible
chevron and a stretched hit area covering the tile. The icon and description
sit outside the anchor. Tab reaches the title link once, and its focus ring
surrounds the tile.

If a linked item's description contains a link, button or field, NavGrid
renders a separate title link without a stretched overlay. The title link
has its own focus outline; description controls retain their own hit areas
and keyboard stops. Interactive content in a linked item's title or icon
throws a `TypeError`. An item with `onSelect` renders through the package's
`Button` atom (`variant="ghost"`), with its icon, title and description inside
the one button. `href` and `onSelect` are mutually exclusive at the type
level. Icons are decorative reinforcement for the title.

Eligible all-linked collections of two to six items with consistent icon
presence and noninteractive descriptions use the shared linked-item layout.
Single-item, larger, mixed-icon, mixed link/button and interactive-description
collections retain control tiles and authored order: one per row below
tablet, two from tablet and three from desktop. Action tiles keep their
raised, bordered button style.

### `SectionHeader`

```tsx
import { SectionHeader } from "@clossys/designer/blocks";
import { Button } from "@clossys/designer/atoms";

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
`@clossys/writer`).

`Hero`, `FeatureGrid`, `Faq`
(including its server implementation), `OrderedStepSequence`, and
`StatusList` share one closed `ground` contract:
`"base" | "sunken" | "inverse"` (default `"base"`). Base inherits the
ambient page surface, preserving existing composition and markup, while
sunken and inverse paint their semantic surfaces explicitly. Every ground
selects its foreground, divider/connector, and status treatment from
Designer's exported `SECTION_GROUND_CLASSES`; consumers do not pair a surface
with unrelated foreground tokens. The mapping and its
`SectionGround` type are exported from both `@clossys/designer/blocks` and
`@clossys/designer/blocks/server`. Status dots retain the closed display-status
colors on all three grounds; sunken and inverse add a checked, ground-specific
contrast boundary, while the adjacent visible label remains the meaning-bearing
channel.

### `Hero`

`Hero size="compact"` uses the section heading ramp and rhythm. Its heading
remains an `h1` by default; `headingLevel={2}` still supports a later hero.
`size="display"` is the default. Omitting `size` or selecting the supported
`"default"` alias keeps the same display treatment.

```tsx
import { Hero } from "@clossys/designer/blocks";
import { Button } from "@clossys/designer/atoms";

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
Use `ground="sunken"` or `ground="inverse"` for those semantic section
grounds; the block applies the matching painted surface and ink policy as one
unit. The default base ground inherits the surrounding base surface.

`align` (`HeroAlign`: `"start"` or `"center"`, default `"start"`) sets how the
text block lines up. `"center"` centres each line and the actions row, holds
the text block to the prose measure (`--ui-width-prose-max`), balances the
heading's lines and pretty-wraps the description, so a centred opening or
closing message wraps sooner than the column it sits in. A `split`
composition keeps its two columns.

```tsx
<Hero heading="Heading text" description="Subheading copy goes here." actions={<Button>CTA label</Button>} align="center" />
```

### `SectionIntro`

`SectionIntro` and `Hero` accept three optional controls. `eyebrowTone="muted"`
uses the ground's secondary ink; the default is `"accent"`. `measure="wide"`
leaves the headline within its content container without a prose cap and limits
the supporting copy to `--ui-width-hero-wide` (64rem); the default `"prose"`
keeps the existing 48rem cap. `headingScale="display"` selects display-m,
display-l from tablet, and display-xl (72px) from tablet-lg; the default
`"default"` keeps the emphasis ramp. These controls are independent.

```tsx
import { SectionIntro } from "@clossys/designer/blocks/server";

<SectionIntro eyebrow="Eyebrow" heading="Section heading" description="One line of how." />;
```

A section's header group: eyebrow, heading, description and optional
actions, in that order, with one rhythm. The eyebrow says what the section
is, the heading why it matters, the description how; the module (a grid,
a figure, a list) follows the intro. `emphasis="display"` is a page's
opening (`text-display-m`, `text-display-l` from `tablet`, `leading-display`;
gaps `mt-sm` / `mt-2xl` / `mt-3xl`), `emphasis="section"` (the default)
every band after it (the section-title step, `leading-heading`; gaps
`mt-sm` / `mt-xl` / `mt-2xl`). Each gap is larger than the heading's own
line gap and grows toward the action, so the group reads as one unit. The
eyebrow is a small tracked label (`text-body-s`, medium, uppercase) in the
ground's accent ink (`accent-text`, `accent-on-inverse` on an inverse band).
The actions row (`data-section-intro-actions`) carries the ground's primary
ink, so an `outline` button in it takes a readable edge on every ground.
`Hero` and `ContentSection` both compose it; use it directly only for a
header group outside those blocks. It paints no surface: `ground` picks the
ink only.

### `ContentSection`

```tsx
import { ContentSection, FeatureGrid, MediaFigure } from "@clossys/designer/blocks";

function ProductSection() {
  return (
    <ContentSection eyebrow="Eyebrow text" heading="Section heading" description="One supporting line.">
      <FeatureGrid items={[{ id: "one", heading: "Item heading", description: "Item copy." }]} />
      <MediaFigure caption="Caption text">
        <img src="/media.png" alt="Media description" />
      </MediaFigure>
    </ContentSection>
  );
}
```

One section anatomy for long-form marketing pages: a header group (an
optional eyebrow, heading, description and actions row) followed by a
module slot holding one or more content modules — a `FeatureGrid`,
`StatusList`, `OrderedStepSequence` or `Faq` rendered without its own
heading region, a `MediaFigure`, or any combination. Spacing is fixed by the
block so sections composed with it do not drift: the header group is a
`SectionIntro` at the section emphasis (eyebrow `mt-sm` to the heading,
heading `mt-xl` to the description, `mt-2xl` to the actions, each gap wider
than the one before it) and never runs wider than the prose measure
(`--ui-width-prose-max`); the header group and each module sit one step
apart (`gap-2xl`, `gap-3xl` from `tablet-lg`); modules take the full column.

`headingLevel` (`ContentSectionHeadingLevel`: `2` to `6`, default `2`) picks
the heading element; at every level the heading is a section title in the
display face that scales with the viewport (`text-h1`, `text-h0` from
`tablet`, `text-display-m` from `tablet-lg`, with `leading-heading`), one
display step under `Hero`'s, and the description sits at `text-body-l`. `align` (`ContentSectionAlign`: `"start"` or `"center"`, default
`"start"`) lines the header group up; modules always take the full column.
`ground` selects the header group's ink and paints no surface. The band
around it (ground surface and column) is a `SectionFrame`'s.
An explicit `size` owns the section's vertical padding and header scale:

| Size | Below 768px | From 768px | From 1280px | Header scale |
| --- | --- | --- | --- | --- |
| `compact` | 48px | 64px | 96px | section |
| `standard` | 64px | 96px | 128px | section |
| `display` | 96px | 128px | 160px | display |

The largest step composes the existing 128px and 32px spacing tokens.
Omitting `size` leaves vertical padding to the outer `SectionFrame` and
lets `emphasis` set the header scale. When supplying `size`,
remove outer vertical padding so the two frames do not add their spacing.
`emphasis` (`ContentSectionEmphasis`: `"section"` or `"display"`, default
`"section"`) sets the header group's scale when `size` is omitted; `"display"` gives a statement
band (a header and its actions, no module or media) the `SectionIntro`
display step and rhythm. `headingLevel` still sets the element.

`actions` holds one or two button-styled links (`buttonLinkClassName`), at
most one `primary`, the other `outline`. Where they belong depends on the
shape, and the component renders what it is given: a stacked section with
modules or media after its header takes none (link the module's items with
`href`, or put one link in the footnote); a header-only section takes them
as its last element, with no footnote after them; a split takes them in its
text column, never under the visual. Publisher's content contract refuses
the other shapes. `footnote` (`ReactNode`) is an
optional one-sentence aside closing the band: `text-body-s` in the ground's
secondary ink, at most the prose measure, following `align`, and holding at
most one underlined link. It has `data-content-section-footnote`; without
the slots below it closes the section (the text column in a split).
Never put a call to action in it.

`takeaway` and `source` are optional `ReactNode` slots. The takeaway follows
the body and media, spans the full band in every layout, and carries an
accent rule at the logical start edge using `--ui-border-hairline`, with
`text-body-l` semibold text. The footnote follows it with its existing
styling and column. The source follows the footnote in that same column,
using `text-caption` and the ground's secondary ink. Both slots render the
authored nodes without a prefix or default copy. Omitting both preserves
the existing markup; empty strings, null and false also render no slot.

Use it instead of `SectionHeader` (settings scale, `text-h3`) for a
marketing section, and instead of `MarketingChapter` when the section needs
an eyebrow, actions, or modules other than prose, or already sits in a
`SectionFrame`. Props are `ContentSectionProps`: the regions above, plus
`children`, `className`, `style` and every native `<div>` attribute except
`title`.

**Layouts.** `layout` (`ContentSectionLayout`) is `"stacked"` (the default),
`"split-start"` or `"split-end"`. A stacked section may take `media`, rendered
after its text module. From `tablet-lg` (1024px), a split puts the header
group in a 5/12 column and its companion in a 7/12 column, `gap-x-4xl` apart.
Media takes the companion column; without media, children take it. Without
either, the eyebrow and heading take 5/12 and description, actions and
footnote take 7/12. Header-only splits align at the top; media splits centre
vertically. Below 1024px they stack in DOM reading order: heading first,
then supporting content. `split-start` moves the companion with grid
placement only. `align` is stacked only; split headers line up at the start.
The supported `layout="split"` and `mediaSide="start" | "end"` aliases
use a media-based split layout and require media.

```tsx
import { ContentSection, Items } from "@clossys/designer/blocks";

function SplitSection() {
  return (
    <ContentSection
      layout="split-start"
      size="standard"
      eyebrow="Eyebrow text"
      heading="Section heading"
      media={<img src="/media.png" alt="Media description" />}
    >
      <Items
        arrangement="rows"
        treatment="rule"
        columns={1}
        items={[
          { id: "one", heading: "Topic one" },
          { id: "two", heading: "Topic two" },
        ]}
      />
    </ContentSection>
  );
}
```

### `MediaFigure`

```tsx
import { MediaFigure } from "@clossys/designer/blocks";

function Screenshot() {
  return (
    <MediaFigure caption="Caption text" measure="content">
      <img src="/media.png" alt="Media description" />
    </MediaFigure>
  );
}
```

Large media as a section module: the media straight on the section ground
(no panel, fill, padding or shadow) and an optional caption underneath as the
`<figcaption>`, `gap-sm` below the media in the ground's muted ink. `framed`
(default `false`) draws one hairline, the ground's line with rounded corners,
around the media; use it only when the media has no edge of its own. Give
the media a fluid width so it fits the column at every width and never
scrolls inside the figure.
`measure` (`MediaFigureMeasure`: `"column"` or `"content"`, default
`"column"`) runs it across the whole column or holds it to the content
measure (`--ui-width-content-max`). `ground` selects the hairline and the
caption ink. Props are `MediaFigureProps`: those, plus `children` (the
media), `className`, `style` and every native `<figure>` attribute. Give an
image its own alt text.

### `MarketingChapter`

```tsx
import { MarketingChapter } from "@clossys/designer/blocks";
import { ArticleBody } from "@clossys/designer/blocks";

function FoldChapter() {
  return (
    <MarketingChapter title="Chapter heading" description="Supporting line.">
      <ArticleBody>{/* long-form prose */}</ArticleBody>
    </MarketingChapter>
  );
}
```

A full-bleed marketing chapter band after the fold: a marketing-scale title
(`text-h2`, not settings-scale `SectionHeader` `text-h3`), an optional
description, and a prose slot for long-form content. Use when the page hero
already consumed `<h1>` and the next major section needs marketing heading
scale. `headingLevel` (`2 | 3`, default `2`) picks the title element; `ground`
follows the same `SectionGround` contract as `Hero` and `FeatureGrid`.

### `Item` and `Items`

```tsx
import { Item, Items } from "@clossys/designer/blocks/server";

function RelatedResources() {
  return (
    <div>
      <Item id="notice" heading="Reference" meta="Updated" badge={{ label: "Live", tone: "success" }} treatment="plain" size="standard" ground="base" />
      <Items
        arrangement="columns"
        columns={2}
        treatment="plate"
        headingLevel={3}
        items={[
          { id: "guide", heading: "Guide", description: "Read the reference.", href: "/guide", badge: { label: "Live" } },
          { id: "examples", heading: "Examples", description: "Explore examples.", href: "/examples", meta: "Reference" },
        ]}
      />
    </div>
  );
}
```

`Item` requires `treatment`, `size` and `ground`; its title defaults to a paragraph.
Optional `headingLevel={3}` or `headingLevel={4}` selects a semantic heading.
`Items` defaults treatment
to plain, ground to base, size to standard, and item heading elements to
h3 (`headingLevel={4}` selects h4). Unordered columns, bento and stacked
collections use text-h2 at standard size, text-h1 at display size, and text-h0
for centred statements. Bento follows the supplied frame size. Rows use
text-body headings and text-body-s descriptions with inline decorative icons;
ordered collections and standalone Item retain their measured scale. These
visual scales do not change heading elements. Rules are hairlines; decorative
icons use secondary ink. Eyebrow,
badge and meta share a wrapping row in every treatment. The four status tones
use a rounded opaque base-surface backing, preserving the Badge text and tint
pairing on each ground. Neutral keeps its own opaque fill. Badge tone maps to
the existing Badge atom: neutral (default), success, warning, danger or info.
The item-level featured field is retired; select the collection treatment.

An optional `figure` makes an item's measurement prominent: `{ value, delta?,
trend? }`. Values use `text-h2` (`text-h1` at display size), the display font
and tabular numerals. Author the sign in `delta`, such as `"+12%"` or `"-3%"`;
`trend` selects `"up"`, `"down"` or `"neutral"` ink from the same mapping as
`Stat`. A trend needs a nonblank delta. Figures belong to columns, rows and
stacked collections, including connected order, with a figure on every item
or on none. They cannot share an item with `visual`, or use bento, statement
scale or disclosure.

Use `status: { tone, label }` for a lighter state marker instead of a badge.
The existing `StatusMark` atom supplies its tone-specific shape beside the
visible label in the meta row. Its tones are `success`, `warning`, `danger`,
`info` and `neutral`; the label carries the meaning in greyscale and print.
On rows the status moves to the meta row's end from tablet width. Status is
available in the three treatments and disclosure, but not statement scale,
and cannot share an item with `badge`. Linked items require inert figure
and status content; disclosure status labels must be phrasing content
without controls.
On inverse ground, delta and status slots use a raised-surface backing
to keep their semantic text on its checked surface.

```tsx
import { Items } from "@clossys/designer/blocks/server";

function ServiceMetrics() {
  return <Items arrangement="rows" items={[
    { id: "requests", heading: "Requests", figure: { value: "2,481", delta: "+12%", trend: "up" }, status: { tone: "success", label: "Available" } },
    { id: "latency", heading: "Latency", figure: { value: "120 ms", delta: "-3%", trend: "down" }, status: { tone: "neutral", label: "Stable" } },
  ]} />;
}
```

#### Index configuration: status list

Use unordered `Items` rows when readers look up an item's current status.
Put each visible status label in `badge`; the optional description explains
that item. This configuration uses Index's existing shape, reveal and groups
axes: `rows-1`, `all`, `off` in the example. Labels are authored copy,
and the badge uses existing semantic tokens. The list follows the row count
and grouping limits below.

```tsx
import { Items } from "@clossys/designer/blocks/server";

function FeatureStatus() {
  return (
    <section>
      <h2 id="feature-status-heading">Feature status</h2>
      <Items
        aria-labelledby="feature-status-heading"
        arrangement="rows"
        columns={1}
        order="none"
        reveal="all"
        treatment="rule"
        scale="item"
        items={[
          { id: "search", heading: "Search", description: "Find a record.", badge: { label: "Live", tone: "success" } },
          { id: "imports", heading: "Imports", description: "Bring records together.", badge: { label: "In progress", tone: "info" } },
          { id: "exports", heading: "Exports", description: "Take a copy with you.", badge: { label: "Planned", tone: "neutral" } },
        ]}
      />
    </section>
  );
}
```

Publisher selects this configuration with `kind: "content-section"` and
an `items` block using `recipe: "topics"`, with `badge.label` as a `CopyRef`.
Its preview example appears on `catalog/index-function.html`.

| Arrangement | Columns | Counts |
|---|---|---|
| columns | 2 | 2, 4, 6 |
| columns | 3 (default) | 3, 6 |
| rows | 1 (default) | 2–8 |
| rows | 2 | even counts from 2–8 |
| rows | 3 | 3 or 6 ungrouped linked plates, unordered and fully revealed |
| bento | omitted | 2–6, complete ordered 12-unit rows |
| stacked | omitted | 2–4 |

Bento spans are third, half, two-thirds or full; an omitted span is half.
An item cannot overflow its current row even when the total divides by 12.
At tablet width, a lone third fills its row; desktop keeps its third span.
Statement requires columns 3, exactly three items and plain or rule treatment;
its items take heading, description and optional badge only. Items refuse
the retired featured field, including false. Spans belong to bento; columns
belong to columns and rows.

Rows may have 2–4 labelled groups, with 2–4 item IDs in each. Groups reference
every item exactly once, and render members in each group's authored ID
order. Group labels are caption paragraphs naming `role="group"` containers
through unique label IDs; item headings retain the selected h3/h4 level.
Unordered arrangements use a `ul` with `role="list"` and one `li` per item;
ordered arrangements use an `ol`. Grouped rows use a separate list in each
group. List items own responsive grid spans.

Link all items or none, up to six distinct normalized destinations. A linked
item has one title-named anchor; description, badge, meta and visual remain
outside it. Native controls, finite tabIndex targets (including -1), editable
content and controlled media are refused in every linked slot. Passive SVG
`use` and `image` href references are allowed under a literal `<svg>` in the
supplied element tree. Handlers, focus, editing and interactive descendants
still make those resources targets. A `foreignObject` resets SVG context;
a nested literal `<svg>` restores it. An opaque wrapper such as
`<SpriteIcon><use href="#mark" /></SpriteIcon>` does not establish that
context, even if it renders an SVG. Other SVG href carriers, including
`linearGradient`, `radialGradient`, `pattern`, `textPath`, `feImage` and `mpath`,
are conservatively refused; a refusal does not mean their references are
intrinsically interactive. The guard walks supplied arrays, fragments and
element children; it does not execute opaque components or inspect referenced
symbol shadow trees. Consumers must ensure referenced symbols contain no
interactive content. These supplied-tree limits also apply to NavGrid's
private linked plate list (LinkGrid) and Specimen status-row copy. Numeric zero is content
in every slot; optional whitespace-only copy is omitted. Stable IDs and
nonblank headings are required.

NavGrid preserves its published frames, counts and presence rules through
the shared item renderer and retains ownership of its Button controls. Public Item and Items do not expose those
private policies.

`Items` keeps source reading order and accepts `order="none"` (the default),
`"numbered"`, or `"connected"`. Numbered items use ordered-list semantics;
numbering continues across labelled groups in their rendered membership order.
Connected items take three to five steps in columns or a stack, with longer
stacks available for three or four lanes as described below. Four steps
without lanes are accepted with a warning; four with lanes produce no count
warning. Connected columns keep the authored two- or
three-column layout, including an incomplete final row.

Connected items can take `end="ends"` (the default) or `"continues"`, optional
`endLabel`, and a caption when at least one item has a visual. The terminal comes
after the final step. A continuation without an authored label is decorative;
empty labels are omitted. End fields, captions, and lanes belong to connected
order.

Supply lane definitions as a readonly array of `{ id, label }` entries and
give every step its lane ID. Two actors allow connected columns or a stack of
three to five steps. Three actors allow a connected stack of four to six steps;
four actors allow a connected stack of five to eight steps. The first step
uses the first defined lane, every lane appears, and each reference matches a
definition. The existing limit of six linked items also applies to lanes.

Three- and four-actor stacks show one ordered list with an authored lane chip
before each heading below `tablet-lg`. From `tablet-lg`, a lane-label column
and one column per step form a grid with numbered markers, hairline elbow
connectors and an end marker. Step reading order stays the authored item order
at every width. Lane labels remain available to assistive technology in the
grid. If an authored label contains a link, its step chip becomes visible
when that link receives keyboard focus.

`reveal="all"` is the default. `reveal="disclose"` takes four to six rows with
descriptions and supports numbered order and labelled groups. Disclosed items
cannot take item `href`s, visuals, or connected order. Heading, icon, eyebrow, meta,
and badge-label content must be phrasing content without authored controls;
answers can contain links and other controls. Supplied native elements are
checked recursively, while opaque component output is not executed by the
guard. The ordinary entry uses independent disclosures; the server entry uses
independent native details. Both start closed and retain their answer content.

Items accepts the standard optional `aria-labelledby` string to name its actual list from an authored heading outside the collection. Grouped inner lists are named by their own group label; the external reference names ungrouped lists. `ItemsLane` is exported with the Items types.

### `FeatureGrid`

```tsx
import { FeatureGrid } from "@clossys/designer/blocks";

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
treatment `NavGrid` gives its icons. Item titles are paragraphs; the optional
collection heading uses `headingLevel` (default `2`). The published grid keeps
arbitrary item counts and its automatic one-column, tablet two-column and
desktop three-column layout. `ground` uses the shared section-ground contract.
Use `Items` for authored columns, treatments, statements, links and visuals.

### `OrderedStepSequence`

```tsx
import { OrderedStepSequence } from "@clossys/designer/blocks";

<OrderedStepSequence
  heading="How it works"
  items={[
    { id: "discover", ordinal: "01", label: "First", heading: "Discover", description: "Understand the need." },
    { id: "decide", ordinal: "02", label: "Second", heading: "Decide", description: "Choose a path." },
  ]}
/>
```

An editorial `<ol>`, not a stepper or progress indicator. Each ordinal remains
authored text, while decorative connectors are hidden from assistive technology
and render only between adjacent items. The sequence changes from a vertical
column with a rail running from one ordinal down to the next to a horizontal
row with a hairline running from one ordinal across to the next at `tablet`;
the connector is `line-strong`, so it stays visible in light and dark
schemes. The ordinal is a 32px disc in the accent tint with an
`accent-text` numeral (an inverse-line ring with on-inverse ink on an
inverse band). Step headings use `text-body-l`, body font and medium weight, the
`label` above as a small tracked label and the description at `text-body`;
Set
`ground="sunken"` or `ground="inverse"` selects the shared matching painted
surface, ink, border, and connector policy. Base inherits its surrounding
surface. `headingLevel` controls the real heading
elements (default `2`). `eyebrow` is the same optional label slot `Hero` and
`FeatureGrid` ship, rendered above the heading when supplied.

Each item's optional `label` is its actor tag, set above the step heading.
Ordinals remain authored strings or numbers. Use connected `Items` for lanes,
visuals, item destinations, captions and explicit termination.

### Scene

A static figure for a process or provenance story, accepted by the existing
`ContentSection.media` React-node slot. `converge` brings three-to-eight
documents into one record; `evidence-trail` traces a result to two-to-four
cited documents; `approval-chain` brings two-to-four findings through a review
node to one decision and a named role. Exactly one finding is the subject.

Import `Scene`, `layoutScene`, `sceneRelationText` and their types from
`@clossys/designer/blocks` or `/blocks/server`. Supply an explicit `input.seed`,
a separate caller-unique `id`, an authored figure `label`. Optional `relationLabel` names row source lists.
Reuse the seed across instances for the same geometry; each instance needs its
own id. `sample` is an authored caption. Figure labels accept React nodes; data copy is plain text. Input accepts no
coordinates, CSS, markup or classes. Invalid counts throw `RangeError`;
invalid structure, dangling relations and unwired sources throw `TypeError`.
Converge sources require one or two relations each, at most twelve total.

`layoutScene` is pure and needs no measurements. SVG is decorative; complete
linear HTML carries every source, origin, citation, status and subject path at
all widths. Only SVG titles are shortened to fit the drawing; linear copy stays
complete. The drawing appears at container widths of 800px, 520px and 900px for
converge, evidence-trail and approval-chain, capped at 880px, 560px and 1000px.
Below those thresholds the linear form is capped by `--ui-scene-card-w`
(default `30rem`). At desktop widths the HTML is clipped, never removed.

Documents remain flat. Seeded disorder controls horizontal nudge, defaulting
to medium for converge and low for the other templates; none produces zero
nudge. `--ui-scene-card-w` is structural and non-brandable; brand overrides
are refused. Wire anchors follow each document's right-edge midpoint.
All paints and radii read live theme tokens. A converge relation may
have one emphasis accent; approval-chain uses primary ink for its subject and
reserves its sole accent for the decider ring. Scenes have no controls, hooks,
script, animation or focus stops.

### AnatomyCallouts

A static specimen panel with numbered markers and an ordered explanatory key.
Supply a unique instance `id`, the figure `label`, its `panel`, three to five
`markers`, and the authored `keyLabel`. Prefer three or five markers. Each
marker targets the panel title (`header`), one labelled part id, or `footer`,
in that reading order. Duplicate ids, duplicate targets and reordered markers
throw `TypeError`; unknown targets or targets without label lines throw
`RangeError`, as do counts outside three to five.

`legendSide="end"` is the default: figure then key below 1024px, an 8:4 grid
from 1024px. `legendSide="below"` keeps the key below at the prose measure.
Each key row composes the public `Item` at its standard text scale.
Key headings use `headingLevel` 3 by default, or 4. `ground` selects base,
sunken or inverse key colors. Pass authored sample disclosure as the `sample`
caption whenever the panel contains illustrative figures. Labels accept React
nodes and derive accessible names from rendered content, with no English
fallback. The component is exported from blocks and blocks/server.

`SpecimenPanel` also accepts optional rendering-only `markers`, a target-to-
number map. They sit first inline on the title, labelled part or footer line;
unmarked panels keep their existing markup. Both components remain server-safe.


### RecordLedger and item visuals

RecordLedger shows one record in a named figure with `form="record"`.
Record groups contain one-to-six rows or a final owner;
one-to-three groups are allowed. Multi-column records have one group per column.
Provide a unique caller `id` seed for each record instance, even with identical
data. The component generates length-prefixed DOM IDs for the figure, head and
groups from that seed; the figure does not use the raw caller `id`:
the title and group heading IDs derive from it. `headingLevel` is 3 or 4.
Record titles and captions require visible content: blank
strings, booleans and empty recursive arrays are rejected; numeric zero is valid.

Two columns are stacked below 768px and equal from 768px. Three columns become
two plus a full-width third at 768px, then three from 1024px; a final owner gets
4/4/3 shares, otherwise the columns are equal. All native margins and list
padding are reset by these components. Motion is static, including reduced motion.
RecordLedger does not reveal on scroll. Inverse-ledger
status labels use inverse primary ink for normal-text contrast; glyph colors and
shapes remain the existing status marks. Other grounds retain toned label ink.

A record flag needs caller-owned `flagLabel` copy; at most one row may be
flagged. Use a `SpecimenPanel` status-rows part for a compact item visual.
`mobileRows={3}` retains all rows and hides later rows only below tablet.
Status-row labels, details and status copy reject native interactive nodes in
their own supplied content, including when the panel is inside a linked Item.

```tsx
import { Items, SpecimenPanel, RecordLedger } from "@clossys/designer/blocks/server";

function LedgerExample() {
  const rows = [
    { id: "one", label: "Record one", detail: "Due tomorrow", status: { tone: "neutral" as const, label: "Open" } },
    { id: "two", label: "Record two", detail: "Received today", status: { tone: "success" as const, label: "Received" } },
  ];
  return <>
    <RecordLedger id="example-ledger" form="record" head={{ title: "Review record" }} groups={[{ id: "checks", label: "Checks", rows }]} caption="Sample data." />
    <Items arrangement="bento" treatment="rule" items={[
      { id: "one", heading: "Review records", span: "two-thirds", href: "/records", visual: <SpecimenPanel parts={[{ id: "checks", type: "status-rows", label: "Sample records", items: rows }]} /> },
      { id: "two", heading: "Review guidance", span: "third", href: "/guidance" },
    ]} />
  </>;
}
```

### `Tree`

```tsx
import { Tree, type TreeNodeData } from "@clossys/designer/blocks/server";

function OrganizationTree() {
  const nodes: TreeNodeData[] = [
    { id: "organization", heading: "Organization", description: "Sample structure." },
    { id: "research", parent: "organization", heading: "Research", edgeLabel: "Includes", figure: { value: "4", delta: "+1", trend: "up" } },
    { id: "operations", parent: "organization", heading: "Operations", edgeLabel: "Includes", status: { tone: "info", label: "Forming" } },
  ];
  return <>
    <h2 id="organization-structure">Organization structure</h2>
    <Tree nodes={nodes} labelledBy="organization-structure" />
  </>;
}
```

`Tree`, `TreeProps` and `TreeNodeData` are exported from
`@clossys/designer/blocks` and `@clossys/designer/blocks/server`.
Tree is a passive nested list of 3–12 nodes. Nodes carry Item's `id`, `heading`,
`description`, `eyebrow`, `meta`, `figure`, `status` and `badge` slots, plus a
`parent` id and optional authored `edgeLabel`. Omit `parent` on one root.
Parents must exist, ids must be unique, and cycles are refused. Siblings keep
their source array order even when supplied before their parent. Root headings
are h3; other nodes are h4. Edge labels appear before their child headings;
provide content for every sibling or none. The root has no incoming edge.

| Blocks export | Kind | Contract |
| --- | --- | --- |
| `Tree` | component | Passive nested Item tree with validated parent relations, responsive right/down diagrams and a print list. |
| `TreeProps` | type | Nodes and optional orientation (`right` or `down`), labelledBy, ground and className. |
| `TreeNodeData` | type | Item id, heading, description, eyebrow, meta, figure, status and badge slots, plus parent and edgeLabel. |

Leaves have no children. Other parents have 2–4 children, with up to six at
the root. `orientation="right"` is the default: at most three edges from root
to leaf and eight leaves. `orientation="down"` allows two edges and six nodes
at each depth. The root is depth zero. `ground` is `base` (default), `sunken`
or `inverse`; `className` extends the outer list. `labelledBy` refers to an
existing external heading; Tree adds no fallback label or generated ids.

Below `tablet-lg`, nodes form an indented list with a hairline at each level.
From `tablet-lg`, right trees share depth columns with parents centred beside
their children; down trees share centred rows. Nodes become ground-relative
plates and pseudo-element elbows show relations. Print restores the indented
list. The nested list and authored reading order are retained in each layout;
there is no interactive tree role, disclosure, navigation or focus target.

Individual nodes reuse Item's figure, trend and status validation. A trend
needs an authored signed delta, and status cannot accompany a badge on the
same node. Other nodes may omit figures. `href`, `visual`, `icon` and retired
`featured` are outside this block's node contract. Supplied native controls,
focus attributes, editing and event handlers are refused in node and edge
content. Opaque component output is not inspected; callers must keep that
output passive too.

### `Matrix`

```tsx
import { Matrix } from "@clossys/designer/blocks";

<Matrix
  sides={[
    { id: "first", label: "First option", heading: "A shared record", points: ["One source", "Clear dates"] },
    { id: "second", label: "Second option", heading: "A shared view", points: ["One view", "Clear owners"] },
  ]}
  featured="second"
/>;
```

The omitted `arrangement` and `arrangement="sides"` render two sides on equal
`Card` plates. Each side has a distinct,
whitespace-free `id`, an optional `label` rendered as a caption paragraph, and a
required `heading` rendered at the selected semantic heading level. Label both
sides or neither; mixed label presence is refused. Supply the same primary form
on both sides: two to
four points with equal counts, or a visual. An optional description supplies
lead copy alongside points or a visual; description alone is refused. Points
and visuals cannot be combined. Optional description rows stay aligned when
only one side has supporting copy.

`featured` names one side's id and adds the accent top rule without changing
reading order or either plate's fill. `headingLevel` defaults to `3`; `ground`
defaults to `base`. Sides stack below `tablet`, or `tablet-lg` when they carry
visuals, then share subgrid rows for aligned copy and visuals. All styling uses
the existing plate, ground, typography and accent tokens. Server-safe.

Use `arrangement="grid"` for a comparison with two to six columns and two to
eight rows:

```tsx
import { Matrix } from "@clossys/designer/blocks/server";

<Matrix
  arrangement="grid"
  aria-label="Record comparison"
  columns={[
    { id: "record", label: "Record" },
    { id: "count", label: "Count" },
    { id: "state", label: "State" },
    { id: "coverage", label: "Coverage" },
  ]}
  rows={[
    {
      id: "current", label: "Current record", description: "The latest authored view.",
      cells: {
        record: { type: "text", text: "Reviewed record" },
        count: { type: "figure", value: "2,481", delta: "+12%", trend: "up" },
        state: { type: "status", tone: "success", label: "Reviewed" },
        coverage: { type: "mark", value: 3 },
      },
    },
    {
      id: "previous", label: "Previous record",
      cells: {
        record: { type: "empty" },
        count: { type: "figure", value: "2,200", delta: "-3%", trend: "down" },
        state: { type: "status", tone: "warning", label: "Needs review" },
        coverage: { type: "mark", value: 1 },
      },
    },
  ]}
  featured={{ column: "count" }}
  featuredLabel="Selected measure"
  emptyLabel="No authored value"
  markLabels={["None", "One quarter", "Half", "Three quarters", "Full"]}
  keyLabel="Coverage key"
/>;
```

Column and row ids are distinct and whitespace-free within their axis; each row
has its label, optional description, and a `cells` record containing every column
id with no extra key. Cells use `type: "text"` with authored `text`, `"figure"`
with `value`, optional signed `delta` and `trend` (`up`, `down`, `neutral`),
`"status"` with a StatusMark `tone` and visible `label`, `"mark"` with a `value`
from `0` through `4`, or `"empty"`. Each column
contains one type among its non-empty cells. Figures align to the inline end and
use tabular numerals; a supplied trend requires a delta. Empty cells voice the
authored `emptyLabel`, required when any cell is empty and omitted otherwise.

Mark cells show a 16px Harvey circle with zero to four filled quarters, using
geometry to retain the distinction in greyscale and print. Supply five meaningful
`markLabels`, ordered from zero through four, and a meaningful `keyLabel` when
any cell is a mark; omit both otherwise. Each cell voices its matching label
through screen-reader-only text. A visible list below the table shows all five
marks with their authored labels under the key heading. The SVG is decorative;
the words carry the meaning. Its ring uses the hairline token and secondary ink,
and its quarters use primary ink for the selected ground.

`featured` selects one `{ row: id }` or `{ column: id }`, adding a hairline accent
rule and a Badge to that header. Supply meaningful `featuredLabel` when a target
is featured, and omit it otherwise. The grid forwards native table attributes,
including authored `aria-label` or `aria-labelledby`; it supplies no English
labels. Row labels use `headingLevel` (default `3`), and `ground` supports the
same three grounds as sides.

One semantic table retains explicit table, row, header and cell roles and header
scopes at every width. Up to four columns use table layout from `tablet`; five
or six use `tablet-lg`. Below that breakpoint, rows become cards with a heading
and visible column labels. Those repeated inline labels are hidden from assistive
technology; the real column headers remain visually hidden and accessible.

### `Specimen`

```tsx
import { Specimen } from "@clossys/designer/blocks/server";

<Specimen
  label="An order record with its delivery fields, two checks and the stock level against its floor."
  panels={[
    {
      id: "order",
      title: "Order 1042",
      meta: "Placed 1 March",
      status: { tone: "info", label: "Open" },
      parts: [
        {
          id: "fields",
          type: "fields",
          items: [
            { id: "qty", label: "Quantity", value: "240 units" },
            { id: "due", label: "Due", value: "12 March" },
          ],
        },
        {
          id: "checks",
          type: "status-rows",
          label: "Checks",
          items: [
            { id: "count", label: "Stock count", status: { tone: "warning", label: "In progress" } },
            { id: "labels", label: "Labels printed", status: { tone: "success", label: "Done" } },
          ],
        },
        {
          id: "stock",
          type: "meter",
          label: "Stock level",
          value: 38,
          scaleMax: 100,
          limit: 25,
          direction: "min",
          tone: "success",
          valueText: "38 units",
          limitText: "floor 25",
        },
      ],
      footer: { assignee: { initials: "AL", name: "Alex Lane", note: "owner" } },
    },
  ]}
/>;
```

Native product-UI evidence for a marketing band, in place of screenshots
and iframes: a `<figure>` named by the required `label` (its
`aria-label`: what the specimen shows, 12 to 25 words, no claims), holding
1 to 3 `SpecimenPanel`s built from atoms and tokens and rendered on the
server. Every word and number arrives through props, so the specimen is
real text, the size of its content, and reflows at 390px.

`arrangement` (`SpecimenArrangement`) is `"single"` (the default, exactly
one panel), `"row"` (two or three panels side by side from `tablet`, three
across from `desktop`: put a row of three in a stacked band, not in a
split's visual column), `"stack"` (one column) or `"flow"` (one column
joined by a hairline connector; `connector` is the short caption after the
first panel, allowed only with `flow`). A `SpecimenPanel` is the `Card`
outline lifted by the panel elevation (raised fill, one panel edge,
`rounded-panel`, the `--ui-elevation-panel` shadow, which defaults to
`--ui-elevation-floating`), so it reads as
product UI on a stage: a title row (`title` at `text-body-l`, `meta`,
`status`, optional `badge`), 1 to 3 `parts` and an optional `footer` (an assignee's initials
on an accent-tint disc beside their name, a note), each separated by a
hairline. Body text is `text-body`, labels and secondary lines
`text-body-s`; part labels are sentence case. Badge labels use the atom's
`text-caption` scale. Secondary lines use secondary ink, which holds AA
on the raised fill. A badge has an authored
`label` and optional existing Badge `tone`: neutral (the default), success,
warning, danger or info. It can appear alongside the state or name a header
on its own. Empty labels and unsupported tones are refused.

The figure and each panel are size containers (`@container`), so a panel
responds to its own width, not the viewport's: padding is `p-lg`, `p-xl`
via `@md:p-xl` once the panel reaches 28rem; a table is a stacked record until
`@md:table` applies at 28rem; four field columns use `@lg:grid-cols-4` at 32rem. A panel in a third-width
card or a split column therefore keeps the narrow layout even on a wide
screen.

Parts (`SpecimenPart`, by `type`): `"fields"` (a `<dl>` in 1, 2 or 4
columns, default 2, with `@lg:grid-cols-4` only at container widths of 32rem or more); `"status-rows"`
(a `<ul>` of label, detail and `StatusMark`; optional `mobileRows: 3` hides
later rows below the 768px viewport breakpoint while retaining them in the
DOM); `"meter"` (the `Meter` atom
at `emphasis="figure"`, the value as the panel's focal number, with its
label, state and note, forwarding optional paired `previous`/`previousText`
to the same Meter); `"table"` (a real `<table>` of at most 4
columns and 5 rows with a visually hidden `caption`; below the 28rem
container width required by `@md:table` each row reflows to a stacked record of label/value pairs, with explicit table
roles so the semantics survive the display change); `"schedule"` (an
`<ol>` of dated rows on a hairline rail); `"shares"` (names with a
percentage `Meter` on a scale of 100, in the accent, or in the share's
`status` tone when it has one); `"files"` (a mono format tag, a
name and a source).

Static by design: no link, button, input, hover state or focus stop, no
internal or horizontal scroll, and no `ground` prop: specimens never sit
on an inverse band. Budgets are validated and throw rather than crowd the
panel: 3 panels, 3 parts per panel, 6 rows per part, a 4 by 5 table with
one cell per column, shares from 0 to 100, and a non-blank `label`
(`TypeError`).

A specimen resets its own user-agent spacing (`m-0` on the figure,
paragraphs, `<dl>`/`<dd>` and lists, `p-0` on lists and table cells), so it
renders the same with or without a CSS reset; its list rows are flex boxes,
so no marker shows either way.

### `StatusList`

```tsx
import { StatusList } from "@clossys/designer/blocks";

<StatusList
  legendLabel="Status"
  labels={{ available: "Available", partial: "Partial", planned: "Planned", dispositions: { "not-offered": "Not offered" } }}
  groups={[
    { id: "coverage", heading: "Coverage", items: [{ id: "reports", label: "Reports", state: "available" }] },
  ]}
/>
```

A grouped `<dl>` for editorial readiness statements and deliberate
non-capabilities, with one section-level legend whose required `legendLabel`
is caller-localized, visible, and names the semantic legend list. The readiness
axis is closed to `available`, `partial`, and `planned`; dispositions are
separately closed in the `dispositions` map. Use the `not-offered` disposition only for a
deliberate non-capability outside the readiness axis, not as another degree of
readiness. The block maps those values to semantic tones rather than accepting
a color. The dot is
decorative and its adjacent state text remains ordinary reading text, so color
never carries the meaning alone.
`ground` uses the shared closed section-ground contract above, including the
ground-appropriate status-dot boundary. A row may carry an optional `detail`,
its own explanation, which renders as a second description of the same row so
the explanation stays inside the definition-list semantics rather than merely
sitting near them. `eyebrow` is the same optional label slot `Hero` and
`FeatureGrid` ship; a block given neither an eyebrow, a heading, nor a
description renders no heading region at all, exactly as before.

`groups` is optional; provide it or the sibling `items` prop, never both.
`items` is a flat array of the same row shape with no group at all — the
common shape for a short list with nothing to group — rendered as a single
`<dl>` with no group heading. A caller using `groups` sees no rendering
change from `items` existing.

### `Faq`

```tsx
import { Faq } from "@clossys/designer/blocks";

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

**Built on react-aria-components' own `Disclosure`/`DisclosurePanel`, one
per item** — the primitives the `Disclosure` atom wraps, with the same
accessibility contract (real `aria-expanded`/`aria-controls` wiring,
Enter/Space-and-click toggling, collapsed content kept in the DOM rather
than unmounted). `Faq` composes them directly so each row takes the FAQ
recipe, shared with the server implementation: the whole row is the hit
area (full width, generous vertical padding), the question sits at the
`body-l` step, a Designer `ChevronDown` at the row's end turns half a turn
when open (no transition under reduced motion), and the answer wraps at
the prose measure. Questions sit between ground-matched hairlines, and
the trigger carries the package-standard focus-visible outline. The
server implementation hides `summary`'s native marker so the chevron is
the one open/closed cue. The answer's height eases open and shut, CSS
only, on the motion tokens and instant under reduced motion: the server
rows ease `::details-content` (`details-motion`; a row must stay in block
flow, since a flex `details` does not ease its content height), the client
rows ease React Aria's `--disclosure-panel-height`
(`disclosure-panel-motion`). Each pair expands and collapses
INDEPENDENTLY — `Faq` holds no shared "which one is open" state and
renders no `DisclosureGroup`, so opening one question never closes
another, unlike a coordinated accordion.
Both implementations accept the same shared `ground` values and apply the
matching surface policy, question/answer foregrounds, and dividers. Base
inherits the ambient surface; sunken and inverse paint their own surfaces.
Both also accept the same optional `eyebrow`, the label slot `Hero` and
`FeatureGrid` ship, rendered above the heading when supplied.

### `PricingTable`

```tsx
import { PricingTable } from "@clossys/designer/blocks";
import { Button } from "@clossys/designer/atoms";

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
import { Testimonial } from "@clossys/designer/blocks";

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

### `SectionFrame`

```tsx
import { ArticleBody, SectionFrame, Stat } from "@clossys/designer/blocks";

function MarketingChapter() {
  return (
    <SectionFrame ground="base" measure="prose">
      <ArticleBody>
        <h2>Section heading text</h2>
        <p>Body copy goes here.</p>
      </ArticleBody>
    </SectionFrame>
  );
}
```

Full-bleed marketing section band: `ground`, horizontal page padding,
vertical section rhythm, and a measured inner column (`content`, `wide`,
or `prose`). Compose `ArticleBody`, `Stat`, and other blocks that do not
own their own band inside this — not a host `className` wrapper.

### `ArticleBody`

```tsx
import { ArticleBody, SectionFrame } from "@clossys/designer/blocks";

function ArticlePage() {
  return (
    <SectionFrame measure="prose">
      <ArticleBody>
        <h2>Section heading text</h2>
        <p>Body copy goes here.</p>
        <ul>
          <li>List item text</li>
        </ul>
      </ArticleBody>
    </SectionFrame>
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
`@clossys/publisher` instead.

Measure and section padding come from the parent `SectionFrame` (`measure="prose"` for long-form copy). This component only applies typography. A page can hold two `ArticleBody`s (a main
article plus a sidebar callout, or two comparison columns), which is what
keeps it at this layer rather than being a view (test 3).

### `AccountMenu`

A Navigation Material combining Avatar, Button, Icon, Tooltip and Menu. The host
supplies `actor.name`, optional `secondaryText` and `image`, `contextLabel`, and
`sections`. Avatar derives fallback initials from the name. Expanded triggers
show the name and context; collapsed triggers show the avatar, keep an explicit
accessible name, and expose a tooltip. A non-empty `triggerLabel` overrides only
the collapsed trigger and tooltip. Expanded controls retain the visible actor
name in their accessible name. The open menu shows and truncates long actor
details within a viewport-bounded panel. Later unnamed command sections use
separators without repeating the actor as a group name.

Command sections contain `link` (`href`), `action` or `destructive` (`onAction`)
entries. Preference sections use `kind="preferences"`, a required `label`, and
`preference` entries with `checked` and `onCheckedChange`. Each entry also takes
an `id`, `label` and optional `isDisabled`. Duplicate section IDs (including empty
sections) and duplicate entry IDs within a section are rejected with `TypeError`.
Equal entry IDs in different sections remain valid. Empty sections are omitted; an empty
menu renders no trigger or placeholder. Preference changes remain controlled and
keep the menu open. Links and actions retain ordinary menuitem semantics.
Empty actor names or entry labels are rejected. Destinations follow Items: an
anchor, one-origin path, HTTP(S) URL without credentials, or explicit mail link;
blank, protocol-relative, script/data, control-character and backslash URLs are
rejected. Images remain host-provided Avatar data. Destructive styling does not
confirm an action: the host owns confirmation and the final destructive effect.

`onClose` observes a menu close and `onRoute` observes a link activation. A drawer
host removes or hides its navigation, then focuses its visible opener or route
destination after that update commits; the block does not own the drawer. Normal
Escape focus return and collision-aware placement use Menu's overlay machinery.
This is a client component: SSR emits a closed trigger and hydration enables
interaction. It is not exported from `blocks/server`. Tests cover synthetic
viewport geometry, normal and forced-color focus, reduced-motion transitions,
long actor details, retained hidden-host handoff, and client hydration;
they do not establish a separate native server or browser-qualification claim.

### `ConsentBanner`

```tsx
import { ConsentBanner } from "@clossys/designer/blocks";
import { Link } from "@clossys/designer/atoms";

function PageConsent({ onAccept, onReject, status }: { onAccept: () => void; onReject: () => void; status?: string }) {
  return (
    <ConsentBanner
      title="Banner title"
      body="Banner body text."
      acceptLabel="Accept label"
      rejectLabel="Reject label"
      onAccept={onAccept}
      onReject={onReject}
      privacyLink={<Link href="/privacy">Privacy link</Link>}
      status={status}
    />
  );
}
```

A presentational consent notice, and nothing more: it holds no consent
state, reads or writes no storage, and makes no network call. The consumer
decides what `onAccept` and `onReject` do, whether to render it at all, and
where it sits. The default `presentation="banner"` renders in flow;
`presentation="card"` pins a compact card to the bottom edge. All copy arrives through props
(`title`, `body`, `acceptLabel`, `rejectLabel`, and an optional
`privacyLink` slot (after the body in the default banner), and an optional `status` line), so
this package ships no wording of its own.

`status` renders inside a polite live region (`role="status"`,
`aria-live="polite"`) placed after the body and before the actions. The
region is always mounted and empty while `status` is absent, so a status
passed later is announced rather than inserted with its region. It is
presentation only: neither button is ever disabled, accept and reject stay
the same variant and size, and the block still holds no consent state.

The root is a `<section>` named by its own title heading, so assistive
tech announces it as a region landmark. It is deliberately not a dialog: no
`role="dialog"`, no `aria-modal`, no autofocus, no focus trap, no Escape
handling, no portal and no timer, so keyboard users move past it with Tab
like any other content. Accept and reject are both `Button` atoms with the
same `variant` and `size`, which gives the two choices equal prominence
(rejecting is a button, not a link). No form control renders inside it.

The default banner uses `bg-overlay-surface`, `border-overlay-border` and ink
tokens only, so it is opaque. Its actions stack at full width at the base size
and sit in a row from the `tablet` breakpoint; the content width is capped
with `max-w-display` from `tablet-lg`. The root carries `data-consent-banner`,
a stable selector the consumer can pass in `overlayIntersectingFold` when the
banner is positioned over the page. If you pin the banner to the bottom
visually, render it early in DOM order so keyboard and assistive-tech users
reach it without tabbing through the whole page first.

The opt-in card floats on the notice layer (`--ui-z-notice`), above the
shell header and footer. Below tablet width it fills the viewport less
safe-area gutters, centred; from tablet width it is capped at the notice
width (`--ui-width-notice-max`) and sits at the bottom inline start. Its
plate is the base surface at 90% with the notice backdrop blur
(`--blur-notice`), a hairline in the base line colour and the raised
elevation; unsupported backdrop filters use the base surface at 95%, reduced
transparency uses an opaque plate, and forced colours use system colours.
Its only motion is a short background and blur transition, removed under
reduced motion. Long copy can wrap and scroll within the viewport. The title
stays as a visually hidden heading that names the region. The policy slot is
inline with the body, and both choices fill a two-column row as full-width
tap targets whose labels may wrap. Pass `selectedChoice="granted"` or `"denied"` from
host state to show a decorative check and `aria-pressed`; the component
stores no choice. The live region stays mounted in either presentation.

### Composing chrome and blocks

Marketing/site chrome (`shell`) and marketing content blocks compose
cleanly — `shell` and `blocks` are independent sibling layers built on
`atoms`, neither depending on the other (see "Package structure" above),
so a real page just renders both together:

```tsx
import { SiteHeader, SiteFooter } from "@clossys/designer/shell";
import { Hero, FeatureGrid } from "@clossys/designer/blocks";
import { Button, Link } from "@clossys/designer/atoms";

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
`@clossys/publisher/web`. UI stops at reusable primitives; Publisher owns
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
// ErrorView is exported by @clossys/publisher/web.
import { Button } from "@clossys/designer/atoms";

function ServerErrorPage() {
  return (
    <ErrorView
      status={500}
      title="Something went wrong"
      description="We couldn't load this page. Error: 8f2a91c0."
      action={<Button onPress={() => retry()}>Try again</Button>}
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
A diagnostic reference (a request id or correlation id) is part of the
message: put it in `description` as caller copy, for example `"Something went
wrong. Error: 8f2a91c0."`, so it is visible without opening anything. `action`
holds ONE primary control; a secondary destination (a support page, a status
page) is a text link inside `description`, not a second button.

### `DetailView`

```tsx
import { DetailView } from "@clossys/designer/blocks";
import { Badge, Button } from "@clossys/designer/atoms";

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
// AuthView is exported by @clossys/publisher/web.
import { Link } from "@clossys/designer/atoms";

function SignInPage() {
  return (
    <AuthView
      brand={<img src="/logo.svg" alt="Acme" />}
      heading="Sign in"
      description="Welcome back."
      form={<MyProductsOwnSignInForm />}
      secondaryAction={<Link href="/request-access">No account? Request access</Link>}
      footnote={<>By continuing you agree to our <Link href="/terms">Terms</Link>.</>}
    />
  );
}
```

A full-page authentication shell — sign-in, sign-up, password reset, email
verification. In order: a site header (`SiteHeader`, holding the required
`brand`), a page header (`heading` plus the required `description`), a card
(built on `atoms/Card`) holding only the `form` slot, the `secondaryAction`
lines below the card, an optional `footnote`, and a site footer (`SiteFooter`, fed by
`footerSecondary`). `heading` (required) renders as the page's `<h1>`;
`description` (required) renders directly under it, so every step decides on
a supporting line; `form` (required) is rendered exactly as given, with no
wrapper (the one exception is `isDisabled`: when the sign-in provider is
unavailable, `form` renders inside a disabled `<fieldset>` so the form stays
on screen with what the person typed still shown, the one notice is the
form's own `submitError`, and a retry link in `secondaryAction` stays
enabled). The content column is held to the `--ui-width-form-max` form
measure (`38rem`). The view prints no developer text; a missing sign-in
provider setting is reported in the server log, not on the page. An auth
page's `footerSecondary` holds a legal row only,
never a locale switcher, because auth pages are single-locale.
`secondaryAction` is always the site's copy, and an invitation or activation
step never offers request-access or sign-up; the view has no mode and no
`requestAccess` prop, so each site's activation-page test should assert no
request-access or sign-up link. Pass each `secondaryAction` line as one
element: the lines stack in a column, so text plus a link in one fragment
splits onto two lines.

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

`AuthView` also ships no `BrandLockup` — `brand` is required and supplied by
the caller, for the same reason `Shell` ships no `SiteHeader`/`AppHeader`
(see "Shell" below): a brand mark is per-product, and a pre-built one would
recreate the `mode`-prop failure one layer up.

### `Pagination`

```tsx
import { Pagination } from "@clossys/designer/blocks";
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
current page. The previous/next controls' own accessible names default to
`"Previous page"`/`"Next page"` and are independently overridable via
`previousPageLabel`/`nextPageLabel` — for localization, or to disambiguate
several `Pagination`s on one page the same way `aria-label` does for the
surrounding `<nav>`.

Omit `totalItems`/`pageSize` for a plain "Page X of Y" range summary;
provide both for "Showing 11–20 of 42".

### `Stat`

```tsx
import { Stat } from "@clossys/designer/blocks";

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
// Your Next.js app's root layout (the "layout.tsx" file in the App
// Router's "app" directory)
import { Shell } from "@clossys/designer/shell";
import { Link } from "@clossys/designer/atoms";

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
import { PageHeader } from "@clossys/designer/blocks";

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
navigation to that route's actual content. `skipLinkLabel` is that link's
visible text and defaults to "Skip to content". Activating it (click, Enter
or Space) moves focus to `Shell.Main` and scrolls it into view without
changing `location.hash` or browser history, so an application that keeps its
route in the URL fragment stays on its current route. Without JavaScript the
link falls back to its `href`.

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
  <Shell.Header><MemberAccountControl /></Shell.Header>
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

`MarketingNav`, `MemberAccountControl`, `MemberNav`, `StaffToolbar`, `StaffNav`, and
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

### Site chrome: `SkipLink`, `SiteHeader`, `NavDisclosure`, `NavShell`, `SiteFooter`

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
// Your Next.js app's root layout (the "layout.tsx" file in the App
// Router's "app" directory)
import { NavShell, SiteFooter, SiteHeader, SkipLink } from "@clossys/designer/shell";
import { Link } from "@clossys/designer/atoms";

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
text (`children`) as props — `Shell` renders this same component, wired to
`Shell.Main`'s own fixed, package-owned id, whereas a site's own page
structure decides what "content" means, so this version assumes nothing
about where it points. Give the target element a matching `id` and
`tabIndex={-1}` (a plain `<main>` isn't natively focusable). Activation
(click, Enter or Space) is focus-only: it focuses the target, which scrolls it
into view, and cancels the anchor's default navigation, so `location.hash` and
history are left alone and a hash-routed application keeps its route. The
`href` remains as the fallback when JavaScript is unavailable, for a modified
or non-primary click (open in a new tab), when the target is not in the
document, and when the target cannot take focus (for example it lacks
`tabIndex={-1}`), so the link still scrolls there. Because the fragment is no
longer updated, the target no longer matches `:target` and no history entry is
added; this applies to the public `SkipLink` as well as the one `Shell` renders.

`SiteHeader` renders a real `<header>` — the page's `banner` landmark,
provided it sits at the top level rather than nested inside `<main>`/
`<article>`/`<aside>`/`<nav>`/`<section>` (nesting strips the implicit
role per the HTML/ARIA spec, the same placement rule `Shell.Header` and
`Shell.Footer` already carry). Three slots that differ in kind — `brand`
(required), `nav`, `actions` — the same "Slots, not a `mode`/`variant`
prop" shape every block in this README already follows; see `SiteHeader`'s
own doc comment for why it's `shell`, not `blocks`, despite reading like a
`PageHeader`-shaped composition of named regions.

`navPlacement="centered"` and `mobileLayout="menu-brand-action"` are the
shared defaults. Equal side tracks center navigation on the whole header;
`NavDisclosure` measures intrinsic brand/link/action widths and collapses
before collision. Mobile centers the supplied mark on the whole bar, not on
the space left between the controls, with menu at inline-start and a supplied
primary icon or empty track at inline-end. The mobile brand hides wordmark
text only: a `Brandmark` mark stays visible (an image, a shared plate holding
an image, or an accent mark tagged `data-brand-mark`), and the link keeps its
`aria-label` as its name while the wordmark is hidden. The layout mirrors
in RTL. `secondaryAction` renders before `actions` in the trailing region.
Explicit `navPlacement="leading"` or `mobileLayout="inline"` retain legacy
positioning rather than the default geometry. DOM order remains brand, nav,
actions, and the header adds no brand symbol.

```tsx
<SiteHeader
  navPlacement="centered"
  brand={<Link href="/" variant="standalone">Acme</Link>}
  nav={
    <NavShell aria-label="Primary">
      <Link href="/products" variant="standalone">Products</Link>
      <Link href="/pricing" variant="standalone">Pricing</Link>
    </NavShell>
  }
  secondaryAction={<Link href="/sign-in" variant="standalone">Sign in</Link>}
  actions={<Link href="/pricing" variant="standalone">Pricing</Link>}
/>
```

`surfaceLabel` names the surface a staff or demo host serves, such as `"admin"`
or `"demo"`: a neutral `Badge` rendered last in the trailing region, after
`secondaryAction` and `actions`, in either placement. It is text only by type,
so no link, button or icon can be passed and it is never interactive; a member
host omits it.

```tsx
<SiteHeader brand={<Link href="/" variant="standalone">Acme</Link>} surfaceLabel="admin" />
```

`surfaceLabel` is superseded by environment links and stays for existing
callers. `SiteHeader.ActionLink` is one header call to action: a real
`<a>` with a `label` and an optional caller-supplied `IconNode` glyph. Without
an icon, the label is plain visible text at every width. With an icon, from the
`tablet` breakpoint up it shows the icon and the label; below it the label is
visually hidden and stays the link's accessible name, so the icon-only link
still announces its label. `isCurrent` sets `aria-current="true"` and adds
an underline-style inset rule, so the current link is not marked by colour
alone. The link is at least the layout tap target in both directions and
shows the accent focus outline. The package ships no hrefs and no copy: the
caller passes both. Pass one per environment in `actions`, with the brand
linking to the main site home.

```tsx
import { Home, Settings } from "@clossys/designer/icons";

<SiteHeader
  brand={<Link href="https://example.com/" variant="standalone">Acme</Link>}
  actions={
    <>
      <SiteHeader.ActionLink href="https://app.example.com/" label="App" icon={Home} isCurrent />
      <SiteHeader.ActionLink href="https://admin.example.com/" label="Admin" icon={Settings} />
    </>
  }
/>
```

`variant` takes `"primary"`, `"secondary"` (default) or `"ghost"`, the same
looks as `Button` at its small size. `ActionLink` is a server-safe component
from both `@clossys/designer/shell` and `@clossys/designer/shell/server`.

`placement` (`"flow"` by default) decides where the header sits. `"flow"` is
the header in normal document flow, unchanged from earlier releases.
`"overlay"` fixes the header to the top of the viewport over the first block,
taking no height in the document: transparent at the top of the page, then a
glass plate once the page scrolls beneath it. The glass is
`--color-surface-glass` (or `--color-surface-glass-inverse`) behind a
`--blur-glass` backdrop blur, over a hairline in the matching line role.

- `tone` (`"base"` by default, or `"inverse"`) sets the header's inherited
  ink (`ink-primary` or `ink-on-inverse`) and the matching glass, so the ink
  stays the same as the header turns to glass. Tones are theme-relative, like
  the tokens: `base` is dark ink on a light ground only in the light theme.
  In `"overlay"`, `ground` is not read.
- `tone` governs inherited ink only. A child that sets its own ink keeps it:
  `Link` in every variant (`standalone` is `ink-primary`, `default` is
  `ink-link`, `muted` is `ink-muted`), `Brandmark` (`ink-primary`) and
  `SiteHeader.ActionLink`'s `ghost` look (`ink-primary` with no plate). With
  `tone="inverse"` those read dark on dark glass. `ActionLink`'s `primary`
  and `secondary` looks carry their own fill, so they read on either tone.
- The contrast gate checks only the tone's own ink on the glass:
  `ink-primary` on `surface-glass` and `ink-on-inverse` on
  `surface-glass-inverse`. A child whose ink is exactly that token (with
  `tone="base"`, `Link`'s `standalone` look or `Brandmark`) is covered by
  those pairs. No other ink is checked on the glass, and the softer inks
  fall short of AA there: `ink-link` (`Link` `default`) and `ink-secondary`
  in the dark theme over a white backdrop, and `ink-muted` (`Link` `muted`)
  in both themes. Give header text the inherited ink (an `<a>` with
  `text-inherit`, as below) or a child that carries its own fill.
- Focus indicators inside the header take the tone's ink instead of
  `--color-accent`: the `--ui-ring-focus` ring (`Link`, `Button`) and the
  colour of every `:focus-visible` outline (`ActionLink`). Accent does not
  reach the 3:1 non-text floor on the glass (dark theme, base glass over a
  white backdrop: 1.55:1), and the gate checks the ring in the tone's ink
  on each glass at 3:1.
- `menuOpen` holds the glass at any scroll position while a menu belonging to
  the header is open (`data-menu-open`). A descendant with
  `aria-expanded="true"`, such as an open `NavShell` trigger, or an open
  `<details>` does the same in CSS with no prop.
- The glass state is a scroll-driven CSS animation over the first
  `--spacing-3xl` of root scrolling, so it needs no JavaScript. An engine
  without scroll-driven animations shows glass at every scroll position.
  Reduced motion replaces the fade with a single step at the first scroll.
  Reduced transparency, or an engine without backdrop blur, replaces the
  glass with the opaque `surface-raised` (or `surface-inverse`) plate. Only
  paint changes between states, so the header never shifts layout.
- The contrast gate checks each glass with its ink and its focus indicator
  composited over white and over black, the two extremes a blurred backdrop can average to, in both
  themes, scoring the lower of a linear-light and a browser (gamma-encoded
  sRGB) blend. It does not check the transparent top state: over
  photographic or arbitrary hero art the page supplies its own top scrim and
  a tone that reads over it in both themes.

The header is fixed rather than absolutely positioned (which would scroll
away before it could turn to glass) or stuck (which reserves its height in
flow). These hosting requirements apply to a standalone header; Publisher
`SiteFrame` supplies shared header clearance for its main, skip and anchor
targets. A standalone page supplies the following:

- **The root scrolls.** The fade follows `scroll(root block)`. If the page
  scrolls inside a container instead, the root never scrolls and the header
  stays transparent over content.
- **The first block reserves the header's height.** No header-height value is
  exported; the height changes with wrapping, text zoom and `surfaceLabel`,
  so measure it in the page or pad generously.
- **The root sets `scroll-padding-top`** to at least the header's height. It
  lands in-page anchors below the header, and it keeps a focused element
  from scrolling under it (WCAG 2.2 Focus Not Obscured, 2.4.11).
- **No ancestor of the header creates a containing block** for fixed
  elements: no `transform`, `filter`, `perspective`, `will-change: transform`
  or `will-change: filter`, and no `contain: layout` or `contain: paint`.
  Any of them pins the header to that ancestor instead of the viewport.
- **Page content stays below the shell layer.** The header sits at the
  shell's `z-index` (20); content with a higher `z-index` paints over it.
- **Menus portal out of the header.** In the glass state the backdrop blur
  makes the header the containing block for fixed-position descendants, so
  a full-screen menu panel rendered inside it is clipped to the header.
  Always render one through a portal.

```tsx
<SiteHeader
  placement="overlay"
  tone="inverse"
  brand={<a href="/" className="text-inherit">Acme</a>}
  actions={<a href="/sign-in" className="text-inherit">Sign in</a>}
/>
```

`NavDisclosure` is the non-modal navigation for `SiteHeader`'s `nav` slot.
It renders one navigation landmark and one set of links: below `tablet`
(`768px`) a Menu button opens a sheet directly under the header; from
`tablet` up the same panel is an inline row and the button hides. The
server-rendered state is collapsed. With scripting unavailable, CSS shows
the panel inline and hides the button at every width. The toggle keeps
focus when activated; Escape while open closes the sheet and returns focus
to the toggle, and activating an `a[href]` within the panel closes it. Closed
header content is inert after mount and CSS hides it before hydration.
Equivalent parent renders preserve an open menu; meaningful route changes
reset it and desktop transitions retain visible focus. Without scripting,
expanded frame navigation stays in document flow before the View.
There is no focus trap or portal, and the disclosure has no animation.
`SiteHeader` supplies the positioned containing block for the mobile sheet.
Use `NavShell` when the menu needs a modal drawer and managed focus instead;
its drawer requires JavaScript.

```tsx
import { NavDisclosure, SiteHeader } from "@clossys/designer/shell";
import { Home } from "@clossys/designer/icons";

<SiteHeader
  mobileLayout="menu-brand-action"
  brand={<a href="/"><img src="/logo.svg" alt="Example" style={{ maxWidth: "100%", height: "auto" }} /></a>}
  nav={
    <NavDisclosure aria-label="Primary" trigger="icon" triggerLabel="Menu">
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
    </NavDisclosure>
  }
  actions={<SiteHeader.ActionLink href="/start" label="Get started" icon={Home} variant="primary" />}
/>
```

`NavDisclosure` and `NavDisclosureProps` are exported from the public
`@clossys/designer/shell` client entry, outside `shell/server`. The package
declares no root (`"."`) export; `src/index.ts` re-exports them only for
internal tooling and is not an import path.
The props are `children` (required), `aria-label` (default `"Primary"`),
`triggerLabel` (default `"Menu"`), `trigger` (`"label"` by default, or
`"icon"`) and `className` on the landmark. The icon toggle draws two
decorative bars in the current ink; `triggerLabel` remains its accessible
name. Both triggers keep the same tap target, disclosure controls, Escape
handling and focus return.

`NavShell` is the modal responsive half: an ordinary inline `<nav>` from the
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

`SiteFooter` accepts `ground` (`base` | `inverse`, default `base`) — use
it for the common inverse footer plate instead of reconstructing
`bg-surface-inverse` and ink utilities in host `className`.

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

`SiteFooter.Legal` fills the `secondary` slot with a copyright line and a
row of legal links, so a caller supplies data rather than composing the row
by hand. It takes `entity` (a plain string) and `links` (a list of
`{ label, href }` records), plus an optional `linksLabel`, the accessible
name for the links region. When `linksLabel` is given, the links render
inside a `<nav aria-label>`; otherwise they render as a plain list. The
component ships no English of its own, so the caller supplies `linksLabel`
in the page's language.

```tsx
import { SiteFooter } from "@clossys/designer/shell";

export function Footer() {
  return (
    <SiteFooter
      secondary={
        <SiteFooter.Legal
          entity="Example Co"
          linksLabel="Legal"
          links={[
            { label: "Terms", href: "/terms" },
            { label: "Privacy", href: "/privacy" },
          ]}
        />
      }
    />
  );
}
```

It renders one text string, `© {year} {entity}`, where the year is computed
at render from the current date; there is no `year` prop. The component owns
the layout: the links come first in DOM order; below the `desktop`
breakpoint the two stack, centred, links first; from `desktop` up they sit on
one line with the copyright on the left and the links on the right. Every
link tap target is at least 44px. There is deliberately no disclaimer slot
and no `children`, `className`, or `style` prop — regulatory text belongs in
legal documents the links point to. `SiteFooter.Legal` does not import
react-aria-components, so it is available from `@clossys/designer/shell/server`
as well as `@clossys/designer/shell`, and its prop types
(`SiteFooterLegalProps`, `SiteFooterLegalLink`) are exported from both.
`secondary` continues to accept any node, so existing footers that
compose their own row are unaffected.

#### Transparent chrome and full width

`SiteHeader` and `SiteFooter` accept `ground="transparent"` for chrome that
sits over a page backdrop. It renders no `bg-*` class, no `border-*` class
and no border-width style, and `SiteFooter` also omits the divider between
`columns` and `secondary`. Ink is unchanged from `"base"`: `SiteFooter` still
sets the base ink, and `SiteHeader` still sets none, so its content inherits
its ink from the page. `ground` still defaults to
`"base"`, and `"base"` and `"inverse"` render the same markup as before.
`Shell.Header` and `Shell.Footer` keep `"base" | "inverse"`: passing
`"transparent"` or `"transparent-inverse"` to either is a type error.

```tsx
import { SiteFooter, SiteHeader } from "@clossys/designer/shell";

export function Chrome() {
  return (
    <>
      <SiteHeader ground="transparent" brand={<a href="/">Example Co</a>} />
      <SiteFooter
        ground="transparent"
        secondary={<SiteFooter.Legal entity="Example Co" links={[{ label: "Privacy", href: "/privacy" }]} />}
      />
    </>
  );
}
```

`brand` is still a slot that takes any node you supply, including a
`Brandmark`. The inner containers of the header, the footer and the `SiteFooter.Legal`
row carry no `max-w-*` class and no `maxWidth` style, so chrome content runs
the full viewport width, inset only by the `--ui-width-page-padding-x` token;
page content stays in `Shell.Main`'s container. A test pins this for every
ground.

`ground="transparent-inverse"` is the same no-plate, no-border chrome for a
page that is itself on the inverse ground (`bg-surface-inverse` with
`text-ink-on-inverse`). `SiteFooter` sets `text-ink-on-inverse` on the footer
and `text-ink-on-inverse-muted` on its `secondary` row, the ink the
`"inverse"` plate uses; `SiteHeader` renders exactly as it does for
`"transparent"`, since it sets no ink and inherits the page's.

```tsx
import { SiteFooter, SiteHeader } from "@clossys/designer/shell";

export function InverseChrome() {
  return (
    <div className="bg-surface-inverse text-ink-on-inverse">
      <SiteHeader ground="transparent-inverse" brand={<a href="/">Example Co</a>} />
      <SiteFooter
        ground="transparent-inverse"
        secondary={<SiteFooter.Legal entity="Example Co" links={[{ label: "Privacy", href: "/privacy" }]} />}
      />
    </div>
  );
}
```

Neither transparent ground checks the contrast of the chrome ink over
whatever sits beneath it. That is the consumer's backdrop's job: choose a
backdrop the base ink reads against, use `"transparent-inverse"` over the
inverse ground, or use `ground="inverse"` for an opaque dark band.

### `Brandmark`

`Brandmark` is the site's identity link, for `SiteHeader`'s `brand` slot or
anywhere else a home link belongs. It ships from the same `/shell` subpath
(and from `/shell/server`, since it has no hooks and no client directive).

```tsx
import { Brandmark, SiteHeader } from "@clossys/designer/shell";

<SiteHeader
  brand={
    <Brandmark
      variant="lockup"
      size="md"
      label="Acme home"
      markSrc="/brand/acme-mark.svg"
      wordmark="Acme"
    />
  }
/>;
```

`label`, `markSrc` and `wordmark` are placeholders the example supplies;
this package ships no default label, brand name or image. `variant` is
`"mark"` (the image alone; `wordmark` is not accepted) or `"lockup"` (the
image beside `wordmark`, which is required and is text: a `string`, never an
element or image). `size` is `"sm"`, `"md"` or
`"lg"`, mapped to the `--ui-brandmark-height-*` and `--ui-brandmark-gap-*`
tokens. The exported types are `BrandmarkProps`, `BrandmarkVariant` and
`BrandmarkSize`.

What `Brandmark` does: it renders a plain `<a href="/">` whose accessible
name is `label` (set as `aria-label`), so the name does not depend on the
image or the wordmark text. The image is decorative (`alt=""`) and is set
from `markSrc` as a URL, and `wordmark` renders as live text in the display
font at a size derived from the mark's height; neither is injected as
markup. The component spreads no props onto the anchor, so `href` and
`aria-label` are not reachable through its props. What it does not do: it
does not check that `markSrc` resolves or that the image is legible at the
chosen size, it does not check that `label` is a meaningful name beyond the
two refusals below, and it does not load the display font, so the wordmark
falls back to whatever the page's font stack provides when the font is not
loaded. A lockup without a wordmark value renders the mark alone.

`Brandmark` refuses two `label` values by throwing a plain `Error` that
names the prop and does not repeat its value. First, an empty,
whitespace-only or non-string `label` is refused for both variants, because
the image is decorative and the link would otherwise have no accessible
name. Second, for `variant="lockup"` the `label` must contain the visible
`wordmark` text, compared case-insensitively with whitespace normalised
(`"Acme home"` for a wordmark of `"Acme"`), because `aria-label` replaces the
visible text as the link's name and a label without it fails WCAG 2.5.3
(label in name). The `mark` variant shows no text, so only the first refusal
applies to it, and a lockup with an empty wordmark falls back to the mark
alone and is held to the first refusal only. The component renders on the
server, so a refused `label` fails that render.

Declared boundary: the wordmark's size is the mark's height times the fixed
22/48 ratio, so at `size="sm"` (a 24px mark) the wordmark is 11px. Sizes
derive from that ratio and are not raised to a minimum, so use `"md"` or
`"lg"` where an 11px wordmark is too small.

One brand slot size: the mark's box is the size's `--ui-brandmark-height-*`
token for every form (`variant="mark"` or `"lockup"`, either plate, either
`markInk`), so a mark-only brand and a lockup share one slot height, and the
desktop header, the mobile bar and the menu panel all use that same token.
The header styles set no brand height or font size of their own, so no
per-site override is needed.

#### Accent mark

`markInk` is `"image"` or `"accent"`. On a `Brandmark` of its own, `"image"`
is the default and the mark is the `markSrc` image, as above. Inside
`SiteHeader`, an omitted `markInk` becomes `"accent"`, so the header's
logomark is in the accent token by default; pass `markInk="image"` there to
opt out. With `"accent"`,
`Brandmark` paints the mark's shape in the accent token (`bg-accent`): a
decorative `<span>` the size's height square, using `markSrc` as a CSS mask
(`mask-image`, `contain`, centred), so the mark follows the accent token in
light and dark color schemes. The wordmark keeps the link's ink: the
`--color-ink-primary` token, or `--color-ink-on-inverse` with
`tone="inverse"` on a dark or overlay ground, so it switches with the scheme
and the ground through tokens only. With `plate="shared"` the accent mark sits
inset on the plate. The prop is part of `BrandmarkProps`; no new type is
exported.

```tsx
<Brandmark
  variant="lockup"
  size="md"
  label="Acme home"
  markSrc="/brand/acme-mark.svg"
  wordmark="Acme"
  markInk="accent"
/>;
```

What it does not do: the mask uses the image's alpha only, so a multi-colour
mark becomes a one-colour accent silhouette, including in the header's
default; pass `markInk="image"` for a mark whose colours matter. It does not check that the accent reads on the ground behind
it.

#### Shared plate

`plate` is `"self"` or `"shared"`, and defaults to `"self"`. With `"self"` or
without the prop the markup is unchanged: the mark's own edge is its plate.
With `"shared"`, `Brandmark` draws one rounded-square plate behind the mark in
the base ink (`bg-ink-primary`), as a decorative `<span>` styled with CSS; no
inline `<svg` is used. The plate's side is the size's height token and its
corner radius is that side times `BADGE_RADIUS_SHARE` (7/32). The image is
inset by `BADGE_INSET_SHARE` (0.18) on each side, so it is 64% of the side. In
a lockup the plate wraps the mark only; the wordmark stays beside it. The
exported type is `BrandmarkPlate`.

```tsx
<Brandmark
  variant="mark"
  size="md"
  label="Acme home"
  markSrc="/brand/acme-mark-on-ink.svg"
  plate="shared"
/>;
```

`badgePlatePath(size)` returns the same rounded square as SVG path data, from
(0, 0) to (`size`, `size`), for a consumer that draws the plate itself. The
radius is `size * BADGE_RADIUS_SHARE` and each number is rounded to 3
decimals, so `badgePlatePath(32)` is
`M7 0H25A7 7 0 0 1 32 7V25A7 7 0 0 1 25 32H7A7 7 0 0 1 0 25V7A7 7 0 0 1 7 0Z`.
It throws a `TypeError` for a non-number and a `RangeError` for a non-finite
or non-positive `size`; the message names `size` and does not repeat the
value. `BADGE_RADIUS_SHARE`, `BADGE_INSET_SHARE` and `badgePlatePath` ship
from `/shell`, `/shell/server` and the package root.

What it does not do: it does not check that the mark reads on the base ink,
so the consumer supplies a mark that does, and it does not check the
contrast between them.

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
// Your Next.js app's root layout (the "layout.tsx" file in the App
// Router's "app" directory)
import { Shell, Toaster } from "@clossys/designer/shell";

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
import { toast } from "@clossys/designer/shell";

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
  from this package's fixed-order categorical palette, with
  an explicit `color` per series winning on `BarChart` and `LineChart`. By default a
  series' color is its position in the `series` array — which, on its
  own, is exactly the anti-pattern this rule warns about the moment a
  consumer filters `series` down to a subset, since removing an entry
  shifts everyone after it. Pass the stable, full `colorDomain` prop
  (`BarChart`/`LineChart` both accept it — the complete set of possible
  series names, known before any filtering) and each name's position in
  THAT list picks its slot instead, so filtering never repaints a
  survivor. `ScatterChart` instead uses its stable full `series` declaration
  for both categorical slots and distinct marker shapes.
- **By default, a legend appears for two or more series** (the title
  names a single series). `ChartFrame` can also show one series through
  `showSingleSeriesLegend`; static/fluid `BarChart` enables that option
  to keep every series name visible independently of the title.
- **A table-view fallback ships with every chart**, `Sparkline` included —
  a `<details>` whose summary text is `tableFallbackLabel` (default
  "View as table") on `ChartFrame`, `BarChart`, `LineChart`, and
  `Sparkline`, holding the same data as an ordinary HTML `<table>`,
  always reachable, never gated behind a screen reader or a hover.
  `Sparkline`'s value column heading is `valueColumnLabel` (default
  "Value"). `WaterfallChart` instead requires authored `labels.table`,
  `labels.category`, and `labels.value` for its disclosure and columns.
  `RangeChart` requires `labels.table`, `category`, `from`, `to`, and `status`
  when rows carry statuses. `ScatterChart` requires `labels.table` and
  `category`, both axis labels, and an authored size label when sizing is used.
- **Interactive charts ship a hover layer** — a crosshair
  + shared tooltip readout on `LineChart`, a per-mark tooltip on
  `BarChart` — with the same detail reachable on keyboard focus as on
  pointer hover. Static `BarChart` marks retain the chart graphic and table fallback. The
  static and fluid paths show a legend even for one series, independently
  of the title.

### `ChartFrame`

The shared container `BarChart`, `LineChart`, `WaterfallChart`, `RangeChart`, and `ScatterChart` compose: plot area,
axes, grid, an optional legend, an accessible SVG `<title>`/`<desc>`, and
the table-view fallback. Only reached for directly when composing a new
chart type this package doesn't ship; `BarChart`/`LineChart`/`WaterfallChart`/`RangeChart`/`ScatterChart`/`Sparkline`
below are the components most consumers actually render.

`fit` accepts `"fixed"` (default) or `"fluid"`. Fluid charts fill their
available width, preserve the SVG aspect ratio, and stop growing at 1.5
times their intrinsic width. `width` and `height` define the coordinate
space used by axes and marks; the outer figure still accepts `className`
and `style`. Fluid table fallbacks stack their labelled cells below tablet,
keeping headers and table roles available without horizontal scrolling.

```tsx
import { ChartFrame } from "@clossys/designer/charts";

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
import { BarChart } from "@clossys/designer/charts";

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

`BarChart` accepts the same `fit` option. Its fluid path uses an intrinsic
width of 360 when `width` is omitted. `marks="interactive"` (default) gives
each bar a native SVG tooltip and keyboard focus target, with hover and
focus feedback supplied by CSS. `marks="static"` presents the chart as
one accessible graphic with its table fallback. Fluid or static bars read
`--radius-subtle`; the fixed interactive path retains its existing 4px
radius. Import `BarChart` from `@clossys/designer/charts/server` in a React
Server Component.

### `LineChart`

Change over time — one line per series, sharing one x scale and one y
scale:

```tsx
import { LineChart } from "@clossys/designer/charts";

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
never has to land exactly on a line to read it. That overlay's own
accessible name is `"${title}: ${keyboardHintLabel}"`; `keyboardHintLabel`
defaults to `"use arrow keys to inspect values"` and is independently
overridable — `title` itself is already consumer-supplied, so only the
fixed instructional half needed a prop.

### `WaterfallChart`

An opening total, ordered signed changes, and a derived closing total. Each
change begins at the previous running total; the opening and closing bars
begin at zero. Connectors show the accumulation, while signed value labels
and the matching table preserve meaning independently of color.

```tsx
import { WaterfallChart } from "@clossys/designer/charts/server";

<WaterfallChart
  title="Balance changes"
  description="Opening balance, additions, and removals"
  start={{ label: "Opening", value: 100 }}
  steps={[
    { id: "added", label: "Added", value: 30 },
    { id: "removed", label: "Removed", value: -20 },
    { id: "recovered", label: "Recovered", value: 10 },
  ]}
  end={{ label: "Closing", value: 120 }}
  labels={{ table: "View values", category: "Stage", value: "Amount" }}
/>
```

`labels.table`, `labels.category`, and `labels.value` are required, nonblank
strings. Steps need nonblank, unique IDs; visible labels may repeat. Empty
steps are supported. The chart rejects nonfinite values and closing totals
that disagree with the accumulation beyond floating-point roundoff.

`end.value` is optional and checks the derived total. Geometry, visible
values, and table values always use that derived total. For example,
`0.1 + 0.2` accepts an authored end of `0.3`; with `valueFormat={String}`,
the visible closing value and table value display `+0.30000000000000004`. With no steps, an authored
end must exactly equal the opening value.

Every positive bar, including opening and closing totals, has a `+` label;
negative bars use Unicode minus (`−`), and zero is unsigned. Table values use
the same signs. `valueFormat` formats an unsigned magnitude and must omit its
own sign; the chart supplies signs for marks, table values, and negative-axis
ticks. Positive-axis ticks remain unsigned. For example,
`valueFormat={value => "$" + value}` yields `+$100` for the opening total,
`−$20` for a negative change, and `$0` for zero. The default formatter uses
the existing en-US number formatting.

Short stage names appear directly below their bars. Dense categories use
numbered SVG anchors and an always-visible wrapping key containing each
number and its complete authored stage name. Full names remain in the table,
and every signed value stays by its mark. No category names are truncated.

The default is `fit="fluid"` with a 360×280 coordinate space and a width cap
of 540px. `fit="fixed"` keeps the intrinsic dimensions. Marks are static;
the named graphic and native table disclosure work without JavaScript.
Positive and negative changes use the existing diverging colors. Neutral
totals have a contrasting, non-scaling hairline outline because their fill
alone does not distinguish the bar boundary from the chart ground.

### `RangeChart`

`RangeChart` shows activities across authored intervals. `ticks` names each
interval; numeric `from` and `to` identify its boundaries. With four ticks,
boundaries run from `0` through `4`. Fractional boundaries are supported.

```tsx
import { RangeChart } from "@clossys/designer/charts/server";

<RangeChart
  title="Sample schedule"
  description="Activities across four phases"
  ticks={["Phase A", "Phase B", "Phase C", "Phase D"]}
  rows={[
    { id: "whole", label: "Whole schedule", from: 0, to: 4 },
    {
      id: "review",
      label: "Review",
      from: 0.5,
      to: 2.75,
      status: { tone: "warning", label: "Awaiting review" },
    },
  ]}
  labels={{
    table: "Schedule data",
    category: "Activity",
    from: "Start boundary",
    to: "End boundary",
    status: "State",
  }}
/>
```

Each row requires a unique, nonblank `id`, a visible `label`, and finite bounds
satisfying `0 <= from < to <= ticks.length`. Tick labels sit at interval
centers. Optional statuses repeat the authored state in a visible label and
the native table; their five distinct glyph shapes retain meaning in greyscale.
Provide at least one row and one period; row and period labels must be nonblank.
Every period retains a complete visible and accessible numbered key, including
when there is only one period. Key item `1` names interval `0` through `1`.
Long or dense period names use the same numbers at their SVG interval centers.
An intrinsic width that cannot keep those numbered anchors distinct is rejected.
`labels.status` is required when any row has a status. Rows without status keep
an empty cell in that column. With no statuses, the table has three columns.

The chart is static and available from both chart entry points. The default
fluid view uses a 360-unit width and grows to fit wrapped activity and status
labels. Two short rows without statuses retain a 120-unit height. An authored
height smaller than the required content height is rejected.
`width`, `height`, `fit`, `className`, and `style` allow authored layout.
The native table disclosure works without JavaScript. Open it before printing
to include the table; automatic expansion during printing is not promised.

### `ScatterChart`

`ScatterChart` plots three to twelve authored numeric observations. Each point
has a unique, nonblank `id`, a visible `label`, and finite `x` and `y` values.
Provide nonblank axis titles and the table disclosure and category labels.
Point labels allow at most twenty graphemes; axis titles allow at most
thirty-two. Axis titles can use multiple lines while preserving their full text.

```tsx
import { ScatterChart } from "@clossys/designer/charts/server";

<ScatterChart
  title="Sample observations"
  description="Two measures and sample counts across two cohorts"
  x={{ label: "First measure", min: 0, max: 10 }}
  y={{ label: "Second measure", min: 0, max: 10 }}
  size={{ label: "Sample count" }}
  series={[
    { id: "a", name: "Cohort A" },
    { id: "b", name: "Cohort B" },
  ]}
  points={[
    { id: "first", label: "Observation A", x: 2, y: 2, size: 1, series: "a", labelSide: "end" },
    { id: "second", label: "Observation B", x: 5, y: 7, size: 4, series: "a", labelSide: "above" },
    { id: "third", label: "Observation C", x: 8, y: 4, size: 9, series: "b", labelSide: "start" },
  ]}
  labels={{ table: "Observation data", category: "Observation" }}
/>
```

Omitted bounds use a domain derived from the observations, with a constant
range expanded to a finite interval. Authored `min` and `max` must be finite
and contain every coordinate; when both are provided, `min < max` is required.
Invalid bounds or coordinates are rejected. Bounds are independent for each
axis.

Declare at most four series, using unique, nonblank IDs and nonblank names.
Every point must reference that declared domain. Declaration order assigns
categorical slots and the circle, square, diamond, and triangle shapes in that
order. Keep the full series declaration stable when filtering or reordering
points so a surviving series retains its color and shape. With no declared
series, omit each point's `series`; the marks use the first categorical slot
and circle shape. A matching shape legend appears for two or more series. Series identity combines
these shapes with complete point labels and the matching native table. The
existing light base/sunken categorical policy compensates slots 2–4 below 3:1
through these additional channels; those fills are compensated rather than raw
contrast passes. Marker contours have equal filled area and no border, so shape
does not change the size comparison. Dark fills retain the existing 3:1 floor
without relief.

Without `size`, omit every point's size value: all marks have equal filled
area, including marks with different shapes. When `size={{ label }}` is
provided, its label must be nonblank and every point must carry a finite,
nonnegative `size`. Filled area is proportional to size within the chart,
normalized to its largest observed size; a `1:4:9` size ratio produces a
`1:4:9` area ratio. A zero size has zero filled area while its direct label
and table row remain present. An all-zero set retains labels and rows without
inflating its marks. The size label remains visible above the chart.

The default intrinsic dimensions are `360 × 300`, with `fit="fluid"`.
The SVG fills the available width, preserves its aspect ratio, and stops
growing at 1.5 times its intrinsic width. `fit="fixed"` retains the authored
SVG dimensions. Both `width` and `height` must be finite and at least `240`;
that minimum does not guarantee every formatter or label placement fits.
Wide formatted y ticks reserve extra space. X ticks can omit interior ticks
to keep their complete text distinct; the first and last visible tick labels
remain. A layout that cannot retain its tick text and plot is rejected.
`valueFormat` formats axis ticks, table coordinates, and table sizes; it
defaults to the chart number formatter. `className` and `style` apply to the
outer chart figure.

Each point's complete label is drawn next to its mark. `labelSide` accepts
`"start"`, `"end"`, `"above"`, or `"below"`; start and end mean left and right
in the SVG coordinate space. By default, the chart prefers a side toward the
plot interior, tries the opposite side when needed, and otherwise places the
label above. Authored start/end placement is rejected if the complete label
cannot fit beside the mark within the plot. Above/below labels can shift
horizontally to stay inside the SVG. These choices do not resolve collisions
between nearby or coincident points. Authors must check the actual layout,
choose label sides and dimensions, and provide suitably separated observations
so labels remain readable.

The component is static, available from both chart entry points, and requires
no client state, effect, or interaction hook. There is no hover readout or
per-point keyboard stop. `ChartFrame` supplies the caption, accessible SVG
title and optional description, and a complete native data table. The table
retains each point label, its declared series name when present, both formatted
coordinates, and the formatted size when enabled, including zero. Its
disclosure works without JavaScript. Open it before printing to include the
table; automatic expansion during printing is not promised.

### `Sparkline`

A bare inline trend — no axes, no grid, no legend, and (the one exception
in this layer) no hover layer, meant to sit inline in running text or a
stat tile at a size too small for a crosshair to make sense:

```tsx
import { Sparkline } from "@clossys/designer/charts";

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
import { getThemeInitScript, getStoredThemeInitScript } from "@clossys/designer/theme";

<script dangerouslySetInnerHTML={{ __html: getThemeInitScript() }} />
```

Returns a small, self-contained script (as a string) that a consumer
injects into `<head>`, before any stylesheet or script that might paint —
see "Wiring up a theme toggle" above for why this can't be
`ThemeProvider`'s job: a React component fundamentally cannot run before
the document paints, so anything React-based corrects the theme one frame
too late, and that one frame is a real, visible flash on every page load
for a visitor whose stored preference disagrees with what the OS/CSS
would otherwise render. The returned script reads `storageKey` (default `"ui-theme"`) and applies
valid stored `"light"`, `"dark"` or `"system"` preferences. Set `defaultTheme`
to `"light"`, `"dark"` or `"system"` (default) for missing or invalid stored
values and unavailable storage. A stored `"system"` continues to follow the
OS even when the configured default is light or dark. Match the provider's
`defaultPreference` to the script's `defaultTheme`:

```tsx
<script dangerouslySetInnerHTML={{
  __html: getStoredThemeInitScript({ defaultTheme: "light" }),
}} />
// Wrap the body content with the matching fallback.
<ThemeProvider defaultPreference="light">{children}</ThemeProvider>
```

`getStoredThemeInitScript` is the product-app builder; the deprecated
`getThemeInitScript` delegates to it with the same options.
`getAuthoredThemeInitScript` stamps the authored light register without
reading storage. These builders emit literal templates that survive host
minification. The storage key is JSON-quoted with `<`, `>`, `&`, U+2028 and
U+2029 escaped as Unicode sequences for embedding in a `<script>` element;
execution reads the original key. The parity tests compare the stored
script with `readStoredPreference` and `applyThemeDom`, including configured
fallbacks and storage errors.

### `ThemeProvider` and `useTheme`

```tsx
import { ThemeProvider, useTheme } from "@clossys/designer/theme";

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
corrects local state if it differs, retaining `defaultPreference` when
storage is absent, invalid or unavailable. This does not reintroduce the flash
`getThemeInitScript` solves: the page's actual rendered THEME already
matches the stored preference by the time this runs, because the head
script (which must run) already stamped it before first paint. Only this
hook's own reported `preference` — and anything that visibly depends on it,
like `ThemeToggle`'s icon — settles into its correct value one tick after
mount, the same tradeoff every SSR-safe theme provider makes.

### `ThemeToggle`

```tsx
import { ThemeToggle } from "@clossys/designer/theme";

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

## Icon glyph data (`@clossys/designer/icons`)

```tsx
import { Icon } from "@clossys/designer/atoms";
import { Search } from "@clossys/designer/icons";

<Icon glyph={Search} label="Search" />;
```

40 `IconNode` exports — plain data, no components, no rendering logic of
any kind. See "Icon" (above, under "Atoms") for the render contract that
consumes this data; this section covers the data itself: where it came
from, how the 40 were chosen, and how to keep it current.

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
`"sideEffects": false`, and `@clossys/designer/icons` ships one ES module
per glyph — importing `Search` from it bundles exactly `Search`, the same
elimination `src/icons/tree-shake.test.ts` measures against a real
bundler's OUTPUT, not assumed. An unimported `ui/icons` costs an unrelated
`ui` consumer zero bytes, the identical reasoning that already justifies
`@clossys/designer/charts` living inside this package rather than as its
own. The dependency-weight argument the standalone package's own README
made for keeping icons separate does not hold up under that same scrutiny —
it is not repeated here.

**The argument that DOES hold, and is why this data is still vendored
rather than a direct `lucide-react` dependency:** insulation from upstream
renaming and churn. This set already crossed one Lucide rename in the
version it's pinned at — four of its 40 names resolve to a Lucide glyph
published under a *different* name in the pinned release (`AlertTriangle`
→ `triangle-alert`, `Home` → `house`, `CheckCircle` → `circle-check-big`,
`XCircle` → `circle-x`; see "Third-party notices" below for the full
table). A direct dependency on `lucide-react` would mean either following
Lucide's own renames as they happen (churn a consumer of THIS package never
asked for) or pinning a `lucide-react` version directly (which still drifts
from whatever else in a consumer's own tree might depend on a newer one).
Vendoring the path data once, under this package's own stable names, means
this set's 40 names never move under a consumer's feet regardless of what
Lucide does next — Lucide itself has moved on to 1.30 already; this data
stays pinned at 1.23.0 until a deliberate refresh (see below). The eight
content glyphs added later (see the last tier below) were copied from
Lucide 1.24.0, the release current when they were added; the original
32 were not refreshed.

### How the 40 were chosen

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

A third tier, added later, serves content lists rather than interface
chrome: a feature or topic list on a marketing page where a small line
glyph tells items apart (one per item, muted, never on a heading).
`Landmark`, `Briefcase`, `Globe`, `ShieldCheck`, `Scale`, `ArrowRight`,
`FileCheck` and `Layers` are the glyphs such lists actually needed and the
set above could not supply (a bank or institution, a client role, a
cross-border topic, a safeguard, a rule or balance, a next step, a
verified document, a layered stack). They exist because the sectioned
content blocks name them as allowed item icons, not because one site
asked for them; a content list may use only that named subset.

22 (3-way intersection) + 2 (status-family completion) + 8 (interaction
primitives) + 8 (content-list disambiguation) = **40** — the exact number
every count in this section and every test in `src/icons/` checks against;
nothing was added and then quietly dropped to make the arithmetic round.

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
three of the 40 names are now a literal prefix of another (`Check` of
`CheckCircle`, `User` of `Users`, `X` of `XCircle`) — a collision the old
`*Icon`-suffixed names happened to avoid (`UserIcon` is not a contiguous
substring of `UsersIcon`, because the plural's extra `s` sits between
them). `src/icons/tree-shake.test.ts`'s own header comment covers the
concrete consequence (a bare-identifier bundle marker doesn't work for
these three pairs) and the fix used instead.

### Third-party notices

The 40 glyphs here are visually derived from [Lucide](https://lucide.dev)
(ISC License) and, for a subset of those, [Feather](https://feathericons.com)
(MIT License) before that — this package does not depend on `lucide-react`
at runtime (see "A subpath of `ui`, not a separate package" above), but the
SVG path data was copied from it, pinned at Lucide **1.23.0** (the eight
content-list glyphs at **1.24.0**). Full
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
changelog, then run `node scripts/generate-icons.mjs` and `npm test`
— `src/icons/icons.test.ts` and `src/icons/tree-shake.test.ts` both
re-verify the regenerated data. See `scripts/generate-icons.mjs`'s own
header comment for the full procedure, including adding a genuinely new
name (follow "How the 40 were chosen" above first — this set is curated,
not a grab-bag).

## API

| Export | Kind | Description |
| --- | --- | --- |
| `AlertTriangle`, `ArrowRight`, `BookOpen`, `Box`, `Briefcase`, `Building2`, `Calendar`, `Check`, `CheckCircle`, `ChevronDown`, `ChevronLeft`, `ChevronRight`, `ChevronUp`, `Clock`, `CreditCard`, `ExternalLink`, `FileCheck`, `FileText`, `Folder`, `Globe`, `Grid3x3`, `Home`, `Info`, `Landmark`, `Layers`, `List`, `Lock`, `Monitor`, `Moon`, `Plug`, `Receipt`, `Scale`, `Search`, `Settings`, `ShieldCheck`, `Sun`, `User`, `Users`, `X`, `XCircle` | data | The 40 shipped icon glyphs, each an `IconNode` — see "Icon glyph data" above. |
| `Button` | component | Pressable action built on react-aria-components' `Button`. |
| `ButtonProps` | type | Props for `Button`: `variant`, `size`, `ground`, `trailingIcon` (`quiet` only), plus everything react-aria-components' own `Button` accepts. |
| `ButtonVariant` | type | `"primary" \| "secondary" \| "ghost" \| "danger" \| "outline" \| "tonal" \| "quiet"`. |
| `ButtonSize` | type | `"sm" \| "md" \| "lg"`. |
| `ControlGround` | type | `"base" \| "sunken" \| "inverse"`: the ground a control sits on. |
| `IconButton` | component | Icon-only control built on react-aria-components' `Button`, named by a required `label`. |
| `IconButtonProps` | type | Props for `IconButton`: `label` (required), `icon`, `size`, `shape`, `ground`, plus react-aria-components' own `Button` props except `children`, `aria-label` and `aria-labelledby`. |
| `IconButtonSize` | type | `"sm" \| "md"`: a 36px box with a 44px hit area, or a 44px box. |
| `IconButtonShape` | type | `"circle" \| "square"`. |
| `IconButtonClassOptions` | type | `{ size?, shape?, ground? }` for `iconButtonClassName`. |
| `IconButtonLinkGround` | type | The `ground` of `iconButtonLinkClassName`; the same union as `ControlGround`. |
| `iconButtonClassName` | function | `(options?: IconButtonClassOptions) => string`: the icon-only control look, server-safe. |
| `Icon` | component | The glyph render contract: size, colour, accessibility, applied to either `glyph` (structured `IconNode` data) or `children` (raw SVG/a component). |
| `IconProps` | type | `IconAccessibilityProps & { glyph: IconNode; children?: undefined } \| { glyph?: undefined; children: ReactNode } & { size?: IconSize; className?: string; style?: CSSProperties } & Omit<SVGProps<SVGSVGElement>, ...>`. |
| `IconSize` | type | `"sm" \| "md" \| "lg"`. |
| `IconAccessibilityProps` | type | The `{ decorative: true } \| { label: string }` discriminated union. |
| `IconNode` | type | `ReadonlyArray<readonly [tag: string, attrs: Record<string, string>]>` — also re-exported from `@clossys/designer/icons`. |
| `TextField` | component | Labeled single-line text input built on react-aria-components' `TextField` + `Label` + `Input` + `FieldError`. |
| `TextFieldProps` | type | Props for `TextField`: `label`, `description`, `errorMessage`, `placeholder`, `className`, `inputClassName`, plus everything react-aria-components' own `TextField` accepts. |
| `Badge` | component | Small status/label pill. Plain markup — not interactive, composes no other atom. |
| `BadgeProps` | type | Props for `Badge`: `variant`, plus every native `<span>` attribute. |
| `BadgeVariant` | type | `"neutral" \| "success" \| "warning" \| "danger" \| "info"`. |
| `Card` | component | Content surface: `raised` (default), `plate` (ground-relative fill) or `outline` (hairline panel). Plain markup — not interactive, composes no other atom. |
| `CardProps` | type | Props for `Card`: `variant`, `ground`, plus every native `<div>` attribute. |
| `CardVariant` | type | `"raised" \| "plate" \| "outline"`. |
| `CardGround` | type | `"base" \| "sunken" \| "inverse"`: the section ground a `Card` sits on. |
| `Breadcrumb` | component | Breadcrumb trail built on react-aria-components' `Breadcrumbs`/`Breadcrumb`/`Link`. Carries `Breadcrumb.Item`. An atom: its items are a homogeneous repeat, not distinct named regions. |
| `BreadcrumbProps` | type | Props for `Breadcrumb`: `children`, `className`, `aria-label`, plus react-aria-components' own `Breadcrumbs` props. |
| `BreadcrumbItemProps` | type | Props for `Breadcrumb.Item`: `href`, `children`, `className`. |
| `Link` | component | Navigable link built on react-aria-components' `Link`. |
| `LinkProps` | type | Props for `Link`: `variant`, `buttonVariant`, `buttonSize`, plus everything react-aria-components' own `Link` accepts (including `render`, for a custom/router link element). |
| `LinkVariant` | type | `"default" \| "muted" \| "standalone"`. |
| `Checkbox` | component | Checkbox with indeterminate support, built on react-aria-components' `Checkbox`. |
| `CheckboxProps` | type | Props for `Checkbox`: `children` (the visible label), plus everything react-aria-components' own `Checkbox` accepts (including `isIndeterminate`). |
| `Switch` | component | On/off toggle built on react-aria-components' `Switch`. |
| `SwitchProps` | type | Props for `Switch`: `children` (the visible label), plus everything react-aria-components' own `Switch` accepts. |
| `Select` | component | Labeled single-choice dropdown built on react-aria-components' `Select`/`Button`/`Popover`/`ListBox`/`ListBoxItem`. |
| `SelectProps` | type | Props for `Select`: `label`, `description`, `errorMessage`, `placeholder` (default `"Select an option"`), `options`, `className`, `triggerClassName`, plus everything react-aria-components' own `Select` accepts. |
| `SelectOption` | type | One option: `id`, `label`, `isDisabled?`, `textValue?`. |
| `Textarea` | component | Labeled multi-line text input built on react-aria-components' `TextField` + `Label` + `TextArea` + `FieldError`. |
| `TextareaProps` | type | Props for `Textarea`: `label`, `description`, `errorMessage`, `placeholder`, `rows`, `className`, `textareaClassName`, plus everything react-aria-components' own `TextField` accepts. |
| `Avatar` | component | Person/thing picture with an initials fallback. Plain markup — not interactive, composes no other atom. |
| `AvatarProps` | type | Props for `Avatar`: `alt`, `src`, `size`, plus every native `<span>` attribute except `children`. |
| `AvatarSize` | type | `"sm" \| "md" \| "lg"`. |
| `Spinner` | component | Indeterminate loading indicator. Plain SVG — not interactive, composes no other atom. |
| `SpinnerProps` | type | Props for `Spinner`: `size`, `label`, plus every native `<svg>` attribute except `className`/`children`. |
| `SpinnerSize` | type | `"sm" \| "md" \| "lg"`. |
| `Menu` | component | Dropdown menu built on react-aria-components' `MenuTrigger`/`Menu`/`MenuItem`/`Popover`. Carries `Menu.Item`, `Menu.Separator` and `Menu.Section`. |
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
| `ComboBoxProps` | type | Props for `ComboBox`: `label`, `description`, `errorMessage`, `placeholder`, `triggerLabel`, `options`, `className`, `inputClassName`, plus everything react-aria-components' own `ComboBox` accepts. |
| `ComboBoxOption` | type | One option: `id`, `label`, `isDisabled?`, `textValue?`. |
| `SearchField` | component | Search input with a built-in clear affordance, built on react-aria-components' `SearchField`/`Input`/`Button`. |
| `SearchFieldProps` | type | Props for `SearchField`: `label`, `description`, `errorMessage`, `placeholder`, `className`, `inputClassName`, plus everything react-aria-components' own `SearchField` accepts. |
| `FileTrigger` | component | File selection wired onto an arbitrary pressable trigger, built on react-aria-components' `FileTrigger`. |
| `FileTriggerProps` | type | Props for `FileTrigger`: `children` (the pressable trigger), plus everything react-aria-components' own `FileTrigger` accepts (`acceptedFileTypes`, `allowsMultiple`, `onSelect`, ...). No `className` — see `FileTrigger.tsx`'s own doc comment for why. |
| `Disclosure` | component | A single expandable/collapsible section, built on react-aria-components' `Disclosure`/`DisclosurePanel`. |
| `DisclosureProps` | type | Props for `Disclosure`: `title`, `children`, `className`, `triggerClassName`, `panelClassName`, plus most of react-aria-components' own `Disclosure` props. |
| `ProgressBar` | component | Determinate/indeterminate progress built on react-aria-components' own `ProgressBar`. |
| `ProgressBarProps` | type | Props for `ProgressBar`: `label`, `className`, plus everything react-aria-components' own `ProgressBar` accepts (`value`, `minValue`, `maxValue`, `isIndeterminate`, ...). |
| `Separator` | component | Visual divider built on react-aria-components' own `Separator`. |
| `SeparatorProps` | type | Props for `Separator`: `orientation`, `decorative`, `className`, `style`, plus most of react-aria-components' own `Separator` props. |
| `Chip` | component | A removable label: a label region plus a remove-affordance region. Distinct from `Badge`, which is static. |
| `ChipProps` | type | Props for `Chip`: `children`, `isDisabled`, `className`, `style`, plus `onRemove`/`removeLabel` (typed together — `removeLabel` is required whenever `onRemove` is supplied). |
| `StatusMark` | component | A tone mark (a shape per tone) and a visible label for one data state. Server-safe. |
| `StatusMarkProps` | type | Props for `StatusMark`: `tone`, `children` (required), plus every native `<span>` attribute. |
| `StatusMarkTone` | type | `"success" \| "warning" \| "danger" \| "info" \| "neutral"`. |
| `Meter` | component | A value against a scale and an optional limit, with visible value and limit text and a decorative bar. Server-safe. |
| `MeterProps` | type | Props for `Meter`: `value`, `scaleMax`, `limit`, `direction`, `tone`, `valueText`, `limitText`, `emphasis`, optional paired `previous`/`previousText`, plus every native `<div>` attribute except `children`. |
| `MeterTone` | type | `"success" \| "warning" \| "danger" \| "info" \| "neutral"`. |
| `MeterDirection` | type | `"max" \| "min"`: whether the limit is a cap or a floor. |
| `AccountMenu` | component | Navigation Material with actor trigger, grouped commands and controlled preferences. |
| `AccountMenuProps` | type | Actor, sections, context/collapsed/triggerLabel and host close/route callbacks. |
| `AccountMenuActor` | type | Name, optional secondaryText and image; name-derived fallback initials. |
| `AccountMenuEntry` | type | Command or controlled preference entry. |
| `AccountMenuCommand` | type | Link, action or destructive command. |
| `AccountMenuLink` | type | Labelled destination entry with href. |
| `AccountMenuAction` | type | Labelled action or destructive callback entry. |
| `AccountMenuPreference` | type | Checked preference and change callback. |
| `AccountMenuSection` | type | Command group or named preference group; entries have section-local IDs. |
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
| `PaginationProps` | type | Props for `Pagination`: `page`, `pageCount`, `onPageChange`, `totalItems`, `pageSize`, `pageSizeOptions`, `onPageSizeChange`, `siblingCount`, `previousPageLabel`, `nextPageLabel`, `noResultsLabel` (default `"No results"`), `rangeSummaryMessage`, `pageSummaryMessage`, `pageSizeLabel` (default `"Rows per page"`), `className`, `style`, plus every native `<nav>` attribute. |
| `Stat` | component | A single metric: label, value, optional delta/trend, optional description. |
| `StatProps` | type | Props for `Stat`: `label`, `value`, `delta`, `trend`, `trendLabels` (default Increase / Decrease / No change), `description`, `className`, `style`, plus every native `<div>` attribute. |
| `StatTrend` | type | `"up" \| "down" \| "neutral"`. |
| `Form` | component | Form layout: optional heading, fields region, opt-in error-summary region, submit-error region, actions region. Owns no validation logic; opts into `useFormValidation` through `validation`. |
| `FormProps` | type | Props for `Form`: `heading`, `children`, `errors`, `errorSummaryMessage` (opt-in: the summary renders only when passed; no default text), `submitError`, `validation`, `onSubmitError` (optional; receives a rejection from the validated `onSubmit`, and does nothing when omitted), `actions`, `onSubmit` (ignored when `validation` is passed), `className`, `style`, plus every native `<form>` attribute. |
| `FormError` | type | One error-summary entry: `fieldId`, `message`. |
| `FormValidationBinding` | type | What `Form` reads from a validation source: `handleSubmit`, `summaryErrors`, `isSubmitting`, `formRef`. `useFormValidation`'s return value satisfies it. |
| `useFormValidation` | function | Hook for the form validation timing: validate on blur, re-validate on change once a field shows an error or after the first submit, focus the first invalid field on a failed submit, pending (never disabled) submit. Returns `FormValidation`. |
| `FormValidation` | type | Return of `useFormValidation`: `values`, `errors`, `touched`, `submitCount`, `isSubmitting`, `fieldId`, `errorId`, `getFieldProps`, `getNativeInputProps`, `getSubmitButtonProps`, `setFieldValue`, `reset`, plus the `FormValidationBinding` members. |
| `UseFormValidationOptions` | type | Options for `useFormValidation`: `initialValues`, `validators`, `onSubmit`, `idPrefix`. |
| `FieldValidator` | type | `(value, values) => ReactNode`: returns the error to show, or `undefined`/`null`/`false`/`""` when valid. |
| `FormFieldName` | type | The string keys of a form's values type; each becomes part of a DOM id. |
| `FormStringFieldName` | type | The field names whose value is a string, the ones `getNativeInputProps` accepts. |
| `FormFieldProps` | type | Props `getFieldProps` returns for a designer field atom: `id`, `name`, `value`, `onChange`, `onBlur`, `isInvalid`, `errorMessage`, `validationBehavior`. |
| `FormNativeInputProps` | type | Props `getNativeInputProps` returns for a plain input: `id`, `name`, `value`, `onChange`, `onBlur`, `aria-invalid`, `aria-describedby`. |
| `FormSubmitButtonProps` | type | Props `getSubmitButtonProps` returns for the submit `Button`: `type: "submit"`, `isPending`. |
| `FieldGroup` | component | A related set of fields under a shared `<fieldset>`/`<legend>`: legend, optional description, the fields. |
| `FieldGroupProps` | type | Props for `FieldGroup`: `legend`, `description`, `layout`, `children`, `className`, `style`, plus every native `<fieldset>` attribute. |
| `FieldGroupLayout` | type | `"single" \| "multi"`. |
| `ConfirmDialog` | component | Confirmation prompt built on `Dialog`: heading, message, Cancel/Confirm actions. Focus defaults to Cancel for `tone="destructive"`. |
| `ConfirmDialogProps` | type | Props for `ConfirmDialog`: `trigger`, `heading`, `message`, `confirmLabel`, `cancelLabel`, `tone`, `onConfirm`, `onCancel`, `className`, `style`, plus most of `Dialog`'s own props. |
| `ConfirmDialogTone` | type | `"neutral" \| "destructive"`. |
| `Toolbar` | component | Action bar built on react-aria-components' own `Toolbar`: leading actions, search/filter slot, trailing actions, with real roving-focus arrow-key navigation. |
| `ToolbarProps` | type | Props for `Toolbar`: `leading`, `search`, `trailing`, `className`, `style`, plus most of react-aria-components' own `Toolbar` props (`orientation`, `aria-label`, ...). |
| `NavGrid` | component | Grid of navigation cards with an optional heading. Ordinary linked tiles stretch their title link; interactive descriptions keep separate title links and controls. Action tiles use a `<button>`. |
| `NavGridProps` | type | Props for `NavGrid`: `heading`, `items`, `className`, `style`. |
| `NavGridItem` | type | One card, as data: `id`, `title`, `description?`, `icon?`, and either `href` or `onSelect` (mutually exclusive). |
| `SectionHeader` | component | Heading for a section within a page (as opposed to the whole-page `PageHeader`): eyebrow, title, description, actions slot. `level` picks its heading element. |
| `SectionHeaderProps` | type | Props for `SectionHeader`: `eyebrow`, `title`, `description`, `actions`, `level`, `className`, `style`, plus every native `<div>` attribute. |
| `SectionHeaderLevel` | type | `2 \| 3 \| 4 \| 5 \| 6`. |
| `Hero` | component | Above-the-fold message: eyebrow, heading, description, actions slot, optional media slot (switches to a two-column layout when supplied). `headingLevel` picks its heading element. |
| `SECTION_GROUND_CLASSES` | constant | Exhaustive Designer-owned surface, foreground, divider/connector, readiness-status, and separate neutral off-axis-mark policy for every `SectionGround`; base inherits its ambient surface, while sunken and inverse paint theirs; server-safe and exported from both blocks barrels. |
| `SectionGround` | type | `"base" \| "sunken" \| "inverse"`. |
| `SectionGroundClasses` | type | The complete class-map shape for one section ground, including readiness `status` and separately named neutral `offAxis` mark. |
| `SectionStatusTone` | type | `"success" \| "warning" \| "info"`; closed readiness-dot tones. A separate off-axis disposition uses neutral structural ink. |
| `HeroProps` | type | Props for `Hero`: `eyebrow`, `heading`, `description`, `actions`, `media`, `composition`, `headingLevel`, `size` (`display` or `compact`, with supported `default` alias), `ground`, `align`, `className`, `style`, plus every native `<section>` attribute. |
| `HeroAlign` | type | `"start" \| "center"`. |
| `HeroHeadingLevel` | type | `1 \| 2`. |
| `MarketingChapter` | component | Full-bleed marketing chapter band: marketing-scale title, optional description, prose slot. `headingLevel` picks its heading element. |
| `MarketingChapterProps` | type | Props for `MarketingChapter`: `title`, `description`, `children`, `headingLevel`, `ground`, `className`, `style`, plus every native `<section>` attribute except `title`. |
| `MarketingChapterHeadingLevel` | type | `2 \| 3`. |
| `ContentSection` | component | One marketing section anatomy: a header group (eyebrow, heading, description, actions) held to the prose measure, then a module slot for one or more content modules, at fixed spacing; stacked, or split with a visual in a 7/12 column. |
| `ContentSectionProps` | type | `ContentSectionStackedProps \| ContentSectionSplitProps`: `eyebrow`, `heading`, `description`, `actions`, `footnote`, `takeaway`, `source`, `headingLevel`, `size`, `emphasis`, `ground`, `layout`, `media`, `mediaSide` (supported split alias), `align` (stacked), `children`, `className`, `style`, plus every native `<div>` attribute except `title`. |
| `ContentSectionStackedProps` | type | Stacked section: `layout?: "stacked"`, `align?`, optional `media` after the text module. |
| `ContentSectionSplitProps` | type | Split section: `layout: "split-start" \| "split-end"`, optional `media`; supported `layout: "split"` alias requires `media` and accepts `mediaSide?`. |
| `ContentSectionLayout` | type | `"stacked" \| "split-start" \| "split-end" \| "split"` (supported alias). |
| `ContentSectionMediaSide` | type | `"end" \| "start"`. |
| `ContentSectionHeadingLevel` | type | `2 \| 3 \| 4 \| 5 \| 6`. |
| `ContentSectionAlign` | type | `"start" \| "center"`. |
| `MediaFigure` | component | Large media as a section module: framed media with an optional caption underneath. |
| `MediaFigureProps` | type | Props for `MediaFigure`: `children`, `caption`, `measure`, `framed`, `ground`, `className`, `style`, plus every native `<figure>` attribute. |
| `MediaFigureMeasure` | type | `"column" \| "content"`. |
| `FeatureGrid` | component | Titled collection of feature items: optional eyebrow/heading/description region, a grid of icon/heading/description items. |
| `FeatureGridProps` | type | Props for `FeatureGrid`: `eyebrow`, `heading`, `description`, `items`, `headingLevel`, `ground`, `className`, `style`, plus every native `<div>` attribute. |
| `FeatureGridItem` | type | One item: `id`, `icon?`, `heading`, `description?`. |
| `FeatureGridHeadingLevel` | type | `2 \| 3 \| 4 \| 5 \| 6`. |
| `Item` | component | Standalone item with required treatment, size and ground; one title link and independent copy, badge, meta and visual slots. |
| `Items` | component | Canonical bounded collection with labelled groups, numbered or connected order, two to four actor lanes, and independent disclosed rows. |
| `ItemData` | type | Stable id and heading; optional description, eyebrow, icon, meta, visual, href, span, badge and connected lane ID. |
| `ItemFigureData` | type | The existing figure slot: required ReactNode value, optional authored delta and `up`, `down` or `neutral` trend. |
| `ItemStatusData` | type | The existing status slot: an existing status tone and a visible ReactNode label. |
| `ItemProps` | type | ItemData plus required treatment, size and ground, and optional headingLevel (`3 \| 4`; omission keeps a paragraph). |
| `ItemBadge` | type | ReactNode label and optional existing Badge tone. |
| `ItemSize` | type | `"standard" \| "display"`. |
| `ItemTreatment` | type | `"plain" \| "rule" \| "plate"`. |
| `ItemSpan` | type | `"third" \| "half" \| "two-thirds" \| "full"`. |
| `ItemsProps` | type | Items, arrangement, columns, treatment, scale, size, groups, headingLevel, ground, order, reveal, lanes, end, endLabel, caption, aria-labelledby and className. |
| `ItemsArrangement` | type | `"columns" \| "rows" \| "bento" \| "stacked"`. |
| `ItemsColumns` | type | `1 \| 2 \| 3`; arrangement determines validity. |
| `ItemsScale` | type | `"item" \| "statement"`. |
| `ItemsLane` | type | Stable actor ID and authored ReactNode label; two lanes allow columns or stacks, while three or four lanes allow stacks. |
| `ItemsGroup` | type | Stable id, ReactNode label and an ordered list of canonical item IDs. |
| `AnatomyCallouts` | component | A specimen panel with 3 or 5 numbered markers and an ordered key. |
| `AnatomyCalloutsProps` | type | Required caller instance `id`, `label`, `panel`, `markers`, `keyLabel`; optional `legendSide`, `sample`, `headingLevel`, `ground`, `className`, `style`. |
| `AnatomyCalloutsMarker` | type | Stable `id`, labelled `target`, authored `heading` and `description`. |
| `RecordLedger` | component | A record on rules, without a panel. |
| `RecordLedgerProps` | type | `form: "record"` takes unique instance seed `id`, `head`, `groups`, `columns?`, `caption`, `flagLabel?`; accepts `ground`, `headingLevel`, `className`. |
| `LedgerRowData` | type | Static row: `id`, `label`, `detail?`, `status?` (`tone`, `label`), `flag?`. |
| `LedgerGroupData` | type | `id`, `label`, either `rows` or last-group `owner` (`initials`, `name`, `note?`), with optional owner-group `note`. |
| `Scene` | component | Static converge, evidence-trail or approval-chain figure with complete linear HTML. |
| `SceneProps` | type | Caller-unique `id`, authored `label`, `input`; optional `relationLabel`, `sample`, `headingLevel` and `className`. |
| `layoutScene` | function | Pure seeded geometry without DOM measurements. |
| `sceneRelationText` | function | One authored relationship sentence per source wire. |
| `SceneInput` | type | Closed union of the three launch templates, with an explicit geometry `seed`. |
| `SceneConverge` | type | Documents, target rows and one-to-two relations per source; at most one emphasis. |
| `SceneEvidenceTrail` | type | Cited documents, result rows, status and an optional person. |
| `SceneApprovalChain` | type | Prepared findings, exactly one subject, a review node and a decision with a person. |
| `SceneDisorder` | type | `none`, `low` or `medium`; medium is available only to converge. |
| `SceneFormat` | type | `pdf`, `email`, `sheet`, `doc`, `note`, `scan` or `calendar`. |
| `SceneDocument` | type | Stable `id`, document `format`, `title` and optional `origin`. |
| `SceneRow` | type | Stable `id`, `label`, `value` and optional status, figure or quiet treatment. |
| `SceneStatus` | type | Status tone and authored text. |
| `ScenePerson` | type | Initials, name and role note. |
| `SceneFinding` | type | Stable `id`, function label, title, subject line and status; one finding is the subject. |
| `SceneLayout` | type | Intrinsic width/height and document, card, wire, terminal, tag, node and person geometry. |
| `ScenePoint` | type | User-unit `x` and `y` coordinates. |
| `ScenePart` | type | A layout part's id, bounds and deterministic horizontal nudge. |
| `SceneWire` | type | Source/target ids, endpoints and rounded cubic path, with subject/emphasis flags. |
| `SceneTerminal` | type | A receiving row's anchor and subject flag. |
| `SceneTag` | type | Citation tag bounds and copy. |
| `SceneNode` | type | Review-node bounds and copy. |
| `ScenePersonLayout` | type | Person row bounds and decider-ring flag. |
| `Matrix` | component | Two parallel sides on equal plates, or a responsive grid of authored comparison cells. |
| `MatrixProps` | type | Optional `arrangement: "sides"` with two sides, or `arrangement: "grid"` with columns, rows, cell records and authored labels, including five-level mark labels and a visible key when marks occur; shared ground/heading controls and native root attributes except `title`. |
| `MatrixGridProps` | type | The `arrangement: "grid"` member of MatrixProps with columns, rows, authored cells and grid labels. |
| `MatrixQuadrantProps` | type | The `arrangement?: "sides"` member of MatrixProps with exactly two parallel sides. |
| `MatrixCellData` | type | One authored text, figure, status, empty or mark cell in a grid row. |
| `MatrixSide` | type | Stable id, required heading and optional label/description; a union requiring points or visual, never both. Labels appear on both sides or neither. |
| `MatrixHeadingLevel` | type | `2 \| 3 \| 4 \| 5 \| 6`. |
| `Specimen` | component | Labelled figure of 1 to 3 static product-UI panels (`single`, `row`, `stack`, `flow`); budgets validated. |
| `SpecimenProps` | type | Props for `Specimen`: `label`, `arrangement`, `connector`, `panels`, `className`, `style`, plus native `<figure>` attributes except `children`, `title`, `aria-label` and `aria-labelledby`. |
| `SpecimenArrangement` | type | `"single" \| "row" \| "stack" \| "flow"`. |
| `SpecimenPanel` | component | One specimen panel: an outline card with a title row, 1 to 3 parts and an optional footer. |
| `SpecimenPanelProps` | type | Props for `SpecimenPanel`: `SpecimenPanelContent` plus native `<div>` attributes except `title` and `children`. |
| `SpecimenPanelContent` | type | What one panel shows: `title?`, `meta?`, `status?`, `badge?`, `parts`, `footer?`. |
| `SpecimenPanelItem` | type | One entry of `Specimen`'s `panels`: `SpecimenPanelContent` plus `id`. |
| `SpecimenFooter` | type | A panel footer: `assignee?`, `note?`. |
| `SpecimenAssignee` | type | `initials` (decorative), `name`, `note?`. |
| `SpecimenTone` | type | `"success" \| "warning" \| "danger" \| "info" \| "neutral"`. |
| `SpecimenStatus` | type | A state in words: `tone`, `label`. |
| `SpecimenPart` | type | Union of the seven part shapes, keyed by `type`. |
| `SpecimenPartType` | type | `"fields" \| "status-rows" \| "meter" \| "table" \| "schedule" \| "shares" \| "files"`. |
| `SpecimenFieldsPart` | type | `type: "fields"`: `label?`, `columns?` (`1 \| 2 \| 4`), `items` (1 to 6). |
| `SpecimenField` | type | `id`, `label`, `value`. |
| `SpecimenStatusRowsPart` | type | `type: "status-rows"`: `label?`, `items` (1 to 6), optional `mobileRows: 3`. |
| `SpecimenStatusRow` | type | `id`, `label`, `detail?`, `status`. |
| `SpecimenMeterPart` | type | `type: "meter"`: `label`, `value`, `scaleMax`, `limit?`, `direction?`, `tone`, `valueText`, `limitText?`, paired `previous?`/`previousText?`, `status?`, `note?`. |
| `SpecimenTablePart` | type | `type: "table"`: `label?`, `caption`, `columns` (1 to 4), `rows` (1 to 5). |
| `SpecimenTableColumn` | type | `id`, `label`. |
| `SpecimenTableRow` | type | `id`, `cells` (one per column; the first is the row header). |
| `SpecimenTableCell` | type | `{ text }` or `{ status }`. |
| `SpecimenSchedulePart` | type | `type: "schedule"`: `label?`, `items` (1 to 6). |
| `SpecimenScheduleItem` | type | `id`, `date`, `label`, `amount?`, `status?`. |
| `SpecimenSharesPart` | type | `type: "shares"`: `label?`, `items` (1 to 6). |
| `SpecimenShare` | type | `id`, `name`, `share` (0 to 100), `shareText`, `status?`. |
| `SpecimenFilesPart` | type | `type: "files"`: `label?`, `items` (1 to 6). |
| `SpecimenFile` | type | `id`, `format`, `name`, `source?`. |
| `OrderedStepSequence` | component | Editorial ordered sequence: optional heading region, authored ordinal/label/heading/body steps, responsive decorative connectors. |
| `OrderedStepSequenceProps` | type | Props for `OrderedStepSequence`: `eyebrow`, `heading`, `description`, `items`, `headingLevel`, `ground`, `className`, `style`, plus every native `<section>` attribute. |
| `OrderedStepSequenceItem` | type | One step: `id`, `ordinal`, `label?` (the actor tag), `heading`, `description?`. |
| `OrderedStepSequenceHeadingLevel` | type | `2 \| 3 \| 4 \| 5 \| 6`. |
| `OrderedStepSequenceGround` | type | Sequence-specific alias of the shared `SectionGround`: `"base" \| "sunken" \| "inverse"`. |
| `StatusList` | component | Grouped editorial status list: one legend and a definition list per group. |
| `StatusListProps` | type | Props for `StatusList`: `eyebrow`, `heading`, `description`, `labels`, `groups?`, `items?`, `legendLabel`, `headingLevel`, `ground`, `className`, `style`, plus every native `<section>` attribute. Provide `groups` or `items`, never both. |
| `StatusListGroup` | type | One group: `id`, `heading`, `items`. |
| `StatusListItem` | type | One row: either `id`, `label`, `detail?`, `state`, or `id`, `label`, `detail?`, `disposition`. |
| `StatusListReadinessItem` | type | A `StatusListItem` on the three-value readiness axis. |
| `StatusListDispositionItem` | type | A `StatusListItem` with an off-axis deliberate non-capability. |
| `StatusListLabels` | type | A label for each `StatusListState` plus a separately closed `dispositions` map. |
| `StatusListState` | type | `"available" \| "partial" \| "planned"`. |
| `StatusListDisposition` | type | `"not-offered"`, a deliberate non-capability outside the readiness axis. |
| `StatusListHeadingLevel` | type | `2 \| 3 \| 4 \| 5 \| 6`. |
| `Faq` | component | Expand/collapse question/answer list, under an optional heading region. Each item is a react-aria-components disclosure (native `details`/`summary` from `blocks/server`) with a turning `ChevronDown` — independent, not a coordinated accordion. |
| `FaqProps` | type | Props for `Faq`: `eyebrow`, `heading`, `description`, `items`, `headingLevel`, `ground`, `className`, `style`, plus every native `<div>` attribute. |
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
| `SectionFrame` | component | Full-bleed marketing section band: a `ground` surface, vertical section rhythm, horizontal page padding, and a measured inner column. Sets `data-designer-section-frame` on its outer `<section>`. Compose `ArticleBody`, `Stat`, and other blocks that do not own their own band inside it. |
| `SectionFrameProps` | type | Props for `SectionFrame`: `ground` (default `"base"`), `measure` (default `"content"`), `children`, `className`, `style`, plus every native `<section>` attribute. |
| `SectionMeasure` | type | `"content" \| "wide" \| "prose"`. How wide `SectionFrame`'s inner column is: it maps to the `--ui-width-content-max`, `--ui-width-wide-max`, or `--ui-width-prose-max` token. |
| `ConsentBanner` | component | Presentational consent notice: a region landmark named by its title, a body, an optional `privacyLink` slot after it, and two same-variant, same-size `Button`s for accept and reject. Props only: no consent state, storage, network call or built-in copy. Not a dialog. Always mounts an empty polite `role="status"` live region for an optional `status`. Sets `data-consent-banner` on its root. |
| `ConsentBannerProps` | type | Props for `ConsentBanner`: `title`, `body`, `acceptLabel`, `rejectLabel` (all `ReactNode`), `onAccept`, `onReject` (both `() => void`), `privacyLink?`, `status?` (a `ReactNode` rendered in an always-mounted polite live region), `presentation?` (`banner` by default, or `card`), `selectedChoice?` (`granted` or `denied`, card feedback only), `className?`, `style?`. |
| `mergeUiClasses` | function | Merges token-aware Tailwind utility classes with last-argument precedence; used by surface-level compositions built from UI primitives. |
| `Shell` | component | The persistent application frame. Carries `Shell.Header`, `Shell.SideNav`, `Shell.Main`, `Shell.Rail`, `Shell.Footer`. |
| `ShellProps` | type | Props for `Shell`: `children` (any subset of the five slots above, in any order), `skipLinkLabel` (default `"Skip to content"`), plus every native `<div>` attribute. |
| `ShellHeaderProps` | type | Props for `Shell.Header`: `children`, plus every native `<header>` attribute. |
| `ShellSideNavProps` | type | Props for `Shell.SideNav`: `children`, plus every native `<nav>` attribute (including `aria-label`, default `"Primary"`). |
| `ShellMainProps` | type | Props for `Shell.Main`: `children`, plus every native `<main>` attribute except `id` (fixed, for the skip link). |
| `ShellRailProps` | type | Props for `Shell.Rail`: `children`, plus every native `<aside>` attribute. |
| `ShellFooterProps` | type | Props for `Shell.Footer`: `children`, plus every native `<footer>` attribute. |
| `SkipLink` | component | Keyboard affordance to bypass nav chrome and jump straight to a page's content. Visually hidden until focused. |
| `SkipLinkProps` | type | Props for `SkipLink`: `targetId` (the jump target's `id`), `children` (the link's own visible text — no built-in copy), `className`. |
| `SiteHeader` | component | Public-site top chrome: brand slot, primary navigation slot (leading or centered), secondary action slot, actions slot. Renders the page's `banner` landmark. |
| `SiteHeaderProps` | type | Props for `SiteHeader`: `brand` (required), `nav`, `navPlacement` (`"centered"` default; explicit `"leading"` retains legacy positioning), `mobileLayout` (`"menu-brand-action"` default; explicit `"inline"` retains legacy positioning), `secondaryAction`, `actions`, `surfaceLabel` (text-only badge, last in the trailing region), plus every native `<header>` attribute. |
| `NavShell` | component | The responsive half of a public site's navigation: an inline `<nav>` from `tablet` up, a trigger-plus-drawer below it. |
| `NavDisclosure` | component | A non-modal navigation: a mobile sheet below `tablet`, an inline row from `tablet` up, and inline links when scripting is unavailable. |
| `NavDisclosureProps` | type | Props for `NavDisclosure`: required `children`, `aria-label` (default `"Primary"`), `triggerLabel` (default `"Menu"`), `trigger` (`"label"` default, or `"icon"`), and landmark `className`. |
| `NavShellProps` | type | Props for `NavShell`: `children` (the nav links, rendered in both the desktop row and the drawer), `aria-label` (default `"Primary"`), `triggerLabel` (default `"Menu"`), `closeLabel` (default `"Close menu"`), `className`, plus most of react-aria-components' own `DialogTrigger` props (`isOpen`, `defaultOpen`, `onOpenChange`). |
| `SiteFooter` | component | Public-site bottom chrome: grouped link columns, a secondary/legal row. Carries `SiteFooter.Column` and `SiteFooter.Legal`. Renders the page's `contentinfo` landmark. |
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
| `ChartFrame` | component | The shared plot/axes/grid/legend/table container `BarChart`, `LineChart`, `WaterfallChart`, `RangeChart`, and `ScatterChart` compose. |
| `ChartFrameProps` | type | Props for `ChartFrame`: `title`, `description`, `width`, `height`, `fit` (default `"fixed"`), `margin`, `xTicks`, `yTicks`, `legend`, `showSingleSeriesLegend` (default `false`), `table` (required), `tableFallbackLabel` (default `"View as table"`), `className`, `style`, `children` (render prop receiving the resolved `PlotArea`). |
| `ChartMargin` | type | `{ top, right, bottom, left }`, all `number`. |
| `ChartAxisTick` | type | `{ position, label }` — a pre-scaled pixel position plus its label. |
| `ChartLegendItem` | type | `{ label, color, mark?: "circle" \| "square" \| "diamond" \| "triangle" }`; omitted `mark` retains the color swatch. |
| `ChartTableSpec` | type | `{ headers, rows }` — the table-view fallback's data. |
| `PlotArea` | type | `{ x, y, width, height }` — the plot rectangle passed to `ChartFrame`'s `children` render prop. |
| `BarChart` | component | Categorical magnitude: one bar per category, grouped by series. |
| `BarChartProps` | type | Props for `BarChart`: `categories`, `series`, `colorDomain`, `title`, `description`, `width`, `height`, `fit` (default `"fixed"`), `marks` (default `"interactive"`), `valueFormat`, `barLabel` (default `"{series}, {category}: {value}"`), `categoryColumnLabel` (default `"Category"`), `tableFallbackLabel`, `className`, `style`. |
| `BarChartSeries` | type | `{ name, values, color? }`. |
| `LineChart` | component | Change over time: one line per series, one shared x/y scale, a crosshair + tooltip hover layer. |
| `LineChartProps` | type | Props for `LineChart`: `x`, `series`, `colorDomain`, `title`, `description`, `width`, `height`, `valueFormat`, `xFormat`, `keyboardHintLabel` (default `"use arrow keys to inspect values"`), `overlayLabel` (default `"{title}: {hint}"`), `xColumnLabel` (default `"X"`), `tableFallbackLabel`, `className`, `style`. |
| `LineChartSeries` | type | `{ name, values, color? }`. |
| `WaterfallChart` | component | Static accumulated changes from an opening total to a derived closing total, with signed value labels, connectors, and a required table fallback. |
| `WaterfallChartProps` | type | Props for `WaterfallChart`: required `title`, `start: { label, value }`, `steps: readonly { id, label, value }[]`, `end: { label, value? }`, and `labels: { table, category, value }`; optional `description`, `fit` (default `"fluid"`), `width` (default `360`), `height` (default `280`), `valueFormat` (default en-US number formatting; receives unsigned magnitude), `className`, and `style`. |
| `RangeChart` | component | Static intervals with authored activity/status labels and a native data table. |
| `RangeChartProps` | type | `title`, `description?`, `ticks`, `rows: readonly { id, label, from, to, status?: { tone: StatusMarkTone, label } }[]`, `labels: { table, category, from, to, status? }`, `fit?` (default `"fluid"`), `width?` (default `360`), `height?` (default fits wrapped content), `className?`, `style?`. |
| `ScatterChart` | component | Static numeric observations with direct labels, up to four series shapes, optional proportional area, and a native data table. |
| `ScatterChartProps` | type | `points: readonly { id, label, x, y, size?, series?, labelSide?: "start" \| "end" \| "above" \| "below" }[]`, `x` and `y: { label, min?, max? }`, `size?: { label }`, `series?: readonly { id, name }[]`, `labels: { table, category }`, required `title`, optional `description`, `fit?` (default `"fluid"`), `width?` (default `360`), `height?` (default `300`), `valueFormat?`, `className?`, and `style?`. |
| `Sparkline` | component | A bare inline trend — no axes/grid/legend/hover, still ships a table-view fallback. |
| `SparklineProps` | type | Props for `Sparkline`: `values`, `title`, `width`, `height`, `color`, `valueFormat`, `tableFallbackLabel` (default `"View as table"`), `valueColumnLabel` (default `"Value"`), `className`, `style`. |
| `getThemeInitScript` | function | Returns a self-contained head script (string) that stamps `data-theme` before first paint. Takes `{ storageKey?, defaultTheme? }`. |
| `ThemeInitScriptOptions` | type | Options for `getThemeInitScript`: `storageKey?` (default `"ui-theme"`) and `defaultTheme?` (default `"system"`). |
| `ThemeProvider` | component | Holds/persists the three-state theme preference and keeps `<html data-theme>`/`color-scheme` in sync. |
| `ThemeProviderProps` | type | Props for `ThemeProvider`: `children`, `storageKey?`, `defaultPreference?`. |
| `useTheme` | function | Hook returning `{ preference, resolvedTheme, setPreference }` from the nearest `ThemeProvider`. |
| `ThemeContextValue` | type | `{ preference: ThemePreference; resolvedTheme: ResolvedTheme; setPreference(next: ThemePreference): void }`. |
| `ThemePreference` | type | `"system" \| "light" \| "dark"`. |
| `ResolvedTheme` | type | `"light" \| "dark"` — never `"system"`. |
| `THEME_PREFERENCES` | value | `["system", "light", "dark"] as const` — the three valid preference strings. |
| `DEFAULT_STORAGE_KEY` | value | `"ui-theme"` — the default `localStorage` key `ThemeProvider` and `getThemeInitScript` both use. |
| `ThemeToggle` | component | Accessible control cycling System → Light → Dark → System, built from this package's own `Button`/`Icon` atoms. |
| `ThemeToggleProps` | type | Props for `ThemeToggle`: `preferenceLabels`, `toggleLabel`, `preferenceAnnouncement`, plus everything `Button` accepts except `children`/`onPress`. |

## Tests

`WaterfallChart.test.tsx` covers accumulated totals, signed labels, connectors,
and static fallback behavior. This source test does not ship with the package.

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
  non-default `storageKey`) it evaluates the literal head script
  exactly the way a browser executing an injected `<head>` script would,
  separately runs `ThemeProvider`'s own underlying calls
  (`readStoredPreference` + `applyThemeDom`), and asserts both leave
  `<html>`'s `data-theme` attribute and `color-scheme` style in the
  identical state.
- **`render-environment.test.ts`** proves the "Server Components" claims
  above against the REAL compiled output, not a simulation: a real `node
  --conditions=react-server` subprocess against each `*/server` subpath's
  compiled entry (must resolve cleanly), the same probe against its
  original barrel as a negative control (must still fail — proving the
  server entry does real work rather than merely existing), a normal-node
  resolution check across every `package.json#exports` subpath (proving
  this change added nothing that regresses), and an exhaustiveness check
  that `RENDER_ENVIRONMENT` covers every real subpath and declares no
  phantom one, in both directions.
- **`environment-conformance.test.ts`, `environment-conformance-worker.test.ts`,
  and `environment-conformance-cli.test.ts`** cover
  `checkEnvironmentConformance` and its CLI directly: every one of the
  ternary's three states, both violation directions (independently and
  together in the same run), and a real-package integration test against
  this package's own compiled `dist/`. **`environment-conformance.adversarial.test.ts`**
  is the separating proof described in "Environment-declaration-
  consistency gate" below: the real, compiled CLI and a bare count
  comparison, run over the identical renamed-subpath fixture in the same
  test, asserted to disagree.

## Token-purity gate (`@clossys/designer/gate`, `designer-token-check`)

`@clossys/writer` ships a scanner gate that proves every user-facing
string in a source tree is registered. Before this release, this package
had no equivalent for the VISUAL half of the same contract: a hardcoded
`#3b82f6` or `padding: 13px` anywhere in `ui` was invisible in exactly the
way an unregistered string used to be. This package now ships that mirror,
deliberately kept OUT of the component ladder barrel (`src/index.ts`) and
its `"."` export — it is tooling, not a component — reachable instead from
its own subpath and an installable CLI:

- **`scanStyleSources(root, options?)`** (from `@clossys/designer/gate`)
  walks a real source tree and extracts every hardcoded styling literal: a
  hex color (`#rgb`/`#rrggbb`/`#rrggbbaa`), an `rgb()`/`rgba()`/`hsl()`/
  `hsla()`/`oklch()`/`oklab()`/`lab()`/`lch()` color function, a raw CSS
  length (`13px`, `1.5rem`, `2em`, ...), or a Tailwind arbitrary-value
  class (`bg-[#3b82f6]`, `p-[13px]`, `w-[var(--x,64px)]`). A legitimate
  Tailwind TOKEN class (`text-ink-primary`, `bg-surface-base`, `p-4`,
  `z-10`, `rounded-control`) is never a candidate — it carries a NAME, not
  a hardcoded value, so it never matches any extraction pattern in the
  first place. Zero runtime dependencies, matching `@clossys/writer`'s
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
- **`designer-token-check [scan-dir] [--tokens <path-to-json>]`** is the
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
  supplied file rather than `@clossys/designer/tokens`.

## WCAG contrast gate (`@clossys/designer/tokens`, `designer-contrast-check`)

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
  `relativeLuminance`, `parseOklch`** (from `@clossys/designer/tokens`,
  promoted from that internal module — no behavior change, only
  visibility) — the WCAG colour math itself, pure and zero-dependency.
- **`CONTRAST_PAIRS`** (same subpath) — an EXPLICIT, checked-in list of 107
  `{ foreground, background, level, minimumRatio, compositeOver? }` pairs
  (`compositeOver` is a token, or a literal colour such as `oklch(0 0 0)`
  for a backdrop no token names, which is how the eight glass pairs check
  the overlay header's ink and focus indicator on its glass over a white
  and a black backdrop),
  ratified from `contrast.test.ts`'s own hand-curated pair map rather than
  auto-derived from token names. An earlier design assumed this gate could
  self-extend, deriving one pair per `--<role>-on-<ground>`-shaped token
  name; counted against this package's real 182 tokens, only 5 actually
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
  read the data; categorical marks and axis labels are checked), the modal/popover
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
- **`designer-contrast-check [tokens-css-file]`** — the installable CLI,
  mirroring `designer-token-check`'s shape and this repository's three-state
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
  the `WCAG contrast gate (designer-contrast-check)` job — a gate that ships
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
Running `npx designer-contrast-check` against this package's own
`styles/tokens.css` with no arguments returns `0`, because the relief is
real and documented, not because the failures were excluded from the
pair list to force a green run. Dark mode's own categorical steps all
clear 3:1 on their own and carry no exception at all — if a future
palette edit ever moved one of dark's slots under the floor, it would
report as a genuine, unrelieved `"below-threshold"` finding.

Inline charts check their small axis labels at 4.5:1 using secondary ink,
and all eight categorical marks at 3:1
against the actual base and sunken grounds. Light slots 2–5 measure below
3:1 on those grounds (approximately 2.94/2.58/1.99/2.47 on base and
2.68/2.36/1.82/2.26 on sunken). These exact pairs carry a separate,
measured labels/table compensation policy; the original raised-surface
slots 3–5 remain unchanged. All other light slots and every dark slot must
clear 3:1 outright. The chart ground checks cover the raw findings,
theme-specific relief, stale exceptions and unrelieved dark failures.
The supplementary axis baseline retains its axis-above-grid invariant;
it is not a threshold pair.

## Identity kit (`@clossys/designer/tokens`) — #1210

The master brand mark contract above (`validateMasterMark`) validates a
consumer-SUPPLIED SVG. `identity-kit.ts`/`identity-checks.ts` are the
generative and judgement halves that produce one in the first place, per
[#1210](https://github.com/clossys/foundry/issues/1210): every new product
gets a usable logo set in v0 without waiting on a human designer, and a
custom mark never blocks it.

**Two ways a direction is born.** `generateIdentityDirections(brand, tokens)`
deterministically builds three candidates — a wordmark (a roundel monogram
plus the brand name) and two monogram-only shapes (circle, rounded square)
— from a brand name and already-resolved token literals; the same input
always produces byte-identical SVG, never a fresh roll. `adoptSuppliedMark(
{ brand, suppliedSvg, tokens })` instead validates and derives the same
variant set from a client's existing logo, or a human designer's or image
model's output — the `found` -> adopted path #1210 names. Neither path does
free-hand drawing: both compose the same small set of primitives (a glyph, a
badge wrapper, `recolorSvg`), the "deterministic mechanics" split #1187's
"who does what" table draws for this package's role.

**Seven variant roles**, every direction: `primary` (the flagship lockup,
for light surfaces), `mark` (icon/monogram alone), `mono` (`mark`
recoloured to `currentColor`, single-colour legible), `light` (`primary`
again, its own named file), `dark` (`primary` recoloured to the
inverse-ink token, for dark surfaces), `favicon` (`mark` via `currentColor`,
built the same way as `mono`), and `appIcon` (`mark` composed onto an
accent-filled rounded-square badge, its own viewBox scaled and centred to
fit the badge). For a GENERATED direction, `primary`/`mark` are
ink-coloured (drawn via `currentColor` under a `color:` style set to the
`ink` token); for an ADOPTED direction, `primary`/`mark` are the supplied
SVG's own colours, unchanged — only `mono`/`light`/`dark`/`favicon`/
`appIcon` are recoloured onto token colours in both cases.

**What the recolour does with a two-tone mark (#1537).** Flattening a
two-tone mark onto one colour erases the contrast between its tones, so
`recolorSvg` knocks a mark out instead, but only a mark it recognises as a
flat two-tone mark. **Recognised:** the whole document is groups (carrying
only `transform`) and basic shapes (`path`, `rect`, `circle`, `ellipse`,
`polygon`, `polyline`, `line`), each with an explicit hex `fill`
(`#rgb` or `#rrggbb`, no alpha; a `stroke` is `none` or the same hex);
exactly two tones (`#fff` and `#FFFFFF` are one tone), every first-tone
shape before every second-tone shape; a root carrying only `xmlns`, a
parseable `viewBox`, `width`, `height`, `role`, `aria-label` and
`data-clear-space`; no `id`, reference, `style`, class, text, comment or
root paint. Such a mark is recoloured as a knockout: each tone is painted
in the variant's single colour and masked out where the other tone paints,
so the surface or badge shows through and the tones keep their contrast.
The knockout's root is re-emitted from its parsed attributes (constant
names, escaped values, double-quoted), never sliced out of the input.
**Caps:** the recogniser reads at most 32 attributes on a tag, 2000
elements in all (every `<g>` and every shape) and 32 groups deep, in one
linear, non-backtracking pass, so its cost stays bounded on a crafted
document and its recursion depth is bounded. An input over any cap is not
recognised and stays flat, exactly as any other unrecognised input.
**Everything else stays flat:** any other input (one tone, three or more
tones, tones in an A-B-A order, root or group paint, `<use>`, `<style>`,
`style=`, classes, ids, references, named/`rgb()`/`currentColor`/alpha
paint, text, a value holding a quote, `<` or `&`, or an input over a cap)
is recoloured exactly as before, every `fill`/`stroke` attribute onto the
variant's colour, so its tones become one colour and their boundary is
lost. That is byte-for-byte the flat recolour of the previous release: the
derived variant is never broken by the knockout and never gains an
attribute its input lacked. The contrast check skips only the `<mask>`s
`recolorSvg` itself emits, matched by their exact generated form (the
`recolor-<8 hex>-a|b` id, one white coverage `<rect>`, then only groups and
self-closing shapes painted `#000` or `none`, closed by `</mask>`); a
self-closing or malformed look-alike, and a mark's own `<mask>`, are judged
on their paint as before. Treat the derived variants as a starting point
for review.

**Four checks judge every direction**, mirroring the "package owns
judgment, every check reports satisfied/violated/indeterminate" split this
repository holds every gate to:

| Export | Kind | Purpose |
| --- | --- | --- |
| `checkIdentityContrast(tokens)` | function | WCAG contrast (via `contrastRatio` from `color.ts`) on the four pairs a shipped kit actually composites: `primary`/`mark` (ink on the light surface), `dark` (inverse ink on the dark surface), `appIcon` (badge glyph on its accent background). Floor: `IDENTITY_MIN_CONTRAST` (`3`, WCAG 1.4.11 non-text). |
| `checkMinimumSize(svg)` | function | A declared-geometry PROXY for legibility at small sizes: the finest `stroke-width` in `svg` as a fraction of its own `viewBox`'s shorter side. This package does not rasterize, so this is a heuristic signal, not a rendered measurement — see the function's own header. |
| `checkClearSpace(svg)` | function | Reads the `data-clear-space` ratio every generated/adopted variant declares on its root `<svg>` and checks it against a minimum. Declared, not measured, for the same reason as minimum size. |
| `checkSingleColourLegibility(svg)` | function | Structural: the `mono` variant must paint through `currentColor` alone, with no other explicit `fill`/`stroke` colour literal left over. |
| `judgeIdentityKit(direction, tokens)` | function | Runs all four against one `IdentityDirection` and returns a per-check `{ verdict, findings }` plus an overall `verdict`, flattened `findings`, and `ok` — `true` only when every check is `satisfied`; an `indeterminate` check never counts as a pass, and any `indeterminate` check makes the overall `verdict` `indeterminate` too (fails closed), even alongside a `violated` one. |
| `identityKitReport(direction, tokens, version)` | function | Builds the full report shape the repository contract docs/contracts/check-output-envelope.json declares (not shipped with this package) — `{ package, version, verdict, summary, findings, nextAction? }` — for one direction. |

An `indeterminate` verdict is never a silent pass: a check that could not
actually evaluate its input (no `viewBox`, no `data-clear-space` declared at
all) reports that plainly, the same "a gate that passes because it checked
nothing is worse than no gate" discipline the WCAG contrast gate above
holds to.

`IdentityVerdict` (`satisfied`/`violated`/`indeterminate`) and
`IdentityFinding` (`{ rule, severity, message, path? }`) are this package's
own instance of the shared vocabulary the repository contract docs/contracts/
check-output-envelope.json declares (issue #1174/#1190; that contract does
not ship with this package) — not a second, locally-invented verdict or
finding shape.

**Outputs and the asset roster.** This package does not write files or
register anything itself — `generateIdentityDirections`/`adoptSuppliedMark`
return SVG strings; a caller (the coding agent driving a real engagement,
or Launcher's compose step) writes the chosen direction's variants to
`clossys/designer/assets/` and, for the roles a static-asset roster names
(`favicon-svg` at minimum, directly from a variant's SVG), registers them
where Publisher's own asset-roster reader (`@clossys/publisher`'s
`deriveBrandAssetRoster`/`checkBrandAssetRoster`) expects them — see that
package's README for the full role list and required pixel sizes for the
raster roles this package does not produce.

```ts
import {
  generateIdentityDirections,
  identityKitReport,
  judgeIdentityKit,
  type IdentityTokenInput,
} from "@clossys/designer/tokens";

const tokens: IdentityTokenInput = {
  ink: "oklch(0.2178 0 0)",
  onInverse: "oklch(0.9702 0 0)",
  surfaceBase: "oklch(0.9702 0 0)",
  surfaceInverse: "oklch(0.2178 0 0)",
  accent: "oklch(0.4748 0 0)",
  onAccent: "oklch(0.9702 0 0)",
  fontFamily: "system-ui, sans-serif",
};

const [wordmark, circle, square] = generateIdentityDirections({ name: "Acme Rockets" }, tokens);
const judgement = judgeIdentityKit(wordmark, tokens); // { ok, verdict, findings, checks: { contrast, "minimum-size", "clear-space", "single-colour-legibility" } }
```

```ts
import { identityKitReport } from "@clossys/designer/tokens";

identityKitReport(wordmark, tokens, "0.5.0");
// {
//   package: "@clossys/designer",
//   version: "0.5.0",
//   verdict: "satisfied",
//   summary: "The \"wordmark\" identity kit satisfies all four checks (contrast, minimum size, clear space, single-colour legibility).",
//   findings: [],
// }
```

**Composing a lockup from a supplied mark.** `composeLockup({ brand,
suppliedSvg, tokens, wordmark, fontLicence, header })` returns a
JSON-serialisable spec for a mark-plus-wordmark lockup: the supplied SVG
trimmed but otherwise unchanged as `mark`, its `light` and `dark` recolours
from `adoptSuppliedMark`, the `wordmark` text, the `fontLicence` record
(`{ family, outlining }`), `gapRatio` and `wordmarkSizeRatio` (the gap and
the wordmark's font size as ratios of the mark's height, taken from the
generated wordmark direction), the `header` selection (`"mark"` or
`"lockup"`) and `rendering: "live-text"`. A non-SVG mark, an empty
wordmark, an unrecognised `header` or `fontLicence.outlining` value, or a
`fontLicence.family` outside the font-family character set is refused with
an `IdentityKitValidationError` that lists each reason. `composeLockup` does
not outline glyphs (that needs a font parser, which this package does not
depend on, so `outlining: "permitted"` records the licence and does not
change the output), does not judge whether the mark is legible, and does
not check that the font loads. `Brandmark` from `@clossys/designer/shell`
renders a lockup as live text at the same proportions.

## Environment-declaration-consistency gate (`@clossys/designer/gate`, `designer-environment-check`)

"Server Components" above documents `RENDER_ENVIRONMENT` — a plain
`Record<string, "server-safe" | "client-only">`, one entry per
`package.json#exports` subpath, hand-written by a human after running each
`*/server.ts` entry through a manual `node --conditions=react-server`
probe (see each `*/server.ts` file's own header). Before this gate, nothing
ever verified this record stayed in step with the MANIFEST it describes: a
subpath could be added to (or removed or renamed in)
`package.json#exports` with no matching edit here, or vice versa, and
nothing would notice. This gate closes
[issue #405](https://github.com/clossys/foundry/issues/405),
narrowed by that issue's own correction comment once
[issue #358](https://github.com/clossys/foundry/issues/358)
routed the FULL verification elsewhere (see the next paragraph).

**What this gate checks, precisely, and what it deliberately does not —
read both halves, because a `"satisfied"` verdict is worthless if
mistaken for the other one.** It checks that `RENDER_ENVIRONMENT`'s own
key set and `package.json#exports`' own subpath set are the SAME SET, in
both directions — nothing more. A subpath present in `package.json#exports`
with no entry in `RENDER_ENVIRONMENT` is *undeclared*; a subpath present in
`RENDER_ENVIRONMENT` with no matching real export is a *stale declaration*.
Two different defects, two different fixes, never collapsed into one
"mismatch." **It performs NO module resolution and walks no module
graph.** It never imports, requires, or inspects the compiled entry a
subpath points to — only the two DECLARATIONS (the manifest's `exports`
map and `RENDER_ENVIRONMENT`) against each other. A `"satisfied"` verdict
means the declaration is internally consistent with the manifest; **it
says nothing about whether the declaration is true of the compiled
output** — whether a subpath marked `"server-safe"` actually resolves
safely under the `react-server` export condition is a genuinely different
capability (real module-graph resolution under a declared export
condition), and [issue #358](https://github.com/clossys/foundry/issues/358)
places that resolver in `builder`, shared with a second declaration shape
(layering-seam conformance), specifically so the same resolver serves both
rather than being built twice. This gate is not a smaller version of that
capability and does not pretend to be one.

`designer-environment-check` is an internal-consistency check with **no
close condition** — both sides are this package's own manifest and
declaration, not an external measurer. A contract-level exemption slot to
record that absence is blocked on
[issue #906](https://github.com/clossys/foundry/issues/906).

**Why a bare count comparison is the wrong tool, named explicitly rather
than left implicit.** The obvious-looking cheaper check is: count
`RENDER_ENVIRONMENT`'s keys, count `package.json#exports`' subpaths, and
call it satisfied when the counts match. A fixture where one subpath is
RENAMED — never added, never removed — keeps both counts identical while
the real SETS diverge: the new name is undeclared and the old name is now
a stale declaration. `environment-conformance.adversarial.test.ts` proves
the gap directly, spawning the real compiled CLI by its compiled path
(the same way this repository invokes every gate) against a renamed-
subpath fixture: this gate exits `1`, while a bare count comparison, run
over the IDENTICAL fixture in the same test, exits `0`.

- **`checkEnvironmentConformance(packageRoot)`** (from
  `@clossys/designer/gate`, async) — loads `packageRoot`'s
  `package.json#exports` subpath set and `dist/render-environment.js`'s
  `RENDER_ENVIRONMENT` key set (via a real `node` subprocess — see
  `environment-conformance-worker.ts`'s own header for why an in-process
  dynamic `import()` cannot stand in for this under `vitest`) and compares
  the two sets, in both directions. Returns issue #405's own three-state
  ternary, never a boolean:
  - `"satisfied"` — the two sets are identical, over at least one subpath
    (never "no error was thrown" — `agreedSubpaths` names every subpath
    both sides agree exists).
  - `"violated"` — `violations` lists every `undeclared-subpath` (a real
    export with no declaration) and every `stale-declaration` (a
    declaration with no matching real export), not just the first, and
    each violation names its own direction.
  - `"indeterminate"` — `indeterminateReasons` gives a machine-readable
    reason: the manifest is missing or unparseable, the manifest declares
    no (or an empty) `exports` map, `RENDER_ENVIRONMENT` is missing (`dist/`
    was never built) or does not parse into a plain string-keyed object,
    or the declaration-loading subprocess itself failed.
- **`designer-environment-check [package-dir]`** — the installable CLI,
  exit `0`/`1`/`2` matching `"satisfied"`/`"violated"`/`"indeterminate"`
  directly. Defaults to this package's own root.

## What's deliberately not here

**Atoms:** thirty-three ship —
`Button`, `Icon`, `TextField`, `Badge`, `Card`, `Breadcrumb`, `Link`,
`Checkbox`, `Switch`, `Select`, `Textarea`, `Avatar`, `Spinner`, `Menu`,
`Dialog`, `Tabs`, `Table`, `Field`, `Skeleton`, `Tooltip`, `Banner`,
`RadioGroup`, `Popover`, `DateField`, `ComboBox`, `SearchField`,
`FileTrigger`, `Disclosure`, `ProgressBar`, `Separator`, `Chip`,
`StatusMark`, `Meter` (the last two added for data shown inside content
specimens). No `Modal` exposed as a public atom of
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

**Blocks:** forty-one ship — `AccountMenu`, `PageHeader`, `EmptyState`, `DataTable`,
`DetailView`, `Pagination`, `Stat`, `Form`, `FieldGroup`, `ConfirmDialog`,
`Toolbar`, `NavGrid`, `SectionHeader`, `Hero`, `ContentSection`, `SectionIntro`, `MediaFigure`, `SectionFrame`, `MarketingChapter`,
`FeatureGrid`, `Item`, `Items`, `Tree`, `AnatomyCallouts`, `RecordLedger`, `Scene`, `Matrix`, `Specimen`,
`SpecimenPanel`, `OrderedStepSequence`, `StatusList`, `Faq`, `PricingTable`,
`Testimonial`, `ArticleBody`, `ConsentBanner`, `Panel`, `Drawer`,
`ResizablePane`, `CommandMenu` and `AppNavigation` — completing this layer. No
`FilterBar` block:
`DataTable`'s own `toolbar` slot (and `Toolbar`'s own `search` slot) are
deliberately plain `ReactNode`s, not a block with its own opinion about
what a filter bar contains — a consumer composes filter controls from
this package's own atoms (`Select`, `TextField`, `Popover`) directly into
whichever slot fits.

**Views:** `ErrorView` and `AuthView` moved to `@clossys/publisher/web`; the list is meant to stay
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

**Charts:** seven ship — `ChartFrame`, `BarChart`, `LineChart`, `WaterfallChart`, `RangeChart`, `ScatterChart`, `Sparkline`
— no `PieChart`/`DonutChart` (part-to-whole reads reliably only up to
about six segments and a bar communicates the same comparison more
precisely at any count — see the dataviz reference's anti-patterns list),
no `Heatmap` (not supplied by this layer), and
deliberately **no dual-axis option on `BarChart`/`LineChart`** — that
omission is not a gap to fill later, it's the one hard rule this layer
does not bend on. No charting library is a dependency, and the scale/color
helpers under `charts/internal/` stay unexported — this ships seven
components, not a general-purpose numerical or color library (see
`atoms/internal/cx.ts`/`ui-vars.ts` for the same precedent one layer down).

## Requirements

Node 20+. React 18+. Tailwind CSS v4.

All six peers declared in `peerDependencies` — `react`, `react-dom`,
`react-aria-components`, `tailwind-merge`, `tailwindcss`, and
`@internationalized/date` — are optional (`peerDependenciesMeta`), following
the same per-subpath pattern `@clossys/publisher` documents: which ones a
given import needs depends on the subpath you import, not on the package as
a whole.

- No peers on import: `tokens`, `tokens/server`, every CSS subpath (`tokens.css`, `theme.css`,
  `compiled.css`, `utilities.css`, `brand-template.css`), `icons`, `gate`, and
  `render-environment`.
- `react`: `atoms`, `blocks`, `shell`, `charts`, `theme`, and each `/server`
  component subpath. `tokens/server` does not require React.
- `react-aria-components`: `atoms`, `blocks`, and `shell` only — `charts`
  and `theme` render without it.
- `tailwind-merge`: imported by every React component subpath through the
  shared class-merge helper; a missing install degrades to an unmerged
  class join rather than failing, and `assertTailwindMergeVersion()` from
  `tokens/server` catches an installed-but-out-of-range version.
- Not imported by this package at all (consumer-owned): `react-dom` is
  your own render call, and `@internationalized/date` is only needed when
  you construct a `DateField` value.

## Hero backdrop contract (`@clossys/designer/tokens`)

A per-brand hero visual — the picture, video, canvas or chart behind the
hero's text — has one sanctioned shape here. A bespoke backdrop has needed
the same five fixes each time: text that stays readable over the visual's
worst frame, a layer that never takes pointer events, a layer that assistive
technology skips, a still frame for reduced motion, and a load cost that
cannot block first paint. `BackdropContract` states those as data, and two
checks hold a backdrop to it. This is data and checks only: it adds no
component, CSS or token, and it is not wired into any Publisher block.

**The four kinds.** `BACKDROP_KINDS` lists them, and `BackdropKind` is their
union. `BackdropContract` is a union on `kind`:

| `kind`   | Shape beyond the shared fields                                                      |
| -------- | ----------------------------------------------------------------------------------- |
| `image`  | `reducedMotion` is optional: an image is its own still frame.                       |
| `video`  | `reducedMotion: { fallbackFrame }` is required.                                     |
| `canvas` | `reducedMotion: { fallbackFrame }` is required.                                     |
| `chart`  | `reducedMotion` is required, and `illustrative: true`: no information lives only there. |

Every kind carries `scrim` (`BackdropScrim`: `token`, `textToken` and
`worstCaseBackdrop`), `ariaHidden: true`, `pointerEvents: "none"`, and
`loading` (`BackdropLoading`: `strategy` of `"lazy"` or `"idle"`, and
`budgetBytes`). `reducedMotion` is a `BackdropReducedMotion`. `scrim.token`
and `scrim.textToken` name registry tokens, and `worstCaseBackdrop` is an
opaque six-digit hex or `oklch()` color the author states as the lightest
or busiest the backdrop can show. Use `--color-overlay-scrim` for the scrim
(it darkens in the dark theme) and a text token that stays light in both
themes, such as `--color-neutral-50`. Do not use `--color-ink-on-inverse`
for hero text: it is the ink for the inverse plate, which turns light in
the dark theme, so the ink turns dark there and fails over the darkened
scrim.

**The five rules.** `checkBackdropContract(contract, { tokens?, darkTokens?, themes? })` returns a
`BackdropReport` (`{ ok, findings, unchecked, themes }`) and never throws. Each
`BackdropFinding` carries a `BackdropRuleId` and a developer message.

| Rule id                   | Passes when                                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `scrim-contrast`          | `scrim.token` composited over `worstCaseBackdrop` gives `scrim.textToken` a contrast of at least 4.5 (the `AA` constant), in light and dark.    |
| `aria-hidden`             | `ariaHidden` is `true`, and a `chart` is `illustrative: true`.                                                                                  |
| `pointer-events`          | `pointerEvents` is `"none"`.                                                                                                                    |
| `reduced-motion-fallback` | A `video`, `canvas` or `chart` has a non-empty `reducedMotion.fallbackFrame`. An `image` needs none.                                            |
| `lazy-loading-budget`     | `loading.strategy` is `"lazy"` or `"idle"`, and `loading.budgetBytes` is a positive integer no larger than `BACKDROP_BUDGET_CEILING_BYTES`.     |

`BACKDROP_BUDGET_CEILING_BYTES` is 2 MiB (2,097,152 bytes), the most
transferred bytes a backdrop may declare. The tokens resolve through
`BackdropCheckOptions.tokens`, which defaults to `TOKENS` and so to the
default (light) values, following `var()` alias chains the way the contrast
gate does.

**Both themes.** The scrim pairing must hold in the light and the dark
theme, the two themes the contrast gate checks: `styles/tokens.css` turns
the dark theme on by itself under `prefers-color-scheme: dark` unless the
page sets `data-theme="light"`. `TOKENS` holds light values only and the
check reads no stylesheet, so pass the dark theme as
`BackdropCheckOptions.darkTokens`: a registry of the dark theme's values
layered over the light one. With it, each theme is measured and a failure
names its theme.

A token counts as theme-dependent when its entry in either registry, or in
`TOKENS`, has `themeDependent: true`; the flag on a token you define
yourself is trusted as you set it. Every theme-dependent token on the
scrim's or the text's alias chain must carry its own dark value in
`darkTokens`. One whose dark entry repeats its light value (a registry
spread from `TOKENS` with only some tokens overridden, or the light
registry passed whole) is `unchecked` with `theme-unchecked`, naming the
token, and `ok` is `false`. Without `darkTokens`, any theme-dependent token
on either chain is `theme-unchecked` the same way. A light-theme failure is
still a finding, and a pairing whose tokens never change with the theme
needs no `darkTokens`.

A page that forces the light theme with `data-theme="light"` on its root
states that with `themes: "light-only"` (the default is `"both"`): the dark
pass is skipped, and the report's `themes` is `["light"]` rather than
`["light", "dark"]`, so the result says what it covered. Do not use it for a
page that lets `prefers-color-scheme: dark` switch the theme.

**Fails closed.** A rule the check cannot evaluate is reported in
`unchecked` (a `BackdropUnchecked`, with a `BackdropUncheckedReason`) and
`ok` is `false`: a token the registry does not hold
(`unresolvable-token`), a token or `worstCaseBackdrop` that is not a color
it can read, or a translucent text token (`unparseable-token`,
`unparseable-backdrop`), a theme-dependent token with no dark value of its
own (`theme-unchecked`), a `kind` outside the four (`unknown-kind`), and a
malformed contract (`malformed-contract`). A finding means a rule was
evaluated and broken; `unchecked` means it was not evaluated. Neither is a
pass.

**Checking the rendered element.** `checkBackdropElement(element)` returns
the same report shape with its own rule ids (`BackdropElementRuleId`):
`element-aria-hidden` (`aria-hidden="true"`), `element-pointer-events`
(`pointer-events: none`, read from computed style, then inline style, on
the element; and no descendant setting it to anything but `none` or
`inherit`) and
`element-focusable-descendant` (no link, button, form control, `summary`,
`iframe`, editable element, `video` or `audio` with `controls`, or element
with `tabindex` 0 or more below it). Descendants include the contents of
open shadow roots at any depth; inside a shadow tree it reads only inline
`pointer-events`, because DOM implementations differ on whether computed
style inherits across the shadow boundary. It cannot see into a closed
shadow root, and it does not run script. A value that is not an element is
`unchecked` with `not-an-element`. The contract check does not measure a
real asset's size or choose the worst-case color for you.

```ts
import {
  TOKENS,
  checkBackdropContract,
  checkBackdropElement,
  type BackdropContract,
  type TokenDefinition,
} from "@clossys/designer/tokens";

const backdrop: BackdropContract = {
  kind: "video",
  scrim: {
    token: "--color-overlay-scrim",
    textToken: "--color-neutral-50",
    worstCaseBackdrop: "#6b6b6b",
  },
  ariaHidden: true,
  pointerEvents: "none",
  reducedMotion: { fallbackFrame: "/hero/still.webp" },
  loading: { strategy: "idle", budgetBytes: 1_500_000 },
};

// Your copy of the dark theme's values, layered over the light registry:
// here, the dark scrim as the dark block of styles/tokens.css sets it. Keep
// it in step with the stylesheet you ship. --color-neutral-50 does not
// change with the theme, so it needs no dark entry; a theme-dependent token
// left at its light value here is reported as theme-unchecked.
const darkTokens: Record<string, TokenDefinition> = {
  ...TOKENS,
  "--color-overlay-scrim": {
    property: "--color-overlay-scrim",
    family: "overlay",
    value: "oklch(0 0 0 / 0.6)",
    brandable: false,
    themeDependent: true,
  },
};

const declared = checkBackdropContract(backdrop, { darkTokens });
if (!declared.ok) {
  for (const finding of declared.findings) console.error(finding.rule, finding.message);
  for (const gap of declared.unchecked) console.error(gap.rule, gap.reason);
}

const layer = document.getElementById("hero-backdrop");
if (layer !== null && !checkBackdropElement(layer).ok) {
  console.error("The rendered backdrop breaks the contract.");
}
```

## Licence

MIT

## Changelog

Release notes for every version are in the [changelog](https://github.com/clossys/foundry/blob/main/docs/changelogs/designer.md), kept in the public repository rather than in the installed package.

## Consumer-owned art slots

Consumer repositories own brand art, illustrations, photographs and authored
scenes, including their files and usage rights. Clossys owns the slot geometry,
contract and check. `Specimen` and `Scene` remain Clossys-owned product visuals;
they are not consumer brand art.

`ConsumerArtContract` and `checkConsumerArtContract` are browser-safe exports
from `@clossys/designer/tokens`. Publisher's `ConsumerArtSlot` calls the check
before rendering into an existing art seam. The contract adds no catalog
function or configuration axis: compose catalog blocks through Introduce, Show,
Explain, Index, Sequence and Compare, within three axes per function and four
values per axis. Art fills a slot within that composition.

| Contract field | Rule |
| --- | --- |
| `slot` (`ConsumerArtPosition`) | `backdrop` or `media`, placed through the existing Clossys view and media seams. |
| `width`, `height`, `aspect` (`ConsumerArtAspect`) | Intrinsic integers from 1 through 8192, matching `1:1`, `4:3`, `3:2` or `16:9` without rounding. Media reserves that ratio at fluid column width. A backdrop covers its containing layer and may crop. |
| `fit` | `contain` preserves the full visual; `cover` fills and crops. Backdrops require `cover`. Keep essential information out of cropped edges. |
| `purpose`, `alt` | Decorative art has empty alt and is hidden from assistive technology. Meaningful media has descriptive, nonblank resolved alt. Backdrops are decorative; information must also appear in the section's accessible content. |
| `source` (`ConsumerArtSource`) | Static AVIF, WebP, PNG or JPEG photographs (`ConsumerArtFormat`), or inline SVG geometry as 1–256 `ConsumerArtPath` entries. Each path has `d`, `fillToken` and optional paired stroke paint/width. Raw SVG markup, external SVG images, embeds and animation are outside this contract. |
| `backgroundToken`, path paint | Registered `--color-*` names only; Publisher emits live `var(...)` references. No literal colors, style overrides or arbitrary markup. Inline vector art re-themes with the surrounding brand; photographs retain their pixels, while their background follows the token. Use vector geometry for illustrations or authored brand scenes that must re-theme. |
| `loading`, `bytes` | Declare `eager` for a first-viewport hero visual or `lazy` for deferred art; the Clossys slot honors that declaration for both supported positions. Images decode asynchronously. Declare 1–2097152 transferred bytes, including all required resources; the offline check enforces only a minimum (a floor on inline path data), not an exact size. Inline SVG is static server-rendered geometry with no separate fetch; its bytes count toward the document budget. |

The check accepts plain data, rejects unknown fields, and returns a
`ConsumerArtReport` with path-bearing `ConsumerArtFinding` entries. It checks
declared dimensions, aspect ratio, format, byte budget, URL, loading,
accessibility purpose and token paint offline. File-level verification is not
yet shipped: photographs' actual file dimensions, format, static content and
byte size are not read or compared with the declaration. For inline SVG, the
declared `bytes` must be at least the combined UTF-8 length of all path `d` strings.
This is a minimum, a floor on the path data alone: it ignores markup overhead
and every other required resource, so it does not establish an exact or
complete size.
Consumers supply the art and its usage rights. Images render with declared
intrinsic dimensions. Hidden layers contain no controls or focus targets;
meaningful SVG receives `role="img"` and its resolved alt as the accessible
name. Static geometry needs no reduced-motion alternate. Moving art continues
to require the existing backdrop reduced-motion contract.

Clossys's existing `checkBackdropContract` and `checkBackdropElement` cover
scrim contrast and hidden-layer accessibility. This art declaration check does
not measure rendered contrast; the Clossys view provides its token ground
while art loads or fails.

A minimal declaration references a file in the consumer repository; it ships
no art in Designer:

```ts
import { checkConsumerArtContract, type ConsumerArtContract } from "@clossys/designer/tokens";

const art: ConsumerArtContract = {
  slot: "media", purpose: "meaningful", alt: "A tree beside a walking path",
  width: 1600, height: 900, aspect: "16:9", fit: "contain",
  loading: "lazy", bytes: 100000, backgroundToken: "--color-surface-base",
  source: { format: "webp", src: "/art/photo.webp" },
};
const report = checkConsumerArtContract(art);
```

### Site chrome tone and transparent footer rule

`Brandmark tone="inverse"` uses inverse wordmark ink; `"auto"` keeps the base
ink. A `Brandmark` passed directly to an overlay `SiteHeader` follows the header tone
unless its own tone is explicit. A `Brandmark` passed directly to any `SiteHeader`
paints its logomark in the accent token unless it sets `markInk="image"`. `NavDisclosure tone="inverse"` uses inverse
trigger ink at rest, on hover, when expanded and on keyboard focus. An omitted
nav tone follows an inverse overlay header; an explicit `"auto"` keeps base ink.
Both controls otherwise retain their existing default markup.

`SiteFooter ground="transparent" rule="top"` adds a token-bound top hairline
without a plate or a divider inside the footer. `rule` defaults to `"none"`
and is ignored on other grounds, which retain their existing border policy.

## Token specimens

```tsx
import { TokenPreview } from "@clossys/designer/tokens/preview";
const specimen = <TokenPreview property="--color-chart-surface" />;
```

Load the token CSS and desired theme/brand overrides in the host. The preview
uses live `var(--property, authored-value)` references so host overrides remain primary. This React subpath is
selection tooling; configurable components begin at Atoms. `/tokens` stays
React-free. Unknown properties and unsupported applications are refused.

Optional copy props are `sampleText` (default "Aa 0123") and
`unsupportedMessage` (default "Unsupported token application"). Supply translated
strings as needed. The former `pendingMessage` prop (default "interactive support pending") remains
accepted for compatibility. Motion copy
props are `authoredValueLabel` ("Authored value"), `replayLabel` ("Replay") and `reducedMotionMessage` ("Reduced motion:
static equivalent"). Breakpoint copy props are `thresholdLabel` ("Threshold"),
`matchLabel` ("Match"), `unavailableMessage` ("unavailable"), `matchesMessage`
("yes") and `notMatchesMessage` ("no").

All 188 properties support their authored applications across 19 kinds. The 170
static specimens cover surface, text, border, control, status, chart, font,
space, size, icon, brandmark, radius, shadow, blur, ring, layer and opacity.
Patterns expose translucent applications; inverse foregrounds receive an inverse
backing. No override is claimed as measured.

The 12 motion properties show their authored duration or easing and replay a
small transition when Replay is activated. Reduced-motion preferences show the
same authored information as a static equivalent, with no transition. The six
breakpoint properties show their resolved threshold and current media-query
match; rem values resolve against the root font size. Query listeners are
removed when the selected property changes or the preview unmounts. This
interactive subpath requires a client boundary; `/tokens` remains React-free.

## Application panels

Choose a Material Block before assembling its underlying Atoms. `Panel`,
`Drawer` and `ResizablePane` are exported from `@clossys/designer/blocks`;
`ResizeHandle` is exported from `@clossys/designer/atoms`. These additions stay
outside the server subsets. They do not assemble an application frame or
persist preferences.

```tsx
import { Panel, Drawer, ResizablePane } from "@clossys/designer/blocks";
import { Button } from "@clossys/designer/atoms";

export function WorkspaceTools() {
  return (
    <Panel header="Workspace" footer="Supporting information">
      <Drawer heading="Tools" closeLabel="Close tools" trigger={<Button>Tools</Button>}>
        <ResizablePane min={120} max={480} defaultValue={240}
          label="Tool details" handleLabel="Resize tool details">
          <p>Selected tool details</p>
        </ResizablePane>
      </Drawer>
    </Panel>
  );
}
```

`Panel` composes the outlined `Card` with named `header`, content (`children`)
and `footer` regions. Optional regions are omitted for null, undefined or false;
zero remains content. Card `ground`, DOM semantics, classes and styles pass
through. `APP_FRAME_MATERIALS`, from the blocks entry, records each actual
component, its source, rendered dependencies, regions, finite configurations
and authored inputs. These are Block composition facts, not role qualification.

`Drawer` composes `Dialog` and `Panel`, with logical `placement="start"`
(default), `"end"` or `"bottom"`. It uses Dialog's existing focus containment,
restoration, Escape, outside dismissal and scroll lock. Closed content is
unmounted. Its default `dismissAt="(min-width: 768px)"` matches the structural
tablet breakpoint; supply another media query when the host's wide layout
starts elsewhere. Changing `navigationKey` or entering that query dismisses
an open drawer, as does ordinary in-panel link navigation. No motion is added.
The close control renders the `X` glyph through the `Icon` atom as decoration;
`closeLabel` supplies the control's accessible name.

`wide="sheet"` makes the Drawer an application side sheet that opens at every
viewport width, for example an inspector at `placement="end"`. It ignores
`dismissAt` and registers no media listener; it keeps the same Dialog focus
containment, Escape and outside dismissal, focus restoration, scroll lock,
`navigationKey` and in-panel link dismissal, and adds no motion. The default
`wide="dismiss"` keeps the narrow-layout behavior described above. Switching
an open sheet back to `"dismiss"` while the query matches closes it.

```tsx
import { Drawer } from "@clossys/designer/blocks";
import { Button } from "@clossys/designer/atoms";

export function InspectorSheet() {
  return (
    <Drawer heading="Inspector" closeLabel="Close inspector" placement="end"
      wide="sheet" trigger={<Button>Inspect</Button>}>
      <p>Selection details</p>
    </Drawer>
  );
}
```

For a controlled Drawer, `isOpen` requests an open state; a local dismissal
immediately removes the overlay even while the host retains `true`. The host
can acknowledge closure with `false`, then request `true` again. An explicit
trigger activation can also reopen it; a matching wide-layout query prevents
opening, and blocked requests are not retained for later opening when it narrows.
`onOpenChange` reports these changes. Every exit releases the existing
Dialog lifecycle. The additive Dialog `modalClassName` and `modalStyle` hooks
style its wrapper without changing centered defaults when omitted.

`ResizablePane` composes Panel and ResizeHandle with required finite `min`,
`max` and `defaultValue`, in CSS pixels. Choose bounds that leave room for the
content and the handle's minimum 44px target. `value` makes it controlled;
omission uses local state. `onChange` reports bounded values, with no storage
access. A controlled host owns the dimension: keyboard and pointer changes
render only after the host passes the reported value back, so the host can
keep a remembered width in its own state or storage. `defaultValue` remains
the Enter reset target in both modes. `orientation="vertical"` (default) is a
vertical separator resizing inline width; `"horizontal"` resizes block height.
`label` names the pane and `handleLabel` names the separator; header and footer
remain Panel regions.

```tsx
import { ResizablePane } from "@clossys/designer/blocks";

export function Inspector({ width, onWidthChange }: { width: number; onWidthChange: (width: number) => void }) {
  return (
    <ResizablePane min={240} max={560} defaultValue={320} value={width}
      onChange={onWidthChange} label="Inspector" handleLabel="Resize inspector">
      <p>Selection details</p>
    </ResizablePane>
  );
}
```

`ResizeHandle` is controlled with required `value`, `min`, `max`, `resetValue`,
`label` and `onChange`. Positive `step` defaults to 1. Arrow keys adjust,
Home/End reach the bounds, and Enter resets. Horizontal movement reverses in
explicit or inherited RTL; vertical movement does not. Pointer capture commits
on release; pointer cancellation, lost capture or Escape restores the drag's
start value. Non-finite dimensions, reversed bounds, nonpositive steps and
empty names are refused. Values and resets are clamped. Native forced-color
adjustment remains enabled, with a token-bound edge and a visible focus outline.

### CommandMenu

`CommandMenu` is a Navigation Material in `APP_FRAME_MATERIALS`, composed
from Dialog, SearchField, Tooltip and IconButton. The host owns open state,
query, groups and destinations; item IDs must be unique across groups. Each
item takes exactly one `href` or `onAction`, plus optional `description`,
`shortcutHint`, icon glyph and `disabled`. The default filter matches labels
case-insensitively; `filter(item, query)` replaces it. Empty results show the
host's `emptyMessage` without inventing commands.

The search input receives initial focus and controls a grouped listbox.
Arrows wrap through enabled results, Enter activates the current filtered
result, and pointer activation uses the same destination. Escape closes even
with a nonempty query; Dialog contains focus and restores the external opener.
The count is announced politely as "N results" by default; override
`resultCountMessage(count)` to localize the complete announcement.
Logical layout supports `dir="rtl"`,
disabled results retain semantics, and inherited control transitions honor
reduced motion. Closed server rendering is empty; interaction requires the
client. This component is outside the server-safe subset.

`useCommandMenuShortcut({ onOpen, enabled? })` is optional. It detects the
platform on the client, handles Meta+K on Apple platforms and Ctrl+K elsewhere,
and prevents the default only when it opens. It declines while any visible
dialog is open, including its own menu; use Escape to close, then Mod+K to
reopen. Listeners are removed when disabled or unmounted.

| Export | Kind | Contract |
| --- | --- | --- |
| `CommandMenu` | component | Controlled modal command search over host-supplied groups. |
| `CommandMenuProps` | type | Required labels, empty message, groups, open/query state and callbacks; optional filter, count-message formatter and direction. |
| `CommandMenuItem` | type | Unique ID, string label, href or action, and optional description, shortcut hint, icon and disabled state. |
| `CommandMenuGroup` | type | Stable ID, label and ordered items. |
| `useCommandMenuShortcut` | function | Opt-in opening shortcut outside visible dialogs. |
| `CommandMenuShortcutOptions` | type | Required `onOpen` callback and optional `enabled` flag. |

```tsx
import { useState } from "react";
import { CommandMenu, useCommandMenuShortcut } from "@clossys/designer/blocks";

export function CommandExample() {
  const [isOpen, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  useCommandMenuShortcut({ onOpen: () => setOpen(true) });
  return (
    <>
      <button onClick={() => setOpen(true)}>Commands</button>
      <CommandMenu heading="Commands" searchLabel="Find a command"
        closeLabel="Close commands" emptyMessage="No matching commands"
        isOpen={isOpen} onOpenChange={setOpen} query={query} onQueryChange={setQuery}
        resultCountMessage={count => count + " matching commands"}
        groups={[{ id: "pages", label: "Pages", items: [
          { id: "documents", label: "Documents", href: "/documents" },
        ] }]} />
    </>
  );
}
```

## Application navigation

`AppNavigation` is a Block Material for host-owned destinations. Supply stable
ids, text labels, optional decorative icons, and either `href` or `onAction`.
Parents may have their own destination and children; children are destination
leaves. The exported validator rejects duplicate ids, deeper input, ambiguous
destinations and empty parents. An empty tree displays `emptyMessage`.

```tsx
import { AppNavigation, getAppNavigationBreadcrumbs, type AppNavigationNode } from "@clossys/designer/blocks";
import { Button } from "@clossys/designer/atoms";

const navigation: readonly AppNavigationNode[] = [
  { id: "catalogs", label: "Catalogs", href: "/catalogs", children: [
    { id: "blocks", label: "Blocks", href: "/catalogs/blocks" },
  ] },
];

export function NavigationExample() {
  const crumbs = getAppNavigationBreadcrumbs(navigation, { id: "blocks" });
  return <AppNavigation tree={navigation} activeId={crumbs.at(-1)?.id}
    footer={<Button variant="ghost">Example profile</Button>} />;
}
```

The host places the Material in a height-constrained frame region. Links scroll
independently of `footer`, which accepts plain children and imports no account
control. Navigation stores no preferences, fetches no data and imports no router.
`activeId` takes precedence over `activeHref`; ancestry and breadcrumbs derive
only from that route identity, with no view-internal selection input.

`validateAppNavigationTree(tree)` throws on invalid runtime input without mutating
the tree. `getAppNavigationAncestry(tree, { id, href })` returns the matching
root-to-destination node chain, with id taking precedence over href.


Desktop parents expand inline. A destination link and its disclosure button are
separate controls. A newly active child expands its ancestor. `collapsed` controls
the named, tooltipped icon rail; `defaultCollapsed` supplies its initial local
state and `onCollapsedChange` reports changes. Every child destination remains
reachable in the rail. Long labels retain their complete accessible names.

The narrow layout uses the existing Drawer with full rows. `dismissAt` defaults
to `(min-width: 768px)`. Escape returns focus; route changes, actions and entering
the wide layout close it and release modal state. A held `drawerOpen={true}`
cannot revive a dismissed surface; acknowledge with false or explicitly reopen
the trigger. `onDrawerOpenChange` lets the host coordinate other overlays.
`navigationKey`, `label`, `openLabel` and `closeLabel` are host inputs. The Drawer close control
uses a 44px ghost icon button; `closeLabel` supplies its accessible name.
`expandLabel`, `collapseLabel` and `formatDisclosureLabel(nodeLabel, expanded)`
let the host translate rail toggles and disclosures; their defaults preserve the
English expand/collapse announcements. All message props are optional.

Arrow Up/Down and Home/End move among visible navigation controls. Logical
Left/Right expand or collapse a parent, reversing in RTL. Enter/Space activate
destinations or disclosure. Native forced-color adjustment and reduced motion
remain supported. The interactive Material and helpers use the existing client
blocks entry; no server-subset export or application-frame assembly is added.
### Account menu composition example

`APP_FRAME_MATERIALS` includes the `account-menu` selection for `AccountMenu`,
with identity, trigger, content and preference regions, its rendered `Avatar`,
`Button`, `Icon`, `Menu` and `Tooltip` dependencies, and the finite `collapsed`
configuration. Its authored inputs include `actor`, `sections`, `contextLabel`,
`triggerLabel`, `collapsed`, `onClose` and `onRoute`; the host supplies identity,
preference state, actions and routing.

```tsx
import { AccountMenu } from "@clossys/designer/blocks";

export function AccountControl() {
  return <AccountMenu actor={{ name: "Alex Morgan" }} contextLabel="Workspace"
    sections={[{ id: "account", label: "Account", entries: [
      { id: "settings", kind: "link", label: "Settings", href: "/settings" },
    ] }]} />;
}
```
