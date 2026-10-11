import { useId, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";
import { UI_BORDER_HAIRLINE, UI_BORDER_RULE } from "../atoms/internal/ui-vars.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { assertNoNestedInteractive, CardLinkTitle, cardLinkContainerClassName } from "./stretched-link.js";

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

/**
 * Many short, scannable topics where cards would be heavy: what a review
 * covers, which records are kept, who a team serves. A real `<ul>`; each
 * row is topped by a hairline rule (`--ui-border-hairline`, `line-base`),
 * with the heading at `body-l` in `font-medium` (an item heading, like a
 * `FeatureGrid` or step heading) and an optional description in `body`
 * secondary ink under it.
 *
 * Two columns from `tablet` (`gap-x-3xl`), one below. Rows carry `py-lg`.
 * No check marks or other completion marks: a topic list states coverage,
 * not progress. Icons are optional, `aria-hidden` and muted.
 *
 * A row with `href` is one link: the heading carries the anchor and a
 * chevron at its end, visible at rest; the anchor's hit area covers the row
 * between its hairlines, which gains a hover plate (the band's other
 * ground) on hover and keyboard focus, with the focus ring around it. Link
 * every row or none, each to its own destination; a linked row holding
 * another link, button or field throws a `TypeError`. Server-safe; grouped lists use React heading IDs.
 */
function topicRow(item: TopicListItem, ground: SectionGround, first = false, last = false) {
  const colors = SECTION_GROUND_CLASSES[ground];
  const linkedContainer = cardLinkContainerClassName("topic", ground);
  if (item.href !== undefined) assertNoNestedInteractive("TopicList", item.id, [item.icon, item.heading, item.description]);
  return (
          <li
            key={item.id}
            className={cx(first ? "flex min-w-0 items-start gap-md py-lg" : "flex min-w-0 items-start gap-md border-t py-lg", colors.border, item.href === undefined ? undefined : linkedContainer, last ? "pb-0" : undefined)}
            style={first ? undefined : { borderBlockStartWidth: UI_BORDER_HAIRLINE }}
          >
            {item.icon ? (
              <span aria-hidden="true" className={cx("inline-flex shrink-0", colors.muted)}>
                {item.icon}
              </span>
            ) : null}
            <div className="flex min-w-0 flex-col gap-xs">
              <p className={cx("text-body-l font-body font-medium", colors.primary)}>
                {item.href === undefined ? (
                  item.heading
                ) : (
                  <CardLinkTitle href={item.href} frame="topic" ground={ground}>
                    {item.heading}
                  </CardLinkTitle>
                )}
              </p>
              {item.description ? (
                <p className={cx("text-body text-pretty", colors.secondary)}>{item.description}</p>
              ) : null}
            </div>
          </li>
        );
}

/** Separate component keeps generated heading IDs out of the legacy flat path. */
function GroupedTopics({ groups, ground = "base", headingLevel = 3, className, style, ...rest }: TopicListBaseProps & Omit<HTMLAttributes<HTMLDivElement>, "title"> & { groups: readonly TopicListGroup[]; headingLevel?: 3 | 4 }) {
  const prefix = useId();
  const colors = SECTION_GROUND_CLASSES[ground];
  const inverse = ground === "inverse";
  const Heading = headingLevel === 4 ? "h4" : "h3";
  return (
    <div {...rest} data-topic-list="" data-groups={groups.length} className={cx("grid grid-cols-1 gap-x-3xl gap-y-2xl tablet:gap-y-3xl", groups.length === 3 ? "tablet-lg:grid-cols-3" : "tablet:grid-cols-2", className)} style={style}>
      {groups.map((group, index) => {
        const headingId = `${prefix}-topic-group-${index}`;
        return (
          <section key={group.id} aria-labelledby={headingId} className={cx("min-w-0 border-t", inverse ? "border-ink-on-inverse" : "border-ink-primary")} style={{ borderBlockStartWidth: UI_BORDER_RULE }}>
            <Heading id={headingId} className={cx("pt-md pb-xs font-mono text-caption uppercase tracking-label", colors.secondary)}>{group.label}</Heading>
            <ul>{group.items.map((item, row) => topicRow(item, ground, row === 0, row === group.items.length - 1))}</ul>
          </section>
        );
      })}
    </div>
  );
}

export function TopicList(props: TopicListProps) {
  if ((props.items === undefined) === (props.groups === undefined)) throw new TypeError("TopicList needs exactly one of items or groups.");
  if (props.groups !== undefined) {
    if (props.columns !== undefined) throw new TypeError("TopicList groups derive their columns from the group count.");
    if (props.groups.length < 2 || props.groups.length > 4 || props.groups.some((group) => group.items.length < 2 || group.items.length > 4) || props.groups.reduce((count, group) => count + group.items.length, 0) > 12) throw new RangeError("TopicList needs 2-4 groups, 2-4 topics per group and at most 12 topics.");
    const { groups, items: _items, columns: _columns, ...rest } = props;
    return <GroupedTopics groups={groups} {...rest} />;
  }
  const { items, columns = 2, ground = "base", className, style, groups: _groups, headingLevel: _headingLevel, ...rest } = props;
  return (
    <ul {...rest} data-topic-list="" data-columns={columns} className={cx("grid grid-cols-1", columns === 2 ? "tablet:grid-cols-2 tablet:gap-x-3xl" : undefined, className)} style={style}>
      {items!.map((item) => topicRow(item, ground))}
    </ul>
  );
}
