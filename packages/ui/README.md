# @vespeneventures/ui

React components styled with [@vespeneventures/tokens](https://github.com/vespeneventures/foundry/tree/main/packages/tokens)'
design tokens, via Tailwind CSS v4. This package ships a component ladder
built on top of tokens, one rung at a time. The full intended shape —
including two rungs that aren't built yet — is:

```
tokens → atoms → blocks → views     (content: transient, many, fills slots)
                    ↘      shell    (frame: persistent, one, provides slots)
```

`atoms` and `blocks` ship today. `views` and `shell` are **planned, not yet
shipped** — no code, exports, or placeholder files for either exist in this
package yet. See "Placement rules" below for what distinguishes all four
rungs and how a new component gets assigned to one.

- **`atoms`** — single-purpose: composes no other atom, or its parts are
  homogeneous repeats rather than named regions. Five ship: `Button`,
  `TextField`, `Badge`, `Card`, `Breadcrumb`.
- **`blocks`** — owns the internal layout of multiple named regions,
  typically by composing one or more atoms (and/or layout) into something
  with a real job on a page. Two ship: `PageHeader`, `EmptyState`.
- **`views`** *(planned)* — a block or set of blocks wired to real data and
  routing. Content: transient and many-per-app, it fills the slots the
  shell provides. (`DataTable` and `DetailView` are a deliberate follow-up,
  not part of this package yet.)
- **`shell`** *(planned)* — the persistent frame around content (nav,
  layout chrome) that provides the slots `views` fill. One per app;
  survives route changes that swap out the view underneath it.

A rung may only import DOWN the ladder — a block may import an atom, never
the reverse. `src/ladder.test.ts` enforces that structurally, not just by
convention: it scans every file under `src/atoms/` for an import referencing
`blocks/` and fails the build if it finds one.

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

**3. Does it have a portal, a queue, and an imperative API?** A toast
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
  there's no react-aria-components primitive for either. The `Breadcrumb`
  atom builds on it the same way, for the same reason: its `Breadcrumbs` /
  `Breadcrumb` / `Link` collection components supply correct nav semantics
  and automatic `aria-current` placement that would be easy to get subtly
  wrong hand-rolled.
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
| `Breadcrumb` | component | Breadcrumb trail built on react-aria-components' `Breadcrumbs`/`Breadcrumb`/`Link`. Carries `Breadcrumb.Item`. An atom: its items are a homogeneous repeat, not distinct named regions. |
| `BreadcrumbProps` | type | Props for `Breadcrumb`: `children`, `className`, `aria-label`, plus react-aria-components' own `Breadcrumbs` props. |
| `BreadcrumbItemProps` | type | Props for `Breadcrumb.Item`: `href`, `children`, `className`. |
| `PageHeader` | component | Page banner: breadcrumb slot, title, description, actions slot. |
| `PageHeaderProps` | type | Props for `PageHeader`: `title`, `description`, `actions`, `breadcrumb`, plus every native `<header>` attribute. |
| `EmptyState` | component | Zero-item placeholder: icon slot, title, description, action slot. |
| `EmptyStateProps` | type | Props for `EmptyState`: `icon`, `title`, `description`, `action`, plus every native `<div>` attribute. |

## Tests

Beyond render/interaction/keyboard/ARIA tests per atom (`Button.test.tsx`,
`TextField.test.tsx`, `Badge.test.tsx`, `Card.test.tsx`,
`Breadcrumb.test.tsx`), per block (`PageHeader.test.tsx`,
`EmptyState.test.tsx`), and the `tailwind-merge` regression tests described
above (`internal/cx.test.ts`), two tests are worth calling out specifically:

- **`token-parity.test.ts`** scans every atom's AND every block's source for
  token-derived Tailwind classes (`bg-*`, `text-*`, `border-*`, `rounded-*`,
  ...) and raw `var(--ui-*)`/`var(--color-*)` reads, and asserts every
  single one resolves to a real entry in `@vespeneventures/tokens`' own
  `TOKENS` export — imported from the real package, not a hand-copied list.
  Without this, a typo like `bg-surface-elevated` (there is no such token —
  the real name is `surface-raised`) would compile clean and render with
  zero applied background, with no error anywhere to explain why. This is
  the same failure mode as a missing `@source` line above, just at the
  level of a single class name instead of the whole build.
- **`ladder.test.ts`** scans every file under `src/atoms/` for an import
  specifier that references `blocks/`, and fails the build if it finds one
  — the ladder invariant (atoms → blocks → views, down only) enforced
  structurally rather than left as a comment that can silently drift. It
  also runs the same scan in reverse, over `src/blocks/`, as a sanity check:
  blocks importing atoms is real, expected, and correctly NOT flagged.

## What's deliberately not here

**Atoms:** only `Button`, `TextField`, `Badge`, `Card`, `Breadcrumb` ship.
No `Checkbox`, `Switch`, `Spinner`, `Separator`, or anything else that
isn't one of these five — an atom is added here only once something real
needs it, not speculatively.

**Blocks:** only `PageHeader`, `EmptyState` ship. `DataTable` and
`DetailView` are a deliberate follow-up pass, not started here.

**Views:** no `views` subpath yet. Planned, not shipped — the package is
structured so it can be added later as a sibling export without
restructuring `atoms` or `blocks`.

**Shell:** no `shell` subpath yet either. Also planned, not shipped, and
not on the same track as `views` — see the layer diagram at the top of
this README.

## Requirements

Node 20+. React 18+. Tailwind CSS v4. `@vespeneventures/tokens` ^0.1.0.

## Licence

MIT
