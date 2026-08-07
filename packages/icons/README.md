# @vespeneventures/icons

A small, evidence-picked set of icons for interfaces built on
[`@vespeneventures/tokens`](https://github.com/vespeneventures/foundry/tree/main/packages/tokens).
Every icon strokes with CSS `currentColor` and sizes itself from that
package's `--spacing-*` scale — never a hardcoded hex color or a raw pixel
value — and carries an accessibility contract that's a compile-time error
to get wrong, not a runtime default that quietly does the wrong thing.

```bash
npm install @vespeneventures/icons
```

## The icon set

This package ships **32 icons**. That number is deliberately small, and
deliberately not a guess — see "How the set was chosen" below for the full
method. The problem this solves is the one every growing icon collection
eventually hits: it's easy to add an icon, and hard to ever remove one from
a published package once a consumer depends on it, so the right moment to
be disciplined is before the first release, not after.

```
AlertTriangleIcon   BookOpenIcon      BoxIcon            Building2Icon
CalendarIcon        CheckIcon         CheckCircleIcon    ChevronDownIcon
ChevronLeftIcon     ChevronRightIcon  ChevronUpIcon      ClockIcon
CreditCardIcon      ExternalLinkIcon  FileTextIcon       FolderIcon
Grid3x3Icon         HomeIcon          InfoIcon           ListIcon
LockIcon            MonitorIcon       MoonIcon           PlugIcon
ReceiptIcon         SearchIcon        SettingsIcon       SunIcon
UserIcon            UsersIcon         XIcon               XCircleIcon
```

### How the set was chosen

The standing instruction for this program is explicit: don't build a design
asset just because an existing consumer repo happens to use it — an icon
that shows up in exactly one consumer is that consumer's domain vocabulary,
not a shared primitive. The method here is the same one earlier rounds of
this program used for components: compute the actual intersection of what
independent consumers use, and treat an icon that appears in every one of
them as the strong candidate.

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

From that 3-way intersection, this package excludes anything that reads as
decorative or domain-flavored rather than structural chrome even though it
technically intersected — `sparkle` (a brand/delight accent, not
interactive chrome), `target` ("goals," a marketing concept), `cpu`
(infrastructure-specific), and a handful of fuzzy matches that only worked
by treating two visually distinct concepts as "close enough" (`coins` vs. a
generic dollar sign, `bank` vs. a generic building, `exchange` vs. a
generic left-right arrow). What's left is 22 icons.

That 3-way intersection already happens to fully cover two families this
repository's own other packages commit to elsewhere, which is worth calling
out as corroboration rather than coincidence: `@vespeneventures/tokens`'
README documents a three-state theme toggle (`"system" | "light" |
"dark"`), and `SunIcon`/`MoonIcon`/`MonitorIcon` — all three of its
canonical icons — are already in the 22. `@vespeneventures/tokens` also
ships exactly four status colors (`success` / `warning` / `danger` /
`info`), already exposed as a `variant` prop on `@vespeneventures/ui`'s
`Banner`/`Badge` atoms, and two of the four — `InfoIcon`
(`info`) and `AlertTriangleIcon` (`warning`) — are already in the 22 as
well. The other two color-family members are NOT in the 22 (neither
consumer registry with the narrow, independent 31-icon set had a matching
concept), but the same internal-consistency reasoning that explains why the
first two survived intersection argues for completing the family rather
than shipping it two-fifths done: `CheckCircleIcon` (success) and
`XCircleIcon` (danger) are added as this package's one small,
individually-justified tier beyond the raw intersection number.

A second, separate tier addresses the universal interaction primitives this
repository's OWN `ui` package currently stands in for with plain text,
evidenced directly from `packages/ui/src/atoms/`: `Select.tsx` and
`ComboBox.tsx` render a literal `▾` character instead of a chevron icon,
and `Chip.tsx` / `Banner.tsx` render a literal `×` instead of a close icon —
specifically to avoid taking on an icon-library dependency (see "Package or
`ui` subpath?" below). Now that a dependency-light icon package exists,
`ChevronDownIcon`/`ChevronUpIcon`/`ChevronLeftIcon`/`ChevronRightIcon` and
`XIcon` are the real glyphs those placeholders stand in for — present in
both full `lucide`-based registries (2-way evidence), and individually
justified by a real, named call site in this repository rather than
intersection alone. `CheckIcon`, `SearchIcon` (the exact concept `ui`'s own
`SearchField` atom is named after), and `ExternalLinkIcon` complete this
tier on the same "present in both full registries, and an unambiguous
interaction primitive rather than domain vocabulary" basis.

22 (3-way intersection) + 2 (status-family completion) + 8 (interaction
primitives) = **32** — the exact number every count in this README and
every test in this package checks against; nothing was added and then
quietly dropped to make the arithmetic round.

Bias throughout was toward leaving an icon OUT rather than in: every name
above either survived a genuine 3-way intersection, completes a family this
repository's own tokens/ui packages already committed to most of, or
replaces a real, named placeholder already living in
`@vespeneventures/ui`'s source. Nothing shipped here exists because exactly
one consumer happened to want it.

## Package or `ui` subpath?

**Separate package** — `@vespeneventures/icons` sits at the same layer as
`@vespeneventures/tokens`: a visual contract, installed by
`@vespeneventures/ui` and by applications directly, never a subpath living
inside `ui` the way `@vespeneventures/ui/charts` does.

The comparison to `charts` is the right one to make explicitly, because
`charts` earned the opposite answer for a real reason: it's a subpath of
`ui`, not a sibling package, because a chart mark composes `ui`'s own `cx`
class-merge helper and exists to be rendered inside `ui`-built layouts —
it's UI-domain code through and through, just a distinct domain within that
one package (see `ui`'s README, "Charts"). Icons fail that same test in the
opposite direction: they are **assets**, not components with behavior, and
nothing about rendering one requires anything `ui` provides.

Concrete evidence this repository's own source already draws this
boundary: `ui`'s `Select`, `ComboBox`, `Chip`, and `Banner` atoms render
plain Unicode characters (`▾`, `×`) today instead of importing an icon —
deliberately, to avoid making every consumer of `ui` accept an icon-library
dependency whether or not they use it. That decision only makes sense if
icons is NOT bundled inside `ui`'s own dependency graph. Making icons a
`ui` subpath would mean a consumer who wants only icons — a marketing site,
a docs page, anything with no interactive components — would need to
accept `ui`'s `package.json` (`react-aria-components`, `tailwind-merge`)
in their install graph to reach it, even completely unused. A separate
package makes that dependency weight opt-in exactly once, for exactly the
consumers who need `ui`'s interactive atoms — the identical shape
`@vespeneventures/tokens` already uses for the same reason (`tokens` is
usable with zero React, zero Tailwind; `ui` layers behavior on top of it,
never the reverse). `src/package-layer.test.ts` enforces this structurally,
the same way `@vespeneventures/ui`'s own `src/ladder.test.ts` enforces ITS
internal layer boundaries: it reads this package's real `package.json` and
fails if `@vespeneventures/ui`, `react-aria-components`, or `tailwind-merge`
ever appears as a dependency.

## Color

Every icon strokes with `currentColor` — there is no `color`/`fill`/
`stroke` prop on any icon component, and `IconProps` (see "API" below)
`Omit`s those keys from the underlying SVG props it otherwise forwards, so
passing one is a compile-time error, not a silently-ignored prop. To
change how an icon renders, set CSS `color` on the icon itself or an
ancestor — the same mechanism any `currentColor`-based glyph uses, and the
same reason a `Spinner` or `Skeleton` from `@vespeneventures/ui` already
inherits color rather than taking a color prop of its own.

## Size

Every icon accepts `size?: "sm" | "md" | "lg"` (default `"md"`), each bound
to a step of `@vespeneventures/tokens`' `--spacing-*` scale rather than a
raw pixel value:

| `size` | Token | Resolves to |
| --- | --- | --- |
| `"sm"` | `--spacing-lg` | `16px` |
| `"md"` (default) | `--spacing-xl` | `24px` |
| `"lg"` | `--spacing-2xl` | `32px` |

There is no numeric override (no `size={18}`) — the same closed
`"sm" | "md" | "lg"` shape `@vespeneventures/ui`'s own `Avatar`, `Dialog`,
and `Spinner` atoms already use, so an icon dropped next to one of those
sizes itself from the same vocabulary rather than a private scale of its
own. Each token reference carries a literal pixel fallback
(`var(--spacing-xl, 24px)`) so an icon still renders at a sensible size
even in a project that hasn't installed `@vespeneventures/tokens` — a
defense-in-depth default, not a substitute for installing the real peer
dependency (the same fallback pattern `@vespeneventures/tokens`' own
`styles/tokens.css` uses internally for alias tokens like
`--ui-density-pad`).

## Accessibility

Every icon requires an explicit accessibility decision, enforced by
TypeScript rather than a runtime default — the wrong state (an icon with no
accessibility intent declared at all) is a compile error:

```tsx
import { ClockIcon } from "@vespeneventures/icons";

// Decorative — adds no information beyond text already next to it.
// Hidden from assistive technology (aria-hidden).
<ClockIcon decorative />

// Meaningful — the ONLY signal of what this is. Carries an accessible name.
<ClockIcon label="Last updated 3 hours ago" />

// Compile error: TypeScript rejects this before it ever reaches a browser.
// <ClockIcon />
```

`decorative: true` and `label` are mutually exclusive (also a compile
error together) — `decorative: true` means "adds no information," which is
incoherent alongside a label claiming it does. `src/types.ts`'s
`IconAccessibilityProps` is the discriminated union that makes this a type
error rather than a lint rule or a code-review convention;
`src/internal/accessibility-contract.check.tsx` is a small file, compiled
by the same `tsc` run as everything else in this package (unlike a
`*.test.ts` file — see that file's own header comment for why), that fails
the build if the contract ever regresses.

## Tree-shaking

Importing one icon does not bundle the other 31. This is measured, not
asserted: `src/tree-shake.test.ts` runs a real `esbuild` bundle of
`import { ClockIcon } from "@vespeneventures/icons"` and inspects the
actual OUTPUT bytes (not just which files got parsed while resolving
imports — verified, while writing that test, to include every icon
regardless of tree-shaking, since a barrel has to be parsed to know what it
exports) for every other icon's own distinctive marker. None of the other
31 appear; importing the full 32-icon barrel instead, as a sanity check,
confirms every marker CAN appear, so the single-icon result is real
elimination, not an unreachable assertion. `package.json`'s
`"sideEffects": false` is what makes this reliable — the test suite
includes a check performed by hand (described in that test file, restored
afterward) that disabling it reintroduces exactly the leak the tree-shaking
tests exist to catch.

## Extending with your own icons

`createIcon(name, node)` is the seam: the exact function this package's own
32 icons are built from, exported for a consumer to use directly rather
than forking `Icon`'s size/color/accessibility wrapper logic.

```tsx
import { createIcon } from "@vespeneventures/icons";

export const RocketIcon = createIcon("RocketIcon", [
  [
    "path",
    {
      d: "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z",
    },
  ],
  [
    "path",
    {
      d: "m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z",
    },
  ],
]);

<RocketIcon label="Launch" />;
```

The result is an ordinary component with the identical `IconProps`
contract every shipped icon has — the same `size`/`decorative`/`label`
behavior, the same `currentColor` stroke, the same token-scale sizing —
that a consumer puts wherever their own icon components already live.
Nothing in this package needs to know it exists.

### Why not a name registry

An earlier design considered mirroring a name-string registry pattern
(`<Icon name="rocket" />` resolved at render time against a merged
`{ ...BASELINE_ICONS, ...extensions }` object) instead of `createIcon` plus
per-icon named exports. That shape was rejected: a runtime object merge is
not something a bundler can statically analyze, so importing `Icon` at all
would pull in every registered icon regardless of which `name` a given call
site actually renders — directly defeating this package's own
tree-shaking requirement. Real ESM named exports (`import { ClockIcon }`)
are what a bundler CAN prove are safe to eliminate when unused, which is
exactly what `src/tree-shake.test.ts` measures. `createIcon` is this
package's actual extension seam for the same reason `lucide-react` itself
(the icon library every consumer registry inspected for this package's
icon-set evidence is built on) ships an equivalent internal factory rather
than a mutable shared map.

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `AlertTriangleIcon`, `BookOpenIcon`, `BoxIcon`, `Building2Icon`, `CalendarIcon`, `CheckIcon`, `CheckCircleIcon`, `ChevronDownIcon`, `ChevronLeftIcon`, `ChevronRightIcon`, `ChevronUpIcon`, `ClockIcon`, `CreditCardIcon`, `ExternalLinkIcon`, `FileTextIcon`, `FolderIcon`, `Grid3x3Icon`, `HomeIcon`, `InfoIcon`, `ListIcon`, `LockIcon`, `MonitorIcon`, `MoonIcon`, `PlugIcon`, `ReceiptIcon`, `SearchIcon`, `SettingsIcon`, `SunIcon`, `UserIcon`, `UsersIcon`, `XIcon`, `XCircleIcon` | component | The 32 shipped icons. Each accepts `IconProps`. |
| `createIcon` | function | `(name: string, node: IconNode) => ComponentType<IconProps>` — the extension seam; see above. |
| `IconProps` | type | `IconAccessibilityProps & { size?: IconSize; className?: string } & Omit<SVGProps<SVGSVGElement>, ...>` — every prop an icon component accepts. |
| `IconAccessibilityProps` | type | The `{ decorative: true } \| { label: string }` discriminated union. |
| `IconSize` | type | `"sm" \| "md" \| "lg"`. |
| `IconNode` | type | `ReadonlyArray<readonly [tag: string, attrs: Record<string, string>]>` — the shape `createIcon`'s second argument takes. |

```tsx
import { ClockIcon, SearchIcon, type IconProps } from "@vespeneventures/icons";

function LastUpdated({ label }: { label: string }) {
  return (
    <span>
      <ClockIcon decorative /> {label}
    </span>
  );
}

function SearchTrigger(props: Omit<IconProps, "decorative" | "label">) {
  return <SearchIcon {...props} label="Search" />;
}
```

## Requirements

Node 20+. ESM only. Peer dependencies: `react` (>=18) and
`@vespeneventures/tokens` (`^0.4.0`). No runtime `dependencies` — see
"Package or `ui` subpath?" above.

## Third-party notices

The 32 icons this package ships are visually derived from
[Lucide](https://lucide.dev) (ISC License) and, for a subset of those,
[Feather](https://feathericons.com) (MIT License) before that — this
package does not depend on `lucide-react` at runtime (see "Why not a name
registry" above), but the SVG path data was copied from it. Full
attribution and the two license texts: [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).

## Licence

MIT
