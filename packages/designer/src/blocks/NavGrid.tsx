import type { CSSProperties, ReactNode } from "react";
import { Button } from "../components/Button.js";
import { CompatNavGrid } from "./items/compat-nav.js";
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
      /** Renders this card as a linked tile: its title is a real `<a href>` whose hit area covers the tile. */
      href: string;
      onSelect?: never;
    })
  | (NavGridItemBase & {
      href?: never;
      /** Renders this card as a real `<button>` (this package's own `Button` component), fired on activation. */
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

export function NavGrid(props: NavGridProps) {
  return <CompatNavGrid {...SECTION_STAMP} {...props} renderAction={(item, className, children) => <Button key={item.id} variant="ghost" onPress={() => item.onSelect()} className={className}>{children}</Button>} />;
}
