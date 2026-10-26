import {
  Calendar as AriaCalendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  Heading,
  RangeCalendar as AriaRangeCalendar,
  useLocale,
  type CalendarCellRenderProps,
  type CalendarProps as AriaCalendarProps,
  type DateValue,
  type RangeCalendarProps as AriaRangeCalendarProps,
} from "react-aria-components";
import { Button } from "./Button.js";
import { useGlyph } from "./glyph-context.js";
import { Icon } from "./Icon.js";
import { cx } from "./internal/cx.js";
import { UI_ALPHA_DISABLED, UI_RING_FOCUS } from "./internal/ui-vars.js";

type Shared = "children" | "className" | "errorMessage";

export interface SingleCalendarProps<T extends DateValue = DateValue> extends Omit<AriaCalendarProps<T>, Shared> {
  /** One date. @default "single" */
  selection?: "single";
  /** Merged onto the calendar root. */
  className?: string;
}

export interface RangeCalendarProps<T extends DateValue = DateValue> extends Omit<AriaRangeCalendarProps<T>, Shared> {
  /** A start and an end date; `value` and `onChange` carry a `{ start, end }` range. */
  selection: "range";
  /** Merged onto the calendar root. */
  className?: string;
}

export type CalendarProps<T extends DateValue = DateValue> = SingleCalendarProps<T> | RangeCalendarProps<T>;

const CELL = "inline-flex size-[var(--ui-control-h-sm,32px)] cursor-default items-center justify-center rounded-control tabular-nums outline-none";

/**
 * A day's look from its state. Selected (and a range's two ends) binds to the
 * action colour, as every selected control here does (C12); the days inside
 * a range take the sunken surface; today is marked in the accent ink until
 * selected; an unavailable day is struck through; a day of the neighbouring
 * month keeps its cell (the grid stays rectangular) but is not shown. A
 * range calendar marks every highlighted day selected; only its ends fill.
 */
function cellClassName(state: CalendarCellRenderProps, range: boolean): string {
  const filled = state.isSelected && (!range || state.isSelectionStart || state.isSelectionEnd);
  return cx(
    CELL,
    state.isOutsideMonth && "invisible",
    filled ? "bg-action text-ink-on-action" : state.isSelected ? "bg-surface-sunken text-ink-primary" : "text-ink-primary",
    !state.isSelected && state.isHovered && !state.isDisabled && !state.isUnavailable && "bg-surface-sunken",
    !state.isSelected && state.isToday && "text-accent font-semibold",
    state.isUnavailable && "line-through text-ink-muted",
  );
}

function cellStyle(state: CalendarCellRenderProps) {
  return {
    opacity: state.isDisabled ? UI_ALPHA_DISABLED : undefined,
    boxShadow: state.isFocusVisible ? UI_RING_FOCUS : undefined,
  };
}

function Month({ offset, range }: { offset: number; range: boolean }) {
  return (
    <CalendarGrid offset={offset ? { months: offset } : undefined} className="border-collapse">
      <CalendarGridHeader>
        {(weekday) => <CalendarHeaderCell className="text-caption font-normal text-ink-muted">{weekday}</CalendarHeaderCell>}
      </CalendarGridHeader>
      <CalendarGridBody>
        {(date) => (
          <CalendarCell
            date={date}
            className={(state) => cellClassName(state, range)}
            style={cellStyle}
          />
        )}
      </CalendarGridBody>
    </CalendarGrid>
  );
}

function Body({ months, range }: { months: number; range: boolean }) {
  const { direction } = useLocale();
  const left = useGlyph("assets.icon-chevron-left");
  const right = useGlyph("assets.icon-chevron-right");
  return (
    <>
      <header className="flex items-center justify-between gap-xs pb-sm">
        <Button slot="previous" variant="ghost" size="sm">
          <Icon glyph={direction === "rtl" ? right : left} decorative size="sm" />
        </Button>
        <Heading className="font-semibold" />
        <Button slot="next" variant="ghost" size="sm">
          <Icon glyph={direction === "rtl" ? left : right} decorative size="sm" />
        </Button>
      </header>
      <div className="flex gap-xs">
        {Array.from({ length: months }, (_, offset) => <Month key={offset} offset={offset} range={range} />)}
      </div>
    </>
  );
}

/**
 * A month grid for choosing one date or a range: previous/next paging, a
 * live month heading, weekday headers, and a day grid. Built on
 * react-aria-components' `Calendar` and `RangeCalendar` (`selection`
 * picks which) for what is hard to get right by hand: the `grid` role and
 * its arrow/Page/Home/End keys (mirrored for right-to-left locales), locale
 * week starts and month names, min/max and unavailable dates, and range
 * highlighting while the pointer or focus moves.
 *
 * Reads only its contract's tokens: action, surface, text and accent
 * colours, control radius and size, caption size, font weight, spacing,
 * the disabled state opacity, and the focus shadow for a focused day (no
 * focus outline width or offset). Day numbers inherit the surrounding body
 * size. The previous/next controls are `Button`s (`ghost`, `sm`), so they
 * keep the package's button focus treatment; their chevrons come from the
 * `assets.icon-chevron-left`/`-right` bindings and swap in right-to-left.
 */
export function Calendar<T extends DateValue = DateValue>(props: CalendarProps<T>) {
  const months = props.visibleDuration?.months ?? 1;
  if (props.selection === "range") {
    const { selection: _selection, className, ...rest } = props;
    return (
      <AriaRangeCalendar {...rest} className={cx("inline-block text-ink-primary", className)}>
        <Body months={months} range />
      </AriaRangeCalendar>
    );
  }
  const { selection: _selection, className, ...rest } = props;
  return (
    <AriaCalendar {...rest} className={cx("inline-block text-ink-primary", className)}>
      <Body months={months} range={false} />
    </AriaCalendar>
  );
}
