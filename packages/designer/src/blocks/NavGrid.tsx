import type { CSSProperties, ReactNode } from "react";
import { Button } from "../components/Button.js";
import { CompatNavGrid } from "./items/compat-nav.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { SemanticContent } from "../components/SemanticContent.js";
import { Link } from "../components/Link.js";
import { SectionHeader } from "./SectionHeader.js";
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
  /** Writer-owned details for a role, such as location and employment type. */
  details?: readonly { id: string; label: string; value: string }[];
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
  config?: "roles";
  /** Optional heading above the grid. */
  heading?: ReactNode;
  /** The cards to render, as data — each item is either navigable (`href`) or actionable (`onSelect`), never both. */
  items: readonly NavGridItem[];
  className?: string;
  style?: CSSProperties;
}

export function NavGrid(props: NavGridProps) {
  if (props.config === "roles") return <SemanticContent as="div" {...SECTION_STAMP} data-link-index-config="roles" className={props.className} style={props.style}>
    {props.heading ? <SectionHeader title={props.heading} /> : null}
    <SemanticContent as="ul" role="list" className="m-0 flex flex-col gap-md p-0">
      {props.items.map(item => {
        if (!item.href) throw new TypeError("Role links require a destination");
        return <SemanticContent as="li" key={item.id} className="flex flex-col gap-sm border-b border-line-base py-md">
          <Link href={item.href} variant="standalone">{item.title}</Link>
          {item.description ? <SemanticContent as="p" dir="auto" className="text-body-s text-ink-secondary">{item.description}</SemanticContent> : null}
          {item.details?.length ? <SemanticContent as="dl" className="m-0 flex flex-wrap gap-md">
            {item.details.map(detail => <SemanticContent as="div" key={detail.id}>
              <SemanticContent as="dt" dir="auto" className="text-caption text-ink-secondary">{detail.label}</SemanticContent>
              <SemanticContent as="dd" dir="auto" className="m-0 text-body-s">{detail.value}</SemanticContent>
            </SemanticContent>)}
          </SemanticContent> : null}
        </SemanticContent>;
      })}
    </SemanticContent>
  </SemanticContent>;
  return <CompatNavGrid {...SECTION_STAMP} {...props} renderAction={(item, className, children) => <Button key={item.id} variant="ghost" onPress={() => item.onSelect()} className={className}>{children}</Button>} />;
}
