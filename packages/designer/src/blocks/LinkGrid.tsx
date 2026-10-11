import type { ReactNode } from "react";
import type { CardLinkFrame } from "./stretched-link.js";
import type { SectionGround } from "./section-ground.js";
import { CompatLinkGrid, CompatLinkedTileContent } from "./items/compat-links.js";
export interface LinkGridItem {
  /** Stable identifier: the React key. */
  id: string;
  /** The destination's name, and the link's accessible name. */
  title: ReactNode;
  /** Supporting copy outside the anchor. */
  description?: ReactNode;
  /** Decorative icon above the title. Give every item an icon or none. */
  icon?: ReactNode;
  href: string;
}

export interface LinkGridProps {
  /** Two to six real destinations. */
  items: readonly LinkGridItem[];
  /** The tile's frame. @default "plate" */
  surface?: "plate" | "rule";
  /** The surrounding section ground. @default "base" */
  ground?: SectionGround;
  /** Use a real heading in a page section; omit for a navigation list. */
  headingLevel?: 3 | 4;
  className?: string;
}

export function LinkedTileContent({ frame, ...props }: { item: LinkGridItem; frame: CardLinkFrame; ground: SectionGround; headingLevel?: 3 | 4 }) { return <CompatLinkedTileContent {...props} variant={frame} />; }
export function LinkGrid({ surface = "plate", ground = "base", ...props }: LinkGridProps) { return <CompatLinkGrid {...props} surface={surface} ground={ground} />; }
