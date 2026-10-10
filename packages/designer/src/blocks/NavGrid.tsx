import type { CSSProperties, ReactNode } from "react";
import { Button } from "../atoms/Button.js";
import { cx } from "../atoms/internal/cx.js";
import { assertNoNestedInteractive, CardLinkTitle, cardLinkContainerClassName } from "./stretched-link.js";

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
      /** Renders this card as a linked tile: its title is a real `<a href>` whose hit area covers the tile. */
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

/** A linked tile's container: the tile is the hit area and carries the ring; tiles sit on the base ground. */
const LINKED_TILE = cardLinkContainerClassName("control", "base");

const CARD_BASE =
  "flex h-full flex-col items-start gap-sm rounded-control border border-line-base bg-surface-raised p-lg text-start outline-none transition-colors motion-reduce:transition-none hover:border-line-strong hover:bg-surface-sunken";

function NavGridCardContent({ item }: { item: NavGridItem }) {
  return (
    <>
      {item.icon ? (
        <span aria-hidden="true" className="text-ink-muted">
          {item.icon}
        </span>
      ) : null}
      <span className="text-body font-body font-medium text-ink-primary">
        {item.href === undefined ? (
          item.title
        ) : (
          <CardLinkTitle href={item.href} frame="control" ground="base">
            {item.title}
          </CardLinkTitle>
        )}
      </span>
      {item.description ? (
        <span className="text-body-s text-ink-secondary">{item.description}</span>
      ) : null}
    </>
  );
}

function LinkedCard({ item }: { item: NavGridItem }) {
  assertNoNestedInteractive("NavGrid", item.id, [item.icon, item.title, item.description]);
  return (
    <div data-nav-grid-card="" className={cx(CARD_BASE, LINKED_TILE)}>
      <NavGridCardContent item={item} />
    </div>
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
 * `onClick`.** `items` is a discriminated union. An item with `href` is a
 * linked tile, the same anatomy as a linked `CardGrid` card: its title is
 * one plain `<a href>` (so the link's name is the title alone) with a
 * chevron at its end, visible at rest, and the anchor's hit area covers the
 * tile, so a click anywhere on it follows the link and Tab stops once, with
 * the focus ring around the whole tile. The icon and description sit
 * outside the anchor; a linked tile holding another link, button or field
 * throws a `TypeError`. An item with `onSelect` renders via this package's
 * own `Button` atom (`variant="ghost"`), with `icon`, `title` and
 * `description` inside the one `<button>`, so the whole tile is the target.
 * `href`/`onSelect` are mutually exclusive at the type level (`href?:
 * never` on the `onSelect` branch and vice versa) rather than both being
 * plain optional props a caller could set — or omit — simultaneously.
 * `icon` is `aria-hidden`: it's decorative reinforcement for a title that's
 * already the card's real accessible name, not a second source of meaning a
 * screen reader needs to parse separately.
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
            <LinkedCard key={item.id} item={item} />
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
