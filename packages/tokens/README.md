# @vespeneventures/tokens

Design tokens for web interfaces: CSS custom properties for color, type,
spacing, motion, and layout, plus the same values as typed JS/TS data. The
problem it solves is the one every interface eventually hits without a
shared vocabulary — the blue used for links is a different blue than the
one used for buttons, nobody remembers which, and fixing it means grepping
for hex codes across a whole codebase.

```bash
npm install @vespeneventures/tokens
```

## Import order

This package ships three CSS files and one JS/TS entry point. The CSS
files matter in this order:

```css
/* 1. the tokens themselves — required */
@import "@vespeneventures/tokens/tokens.css";

/* 2. your brand, started from the template below — required to look branded */
@import "./brand.css";

/* 3. anything genuinely specific to your project — optional */
@import "./extensions.css";
```

```css
/* optional 4th import, ONLY if your project uses Tailwind v4 — see
   "Tailwind is optional" below */
@import "@vespeneventures/tokens/theme.css";
```

A note on `@import`, because it trips people up: CSS `@import` is resolved
by PostCSS or Tailwind's own resolver at build time, and that resolver does
**not** read your `tsconfig.json` `paths`/aliases — those are a TypeScript-only
concept. Every `@import` in your own CSS needs a real, resolvable specifier:
either a package name (`@vespeneventures/tokens/tokens.css`, resolved through
`node_modules` the same way a JS `import` would be) or a genuine relative
path (`./brand.css`). A `@/tokens.css`-style TS alias will not resolve inside
a `.css` file, even if your bundler understands it inside `.ts`.

If you're not using Tailwind, stop after step 2 — `tokens.css` plus your own
`brand.css` is a complete, working token system on its own.

## Branding it

Every interface built on this package starts in **greyscale**, on purpose.
Import just `tokens.css` with nothing else and you'll see a small dev-mode
badge in the corner of the page reading "No brand binding" — that's not a
bug, it's the package refusing to let an unbranded render pass as finished.

To brand it:

```bash
cp node_modules/@vespeneventures/tokens/styles/brand-template.css src/styles/brand.css
```

Open `src/styles/brand.css`, fill in every required slot (your page ground
color, your ink, your accent, and so on — the template lists exactly which
ones), import it after `tokens.css`, and set one attribute on your root
element:

```html
<html data-brand-bound>
```

The badge disappears the moment that attribute is present. If you use a
framework that renders `<html>` on the server (Next.js, Remix, SvelteKit),
set the attribute in your root layout/template, not in client JS — otherwise
the badge flashes on every load before your JS runs.

### The three-layer contract

```
tokens.css          primitives      neutral greyscale defaults, this package
your brand.css       brand binding   your colors, your fonts, your radius
your extensions.css   consumer layer  anything else, under your own prefix
```

Each layer only overrides or adds to the one below it — it never redefines
the vocabulary. If you find yourself wanting a token this package doesn't
ship, the third layer is where it belongs, under a prefix of your own
choosing (never `--color-`, `--ui-`, or any other prefix this package uses —
see "Naming convention" below for why those are reserved). The primitives
stay neutral so that skipping the brand layer is loud (the dev badge) rather
than silently shipping the wrong brand's colors, or no brand at all.

## Naming convention

Every one of the 128 tokens this package ships falls into exactly one of
two cases:

| Case | Rule | Example | Generates a Tailwind utility? |
| --- | --- | --- | --- |
| **1. Tailwind namespace** | Uses Tailwind v4's own `@theme` prefix, unmodified — `--color-*`, `--text-*`, `--font-*`, `--tracking-*`, `--spacing-*`, `--radius-*`, `--ease-*`, `--breakpoint-*` | `--color-surface-raised` | Yes, via `theme.css`: `bg-surface-raised`, `text-surface-raised`, ... |
| **2. No Tailwind namespace** | Prefixed `--ui-` — z-index, elevation, motion duration, layout widths, density, ring, border width, disabled alpha | `--ui-z-modal` | No. Read it with `var(--ui-z-modal)`; there is no `z-modal` utility. |

Case 1 exists because Tailwind only turns a custom property into a utility
class when it matches one of Tailwind's own reserved theme namespaces
exactly — there's no benefit to inventing a private name and mapping it
across in `theme.css`, since that would just mean two names for every token
for no gain. Case 2 exists for everything Tailwind has no namespace for at
all: those tokens get the `--ui-` prefix specifically so they can't collide
with a custom property a consumer already has of their own — there's no
Tailwind convention to lean on for safety the way there is for case 1.

If you're adding a token (in a fork, or proposing one upstream): check
whether it's a color, font size, font family, letter-spacing, spacing step,
radius, easing curve, or breakpoint first — if so, it's case 1, name it in
Tailwind's namespace. Everything else is case 2 — name it `--ui-<family>-<role>`.

### Case 1 names must not shadow a Tailwind builtin

Sitting inside a real Tailwind `@theme` namespace (case 1, above) means
`theme.css` generates a matching utility class automatically — but
Tailwind ALSO hardcodes a small, fixed set of utility-class suffixes
within `--radius-*`, `--spacing-*`, `--text-*`, and `--font-*` that are
produced by their own dedicated utility function, independent of the
`@theme` scale (radius's logical/physical corner names and `none`/`full`;
spacing's `px`/`auto`/`full`; text's alignment/wrap/overflow/color
keywords; font's weight keywords). A token whose suffix matches one of
those names collides with Tailwind's own builtin utility of the same
name — silently: nothing errors, but the compiled CSS is wrong (see
CHANGELOG.md's `--radius-s` → `--radius-subtle` entry for the concrete,
compiled-CSS evidence). `src/tailwind-builtin-collision.test.ts` enforces
this for every token in this package and fails the build if a new token's
suffix collides with one of Tailwind's reserved names.

## Tailwind is optional

`tokens.css` is a complete token system with zero framework requirement —
every value is a plain CSS custom property, readable with `var(--color-surface-raised)`
in any stylesheet, in any framework, with no build step beyond whatever
already processes your CSS. `theme.css` is an additional, optional file
that wires the case-1 tokens above into Tailwind v4's `@theme` system so
utility classes exist for them. If your project has no Tailwind, never
import `theme.css` — nothing else in this package needs it.

## Token reference

"Brandable" means the token appears in `brand-template.css` and a real brand
is expected to override it. Everything else is a fixed structural scale —
shipped as-is regardless of brand.

### Color (49 tokens, case 1 — `--color-*`)

| Token | Default | Brandable |
| --- | --- | --- |
| `--color-surface-base` | `oklch(0.9702 0 0)` | yes |
| `--color-surface-sunken` | `oklch(0.9401 0 0)` | yes |
| `--color-surface-raised` | `oklch(1 0 0)` | yes |
| `--color-surface-inverse` | `oklch(0.2178 0 0)` | yes |
| `--color-surface-inverse-raised` | `oklch(0.285 0 0)` | yes |
| `--color-surface-aside` | `oklch(0.9612 0 0)` | yes |
| `--color-surface-selected` | `oklch(0.4748 0 0 / 0.1)` | yes |
| `--color-ink-primary` | `oklch(0.2178 0 0)` | yes |
| `--color-ink-secondary` | `oklch(0.36 0 0)` | yes |
| `--color-ink-muted` | `oklch(0.5658 0 0)` | yes |
| `--color-ink-link` | `oklch(0.36 0 0)` | yes |
| `--color-ink-on-inverse` | `oklch(0.9702 0 0)` | yes |
| `--color-ink-on-inverse-muted` | `oklch(0.7763 0 0)` | yes |
| `--color-ink-on-accent` | alias of `--color-ink-on-inverse` | no (inherits) |
| `--color-line-base` | `oklch(0.8761 0 0)` | yes |
| `--color-line-strong` | `oklch(0.7763 0 0)` | yes |
| `--color-line-on-inverse` | `oklch(0.9702 0 0 / 0.14)` | yes |
| `--color-accent` | `oklch(0.4748 0 0)` | yes |
| `--color-accent-text` | `oklch(0.36 0 0)` | yes |
| `--color-accent-hover` | `oklch(0.36 0 0)` | yes |
| `--color-accent-tint` | `oklch(0.4748 0 0 / 0.1)` | yes |
| `--color-accent-on-inverse` | `oklch(0.7763 0 0)` | yes |
| `--color-status-success` | `oklch(0.6268 0 0)` | yes |
| `--color-status-success-text` | `oklch(0.4748 0 0)` | yes |
| `--color-status-success-tint` | `oklch(0.6268 0 0 / 0.1)` | yes |
| `--color-status-warning` | `oklch(0.4495 0 0)` | yes |
| `--color-status-warning-text` | `oklch(0.36 0 0)` | yes |
| `--color-status-warning-tint` | `oklch(0.4495 0 0 / 0.12)` | yes |
| `--color-status-danger` | `oklch(0.285 0 0)` | yes |
| `--color-status-danger-text` | `oklch(0.2178 0 0)` | yes |
| `--color-status-danger-tint` | `oklch(0.285 0 0 / 0.12)` | yes |
| `--color-status-info` | `oklch(0.5658 0 0)` | yes |
| `--color-status-info-text` | `oklch(0.4748 0 0)` | yes |
| `--color-status-info-tint` | `oklch(0.5658 0 0 / 0.08)` | yes |
| `--color-neutral-50` ... `--color-neutral-950` (11 steps) | fixed greyscale ramp | no |
| `--color-overlay-surface` | alias of `--color-surface-raised` | no (inherits) |
| `--color-overlay-border` | alias of `--color-line-base` | no (inherits) |
| `--color-overlay-scrim` | `oklch(0 0 0 / 0.4)` | no |
| `--color-skeleton-fill` | alias of `--color-surface-sunken` | no (inherits) |

### Text, font, tracking (20 tokens, case 1)

| Token | Default | Brandable |
| --- | --- | --- |
| `--text-display-xl` | `72px` | no (fixed ramp) |
| `--text-display-l` | `56px` | no |
| `--text-display-m` | `40px` | no |
| `--text-h0` | `32px` | no |
| `--text-h1` | `28px` | no |
| `--text-h2` | `18px` | no |
| `--text-h3` | `14px` | no |
| `--text-body-l` | `17px` | no |
| `--text-body` | `15px` | no |
| `--text-body-s` | `13px` | no |
| `--text-blockquote` | `22px` | no |
| `--text-caption` | `12px` | no |
| `--text-code-block` | `13px` | no |
| `--font-display` | system-sans stack | yes |
| `--font-body` | system-sans stack | yes |
| `--font-mono` | system-mono stack | yes |
| `--tracking-tight` | `-0.01em` | no |
| `--tracking-meta` | `0.06em` | no |
| `--tracking-nav` | `0.12em` | no |
| `--tracking-label` | `0.18em` | no |

`--text-*` is font-size only, deliberately — it does not bundle a
line-height. Pair it with your own value, or with Tailwind's own
`leading-*` scale if you're using `theme.css`; see "What didn't translate
cleanly" below for why.

### Spacing, radius, breakpoint, easing (27 tokens, case 1)

| Token | Default | Brandable |
| --- | --- | --- |
| `--spacing-xs` ... `--spacing-6xl` (10 steps: `4px`, `8px`, `12px`, `16px`, `24px`, `32px`, `48px`, `64px`, `96px`, `128px`) | fixed 4px-rooted scale | no |
| `--radius-sharp` | `0px` | no |
| `--radius-subtle` | `2px` | no |
| `--radius-default` | `3px` | **yes** |
| `--radius-control` | `6px` | no |
| `--radius-pill` | `999px` | no |
| `--ease-default` | `cubic-bezier(.2, 0, 0, 1)` | no |
| `--ease-decelerate` | `cubic-bezier(0, 0, .2, 1)` | no |
| `--ease-accelerate` | `cubic-bezier(.4, 0, 1, 1)` | no |
| `--ease-bounce` | `cubic-bezier(.2, .8, .2, 1)` | no |
| `--ease-enter` | alias of `--ease-decelerate` | no |
| `--ease-exit` | alias of `--ease-accelerate` | no |
| `--breakpoint-mobile` | `375px` | no |
| `--breakpoint-mobile-lg` | `480px` | no |
| `--breakpoint-tablet` | `768px` | no |
| `--breakpoint-tablet-lg` | `1024px` | no |
| `--breakpoint-desktop` | `1280px` | no |
| `--breakpoint-wide` | `1440px` | no |

### `--ui-*` (32 tokens, case 2 — no Tailwind utility, raw `var()` only)

| Token | Default | Brandable |
| --- | --- | --- |
| `--ui-width-content-max` | `64rem` | yes |
| `--ui-width-prose-max` | `48rem` | yes |
| `--ui-width-wide-max` | `72rem` | yes |
| `--ui-width-page-padding-x` | `clamp(16px, 4vw, 48px)` | no |
| `--ui-layout-sidebar-w` | `256px` | yes |
| `--ui-layout-sidebar-rail-w` | `64px` | no |
| `--ui-layout-aside-w` | `320px` | no |
| `--ui-density-pad` | alias of `--spacing-xl` | no |
| `--ui-density-gap` | alias of `--spacing-lg` | no |
| `--ui-density-row` | alias of `--spacing-3xl` | no |
| `--ui-border-hairline` | `1px` | no |
| `--ui-elevation-none` | `none` | no |
| `--ui-elevation-raised` | `0 1px 0 var(--color-line-base)` | no |
| `--ui-elevation-floating` | `0 8px 24px rgba(0, 0, 0, 0.10)` | no |
| `--ui-ring-focus` | `0 0 0 2px var(--color-accent)` | no |
| `--ui-ring-on-inverse` | `0 0 0 1px rgba(245, 245, 245, 0.12)` | no |
| `--ui-duration-instant` | `80ms` | no |
| `--ui-duration-fast` | `160ms` | no |
| `--ui-duration-default` | `240ms` | no |
| `--ui-duration-deliberate` | `500ms` | no |
| `--ui-duration-flash` | `1200ms` | no |
| `--ui-duration-overlay` | alias of `--ui-duration-fast` | no |
| `--ui-z-base` | `0` | no |
| `--ui-z-sticky` | `10` | no |
| `--ui-z-shell` | `20` | no |
| `--ui-z-aside` | `30` | no |
| `--ui-z-notice` | `40` | no |
| `--ui-z-modal` | `50` | no |
| `--ui-z-toast` | `60` | no |
| `--ui-z-palette` | `70` | no |
| `--ui-z-tooltip` | `80` | no |
| `--ui-alpha-disabled` | `0.5` | no |

The `--spacing-*` and `--color-neutral-*` ranges above are each written as
one row per family rather than one row per step, so the row count in each
table is lower than its token count. Per-family totals: surface 7, ink 7,
line 3, accent 5, status 12, neutral 11, overlay 3, skeleton 1 (color, 49);
text 13, font 3, tracking 4 (20); spacing 10, radius 5, easing 6,
breakpoint 6 (27); width 4, layout 3, density 3, border 1, elevation 3,
ring 2, duration 6, z 9, alpha 1 (32, all `--ui-*`). 49 + 20 + 27 + 32 = 128
tokens across 24 families.

## Deriving a value instead of requesting a new token

Every token here passed a two-part test before it shipped: it names a
distinct semantic role, and it cannot be produced in one step from another
token via `rgba()`/`color-mix()`/`clamp()`/`calc()`. If you find yourself
wanting a token this package doesn't have, it's very likely a composition
of ones it does:

```css
/* A translucent variant of an existing color */
background: color-mix(in oklch, var(--color-accent), transparent 90%);

/* Placeholder text on an inverse surface */
color: rgb(from var(--color-ink-on-inverse) r g b / 0.4);

/* Fluid display type between two rungs of the scale */
font-size: clamp(var(--text-h1), 5vw, var(--text-display-m));

/* A spacing step half-way between two scale steps */
gap: calc((var(--spacing-lg) + var(--spacing-xl)) / 2);

/* A custom radius not in the 5-step scale */
border-radius: calc(var(--radius-control) * 2);

/* A one-off motion duration */
transition-duration: calc(var(--ui-duration-default) * 1.5);
```

If none of those patterns fit, the token belongs in your own project's
extensions layer (see "The three-layer contract" above) under your own
prefix — never inside a fork of this package's namespace.

## API

The CSS is the primary artifact; this is the JS/TS half, for code that
wants a token's name or default value without parsing CSS.

| Export | Kind | Purpose |
| --- | --- | --- |
| `TOKENS` | const | `Record<string, TokenDefinition>`, keyed by CSS custom property name (e.g. `"--color-surface-raised"`). All 128 tokens, matching `styles/tokens.css` exactly — a test in this package enforces that. |
| `TOKEN_FAMILIES` | const | `readonly TokenFamily[]` — the 24 semantic families, in the order they appear in the "Token reference" section above. |
| `TokenDefinition` | type | `{ property, family, value, brandable }` — one entry of `TOKENS`. |
| `TokenFamily` | type | The union of the 24 family name strings (`"surface"`, `"ink"`, ... `"alpha"`). |

```ts
import { TOKENS } from "@vespeneventures/tokens";

const surfaceRaised = TOKENS["--color-surface-raised"];
console.log(surfaceRaised.value, surfaceRaised.brandable); // "oklch(1 0 0)" true
```

## What didn't translate cleanly

Two things worth naming plainly, for anyone extending this package or
comparing it against a similar one:

- **Font-size tokens dropped their paired line-height.** An earlier draft
  tried the common `<size> / <line-height>` shorthand in one custom
  property, which reads fine in a plain stylesheet (`font: var(--text-h1) var(--font-body);`
  is valid CSS) but breaks the moment it's declared inside a Tailwind
  `@theme` block: Tailwind's `--text-*` namespace expects font-size ALONE,
  and generates `font-size: <the whole value>` for the matching utility —
  handing it a `size / line-height` pair produces invalid CSS for that
  property. `--text-*` here is font-size only for that reason; line-height
  is left to the consumer.
- **The neutral ramp and status colors intentionally sit inside Tailwind's
  own reserved names.** `--color-neutral-*` and (less directly) the status
  family occupy naming territory Tailwind's default theme also uses. That's
  a deliberate choice, not an oversight: this package's whole point is
  that its own values are the ones that should win once `theme.css` is
  imported, the same way any other brand override is meant to win. A
  consumer relying on Tailwind's *default* neutral swatch for something
  unrelated to this package should know that importing `theme.css`
  replaces it.

## Requirements

Node 20+. ESM only. No runtime dependencies.

## Licence

MIT
