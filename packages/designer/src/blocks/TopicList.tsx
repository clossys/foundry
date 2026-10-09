import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";
import { UI_BORDER_HAIRLINE } from "../atoms/internal/ui-vars.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";

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
}

export interface TopicListProps extends Omit<HTMLAttributes<HTMLUListElement>, "title"> {
  /** The topics, in reading order. An even count reads best in two columns. */
  items: readonly TopicListItem[];
  /** @default 2 */
  columns?: TopicListColumns;
  /** The ground the list sits on; selects ink and rule colours. @default "base" */
  ground?: SectionGround;
  className?: string;
  style?: CSSProperties;
}

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
 * not progress. Icons are optional, `aria-hidden` and muted. Server-safe:
 * no hooks.
 */
export function TopicList({ items, columns = 2, ground = "base", className, style, ...rest }: TopicListProps) {
  const colors = SECTION_GROUND_CLASSES[ground];

  return (
    <ul
      {...rest}
      data-topic-list=""
      data-columns={columns}
      className={cx("grid grid-cols-1", columns === 2 ? "tablet:grid-cols-2 tablet:gap-x-3xl" : undefined, className)}
      style={style}
    >
      {items.map((item) => (
        <li
          key={item.id}
          className={cx("flex min-w-0 items-start gap-md border-t py-lg", colors.border)}
          style={{ borderBlockStartWidth: UI_BORDER_HAIRLINE }}
        >
          {item.icon ? (
            <span aria-hidden="true" className={cx("inline-flex shrink-0", colors.muted)}>
              {item.icon}
            </span>
          ) : null}
          <div className="flex min-w-0 flex-col gap-xs">
            <p className={cx("text-body-l font-body font-medium", colors.primary)}>{item.heading}</p>
            {item.description ? (
              <p className={cx("text-body text-pretty", colors.secondary)}>{item.description}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
