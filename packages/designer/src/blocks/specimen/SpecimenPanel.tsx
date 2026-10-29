import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Badge, type BadgeVariant } from "../../selected-components/Badge.js";
import { hasContent } from "../items/policies.js";
import { Card } from "../../selected-components/Card.js";
import { StatusMark } from "../../selected-components/StatusMark.js";
import { cx } from "../../selected-components/internal/cx.js";
import { UI_BORDER_HAIRLINE, UI_ELEVATION_PANEL } from "../../selected-components/internal/ui-vars.js";
import { AnatomyMarker, SpecimenPartView, type SpecimenPart, type SpecimenStatus } from "./parts.js";

/**
 * The panel is a size container (`@container`): its padding, table and
 * field columns follow the panel's own width, so the same panel reads at a
 * third of a row, half a row, or the full width of a phone.
 */
const PANEL_CLASSES = "@container h-full min-w-0 p-0";
const PANEL_BODY_CLASSES = "flex h-full min-w-0 flex-col gap-lg p-lg font-body @md:p-xl";
const SECTION_DIVIDER = "border-t border-line-base pt-md";
const HEADER_CLASSES = "flex flex-wrap items-start justify-between gap-x-md gap-y-xs";
const TITLE_CLASSES = "m-0 text-body-l font-medium text-ink-primary text-balance";
const META_CLASSES = "m-0 text-body-s text-ink-secondary tabular-nums";
/** The assignee's initials: a decorative disc (`aria-hidden`); the name beside it is the text. */
const INITIALS_CLASSES =
  "inline-flex size-2xl shrink-0 items-center justify-center rounded-pill bg-accent-tint text-body-s font-medium text-accent-text";

const HAIRLINE_BLOCK_START: CSSProperties = { borderBlockStartWidth: UI_BORDER_HAIRLINE };
/** Lifted off its ground: the outline hairline plus the floating elevation, so the panel reads as product UI on a stage, not a box drawn on the page. */
const LIFTED: CSSProperties = { boxShadow: UI_ELEVATION_PANEL };

/** Parts one panel may hold. */
export const SPECIMEN_PANEL_MAX_PARTS = 3;

export interface SpecimenAssignee {
  /** One or two letters, shown in a decorative disc. */
  initials: ReactNode;
  /** The person's name, shown as text. */
  name: ReactNode;
  /** A short line after the name ("owner", "reviewing"). */
  note?: ReactNode;
}

/** A panel footer: who holds the item, a closing note, or both. */
export interface SpecimenFooter {
  assignee?: SpecimenAssignee;
  note?: ReactNode;
}

/** What one panel shows. */
export interface SpecimenPanelContent {
  /** The record shown, at most about 40 characters. Optional for a single-part visual whose card already names it. */
  title?: ReactNode;
  /** One line under the title (a reference, a period). */
  meta?: ReactNode;
  /** The record's state, beside the title. */
  status?: SpecimenStatus;
  /** A separate record label using the existing Badge tones. */
  badge?: { label: ReactNode; tone?: BadgeVariant };
  /** 1 to 3 parts, separated by hairlines. */
  parts: readonly SpecimenPart[];
  footer?: SpecimenFooter;
}

/** One panel in a `Specimen`'s `panels`. */
export interface SpecimenPanelItem extends SpecimenPanelContent {
  /** Stable identifier: the React key. */
  id: string;
}

export interface SpecimenPanelProps extends SpecimenPanelContent, Omit<HTMLAttributes<HTMLDivElement>, "title" | "children"> {
  /** Optional target-to-number map, separate from the panel content. */
  markers?: Readonly<Record<string, number>>;
  className?: string;
  style?: CSSProperties;
}

function labelledContent(node: ReactNode): boolean {
  if (node === undefined || node === null || typeof node === "boolean") return false;
  if (typeof node === "string") return node.trim().length > 0;
  if (Array.isArray(node)) return node.some(labelledContent);
  return true;
}

function present(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false;
}

/** A target must have a real label line; reserved target names cannot be part ids. */
export function assertSpecimenMarkerTargets(panel: SpecimenPanelContent, targets: readonly string[]): readonly string[] {
  const partIds = panel.parts.map(part => part.id);
  if (new Set(partIds).size !== partIds.length || partIds.some(id => !id || /\s/.test(id) || id === "header" || id === "footer")) {
    throw new TypeError("Specimen: marked panel part ids must be unique, nonempty and unreserved.");
  }
  const order = ["header", ...partIds, "footer"];
  for (const target of targets) {
    const part = panel.parts.find(part => part.id === target);
    const labelled = target === "header" ? labelledContent(panel.title) : target === "footer" ? panel.footer?.assignee !== undefined || labelledContent(panel.footer?.note) : part !== undefined && labelledContent(part.label);
    if (!order.includes(target) || !labelled) throw new RangeError("Specimen: marker target requires an existing label line.");
  }
  return order;
}

/**
 * One product-UI panel: a title row (title, meta, state), 1 to 3 parts and
 * an optional footer, each separated by a hairline. The surface is the
 * `Card` outline lifted by `--ui-elevation-panel` (the floating elevation
 * by default): raised fill, one panel edge (`--ui-border-panel` in
 * `--color-line-panel`), `rounded-panel`, a soft shadow, never dark. The panel is
 * a size container: `p-lg`, `p-xl` via `@md:p-xl` once the panel reaches 28rem
 * wide, and its parts reflow on the same measure. Text is `text-body`
 * with `text-body-s` secondary lines (never smaller); all secondary text is
 * secondary ink, which holds AA on the raised fill.
 *
 * Static evidence only: no link, button, input, hover state or focus stop,
 * and no internal scroll. `Specimen` renders these inside its labelled
 * figure; render one alone only inside a labelled figure of your own.
 * Throws a `RangeError` for more than 3 parts (or none). Server-safe: no
 * hooks.
 */
export function SpecimenPanel({ title, meta, status, badge, parts, footer, markers, className, style, ...rest }: SpecimenPanelProps) {
  if (badge !== undefined && (!badge || typeof badge !== "object" || Array.isArray(badge) || !hasContent(badge.label) || (badge.tone !== undefined && badge.tone !== "neutral" && badge.tone !== "success" && badge.tone !== "warning" && badge.tone !== "danger" && badge.tone !== "info"))) throw new TypeError("Specimen: badge needs a label and an existing Badge tone.");
  if (parts.length < 1 || parts.length > SPECIMEN_PANEL_MAX_PARTS) {
    throw new RangeError("Specimen: a panel must hold 1 to " + SPECIMEN_PANEL_MAX_PARTS + " parts, got " + parts.length + ".");
  }
  if (markers && Object.keys(markers).length > 0) {
    assertSpecimenMarkerTargets({ title, parts, footer }, Object.keys(markers));
    if (Object.values(markers).some(number => !Number.isInteger(number) || number < 1 || number > 5)) throw new TypeError("Specimen: marker numbers must be integers from 1 to 5.");
  }
  const markerAt = (target: string) => markers && Object.hasOwn(markers, target) ? markers[target] : undefined;
  const headerMarker = markerAt("header");
  const footerMarker = markerAt("footer");
  const hasHeader = present(title) || present(meta) || status !== undefined || badge !== undefined;
  const badgeElement = badge !== undefined ? <Badge variant={badge.tone}>{badge.label}</Badge> : null;
  // Status tint/text pairs are qualified over base, as in Item.
  const statusBadge = badge?.tone !== undefined && badge.tone !== "neutral";
  const assignee = footer?.assignee;
  const hasFooter = assignee !== undefined || present(footer?.note);

  return (
    <Card {...rest} variant="outline" ground="base" data-specimen-panel="" className={cx(PANEL_CLASSES, className)} style={{ ...LIFTED, ...style }}>
      <div data-specimen-panel-body="" className={PANEL_BODY_CLASSES}>
        {hasHeader ? (
          <div data-specimen-panel-header="" className={HEADER_CLASSES}>
            <div className="flex min-w-0 flex-col gap-xs">
              {present(title) ? <p className={cx(TITLE_CLASSES, headerMarker !== undefined ? "flex items-center gap-sm" : undefined)}><AnatomyMarker number={headerMarker} />{title}</p> : null}
              {present(meta) ? <p className={META_CLASSES}>{meta}</p> : null}
            </div>
            {badge !== undefined || status !== undefined ? <div className="flex flex-wrap items-center gap-sm">
              {statusBadge ? <span className="inline-flex rounded-pill bg-surface-base">{badgeElement}</span> : badgeElement}
              {status ? <StatusMark tone={status.tone}>{status.label}</StatusMark> : null}
            </div> : null}
          </div>
        ) : null}
        {parts.map((part, index) => (
          <div
            key={part.id}
            className={hasHeader || index > 0 ? SECTION_DIVIDER : undefined}
            style={hasHeader || index > 0 ? HAIRLINE_BLOCK_START : undefined}
          >
            <SpecimenPartView part={part} marker={markerAt(part.id)} />
          </div>
        ))}
        {hasFooter ? (
          <div data-specimen-panel-footer="" className={cx(SECTION_DIVIDER, "flex flex-col gap-xs text-body-s")} style={HAIRLINE_BLOCK_START}>
            {assignee ? (
              <div className={cx("flex flex-wrap items-center gap-x-sm gap-y-xs", footerMarker !== undefined ? "gap-sm" : undefined)}>
                <AnatomyMarker number={footerMarker} />
                <span aria-hidden="true" className={INITIALS_CLASSES}>
                  {assignee.initials}
                </span>
                <span className="text-ink-primary">{assignee.name}</span>
                {present(assignee.note) ? <span className="text-ink-secondary">{assignee.note}</span> : null}
              </div>
            ) : null}
            {present(footer?.note) ? <p className={cx("m-0 text-ink-secondary text-pretty", !assignee && footerMarker !== undefined ? "flex items-center gap-sm" : undefined)}>{!assignee ? <AnatomyMarker number={footerMarker} /> : null}{footer?.note}</p> : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
