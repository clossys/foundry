import type { CSSProperties, ReactNode } from "react";
import { Button } from "../components/Button.js";
import { SemanticContent } from "../components/SemanticContent.js";
import { Link } from "../components/Link.js";
import { ItemRenderer } from "./items/render.js";
import { renderNavItems } from "./items/ItemsStatic.js";
import { SectionHeader } from "./SectionHeader.js";
import { cx } from "../components/internal/cx.js";
import { UI_LAYOUT_TAP_TARGET } from "../components/internal/ui-vars.js";
import { assertNoNestedInteractive, cardLinkContainerClassName, hasInteractiveContent } from "./stretched-link.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.link-index", "foundry/sections.link-index");

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
      /** Renders this card as a linked tile: its title is a native link whose hit area covers the tile. */
      href: string;
      onSelect?: never;
    })
  | (NavGridItemBase & {
      href?: never;
      /** Renders this card as a native button (this package's own `Button` component), fired on activation. */
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

const CARD_BASE = "flex h-full flex-col items-start gap-sm rounded-control border border-line-base bg-surface-raised p-lg text-start outline-none transition-colors motion-reduce:transition-none hover:border-line-strong hover:bg-surface-sunken";
const LINKED_TILE = cardLinkContainerClassName("control", "base");

type LinkedNavItem = Extract<NavGridItem, { href: string }>;

function LinkedCard({ item }: { item: LinkedNavItem }) {
  const separateDescription = hasInteractiveContent([item.description]);
  assertNoNestedInteractive("NavGrid", item.id, separateDescription ? [item.icon, item.title] : [item.icon, item.title, item.description]);
  const heading = separateDescription ? (
    <Link href={item.href} className="inline-flex items-center text-inherit underline underline-offset-4 rounded-control focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" style={{ minBlockSize: UI_LAYOUT_TAP_TARGET, minInlineSize: UI_LAYOUT_TAP_TARGET }}>{item.title}</Link>
  ) : item.title;
  return <SemanticContent as="div" data-nav-grid-card="" className={cx(CARD_BASE, separateDescription ? undefined : LINKED_TILE)}>
    <ItemRenderer item={{ id: item.id, heading, description: item.description, icon: item.icon, ...(separateDescription ? {} : { href: item.href }) }} treatment="plain" size="standard" ground="base" navigation="control" />
  </SemanticContent>;
}

/** Link indexes compose the section heading, shared item anatomy and native controls. */
export function NavGrid({ heading, items, className, style }: NavGridProps) {
  const linked = items.every(item => item.href !== undefined);
  const icons = items.filter(item => Boolean(item.icon)).length;
  const useLinkedItems = linked && items.length >= 2 && items.length <= 6 && (icons === 0 || icons === items.length) && !items.some(item => hasInteractiveContent([item.description]));
  return <SemanticContent as="div" {...SECTION_STAMP} className={cx("flex flex-col gap-md", className)} style={style}>
    {heading ? <SectionHeader level={2} density="standard" title={heading} /> : null}
    {useLinkedItems ? renderNavItems(items.map(item => ({ id: item.id, heading: item.title, description: item.description, icon: item.icon, href: item.href }))) : (
      <SemanticContent as="div" className="grid grid-cols-1 gap-md tablet:grid-cols-2 desktop:grid-cols-3">
        {items.map(item => item.href !== undefined ? <LinkedCard key={item.id} item={item} /> : (
          <Button key={item.id} variant="ghost" onPress={() => item.onSelect()} className={cx(CARD_BASE, "w-full justify-start whitespace-normal")}>
            <ItemRenderer item={{ id: item.id, heading: item.title, description: item.description, icon: item.icon }} treatment="plain" size="standard" ground="base" navigation="action" />
          </Button>
        ))}
      </SemanticContent>
    )}
  </SemanticContent>;
}
