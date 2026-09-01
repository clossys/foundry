import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";

export type StatusListState = "available" | "partial" | "planned";
export type StatusListHeadingLevel = 2 | 3 | 4 | 5 | 6;

export interface StatusListItem {
  /** Stable identifier — the React key. */
  id: string;
  /** The thing this editorial row describes. */
  label: ReactNode;
  /** Closed readiness vocabulary; callers cannot supply an arbitrary colour. */
  state: StatusListState;
}

export interface StatusListGroup {
  /** Stable identifier — the React key. */
  id: string;
  /** Group heading, rendered at `headingLevel`. */
  heading: ReactNode;
  /** Labelled status rows in this group. */
  items: readonly StatusListItem[];
}

export type StatusListLabels = Readonly<Record<StatusListState, ReactNode>>;

export interface StatusListProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** Optional heading above the status groups. */
  heading?: ReactNode;
  /** Supporting copy under the list heading. */
  description?: ReactNode;
  /** One visible label for each member of the closed state vocabulary. */
  labels: StatusListLabels;
  /** Grouped editorial statements. */
  groups: readonly StatusListGroup[];
  /** Required caller-localized visible and accessible name for the one section-level legend. */
  legendLabel: string;
  /** Which heading element the block and group headings render as. @default 2 */
  headingLevel?: StatusListHeadingLevel;
  className?: string;
  style?: CSSProperties;
}

const STATES: readonly StatusListState[] = ["available", "partial", "planned"];

const STATE_CLASSES: Record<StatusListState, string> = {
  available: "bg-status-success",
  partial: "bg-status-warning",
  planned: "bg-status-info",
};

/**
 * A grouped definition list of labelled states. Each state is one of the
 * three closed readiness values above; the block maps that vocabulary to
 * status tokens itself, so an accent/link colour cannot accidentally become
 * a readiness signal. The coloured dot is decorative and the adjacent text
 * carries the state name, keeping colour out of the accessible name and out
 * of the sole information channel.
 *
 * Status text stays `ink-primary`, while the small dot uses a status display
 * token. Their contrast requirements are intentionally different: the token
 * gate checks status marks against the page ground at the non-text floor,
 * and ordinary row text remains AA reading text on that same ground.
 */
export function StatusList({
  heading,
  description,
  labels,
  groups,
  legendLabel,
  headingLevel = 2,
  className,
  style,
  ...rest
}: StatusListProps) {
  const HeadingTag = `h${headingLevel}` as `h${StatusListHeadingLevel}`;
  const GroupHeadingTag = `h${Math.min(headingLevel + 1, 6)}` as `h${StatusListHeadingLevel}`;
  const hasHeadingRegion = heading !== undefined || description !== undefined;

  return (
    <section {...rest} className={cx("flex flex-col gap-lg", className)} style={style}>
      {hasHeadingRegion ? (
        <div className="flex flex-col gap-xs">
          {heading ? <HeadingTag className="text-h2 font-display text-ink-primary">{heading}</HeadingTag> : null}
          {description ? <p className="text-body text-ink-secondary">{description}</p> : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-xs">
        <p className="text-caption font-body font-medium text-ink-primary">{legendLabel}</p>
        <ul aria-label={legendLabel} className="flex flex-wrap gap-md">
          {STATES.map((state) => (
            <li key={state} className="flex items-center gap-xs text-body-s text-ink-primary">
              <span aria-hidden="true" className={cx("size-xs shrink-0 rounded-pill", STATE_CLASSES[state])} />
              {labels[state]}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-lg">
        {groups.map((group) => (
          <section key={group.id} className="flex flex-col gap-sm">
            <GroupHeadingTag className="text-h3 font-display text-ink-primary">{group.heading}</GroupHeadingTag>
            <dl className="flex flex-col">
              {group.items.map((item, index) => (
                <div
                  key={item.id}
                  className={cx("flex items-center justify-between gap-md py-sm", index > 0 ? "border-t border-line-base" : undefined)}
                >
                  <dt className="text-body text-ink-primary">{item.label}</dt>
                  <dd className="flex shrink-0 items-center gap-xs text-body-s text-ink-primary">
                    <span aria-hidden="true" className={cx("size-xs shrink-0 rounded-pill", STATE_CLASSES[item.state])} />
                    {labels[item.state]}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </section>
  );
}
