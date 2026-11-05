import { SectionHeader } from "./SectionHeader.js";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import { SECTION_GROUND_CLASSES, type SectionGround, type SectionStatusTone } from "./section-ground.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { componentLeaf } from "../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");

/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.status-list", "foundry/sections.status-list");

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
  /**
   * Optional explanation for this row, rendered on its own line beneath the
   * label as a second description of the same term. A row's reasoning is
   * often the substance of the page it sits on, and without this slot it
   * has nowhere to go but the label itself.
   */
  detail?: ReactNode;
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
  /**
   * Optional explanation for this row. The reasoning behind a deliberate
   * non-capability is the part a reader most often needs, so an off-axis
   * row carries the same slot as a readiness row.
   */
  detail?: ReactNode;
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
  /** Small label above the block's own heading, the same slot `FeatureGrid` and `Hero` already ship. */
  eyebrow?: ReactNode;
  /** Optional heading above the status groups. */
  heading?: ReactNode;
  /** Supporting copy under the list heading. */
  description?: ReactNode;
  /** Visible labels for the readiness axis and separately closed dispositions. */
  labels: StatusListLabels;
  /** Grouped editorial statements, each under its own heading. Provide this or `items`, never both. */
  groups?: readonly StatusListGroup[];
  /**
   * A flat list of statements with no group headings — the common shape for
   * a short list that has nothing to group. Provide this or `groups`, never
   * both.
   */
  items?: readonly StatusListItem[];
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
 * dot uses its mapped visual mark. A row's optional `detail` renders as a
 * second description of the same term: another `dd` beside the status one,
 * wrapped onto its own line, so the explanation stays inside the row's
 * definition-list semantics instead of becoming a paragraph that only looks
 * adjacent. A row without a `detail` renders exactly the markup it always
 * did. The off-axis disposition uses neutral
 * structural ink rather than a readiness status token. Base marks clear their
 * checked non-text floor directly; sunken and inverse add a two-pixel boundary
 * using the ground's checked primary ink. The adjacent label remains the sole
 * meaning-bearing channel on every ground.
 *
 * `groups` and `items` are each optional; provide exactly one. `groups`
 * renders the original grouped shape unchanged: one heading and one `dl` per
 * group. `items` renders the same rows as a single flat `dl` with no group
 * heading at all, for a short list that has nothing to group. A caller using
 * `groups` sees no rendering change from this addition.
 */
export function StatusList({
  eyebrow,
  heading,
  description,
  labels,
  groups,
  items,
  legendLabel,
  headingLevel = 2,
  ground = "base",
  className,
  style,
  ...rest
}: StatusListProps) {
  const colors = SECTION_GROUND_CLASSES[ground];
  const GroupHeadingTag = `h${Math.min(headingLevel + 1, 6)}` as `h${StatusListHeadingLevel}`;
  const hasHeadingRegion = eyebrow !== undefined || heading !== undefined || description !== undefined;

  const row = (item: StatusListItem, index: number) => (
    <SemanticContent as="div"
      key={item.id}
      className={cx("flex items-center justify-between gap-md py-sm", item.detail !== undefined ? "flex-wrap" : undefined, index > 0 ? cx("border-t", colors.border) : undefined)}
    >
      <SemanticContent as="dt" className={cx("text-body", colors.primary)}>{item.label}</SemanticContent>
      <SemanticContent as="dd" className={cx("flex shrink-0 items-center gap-xs text-body-s", colors.primary)}>
        <SemanticContent as="span"
          aria-hidden="true"
          className={cx(
            "size-xs shrink-0 rounded-pill",
            isDispositionItem(item) ? colors.offAxis : colors.status[STATE_TONES[item.state]],
          )}
        />
        {labelFor(item, labels)}
      </SemanticContent>
      {item.detail !== undefined ? (
        <SemanticContent as="dd" className={cx("w-full text-body-s", colors.secondary)}>{item.detail}</SemanticContent>
      ) : null}
    </SemanticContent>
  );

  return (
    <SemanticContent as="section" {...SECTION_STAMP} {...rest} className={cx("flex flex-col gap-lg", colors.surface, className)} style={style}>
      {hasHeadingRegion ? (
        <SectionHeader density="standard" level={headingLevel} ground={ground} eyebrow={eyebrow} description={description} {...(heading ? { title: heading } : {})} />
      ) : null}
      <SemanticContent as="div" className="flex flex-col gap-xs">
        <SemanticContent as="p" className={cx("text-caption font-body font-medium", colors.primary)}>{legendLabel}</SemanticContent>
        <SemanticContent as="ul" aria-label={legendLabel} className="flex flex-wrap gap-md">
          {STATES.map((state) => (
            <SemanticContent as="li" key={state} className={cx("flex items-center gap-xs text-body-s", colors.primary)}>
              <SemanticContent as="span" aria-hidden="true" className={cx("size-xs shrink-0 rounded-pill", colors.status[STATE_TONES[state]])} />
              {labels[state]}
            </SemanticContent>
          ))}
          {DISPOSITIONS.map((disposition) => (
            <SemanticContent as="li" key={disposition} className={cx("flex items-center gap-xs text-body-s", colors.primary)}>
              <SemanticContent as="span" aria-hidden="true" className={cx("size-xs shrink-0 rounded-pill", colors.offAxis)} />
              {labels.dispositions[disposition]}
            </SemanticContent>
          ))}
        </SemanticContent>
      </SemanticContent>
      {items ? (
        <SemanticContent as="dl" className="flex flex-col">{items.map((item, index) => row(item, index))}</SemanticContent>
      ) : (
        <SemanticContent as="div" className="flex flex-col gap-lg">
          {(groups ?? []).map((group) => (
            <SemanticContent as="section" key={group.id} className="flex flex-col gap-sm">
              <SemanticContent as={GroupHeadingTag} className={cx("text-h3 font-display", colors.primary)}>{group.heading}</SemanticContent>
              <SemanticContent as="dl" className="flex flex-col">{group.items.map((item, index) => row(item, index))}</SemanticContent>
            </SemanticContent>
          ))}
        </SemanticContent>
      )}
    </SemanticContent>
  );
}
