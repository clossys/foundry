import type { ComponentType, HTMLAttributes, ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import type { SemanticContent as SemanticContentType } from "../components/SemanticContent.js";
import { componentLeaf } from "../runtime/component-leaf.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";

const SemanticContent = componentLeaf<typeof SemanticContentType>("components.semantic-content");
const Card = componentLeaf<ComponentType<HTMLAttributes<HTMLDivElement>>>("components.card");
const SECTION_STAMP = dsAttrs("sections", "sections.testimonials", "foundry/sections.testimonials");

export interface TestimonialSetItem {
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
  ground?: SectionGround;
}

const COUNT_CLASSES: Readonly<Record<number, string>> = {
  1: "mx-auto max-w-reading",
  2: "grid grid-cols-1 gap-lg tablet:grid-cols-2",
  3: "grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-3",
  4: "grid grid-cols-1 gap-lg tablet:grid-cols-2",
  6: "grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-3",
};

/** Quote cards consume the selected leaves; the selected Card owns its treatment. */
export function TestimonialSet({ items, ground = "base", className, style, ...rest }: TestimonialSetProps) {
  if (!Array.isArray(items) || !Object.hasOwn(COUNT_CLASSES, items.length)) throw new TypeError("TestimonialSet: requires one, two, three, four or six items.");
  if (ground !== "base" && ground !== "sunken" && ground !== "inverse") throw new TypeError("TestimonialSet: unknown ground.");
  return (
    <SemanticContent as="ul" {...SECTION_STAMP} {...rest} role="list" className={cx("m-0 list-none p-0", COUNT_CLASSES[items.length], SECTION_GROUND_CLASSES[ground].primary, className)} style={style}>
      {items.map((item, index) => (
        <SemanticContent as="li" key={item.id} className={cx("min-w-0", items.length === 3 && index === 2 ? "tablet:col-span-2 desktop:col-span-1" : undefined)}>
          <Card className="h-full">
            <SemanticContent as="figure" className="m-0 flex h-full flex-col gap-md">
              <SemanticContent as="p" className="font-body text-body-l">{item.quote}</SemanticContent>
              <SemanticContent as="figcaption" className="mt-auto flex items-center gap-sm">
                {item.portrait == null ? null : <SemanticContent as="span" aria-hidden="true" className="shrink-0">{item.portrait}</SemanticContent>}
                <SemanticContent as="div" className="flex flex-col">
                  <SemanticContent as="span" className="font-body text-body font-medium">{item.attributorName}</SemanticContent>
                  {item.attributorRole ? <SemanticContent as="span" className="text-body-s">{item.attributorRole}</SemanticContent> : null}
                </SemanticContent>
              </SemanticContent>
            </SemanticContent>
          </Card>
        </SemanticContent>
      ))}
    </SemanticContent>
  );
}
