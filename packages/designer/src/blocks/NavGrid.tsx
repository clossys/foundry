import type { CSSProperties, ReactNode } from "react";
import { Button } from "../atoms/Button.js";
import { Link } from "../atoms/Link.js";
import { cx } from "../atoms/internal/cx.js";
import { UI_RING_FOCUS } from "../atoms/internal/ui-vars.js";

interface NavGridItemBase {
  /** Stable identifier — the React key. */
  id: string;
  /** The card's own title. */
  title: ReactNode;
  /** Supporting copy under the title. */
  description?: ReactNode;
  /** Icon slot, rendered above the title. Decorative — see the component doc comment. */
  icon?: ReactNode;
}

export type NavGridItem =
  | (NavGridItemBase & {
      /** Renders this card as a real `<a href>` (this package's own `Link` atom). */
      href: string;
      onSelect?: never;
    })
  | (NavGridItemBase & {
      href?: never;
      /** Renders this card as a real `<button>` (this package's own `Button` atom), fired on activation. */
      onSelect: () => void;
    });

export interface NavGridProps {
  /** Optional heading above the grid. */
  heading?: ReactNode;
  /** The cards to render, as data — each item is either navigable (`href`) or actionable (`onSelect`), never both. */
  items: readonly NavGridItem[];
  className?: string;
  style?: CSSProperties;
}

const CARD_BASE =
  "flex h-full flex-col items-start gap-sm rounded-control border border-line-base bg-surface-raised p-lg text-left outline-none transition-colors motion-reduce:transition-none hover:border-line-strong hover:bg-surface-sunken";

// `Button` (used for an `onSelect` card) already applies a focus-visible
// ring itself, conditionally, via its own `isFocusVisible` style callback
// — see `atoms/Button.tsx`. `Link` (used for an `href` card) does NOT
// apply any focus-ring styling of its own at all: its `outline-none` base
// class removes the native default outline with nothing standing in for
// it, unlike every OTHER interactive atom here. That's a real gap in that
// atom, reported rather than fixed here (`src/atoms/` is off-limits for
// this PR) — this local `style` callback, using the same `UI_RING_FOCUS`
// token every other atom's own ring reads (with its own real fallback, so
// this passes `check-contamination-classes`' "no bare var() without a
// fallback" rule the same as `Button`'s own usage does), is this block's
// own workaround so an `href` card is not left with zero visible focus
// indicator.
function linkCardStyle(renderProps: { isFocusVisible: boolean }): CSSProperties | undefined {
  return renderProps.isFocusVisible ? { boxShadow: UI_RING_FOCUS } : undefined;
}

function NavGridCardContent({ item }: { item: NavGridItem }) {
  return (
    <>
      {item.icon ? (
        <span aria-hidden="true" className="text-ink-muted">
          {item.icon}
        </span>
      ) : null}
      <span className="text-body font-body font-medium text-ink-primary">{item.title}</span>
      {item.description ? (
        <span className="text-body-s text-ink-secondary">{item.description}</span>
      ) : null}
    </>
  );
}

/**
 * A grid of navigation cards — an app's "hub" page linking out to its own
 * sections, a settings landing page's category tiles. An optional heading
 * and the card grid itself: two regions that differ in kind, and a page can
 * hold two `NavGrid`s (two separate card groupings under two headings),
 * which is what makes this a block rather than a view.
 *
 * **Each card is a real `<a>` or `<button>`, not a `<div>` with an
 * `onClick`.** `items` is a discriminated union: an item with `href`
 * renders via this package's own `Link` atom (`variant="standalone"` — the
 * variant the README's own `Link` section documents for exactly this case,
 * "a link that IS the whole clickable unit on its own... a nav item"); an
 * item with `onSelect` renders via this package's own `Button` atom
 * (`variant="ghost"`). Both are real interactive elements react-aria-
 * components already supplies full keyboard support for (Enter/Space
 * activation, correct roles, focus management) — nothing about that is
 * reimplemented here. `href`/`onSelect` are mutually exclusive at the type
 * level (`href?: never` on the `onSelect` branch and vice versa) rather
 * than both being plain optional props a caller could set — or omit —
 * simultaneously.
 *
 * **The whole card is the click/keyboard target, not just the title.**
 * `icon`, `title`, and `description` are all rendered INSIDE the single
 * `<a>`/`<button>` element (this component's own card styling is applied
 * directly to that element, not to a wrapping `<div>` around a smaller
 * link) — clicking or activating anywhere on the card, and Tab reaching it
 * once as one stop, both work identically to clicking the title text alone
 * would. `icon` is `aria-hidden`: it's decorative reinforcement for a title
 * that's already the card's real accessible name, not a second source of
 * meaning a screen reader needs to parse separately.
 *
 * Cards lay out one per row on narrow viewports, two from the `tablet`
 * breakpoint, three from `desktop` — a plain Tailwind responsive grid
 * generated from this package's own breakpoint tokens, no JS breakpoint
 * state, the same pattern `DetailView`'s and `Shell.SideNav`'s own
 * responsive layouts already use.
 */
export function NavGrid({ heading, items, className, style }: NavGridProps) {
  return (
    <div className={cx("flex flex-col gap-md", className)} style={style}>
      {heading ? <h2 className="text-h2 font-display text-ink-primary">{heading}</h2> : null}
      <div className="grid grid-cols-1 gap-md tablet:grid-cols-2 desktop:grid-cols-3">
        {items.map((item) =>
          item.href !== undefined ? (
            <Link
              key={item.id}
              href={item.href}
              variant="standalone"
              className={cx(CARD_BASE, "no-underline hover:no-underline")}
              style={linkCardStyle}
            >
              <NavGridCardContent item={item} />
            </Link>
          ) : (
            <Button
              key={item.id}
              variant="ghost"
              onPress={() => item.onSelect()}
              className={cx(CARD_BASE, "w-full justify-start")}
            >
              <NavGridCardContent item={item} />
            </Button>
          ),
        )}
      </div>
    </div>
  );
}
