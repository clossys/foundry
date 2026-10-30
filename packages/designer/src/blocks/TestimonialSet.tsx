import { SemanticContent } from "../components/SemanticContent.js";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import { renderTestimonial } from "./Testimonial.server.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { TestimonialCarousel, type TestimonialCarouselLabels } from "./Testimonial/Carousel.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.testimonials", "foundry/sections.testimonials");

export interface TestimonialSetItem {
  /** Stable identifier for the quote. */
  id: string;
  quote: ReactNode;
  attributorName: ReactNode;
  attributorRole?: ReactNode;
  /** Decorative host-supplied portrait; the adjacent name provides attribution. */
  portrait?: ReactNode;
}

export interface TestimonialSetProps extends Omit<HTMLAttributes<HTMLUListElement>, "children"> {
  /** One, two, three, four or six quotes. */
  items: readonly TestimonialSetItem[];
  /** The containing section's semantic ground. */
  ground?: SectionGround;
  /** Omit to retain the item-count geometry. Carousel advances only on a control press or manual scroll. */
  layout?: "single" | "grid" | "wall" | "carousel";
  /** Authored navigation labels, required for carousel layout. */
  carouselLabels?: TestimonialCarouselLabels;
}

const COUNT_CLASSES: Readonly<Record<number, string>> = {
  1: "mx-auto max-w-[42rem]",
  2: "grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-2",
  3: "grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-3",
  4: "grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-2",
  6: "grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-3",
};

const PLATE_CLASSES: Readonly<Record<SectionGround, string>> = {
  base: "bg-surface-sunken",
  sunken: "bg-surface-raised",
  inverse: "bg-surface-inverse-raised",
};

const QUOTE_STYLE = { "--text-blockquote": "var(--text-body-l, inherit)" } as CSSProperties;

function TestimonialSetFigure({ item, ground }: { item: TestimonialSetItem; ground: SectionGround }) {
  const portrait = item.portrait == null ? null : <SemanticContent as="span" aria-hidden="true" className="size-10 shrink-0 overflow-hidden rounded-pill">{item.portrait}</SemanticContent>;
  return renderTestimonial({ quote: item.quote, attributorName: item.attributorName, attributorRole: item.attributorRole }, portrait, ground);
}

/** A bounded list of quotation plates using the shared Testimonial figure. */
export function TestimonialSet({ items, ground = "base", layout, carouselLabels, className, style, ...rest }: TestimonialSetProps) {
  if (!Array.isArray(items) || !Object.hasOwn(COUNT_CLASSES, items.length)) throw new TypeError("TestimonialSet: requires one, two, three, four or six items.");
  if (ground !== "base" && ground !== "sunken" && ground !== "inverse") throw new TypeError("TestimonialSet: unknown ground.");
  if (layout !== undefined && !["single", "grid", "wall", "carousel"].includes(layout)) throw new TypeError("TestimonialSet: unknown layout.");
  if (layout === "single" && items.length !== 1) throw new TypeError("TestimonialSet: single layout requires one item.");
  if (layout === "carousel" && (!carouselLabels?.previous?.trim() || !carouselLabels.next?.trim())) throw new TypeError("TestimonialSet: carousel requires authored control labels.");
  const geometry = layout === "wall" ? "columns-1 gap-lg tablet:columns-2 desktop:columns-3" : layout === "carousel" ? "flex gap-lg" : COUNT_CLASSES[items.length];
  const list = (
    <SemanticContent as="ul" {...(layout === "carousel" ? {} : SECTION_STAMP)} {...(layout === "carousel" ? {} : rest)} role="list" data-layout={layout === "carousel" ? undefined : layout} className={cx("m-0 list-none p-0", geometry, SECTION_GROUND_CLASSES[ground].primary, layout !== "carousel" && className)} style={layout === "carousel" ? undefined : style}>
      {items.map((item, index) => {
        const span = layout !== "wall" && layout !== "carousel" && items.length === 3 && index === 2 ? "tablet:col-span-2 desktop:col-span-1" : undefined;
        return <SemanticContent as="li" key={item.id} className={cx("min-w-0 rounded-panel p-lg text-body-l", PLATE_CLASSES[ground], span,
          layout === "wall" && "mb-lg break-inside-avoid", layout === "carousel" && "w-full shrink-0 snap-start tablet:w-1/2 desktop:w-1/3")}
          style={{ ...QUOTE_STYLE, ...(layout === "wall" && index % 2 === 1 ? { marginBlockStart: "var(--spacing-lg)" } : {}) }}>
          <TestimonialSetFigure item={item} ground={ground} />
        </SemanticContent>;
      })}
    </SemanticContent>
  );
  return layout === "carousel" ? <TestimonialCarousel labels={carouselLabels!} rootProps={{ ...SECTION_STAMP, ...rest }} className={className} style={style}>{list}</TestimonialCarousel> : list;
}
