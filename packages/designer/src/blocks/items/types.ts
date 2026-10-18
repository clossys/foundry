import type { AriaAttributes, ReactNode } from "react";
import type { BadgeVariant } from "../../atoms/Badge.js";
import type { StatusMarkTone } from "../../atoms/StatusMark.js";
import type { SectionGround } from "../section-ground.js";

export type ItemSize = "standard" | "display";
export type ItemTreatment = "plain" | "rule" | "plate";
export type ItemSpan = "third" | "half" | "two-thirds" | "full";
export interface ItemBadge { label: ReactNode; tone?: BadgeVariant }
/** A focal measurement with authored delta copy and an optional direction. */
export type ItemFigureData = { value: ReactNode; delta?: ReactNode; trend?: "up" | "down" | "neutral" };
/** A shaped status mark with its visible state label. */
export type ItemStatusData = { tone: StatusMarkTone; label: ReactNode };
/** Copy and visual slots for one item. Linked items must contain no other controls. */
export interface ItemData {
  id: string;
  heading: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode;
  visual?: ReactNode;
  href?: string;
  span?: ItemSpan;
  badge?: ItemBadge;
  /** A focal measurement; its authored delta includes its own sign. */
  figure?: ItemFigureData;
  /** A shaped mark and visible state label, distinct from a badge. */
  status?: ItemStatusData;
  /** Actor id in a connected sequence with two, three or four lanes. */
  lane?: string;
}
/** Standalone items explicitly select their frame's scale, treatment and ground. */
export interface ItemProps extends ItemData {
  treatment: ItemTreatment;
  size: ItemSize;
  ground: SectionGround;
  /** A semantic heading when supplied; omission keeps a paragraph. */
  headingLevel?: 3 | 4;
}
export type ItemsArrangement = "columns" | "rows" | "bento" | "stacked";
export type ItemsColumns = 1 | 2 | 3;
export type ItemsScale = "item" | "statement";
export interface ItemsGroup { id: string; label: ReactNode; items: readonly string[] }
export interface ItemsLane { id: string; label: ReactNode }
export interface ItemsProps extends Pick<AriaAttributes, "aria-labelledby"> {
  items: readonly ItemData[];
  arrangement: ItemsArrangement;
  /** Defaults to three for columns and one for rows. Absent for bento and stacked. */
  columns?: ItemsColumns;
  treatment?: ItemTreatment;
  scale?: ItemsScale;
  /** Defaults to standard. A display frame passes display explicitly. */
  size?: ItemSize;
  groups?: readonly ItemsGroup[];
  order?: "none" | "numbered" | "connected";
  reveal?: "all" | "disclose";
  /** Two lanes allow columns or stacks with 3-5 steps; three/four lanes allow stacks with 4-6/5-8 steps. */
  lanes?: readonly ItemsLane[];
  end?: "ends" | "continues";
  endLabel?: ReactNode;
  caption?: ReactNode;
  headingLevel?: 3 | 4;
  ground?: SectionGround;
  className?: string;
}
