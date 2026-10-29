import type { ReactNode } from "react";
import { SemanticContent } from "../../components/SemanticContent.js";
import { cx } from "../../components/internal/cx.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "../section-ground.js";

/** Copy is resolved by the host before rendering. */
export interface ChromeCalloutsProps {
  label: string;
  items: readonly { id: string; body: ReactNode }[];
}

/** A named list keeps screenshot annotations available without visual positioning. */
export function ChromeCallouts({ label, items, ground = "base" }: ChromeCalloutsProps & { ground?: SectionGround }) {
  if (!label.trim()) throw new TypeError("ChromeCallouts requires a non-empty accessible name");
  if (items.length === 0) return null;
  return (
    <SemanticContent as="ul" aria-label={label} className={cx("m-0 flex flex-col gap-sm ps-lg text-caption", SECTION_GROUND_CLASSES[ground].secondary)}>
      {items.map(item => <SemanticContent as="li" key={item.id}>{item.body}</SemanticContent>)}
    </SemanticContent>
  );
}
