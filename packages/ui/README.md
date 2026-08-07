# @vespeneventures/ui

React components styled with [@vespeneventures/tokens](https://github.com/vespeneventures/foundry/tree/main/packages/tokens)'
design tokens, via Tailwind CSS v4. This package ships the **atoms** layer
only — the first rung of a three-layer ladder (`atoms` → `blocks` → `views`)
that isn't fully built yet. An atom is single-purpose and composes no other
atom; four ship here: `Button`, `TextField`, `Badge`, `Card`.

```bash
npm install @vespeneventures/ui \
  @vespeneventures/tokens react react-dom tailwindcss
```

`@vespeneventures/tokens` is a required **peer dependency**, not an
implementation detail — every class this package's components render
(`bg-accent`, `text-ink-primary`, `rounded-control`, ...) is a Tailwind
utility generated from that package's tokens. Without it installed and its
CSS imported, those class names don't correspond to anything and every
component renders unstyled, with no error anywhere to explain why.

## Setup

Two things have to both be true before an atom looks like anything: the
token CSS has to be imported, and Tailwind has to be told to scan this
package's compiled output for the classes it uses.

**1. Import the tokens' Tailwind wiring**, on top of Tailwind itself, in
your CSS entry point:

```css
@import "tailwindcss";
@import
  "@vespeneventures/tokens/theme.css";
```

(`theme.css` already pulls in the base token file, so you don't need a
second line for that — see the tokens package's own README for the full
three-layer contract, including how to bind your own brand colors on top
of the neutral greyscale default.)

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

## Why these dependencies

- **`react-aria-components`** — every interactive atom (`Button`,
  `TextField`) is built on its primitives rather than a hand-rolled
  `<button>`/`<input>`. It supplies keyboard interaction (Enter/Space
  activation, focus management), the ARIA attributes a screen reader needs
  (`aria-invalid`, `aria-describedby` linking an input to its error text,
  label association), and disabled-state semantics — the kind of behavior
  that is easy to get subtly wrong by hand and hard to notice is wrong
  without a screen reader or a keyboard-only pass. `Badge` and `Card`
  compose no other atom and aren't interactive, so they're plain markup —
  there's no react-aria-components primitive for either.
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
surface, styled with `@vespeneventures/tokens`' elevation token.

## API

| Export | Kind | Description |
| --- | --- | --- |
| `Button` | component | Pressable action built on react-aria-components' `Button`. |
| `ButtonProps` | type | Props for `Button`: `variant`, `size`, plus everything react-aria-components' own `Button` accepts. |
| `ButtonVariant` | type | `"primary" \| "secondary" \| "ghost" \| "danger"`. |
| `ButtonSize` | type | `"sm" \| "md" \| "lg"`. |
| `TextField` | component | Labeled single-line text input built on react-aria-components' `TextField` + `Label` + `Input` + `FieldError`. |
| `TextFieldProps` | type | Props for `TextField`: `label`, `description`, `errorMessage`, `placeholder`, `className`, `inputClassName`, plus everything react-aria-components' own `TextField` accepts. |
| `Badge` | component | Small status/label pill. Plain markup — not interactive, composes no other atom. |
| `BadgeProps` | type | Props for `Badge`: `variant`, plus every native `<span>` attribute. |
| `BadgeVariant` | type | `"neutral" \| "success" \| "warning" \| "danger" \| "info"`. |
| `Card` | component | Raised content surface. Plain markup — not interactive, composes no other atom. |
| `CardProps` | type | Props for `Card`: every native `<div>` attribute. |

## Tests

Beyond render/interaction/keyboard/ARIA tests per atom (`Button.test.tsx`,
`TextField.test.tsx`, `Badge.test.tsx`, `Card.test.tsx`) and the
`tailwind-merge` regression tests described above (`internal/cx.test.ts`),
one test is worth calling out specifically:

- **`token-parity.test.ts`** scans every atom's source for token-derived
  Tailwind classes (`bg-*`, `text-*`, `border-*`, `rounded-*`, ...) and raw
  `var(--ui-*)`/`var(--color-*)` reads, and asserts every single one
  resolves to a real entry in `@vespeneventures/tokens`' own `TOKENS`
  export — imported from the real package, not a hand-copied list. Without
  this, a typo like `bg-surface-elevated` (there is no such token — the
  real name is `surface-raised`) would compile clean and render with zero
  applied background, with no error anywhere to explain why. This is the
  same failure mode as a missing `@source` line above, just at the level of
  a single class name instead of the whole build.

## What's deliberately not here

Only `Button`, `TextField`, `Badge`, `Card` ship. No `Checkbox`, `Switch`,
`Spinner`, `Separator`, or anything else that isn't one of these four — an
atom is added here only once something real needs it, not speculatively.
No `blocks` or `views` subpath yet either; the package is structured so
those can be added later as sibling exports without restructuring this one,
but neither exists today.

## Requirements

Node 20+. React 18+. Tailwind CSS v4. `@vespeneventures/tokens` ^0.1.0.

## Licence

MIT
