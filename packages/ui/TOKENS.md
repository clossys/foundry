# @vespeneventures/ui/tokens

Design tokens for web interfaces: CSS custom properties for color, type,
spacing, motion, and layout, plus the same values as typed JS/TS data. The
problem it solves is the one every interface eventually hits without a
shared vocabulary — the blue used for links is a different blue than the
one used for buttons, nobody remembers which, and fixing it means grepping
for hex codes across a whole codebase.

```bash
npm install @vespeneventures/ui
```

## Import order

This package ships three CSS files and one JS/TS entry point. The CSS
files matter in this order:

```css
/* 1. the tokens themselves — required */
@import "@vespeneventures/ui/tokens.css";

/* 2. your brand, started from the template below — required to look branded */
@import "./brand.css";

/* 3. anything genuinely specific to your project — optional */
@import "./extensions.css";
```

```css
/* optional 4th import, ONLY if your project uses Tailwind v4 — see
   "Tailwind is optional" below */
@import "@vespeneventures/ui/theme.css";
```

A note on `@import`, because it trips people up: CSS `@import` is resolved
by PostCSS or Tailwind's own resolver at build time, and that resolver does
**not** read your `tsconfig.json` `paths`/aliases — those are a TypeScript-only
concept. Every `@import` in your own CSS needs a real, resolvable specifier:
either a package name (`@vespeneventures/ui/tokens.css`, resolved through
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
cp node_modules/@vespeneventures/ui/styles/brand-template.css src/styles/brand.css
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

## Dark mode

Every theme-dependent token ships both a light default and a dark
override. The mechanism follows both signals, in both directions —
OS preference by default, with an explicit override that always wins:

```css
:root { /* light — the default, nothing to opt into */ }

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* dark, when the OS prefers it */ }
}

:root[data-theme="dark"] { /* dark, forced, regardless of the OS */ }
```

With no `data-theme` attribute anywhere, the page follows the OS/browser's
`prefers-color-scheme`. Wiring a theme toggle is one attribute:

```js
// "system" | "light" | "dark"
function applyTheme(theme) {
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}
```

`data-theme="dark"` forces dark even when the OS is light; `data-theme="light"`
forces light even when the OS is dark — the `:not([data-theme="light"])`
guard on the media-query block is what makes that last case work, by
keeping the OS-dark rule from ever matching once light has been chosen
explicitly. If you use a server-rendering framework, set the attribute
in your root layout (not client JS only) for the same reason the
brand-binding badge note above does: otherwise the wrong theme flashes
before your JS runs.

**If you have a `brand.css`:** it needs dark bindings too, in the same
shape — see `brand-template.css`'s own two dark blocks and the "What a
brand needs to add" note in CHANGELOG.md. Skipping them doesn't error;
it silently ships a branded light theme next to an unbranded, greyscale
dark theme.

### Which tokens have a dark value

Only theme-dependent ones: colors, and `--ui-elevation-*` (a shadow reads
as a color choice, and reads differently on a dark surface). Every
structural scale — spacing, radius, z-index, motion duration, easing,
breakpoint, font size, tracking, layout width, density, border width —
is theme-invariant and never appears in a dark block; `src/tokens.ts`'s
`TokenDefinition.themeDependent` field records this per token, and a test
(`src/theme-parity.test.ts`) enforces it against the real CSS in both
directions.

Two tokens worth calling out specifically:

- **`--color-surface-inverse` flips polarity by theme.** In light mode it
  is a dark plate; in dark mode it becomes a light plate.
  `--color-ink-on-inverse` flips with it (near-white ink becomes
  near-black ink), so text on the inverse surface stays legible in both
  themes without a consumer doing anything extra.
- **`--color-neutral-*` stays absolute.** `--color-neutral-50` means "the
  same light-grey swatch" in both themes; it does not become the darkest
  step in dark mode. This is a deliberate choice (both directions are
  defensible — see `styles/tokens.css`'s header comment for the
  reasoning), matching how Tailwind's own default gray scale doesn't
  invert either. Reach for `--color-surface-*`/`--color-ink-*` — which DO
  flip — for anything that should read differently by theme.

### Contrast is enforced, not assumed

`src/contrast.test.ts` computes real WCAG contrast ratios for the key
ink-on-surface and status-text-on-tint pairs, in both themes, via a
proper `oklch()` -> linear-sRGB -> relative-luminance conversion — not an
approximation from the lightness channel, which is not a reliable proxy
for contrast once chroma is involved. It asserts AA (4.5:1) for
body-level text and AA-large (3:1) for secondary/large text. A palette
change that looks plausible but drops a pair below its bar fails this
test, not a human doing final review by eye.

That same math is public now — `contrastRatio` and the rest of that
pipeline ship from this subpath (see "API" below) — and a checked-in gate,
`checkTokenContrast`/`CONTRAST_PAIRS`, runs it as CI-enforceable policy
rather than only a test a human has to remember to keep in sync:

```bash
npx ui-contrast-check
```

checks this package's own `styles/tokens.css` (both themes) against 25
checked-in pairs and exits `1` — not `0` — because the light-mode
categorical chart marks at slots 3/4/5 measure below the 3:1 AA-large
floor against the chart surface, a real, currently-shipping WCAG miss
`contrast.test.ts` already tracks as an accepted "WARN" band (mandatory
labels/legend/table fallback, never color alone). See the main
`README.md`'s "WCAG contrast gate" section for the full contract,
including how a consumer's own `tokens.css` (or brand-bound copy of it)
can be checked the same way, and how this differs from the
token-purity gate.

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

### `--ui-*` (36 tokens, case 2 — no Tailwind utility, raw `var()` only)

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
| `--ui-icon-sm` | alias of `--spacing-lg` | no |
| `--ui-icon-md` | alias of `--spacing-xl` | no |
| `--ui-icon-lg` | alias of `--spacing-2xl` | no |
| `--ui-icon-stroke` | `2` | **yes** |
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
breakpoint 6 (27); width 4, layout 3, density 3, icon 4, border 1,
elevation 3, ring 2, duration 6, z 9, alpha 1 (36, all `--ui-*`).
49 + 20 + 27 + 36 = 132 tokens across 25 families, by this same
1-family-added arithmetic. **Note:** this total (and the "128 tokens
across 24 families" figure elsewhere in this README predating it) does not
match `src/tokens.ts`'s real count (154 across 26 families) — a pre-existing
gap from the `chart` color family (22 tokens, added in `0.4.0`) never being
folded into this reference table's totals. That gap predates this PR and is
out of its scope; `src/tokens.ts`/`styles/tokens.css` are what `parity.test.ts`
actually checks, and both are accurate. Flagged here rather than quietly
compounded.

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
| `checkBrandFileCoverage` | function | `(declarations, options?) => BrandFileCoverageReport` — checks a brand's already-parsed custom-property declarations against `TOKENS`. See "Checking a real brand.css", below. |
| `BrandFileCoverageCheckOptions` | type | `{ tokens? }` — `checkBrandFileCoverage`'s second argument. |
| `BrandFileCoverageReport` | type | `{ ok, declarationsChecked, brandableSlotsChecked, findings, unchecked, reason? }` — `checkBrandFileCoverage`'s return shape. |
| `BrandFileCoverageFinding` | type | `{ rule, slot, message }` — one entry of `BrandFileCoverageReport.findings`. |
| `BrandFileCoverageFindingRule` | type | `"uncovered-brandable-slot" \| "unknown-slot" \| "non-brandable-override"`. |
| `BrandFileCoverageUnchecked` | type | `{ key, reason }` — a declaration key `checkBrandFileCoverage` could not classify at all. |
| `BrandFileCoverageFailureReason` | type | `"nothing-to-check" \| "coverage-gap"` — why `BrandFileCoverageReport.ok` is `false`, when it is. |
| `readBrandCss` | function | `(path) => BrandCssReadResult` — reads and parses a real `.css` file's custom-property declarations. See "Checking a real brand.css", below. |
| `parseBrandDeclarations` | function | `(css) => ParsedBrandCss` — the pure, no-I/O half of `readBrandCss`, for CSS text already in hand. |
| `BrandCssReadResult` | type | `{ path, declarations, unchecked, issues, complete }` — `readBrandCss`'s return shape. |
| `ParsedBrandCss` | type | `{ declarations, unchecked }` — `parseBrandDeclarations`'s return shape. |
| `BrandCssUnchecked` | type | `{ line, detail }` — one region of CSS the reader recognized but could not resolve into a declaration. |
| `BrandCssReadIssue` | type | `{ reason, detail }` — why `readBrandCss` could not read `path` at all. |
| `BrandCssReadIssueReason` | type | `"unreadable"` — the closed set of `BrandCssReadIssue.reason` values. |
| `contrastRatio` | function | `(a, b, compositeBackground?) => number` — the real WCAG contrast ratio between two CSS color values (`oklch(...)` or a 6-digit hex), each optionally translucent. |
| `luminanceOf` | function | `(value, backgroundValue?) => number` — the relative luminance of one CSS color value, compositing over `backgroundValue` first if it carries alpha < 1. |
| `oklchToLinearSRGB` | function | `(color: Oklch) => readonly [number, number, number]` — OKLCH -> linear sRGB. |
| `hexToLinearSRGB` | function | `(hex) => readonly [number, number, number]` — a 6-digit hex color -> linear sRGB. |
| `relativeLuminance` | function | `(rgb) => number` — WCAG relative luminance from linear-sRGB channels. |
| `parseOklch` | function | `(value) => Oklch` — parses the first `oklch(...)` function in a CSS value string. |
| `Oklch` | type | `{ L, C, H, A }` — one parsed `oklch()` value. |
| `CONTRAST_PAIRS` | const | `readonly ContrastPair[]` — this package's checked-in WCAG contrast policy, 25 pairs. See "Contrast is enforced, not assumed", above. |
| `ContrastPair` | type | `{ id, foreground, background, level, minimumRatio, compositeOver?, description }` — one entry of `CONTRAST_PAIRS`. |
| `ContrastLevel` | type | `"AA" \| "AA-large"`. |
| `AA` / `AA_LARGE` | const | `4.5` / `3.0` — the two WCAG minimums `CONTRAST_PAIRS` checks against. |
| `checkTokenContrast` | function | `(pairs, options?) => ContrastGateResult` — the pure contrast gate. See "Contrast is enforced, not assumed", above. |
| `ContrastGateCheckOptions` | type | `{ tokens? }` — `checkTokenContrast`'s second argument. |
| `ContrastGateResult` | type | `{ ok, pairsChecked, findings, unchecked, reason? }` — `checkTokenContrast`'s return shape. |
| `ContrastGateFinding` | type | `{ rule: "below-threshold", pairId, ratio, minimumRatio, message }` — a real WCAG threshold miss. |
| `ContrastGateFindingRule` | type | `"below-threshold"`. |
| `ContrastGateUnchecked` | type | `{ pairId, reason, detail }` — a pair that could not be evaluated at all. |
| `ContrastGateUncheckedReason` | type | `"unresolvable-token" \| "cyclic-alias" \| "unparseable-color-value"`. |
| `ContrastGateFailureReason` | type | `"nothing-to-check" \| "contrast-gap"` — why `ContrastGateResult.ok` is `false`, when it is. |

```ts
import { TOKENS } from "@vespeneventures/ui/tokens";

const surfaceRaised = TOKENS["--color-surface-raised"];
console.log(surfaceRaised.value, surfaceRaised.brandable); // "oklch(1 0 0)" true
```

## Checking a real brand.css

`TOKENS` and `styles/brand-template.css` are a vocabulary and a template —
neither one can tell you whether your OWN `brand.css` actually filled the
template in correctly, or whether a slot name got typo'd along the way. This
package ships the check that closes that gap, the same shape every sibling
contract package in this ecosystem ships (`@vespeneventures/copy/voice`'s
`checkCopy`, `@vespeneventures/copy`'s `checkCopyTraceability`,
`@vespeneventures/strategy`'s `checkFactsTraceability`):

```ts
import { checkBrandFileCoverage, readBrandCss } from "@vespeneventures/ui/tokens";

const { declarations, unchecked } = readBrandCss("src/styles/brand.css");
const report = checkBrandFileCoverage(declarations);

console.log(report.ok); // true only if every brandable slot has a real value, no typo'd slot name, no override of a structural slot, and nothing was left unparsed
```

`checkBrandFileCoverage` reports three kinds of finding — every `brandable: true`
slot with no real (non-empty) declared value, every declaration naming a
slot this package does not recognize (almost always a typo), and every
declaration targeting a structural (`brandable: false`) slot, which
`@vespeneventures/surface`'s `flattenTokens` already refuses by throwing — plus
an `unchecked` list for anything it was handed but could not even classify.
`ok` is `true` only when something was actually checked AND the result is
completely clean; a `declarations` object with zero entries can never read as
a pass (nor can an unreadable/unparseable file — see "CLI", below, for the
exit-code side of that). `readBrandCss` is the file-reading half: a small,
hand-written, zero-dependency CSS reader (see `parseBrandDeclarations` for
the pure, no-I/O version) that understands `:root { ... }`, multiple
selectors, comments, `@media` blocks, and multi-line declarations — anything
it cannot parse (including an unterminated comment, which a real browser
would treat as swallowing everything after it) is reported in `unchecked`, a
line and a detail, never silently dropped and never allowed to produce a
false pass.

Not to be confused with `@vespeneventures/strategy`'s own, differently-scoped
`checkBrandCoverage`, which checks whether a `BrandDerivation[]` (a strategy
artifact) accounts for every brandable slot BY NAME — a layer up from this
one, which checks a real CSS FILE's actual declarations. See
`checkBrandFileCoverage`'s own doc comment in `src/check-brand-file-coverage.ts`
for the full distinction.

### CLI

```bash
npx tokens-brand-check src/styles/brand.css
```

`tokens-brand-check` wires `readBrandCss` and `checkBrandFileCoverage` together
into an installable CLI with the same three-state exit-code contract this
ecosystem's other gates use: `0` clean, `1` at least one finding, `2` could
not run (the file is missing/unreadable, or some part of it could not be
parsed) — "could not check" is never reported as a pass. Run
`npx tokens-brand-check --help` for the full usage.

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
