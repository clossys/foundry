import { ItemRenderer } from "./render.js";
import { renderNavItems } from "./ItemsStatic.js";
import type { ReactNode } from "react";
import type { NavGridItem, NavGridProps } from "../NavGrid.js";
import { cx } from "../../atoms/internal/cx.js";
import { assertNoNestedInteractive, cardLinkContainerClassName } from "../stretched-link.js";
type LinkedNavItem = Extract<NavGridItem, { href: string }>;
/** A linked tile's container: the tile is the hit area and carries the ring; tiles sit on the base ground. */
const LINKED_TILE = cardLinkContainerClassName("control", "base");

const CARD_BASE =
  "flex h-full flex-col items-start gap-sm rounded-control border border-line-base bg-surface-raised p-lg text-start outline-none transition-colors motion-reduce:transition-none hover:border-line-strong hover:bg-surface-sunken";

function NavGridCardContent({ item }: { item: NavGridItem }) {
  return <ItemRenderer item={{ id: item.id, heading: item.title, description: item.description, icon: item.icon }} treatment="plain" size="standard" ground="base" navigation="action" />;
}

function LinkedCard({ item }: { item: LinkedNavItem }) {
  assertNoNestedInteractive("NavGrid", item.id, [item.icon, item.title, item.description]);
  return <div data-nav-grid-card="" className={cx(CARD_BASE, LINKED_TILE)}>
    <ItemRenderer item={{ id: item.id, heading: item.title, description: item.description, icon: item.icon, href: item.href }} treatment="plain" size="standard" ground="base" navigation="control" />
  </div>;
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
 * linked tile, the shared item anatomy: its title is
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
 * All-linked collections of two to six items with consistent icon presence
 * compose the private linked-item plate list. Legacy single-item, larger, mixed-control,
 * and mixed-icon collections retain their control tiles and item order.
 * Those cards lay out one per row on narrow viewports, two from the `tablet`
 * breakpoint, three from `desktop` — a plain Tailwind responsive grid
 * generated from this package's own breakpoint tokens, no JS breakpoint
 * state, the same pattern `DetailView`'s and `Shell.SideNav`'s own
 * responsive layouts already use.
 */
export function CompatNavGrid({ heading, items, className, style, renderAction }: NavGridProps & { renderAction: (item: Extract<NavGridItem, { onSelect: () => void }>, className: string, children: ReactNode) => ReactNode }) {
  const linked = items.every(item => item.href !== undefined);
  const icons = items.filter((item) => Boolean(item.icon)).length;
  const useLinkedItems = linked && items.length >= 2 && items.length <= 6 && (icons === 0 || icons === items.length);
  return (
    <div className={cx("flex flex-col gap-md", className)} style={style}>
      {heading ? <h2 className="text-h2 font-display text-ink-primary">{heading}</h2> : null}
      {useLinkedItems ? renderNavItems(items.map(item => ({ id: item.id, heading: item.title, description: item.description, icon: item.icon, href: item.href }))) : <div className="grid grid-cols-1 gap-md tablet:grid-cols-2 desktop:grid-cols-3">
        {items.map((item) =>
          item.href !== undefined ? (
            <LinkedCard key={item.id} item={item} />
          ) : (
            renderAction(item, cx(CARD_BASE, "w-full justify-start"), <NavGridCardContent item={item} />)
          ),
        )}
      </div>}
    </div>
  );
}
