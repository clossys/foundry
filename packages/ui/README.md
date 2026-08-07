# @vespeneventures/ui

React components styled with [@vespeneventures/tokens](https://github.com/vespeneventures/foundry/tree/main/packages/tokens)'
design tokens, via Tailwind CSS v4. This package ships a component ladder
built on top of tokens, one rung at a time. The full shape — every rung now
shipped — is:

```
tokens → atoms → blocks → views     (content: transient, many, fills slots)
                    ↘      shell    (frame: persistent, one, provides slots)
```

`atoms`, `blocks`, `views`, and `shell` all ship today. See "Placement
rules" below for what distinguishes all four rungs and how a new component
gets assigned to one.

- **`atoms`** — single-purpose: composes no other atom, or its parts are
  homogeneous repeats rather than named regions. Sixteen ship: `Button`,
  `TextField`, `Badge`, `Card`, `Breadcrumb`, `Link`, `Checkbox`, `Switch`,
  `Select`, `Textarea`, `Avatar`, `Spinner`, `Menu`, `Dialog`, `Tabs`,
  `Table`.
- **`blocks`** — owns the internal layout of multiple named regions,
  typically by composing one or more atoms (and/or layout) into something
  with a real job on a page. Six ship: `PageHeader`, `EmptyState`,
  `DataTable`, `DetailView`, `Pagination`, `Stat`.
- **`views`** — a whole page's composition, where a second one on the same
  page would be incoherent. Content: transient, it fills the slot the shell
  provides. Deliberately a short list — page structure encodes what a
  product is, so most pages are the consumer's own composition of blocks.
  Only genuinely product-neutral pages are worth shipping. Two ship:
  `ErrorView`, `AuthView`. (`DataTable` and `DetailView` ship as **blocks**,
  not views, by test 3 below — a page can hold two of either. See "Views"
  below for the full reasoning, including why `ListView` and `FormView` are
  deliberately not here either.)
- **`shell`** — the persistent frame around content (nav, layout chrome)
  that provides the slots content fills. One per app; survives route
  changes that swap out the content underneath it. `Shell` ships with five
  slots (`Header`, `SideNav`, `Main`, `Rail`, `Footer`); `Toaster` — a
  runtime service, not itself a rung of this ladder — ships alongside it.
  See "Shell" below.

A rung may only import DOWN the ladder — a block may import an atom, a view
may import an atom or a block, never the reverse. `shell` is a peer of
`views` (both build on `atoms`/`blocks`; neither imports the other) rather
than another rung above it — see "Views" below. `src/ladder.test.ts`
enforces every one of these directions structurally, not just by
convention: it scans every file under `src/atoms/`, `src/blocks/`,
`src/views/`, and `src/shell/` for an import referencing a layer it isn't
allowed to reach, and fails the build if it finds one.

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
  `TextField`, `Link`, `Checkbox`, `Switch`, `Select`, `Textarea`, `Menu`,
  `Dialog`, `Tabs`, `Table`) is built on its primitives rather than a
  hand-rolled `<button>`/`<input>`/`<a>`. It supplies keyboard interaction
  (Enter/Space activation, focus management, arrow-key navigation), the
  ARIA attributes a screen reader needs (`aria-invalid`, `aria-describedby`
  linking an input to its error text, label association, `role="menu"`/
  `aria-checked`/`aria-expanded` and the rest), and disabled-state
  semantics — the kind of behavior that is easy to get subtly wrong by hand
  and hard to notice is wrong without a screen reader or a keyboard-only
  pass. `Badge`, `Card`, `Avatar`, and `Spinner` compose no other atom and
  aren't interactive, so they're plain markup — there's no
  react-aria-components primitive for any of them. `Breadcrumb`, `Select`,
  and `Menu` build on it for their collection components specifically:
  `Breadcrumbs`/`Breadcrumb`/`Link` supply correct nav semantics and
  automatic `aria-current` placement; `Select`/`ListBox`/`ListBoxItem`/
  `Popover` supply a listbox's open/close, typeahead, and selection
  behavior; `MenuTrigger`/`Menu`/`MenuItem`/`Popover` supply a menu's
  open/close, arrow-key navigation, and disabled-item skipping. `Dialog`
  builds on `DialogTrigger`/`ModalOverlay`/`Modal`/`Dialog`/`Heading` for a
  focus-trapped, scroll-locked, Escape-to-dismiss overlay with automatic
  focus restoration; `Tabs` builds on `Tabs`/`TabList`/`Tab`/`TabPanel` for
  roving-tabindex arrow-key navigation between panels; `Table` builds on
  `Table`/`TableHeader`/`TableBody`/`Column`/`Row`/`Cell` for real grid
  semantics, sorting, and row selection (including the indeterminate
  select-all state, via this package's own `Checkbox` atom — see `Table`'s
  own section below). None of that behavior is reimplemented here — it
  would be easy to get subtly wrong hand-rolled, which is the whole reason
  this package leans on react-aria-components for every interactive atom
  rather than building any of it from scratch.
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
block by the same test; it's a deliberate follow-up, not shipped here.

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
## Views

A view is a whole PAGE's composition — test 3 from "Placement rules" above,
repeated here because it's the one that defines this layer: **can one page
contain two of them?** If yes, it's a region of a page, so it's a block
(`PageHeader`, `EmptyState`, or a future `DataTable`). If a second one on
the same page would be incoherent — because the component *is* the page —
it's a view. There is no such thing as half a 404 page, and a sign-in page
either is one or isn't.

**Only two ship: `ErrorView` and `AuthView`.** This is deliberate, not an
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
import { ErrorView } from "@vespeneventures/ui/views";
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

### `AuthView`

```tsx
import { AuthView } from "@vespeneventures/ui/views";
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
`AuditLog` are each the CONSUMER's own composition of atoms — this package
ships no `SiteHeader`/`AppHeader` block. A header is where brand lives, and
shipping a pre-built one would recreate, one layer up, exactly the
`mode`-prop failure "Placement rules" above warns against: a single
component slowly accreting a named mode for every consumer's structural
divergence, with every combination of those modes untested. Three headers
in three files share no code that can break that way, because there's no
shared code to break.

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
| `ErrorView` | component | Full-page error state (404/500/403/...). Composes `EmptyState`; status conveyed as text in the page's own `<h1>`. |
| `ErrorViewProps` | type | Props for `ErrorView`: `status`, `title`, `description`, `action`, `details`, plus every native `<div>` attribute. |
| `AuthView` | component | Full-page authentication shell. Centered card with `brand`/`heading`/`description`/`form`/`secondaryAction`/`footnote` slots. Implements no authentication itself. |
| `AuthViewProps` | type | Props for `AuthView`: `brand`, `heading`, `description`, `form`, `secondaryAction`, `footnote`, plus every native `<div>` attribute. |
| `Shell` | component | The persistent application frame. Carries `Shell.Header`, `Shell.SideNav`, `Shell.Main`, `Shell.Rail`, `Shell.Footer`. |
| `ShellProps` | type | Props for `Shell`: `children` (any subset of the five slots above, in any order), plus every native `<div>` attribute. |
| `ShellHeaderProps` | type | Props for `Shell.Header`: `children`, plus every native `<header>` attribute. |
| `ShellSideNavProps` | type | Props for `Shell.SideNav`: `children`, plus every native `<nav>` attribute (including `aria-label`, default `"Primary"`). |
| `ShellMainProps` | type | Props for `Shell.Main`: `children`, plus every native `<main>` attribute except `id` (fixed, for the skip link). |
| `ShellRailProps` | type | Props for `Shell.Rail`: `children`, plus every native `<aside>` attribute. |
| `ShellFooterProps` | type | Props for `Shell.Footer`: `children`, plus every native `<footer>` attribute. |
| `Toaster` | component | The toast viewport — mount once, anywhere in the same tree as `Shell`. |
| `ToasterProps` | type | Props for `Toaster`: `aria-label` (default `"Notifications"`), `className`. |
| `toast` | value | Imperative toast API: `toast(title, options?)`, `toast.success`/`.error`/`.warning`/`.info`, `toast.dismiss`, `toast.dismissAll`. |
| `ToastFunction` | type | The callable shape of `toast` itself. |
| `ToastHandle` | type | Returned by every `toast(...)` call: `{ id, dismiss() }`. |
| `ToastOptions` | type | Options for `toast(...)`: `description`, `timeout` (ms, or `null` to disable auto-dismiss), `onClose`. |
| `ToastRecord` | type | The queued shape of one toast: `title`, `description?`, `variant`. |
| `ToastVariant` | type | `"success" \| "danger" \| "info" \| "warning"`. |

## Tests

Beyond render/interaction/keyboard/ARIA tests per atom (`Button.test.tsx`,
`TextField.test.tsx`, `Badge.test.tsx`, `Card.test.tsx`,
`Breadcrumb.test.tsx`, `Link.test.tsx`, `Checkbox.test.tsx`,
`Switch.test.tsx`, `Select.test.tsx`, `Textarea.test.tsx`, `Avatar.test.tsx`,
`Spinner.test.tsx`, `Menu.test.tsx`, `Dialog.test.tsx`, `Tabs.test.tsx`,
`Table.test.tsx`), per block (`PageHeader.test.tsx`, `EmptyState.test.tsx`,
`DataTable.test.tsx`, `DetailView.test.tsx`, `Pagination.test.tsx`,
`Stat.test.tsx`),
per shell component (`Shell.test.tsx`, `Toaster.test.tsx`), and the
`tailwind-merge` regression tests described above (`internal/cx.test.ts`),
two tests are worth calling out specifically:
`Table.test.tsx`), per block (`PageHeader.test.tsx`, `EmptyState.test.tsx`),
per view (`ErrorView.test.tsx`, `AuthView.test.tsx`), per shell component
(`Shell.test.tsx`, `Toaster.test.tsx`), and the `tailwind-merge` regression
tests described above (`internal/cx.test.ts`), two tests are worth calling
out specifically:

- **`token-parity.test.ts`** scans every atom's, block's, AND shell
  component's source (everything under `src/`) for token-derived Tailwind
  classes (`bg-*`, `text-*`, `border-*`, `rounded-*`, ...) and raw
  `var(--ui-*)`/`var(--color-*)` reads, and asserts every single one
  resolves to a real entry in `@vespeneventures/tokens`' own `TOKENS`
  export — imported from the real package, not a hand-copied list. Without
  this, a typo like `bg-surface-elevated` (there is no such token — the
  real name is `surface-raised`) would compile clean and render with zero
  applied background, with no error anywhere to explain why. This is the
  same failure mode as a missing `@source` line above, just at the level of
  a single class name instead of the whole build. A per-prefix allow-list
  (`ALLOWED_SUFFIXES` in the test file) skips Tailwind's own non-token
  keywords — alignment/wrap/overflow keywords and universal color keywords
  under `text-`, the same colors plus directional/style keywords under
  `border-`, `none`/`full` under `rounded-`, the font-weight scale under
  `font-`, and `px`/`auto` under the spacing prefixes — each verified
  against a real `@tailwindcss/cli@4.3.3` compile, not assumed from
  documentation. An unknown suffix that isn't in that list and isn't a real
  token still fails the build; only Tailwind's own reserved names are
  exempt.
- **`ladder.test.ts`** scans every file under `src/atoms/`, `src/blocks/`,
  `src/views/`, and `src/shell/` for import specifiers that climb UP the
  ladder, and fails the build if it finds one — the ladder invariant
  (`atoms` → `blocks` → `views`, with `shell` as the frame `views` fill,
  down only) enforced structurally rather than left as a comment that can
  silently drift. It checks every forbidden direction: an atom importing
  `blocks/`, `views/`, or `shell/`; a block importing `views/` or `shell/`;
  `shell` importing `views/`; and `views` importing `shell/` — the mirror
  image of that last one, making `views` and `shell` mutually exclusive
  peers that both build on `atoms`/`blocks` without depending on each
  other. It also runs the same scan for the PERMITTED directions (`blocks`
  importing `atoms`; `views` importing `atoms`; `views` importing `blocks`;
  `shell` importing `atoms`) as a sanity check — proving the scan inspects
  real code rather than passing on zero coverage, without asserting those
  lists are empty, since importing atoms (and, for `views`, blocks too) is
  correct and expected in every one of those places. Verified by hand, not
  just by the sanity checks: a temporary import from `views/` into
  `blocks/index.ts` was added, confirmed to fail the corresponding
  enforcement test, then reverted — proof the check fails closed rather
  than passing vacuously.

## What's deliberately not here

**Atoms:** sixteen ship — `Button`, `TextField`, `Badge`, `Card`,
`Breadcrumb`, `Link`, `Checkbox`, `Switch`, `Select`, `Textarea`, `Avatar`,
`Spinner`, `Menu`, `Dialog`, `Tabs`, `Table`. No `Tooltip`, `Radio`, or a
`Popover`/`Modal` exposed as a public atom of its own — those get added
here only once something real needs them, not speculatively. (`Popover`
is already used internally, inside `Select` and `Menu`; `Modal`/
`ModalOverlay` inside `Dialog`; that's not the same as shipping either as
a standalone public atom a consumer could reach for on its own.)

**Blocks:** `PageHeader`, `EmptyState`, `DataTable`, `DetailView`,
`Pagination`, and `Stat` ship. `ConfirmDialog` (built on `Dialog`) is a
deliberate follow-up, not started here — see `Dialog`'s own section above
for exactly where its scope stops and the block layer's starts. No
`Toolbar`/`FilterBar` block either: `DataTable`'s own `toolbar` slot is
deliberately a plain `ReactNode`, not a second block with an opinion about
what a toolbar contains.

**Views:** only `ErrorView`, `AuthView` ship, and the list is meant to stay
this short — see "Views" above for the full reasoning. `ListView`,
`FormView`, and `DashboardView` are deliberately NOT here: by test 3, a
page can hold two lists, two forms, or several summary panels at once, so
each of those is a block a consumer composes, not a view this package
could pre-assemble without being wrong for most consumers.

**Shell:** `Shell` ships five slots (`Header`, `SideNav`, `Main`, `Rail`,
`Footer`) and nothing else — no `SiteHeader`/`AppHeader`/`AppFooter`
block, no nav-item component, no bundled icon set. Headers and navigation
are where brand and product-specific structure live; a consumer composes
those from atoms and passes them into the relevant slot (see "Shell" →
"How differing chrome is handled" above). No modal/dialog manager and no
command palette either, despite both being named as runtime-service
examples in "Placement rules" above alongside the toast stack that DOES
ship — added only once something real needs them, the same policy this
README states for atoms and blocks.

## Requirements

Node 20+. React 18+. Tailwind CSS v4. `@vespeneventures/tokens` ^0.1.0.

## Licence

MIT
