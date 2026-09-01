import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";
import { SECTION_GROUND_CLASSES, type SectionGround, type SectionStatusTone } from "./section-ground.js";

/** The closed readiness axis. A deliberate non-capability belongs in `StatusListDisposition`, not here. */
export type StatusListState = "available" | "partial" | "planned";
/** The closed off-axis category for a deliberate non-capability. */
export type StatusListDisposition = "not-offered";
export type StatusListHeadingLevel = 2 | 3 | 4 | 5 | 6;

export interface StatusListReadinessItem {
  /** Stable identifier — the React key. */
  id: string;
  /** The thing this editorial row describes. */
  label: ReactNode;
  /** Closed readiness vocabulary; callers cannot supply an arbitrary colour. */
  state: StatusListState;
  /** A readiness item cannot also be an off-axis disposition. */
  disposition?: never;
}

export interface StatusListDispositionItem {
  /** Stable identifier — the React key. */
  id: string;
  /** The thing this editorial row describes. */
  label: ReactNode;
  /** Deliberate non-capability outside the readiness axis. */
  disposition: StatusListDisposition;
  /** An off-axis disposition cannot also claim a readiness state. */
  state?: never;
}

export type StatusListItem = StatusListReadinessItem | StatusListDispositionItem;

export interface StatusListGroup {
  /** Stable identifier — the React key. */
  id: string;
  /** Group heading, rendered at `headingLevel`. */
  heading: ReactNode;
  /** Labelled status rows in this group. */
  items: readonly StatusListItem[];
}

/** Labels keep readiness states and off-axis dispositions structurally separate. */
export type StatusListLabels = Readonly<Record<StatusListState, ReactNode>> & Readonly<{
  /** One visible label for every closed off-axis disposition. */
  dispositions: Readonly<Record<StatusListDisposition, ReactNode>>;
}>;

export interface StatusListProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** Optional heading above the status groups. */
  heading?: ReactNode;
  /** Supporting copy under the list heading. */
  description?: ReactNode;
  /** Visible labels for the readiness axis and separately closed dispositions. */
  labels: StatusListLabels;
  /** Grouped editorial statements. */
  groups: readonly StatusListGroup[];
  /** Required caller-localized visible and accessible name for the combined readiness-and-disposition legend. */
  legendLabel: string;
  /** Which heading element the block and group headings render as. @default 2 */
  headingLevel?: StatusListHeadingLevel;
  /** Semantic section ground; selects the complete matching surface, foreground, line, and status policy. @default "base" */
  ground?: SectionGround;
  className?: string;
  style?: CSSProperties;
}

const STATES: readonly StatusListState[] = ["available", "partial", "planned"];
const DISPOSITIONS: readonly StatusListDisposition[] = ["not-offered"];

const STATE_TONES: Record<StatusListState, SectionStatusTone> = {
  available: "success",
  partial: "warning",
  planned: "info",
};

function isDispositionItem(item: StatusListItem): item is StatusListDispositionItem {
  return item.disposition !== undefined;
}

function labelFor(item: StatusListItem, labels: StatusListLabels): ReactNode {
  return isDispositionItem(item) ? labels.dispositions[item.disposition] : labels[item.state];
}

/**
 * A grouped definition list of labelled states. Each state is one of the
 * three closed readiness values above, plus the separately closed
 * `not-offered` disposition: an off-axis deliberate non-capability rather
 * than a fourth readiness rung. The block maps that vocabulary to semantic
 * tones itself, so an accent/link colour
 * cannot accidentally become a readiness signal. The coloured dot is
 * decorative and the adjacent text carries the state name, keeping colour out
 * of the accessible name and out of the sole information channel.
 *
 * Status text uses the selected ground's primary reading ink, while the small
 * dot uses its mapped visual mark. The off-axis disposition uses neutral
 * structural ink rather than a readiness status token. Base marks clear their
 * checked non-text floor directly; sunken and inverse add a two-pixel boundary
 * using the ground's checked primary ink. The adjacent label remains the sole
 * meaning-bearing channel on every ground.
 */
export function StatusList({
  heading,
  description,
  labels,
  groups,
  legendLabel,
  headingLevel = 2,
  ground = "base",
  className,
  style,
  ...rest
}: StatusListProps) {
  const HeadingTag = `h${headingLevel}` as `h${StatusListHeadingLevel}`;
  const colors = SECTION_GROUND_CLASSES[ground];
  const GroupHeadingTag = `h${Math.min(headingLevel + 1, 6)}` as `h${StatusListHeadingLevel}`;
  const hasHeadingRegion = heading !== undefined || description !== undefined;

  return (
    <section {...rest} className={cx("flex flex-col gap-lg", colors.surface, className)} style={style}>
      {hasHeadingRegion ? (
        <div className="flex flex-col gap-xs">
          {heading ? <HeadingTag className={cx("text-h2 font-display", colors.primary)}>{heading}</HeadingTag> : null}
          {description ? <p className={cx("text-body", colors.secondary)}>{description}</p> : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-xs">
        <p className={cx("text-caption font-body font-medium", colors.primary)}>{legendLabel}</p>
        <ul aria-label={legendLabel} className="flex flex-wrap gap-md">
          {STATES.map((state) => (
            <li key={state} className={cx("flex items-center gap-xs text-body-s", colors.primary)}>
              <span aria-hidden="true" className={cx("size-xs shrink-0 rounded-pill", colors.status[STATE_TONES[state]])} />
              {labels[state]}
            </li>
          ))}
          {DISPOSITIONS.map((disposition) => (
            <li key={disposition} className={cx("flex items-center gap-xs text-body-s", colors.primary)}>
              <span aria-hidden="true" className={cx("size-xs shrink-0 rounded-pill", colors.offAxis)} />
              {labels.dispositions[disposition]}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-lg">
        {groups.map((group) => (
          <section key={group.id} className="flex flex-col gap-sm">
            <GroupHeadingTag className={cx("text-h3 font-display", colors.primary)}>{group.heading}</GroupHeadingTag>
            <dl className="flex flex-col">
              {group.items.map((item, index) => (
                <div
                  key={item.id}
                  className={cx("flex items-center justify-between gap-md py-sm", index > 0 ? cx("border-t", colors.border) : undefined)}
                >
                  <dt className={cx("text-body", colors.primary)}>{item.label}</dt>
                  <dd className={cx("flex shrink-0 items-center gap-xs text-body-s", colors.primary)}>
                    <span
                      aria-hidden="true"
                      className={cx(
                        "size-xs shrink-0 rounded-pill",
                        isDispositionItem(item) ? colors.offAxis : colors.status[STATE_TONES[item.state]],
                      )}
                    />
                    {labelFor(item, labels)}
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
