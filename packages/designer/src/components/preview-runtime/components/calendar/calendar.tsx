"use client"

import { Icon as LibraryIcon } from "../icon/index.js"
import type { ComponentProps as ReactComponentProps, ReactElement as ReactElement, ReactNode as ReactNode, Ref as ReactRef, RefAttributes as ReactRefAttributes } from "react"
import { forwardRef as ReactForwardRef } from "react"
import { cva } from "class-variance-authority"
import { cn } from "../_parts/utils/index.js"
import {
  Calendar as AriaCalendar,
  CalendarGridHeader as AriaCalendarGridHeader,
  RangeCalendar as AriaRangeCalendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarHeaderCell,
  CalendarHeading,
  CalendarMonthPicker,
  CalendarYearPicker,
  type CalendarCellRenderProps,
  type CalendarProps,
  type DateValue,
  type RangeCalendarProps,
} from "react-aria-components"

import { Button } from "../button/index.js"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../select/select.js"
const cellVariants = cva(
  "group/day relative mt-(--spacing-sm) aspect-square h-full w-full cursor-default rounded-(--cell-radius) p-0 text-center select-none [&:is(:last-child>[data-selected=true])>div]:rounded-r-(--cell-radius)",
  {
    variants: {
      showWeekNumber: {
        false:
          "[&:is(:first-child>[data-selected=true])>div]:rounded-l-(--cell-radius)",
        true: "[&:is(:nth-child(2)>[data-selected=true])>div]:rounded-l-(--cell-radius)",
      },
      isToday: {
        true: "rounded-(--cell-radius) bg-(--color-surface-sunken) text-(--color-ink-primary) data-[selected=true]:rounded-none",
      },
      isSelectionStart: {
        true: "relative isolate z-(--ui-z-base) rounded-l-(--cell-radius) bg-(--color-surface-sunken) after:absolute after:inset-y-0 after:right-0 after:w-(--spacing-lg) after:bg-(--color-surface-sunken)",
      },
      isSelectionEnd: {
        true: "relative isolate z-(--ui-z-base) rounded-r-(--cell-radius) bg-(--color-surface-sunken) after:absolute after:inset-y-0 after:left-0 after:w-(--spacing-lg) after:bg-(--color-surface-sunken)",
      },
      isUnavailable: {
        true: "text-(--color-ink-muted) opacity-(--ui-alpha-disabled,50%) [&>div]:line-through",
      },
      isDisabled: {
        true: "text-(--color-ink-muted) opacity-(--ui-alpha-disabled,50%)",
      },
      isOutsideMonth: {
        true: "text-(--color-ink-muted) aria-selected:text-(--color-ink-muted)",
      },
    },
  }
)

type ConsumerCalendarProps<T extends DateValue, M extends "single" | "multiple" = "single"> = Omit<CalendarProps<T, M>, "visibleDuration"> & {
    buttonVariant?: ReactComponentProps<typeof Button>["variant"]
    captionLayout?: "label" | "dropdown"
    numberOfMonths?: number
    showWeekNumber?: boolean
    headerFormat?: Intl.DateTimeFormatOptions
    renderCell?: (
      renderProps: CalendarCellRenderProps & {
        defaultChildren: ReactNode
      }
    ) => ReactNode
  };
const Calendar = ReactForwardRef(function Calendar<T extends DateValue, M extends "single" | "multiple" = "single">(
  props: ConsumerCalendarProps<T, M>, ref: ReactRef<HTMLDivElement>,
) {
  return (
    <AriaCalendar
      ref={ref}
      {...props}
      data-slot="calendar"
      visibleDuration={{ months: props.numberOfMonths || 1 }}
      className={state => cn(
        "p-(--spacing-sm) [--cell-radius:var(--radius-control)] [--cell-size:var(--ui-control-h-sm)] group/calendar w-fit bg-(--color-surface-base) in-data-[slot=card-content]:bg-transparent in-data-[slot=popover-content]:bg-transparent",
        typeof props.className === "function" ? props.className(state) : props.className
      )}
    >
      {state => typeof props.children === "function" ? props.children({ ...state, defaultChildren: <CalendarInner {...props} /> }) : props.children ?? <CalendarInner {...props} />}
    </AriaCalendar>
  )

}) as <T extends DateValue, M extends "single" | "multiple" = "single">(props: ConsumerCalendarProps<T, M> & ReactRefAttributes<HTMLDivElement>) => ReactElement;
type ConsumerRangeCalendarProps<T extends DateValue> = RangeCalendarProps<T> & {
    buttonVariant?: ReactComponentProps<typeof Button>["variant"]
    captionLayout?: "label" | "dropdown"
    headerFormat?: Intl.DateTimeFormatOptions
    numberOfMonths?: number
    showWeekNumber?: boolean
    renderCell?: (
      renderProps: CalendarCellRenderProps & {
        defaultChildren: ReactNode
      }
    ) => ReactNode
  };
const RangeCalendar = ReactForwardRef(function RangeCalendar<T extends DateValue>(
  props: ConsumerRangeCalendarProps<T>, ref: ReactRef<HTMLDivElement>,
) {
  return (
    <AriaRangeCalendar
      ref={ref}
      {...props}
      data-slot="calendar"
      visibleDuration={{ months: props.numberOfMonths || 1 }}
      className={state => cn(
        "p-(--spacing-sm) [--cell-radius:var(--radius-control)] [--cell-size:var(--ui-control-h-sm)] group/calendar w-fit bg-(--color-surface-base) in-data-[slot=card-content]:bg-transparent in-data-[slot=popover-content]:bg-transparent",
        typeof props.className === "function" ? props.className(state) : props.className
      )}
    >
      {state => typeof props.children === "function" ? props.children({ ...state, defaultChildren: <CalendarInner {...props} isRange /> }) : props.children ?? <CalendarInner {...props} isRange />}
    </AriaRangeCalendar>
  )

}) as <T extends DateValue>(props: ConsumerRangeCalendarProps<T> & ReactRefAttributes<HTMLDivElement>) => ReactElement;
function CalendarInner({
  captionLayout = "label",
  buttonVariant = "ghost",
  numberOfMonths = 1,
  showWeekNumber = false,
  headerFormat,
  renderCell,
  isRange,
}: {
  buttonVariant?: ReactComponentProps<typeof Button>["variant"]
  captionLayout?: "label" | "dropdown"
  numberOfMonths?: number
  showWeekNumber?: boolean
  headerFormat?: Intl.DateTimeFormatOptions
  renderCell?: (
    renderProps: CalendarCellRenderProps & { defaultChildren: ReactNode }
  ) => ReactNode
  isRange?: boolean
}) {
  return (
    <div className="relative flex flex-col gap-(--spacing-lg) md:flex-row">
      <header className="absolute inset-x-0 top-0 flex w-full items-center justify-between gap-(--spacing-xs)">
        <Button
          variant={buttonVariant}
          slot="previous"
          className="size-(--cell-size) p-0 select-none aria-disabled:opacity-(--ui-alpha-disabled,50%)"
        >
          <LibraryIcon asset="assets.icon-chevron-left" decorative className="size-(--spacing-lg,calc(var(--spacing)*4))" />
        </Button>
        <Button
          variant={buttonVariant}
          slot="next"
          className="size-(--cell-size) p-0 select-none aria-disabled:opacity-(--ui-alpha-disabled,50%)"
        >
          <LibraryIcon asset="assets.icon-chevron-right" decorative className="size-(--spacing-lg,calc(var(--spacing)*4))" />
        </Button>
      </header>
      {Array.from({ length: numberOfMonths }, (_, i) => (
        <div key={i} className="flex w-full flex-col gap-(--spacing-lg)">
          <div className="flex h-(--cell-size) w-full items-center justify-center gap-(--spacing-xs) px-(--cell-size)">
            {captionLayout === "dropdown" ? (
              <>
                <MonthDropdown format={headerFormat} />
                <YearDropdown format={headerFormat} />
              </>
            ) : (
              <CalendarHeading
                offset={{ months: i }}
                format={headerFormat}
                className="text-(length:--text-sm) font-(weight:--font-weight-medium) select-none"
              />
            )}
          </div>
          <CalendarGrid
            className="w-full border-collapse"
            offset={{ months: i }}
          >
            <AriaCalendarGridHeader>
              {(day) => (
                <CalendarHeaderCell className="rounded-(--cell-radius) text-(length:--text-caption) font-(weight:--font-weight-normal) text-(--color-ink-muted) select-none">
                  {day}
                </CalendarHeaderCell>
              )}
            </AriaCalendarGridHeader>
            <CalendarGridBody>
              {(date) => (
                <CalendarCell
                  date={date}
                  className={(renderProps) =>
                    cellVariants({ ...renderProps, showWeekNumber })
                  }
                >
                  {(renderProps) => (
                    <div
                      data-selected-single={renderProps.isSelected && !isRange}
                      data-range-start={renderProps.isSelectionStart && isRange}
                      data-range-end={renderProps.isSelectionEnd && isRange}
                      data-range-middle={
                        renderProps.isSelected &&
                        !renderProps.isSelectionStart &&
                        !renderProps.isSelectionEnd &&
                        isRange
                      }
                      className={cn(
                        "relative isolate z-(--ui-z-sticky) flex aspect-square h-full w-full min-w-(--cell-size) flex-col gap-(--spacing-xs) border-0 leading-(--leading-heading) font-(weight:--font-weight-normal) group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-(--ui-z-sticky) group-data-[focused=true]/day:border-(--color-focus-ring) group-data-[focused=true]/day:outline-solid group-data-[focused=true]/day:outline-(length:--ui-border-focus,3px) group-data-[focused=true]/day:outline-offset-(--ui-focus-offset) group-data-[focused=true]/day:outline-(--color-focus-ring) group-data-[focused=true]/day:outline-solid group-data-[focused=true]/day:outline-(length:--ui-border-focus,3px) group-data-[focused=true]/day:outline-offset-(--ui-focus-offset) group-data-[focused=true]/day:outline-(--color-focus-ring) data-[range-end=true]:rounded-(--cell-radius) data-[range-end=true]:rounded-r-(--cell-radius) data-[range-end=true]:bg-(--color-action) data-[range-end=true]:text-(--color-ink-on-action) data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-(--color-surface-sunken) data-[range-middle=true]:text-(--color-ink-primary) data-[range-start=true]:rounded-(--cell-radius) data-[range-start=true]:rounded-l-(--cell-radius) data-[range-start=true]:bg-(--color-action) data-[range-start=true]:text-(--color-ink-on-action) data-[selected-single=true]:bg-(--color-action) data-[selected-single=true]:text-(--color-ink-on-action) dark:hover:text-(--color-ink-primary) [&>span]:text-(length:--text-xs) [&>span]:opacity-(--ui-alpha-stale)"
                      )}
                    >
                      {renderCell
                        ? renderCell(renderProps)
                        : renderProps.defaultChildren}
                    </div>
                  )}
                </CalendarCell>
              )}
            </CalendarGridBody>
          </CalendarGrid>
        </div>
      ))}
    </div>
  )
}

function MonthDropdown({ format }: { format?: Intl.DateTimeFormatOptions }) {
  return (
    <CalendarMonthPicker format={format?.month}>
      {(props) => (
        <Select {...props} className="relative">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="min-w-0">
            <SelectGroup>
              {props.items.map((item) => (
                <SelectItem key={item.id} id={item.id}>
                  {item.formatted}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
    </CalendarMonthPicker>
  )
}

function YearDropdown({ format }: { format?: Intl.DateTimeFormatOptions }) {
  return (
    <CalendarYearPicker format={format}>
      {(props) => (
        <Select {...props} className="relative">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="min-w-0">
            {props.items.map((item) => (
              <SelectItem key={item.id} id={item.id}>
                {item.formatted}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </CalendarYearPicker>
  )
}

export { Calendar, RangeCalendar }
