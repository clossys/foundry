import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { SectionGround } from "./section-ground.js";
import { CompatTopicList } from "./items/compat-topics.js";
/** How many columns the list reaches from `tablet`. */
export type TopicListColumns = 1 | 2;

export interface TopicListItem {
  /** Stable identifier: the React key. */
  id: string;
  /** Optional icon before the text, where it tells items apart. Decorative (`aria-hidden`). */
  icon?: ReactNode;
  /** The topic, at item-heading scale (`body-l`). */
  heading: ReactNode;
  /** One short line under the heading. */
  description?: ReactNode;
  /**
   * Links the whole row: the heading becomes the link (its name), with a
   * chevron, and the row between its hairlines is the hit area. Link every
   * row or none. The row may then hold no other interactive element.
   */
  href?: string;
}

export interface TopicListGroup {
  id: string;
  label: ReactNode;
  items: readonly TopicListItem[];
}

interface TopicListBaseProps {
  ground?: SectionGround;
  className?: string;
  style?: CSSProperties;
}

/** A flat list, or labelled groups whose count determines the responsive layout. */
export type TopicListProps = TopicListBaseProps & (
  | (Omit<HTMLAttributes<HTMLUListElement>, "title"> & { items: readonly TopicListItem[]; columns?: TopicListColumns; groups?: never; headingLevel?: never })
  | (Omit<HTMLAttributes<HTMLDivElement>, "title"> & { groups: readonly TopicListGroup[]; items?: never; columns?: never; headingLevel?: 3 | 4 })
);

export function TopicList(props: TopicListProps) { return <CompatTopicList {...props} />; }
