import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Card } from "../../atoms/Card.js";
import { StatusMark } from "../../atoms/StatusMark.js";
import { cx } from "../../atoms/internal/cx.js";
import { UI_BORDER_HAIRLINE } from "../../atoms/internal/ui-vars.js";
import { SpecimenPartView, type SpecimenPart, type SpecimenStatus } from "./parts.js";

const PANEL_CLASSES = "flex h-full min-w-0 flex-col gap-md font-body desktop:p-xl";
const SECTION_DIVIDER = "border-t border-line-base pt-md";
const HEADER_CLASSES = "flex flex-wrap items-start justify-between gap-x-md gap-y-xs";
const TITLE_CLASSES = "m-0 text-body font-medium text-ink-primary text-balance";
const META_CLASSES = "m-0 text-caption text-ink-secondary tabular-nums";
/** The assignee's initials: a decorative disc (`aria-hidden`); the name beside it is the text. */
const INITIALS_CLASSES =
  "inline-flex size-xl shrink-0 items-center justify-center rounded-pill bg-surface-sunken text-caption text-ink-secondary";

const HAIRLINE_BLOCK_START: CSSProperties = { borderBlockStartWidth: UI_BORDER_HAIRLINE };

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
  className?: string;
  style?: CSSProperties;
}

function present(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false;
}

/**
 * One product-UI panel: a title row (title, meta, state), 1 to 3 parts and
 * an optional footer, each separated by a hairline. The surface is the
 * `Card` outline: raised fill, one hairline edge, `rounded-surface`, never
 * a shadow and never dark, with `p-lg`, `p-xl` from `desktop`. All small
 * text is secondary ink, which holds AA on the raised fill.
 *
 * Static evidence only: no link, button, input, hover state or focus stop,
 * and no internal scroll. `Specimen` renders these inside its labelled
 * figure; render one alone only inside a labelled figure of your own.
 * Throws a `RangeError` for more than 3 parts (or none). Server-safe: no
 * hooks.
 */
export function SpecimenPanel({ title, meta, status, parts, footer, className, style, ...rest }: SpecimenPanelProps) {
  if (parts.length < 1 || parts.length > SPECIMEN_PANEL_MAX_PARTS) {
    throw new RangeError("Specimen: a panel must hold 1 to " + SPECIMEN_PANEL_MAX_PARTS + " parts, got " + parts.length + ".");
  }
  const hasHeader = present(title) || present(meta) || status !== undefined;
  const assignee = footer?.assignee;
  const hasFooter = assignee !== undefined || present(footer?.note);

  return (
    <Card {...rest} variant="outline" ground="base" data-specimen-panel="" className={cx(PANEL_CLASSES, className)} style={style}>
      {hasHeader ? (
        <div data-specimen-panel-header="" className={HEADER_CLASSES}>
          <div className="flex min-w-0 flex-col gap-xs">
            {present(title) ? <p className={TITLE_CLASSES}>{title}</p> : null}
            {present(meta) ? <p className={META_CLASSES}>{meta}</p> : null}
          </div>
          {status ? <StatusMark tone={status.tone}>{status.label}</StatusMark> : null}
        </div>
      ) : null}
      {parts.map((part, index) => (
        <div
          key={part.id}
          className={hasHeader || index > 0 ? SECTION_DIVIDER : undefined}
          style={hasHeader || index > 0 ? HAIRLINE_BLOCK_START : undefined}
        >
          <SpecimenPartView part={part} />
        </div>
      ))}
      {hasFooter ? (
        <div data-specimen-panel-footer="" className={cx(SECTION_DIVIDER, "flex flex-col gap-xs text-body-s")} style={HAIRLINE_BLOCK_START}>
          {assignee ? (
            <div className="flex flex-wrap items-center gap-x-sm gap-y-xs">
              <span aria-hidden="true" className={INITIALS_CLASSES}>
                {assignee.initials}
              </span>
              <span className="text-ink-primary">{assignee.name}</span>
              {present(assignee.note) ? <span className="text-ink-secondary">{assignee.note}</span> : null}
            </div>
          ) : null}
          {present(footer?.note) ? <p className="m-0 text-ink-secondary text-pretty">{footer?.note}</p> : null}
        </div>
      ) : null}
    </Card>
  );
}
