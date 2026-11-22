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
  "group/day relative mt-[calc(var(--spacing,0.25rem)*2)] aspect-square h-full w-full cursor-default rounded-(--cell-radius) p-0 text-center select-none [&:is(:last-child>[data-selected=true])>div]:rounded-e-(--cell-radius)",
  {
    variants: {
      showWeekNumber: {
        false:
          "[&:is(:first-child>[data-selected=true])>div]:rounded-s-(--cell-radius)",
        true: "[&:is(:nth-child(2)>[data-selected=true])>div]:rounded-s-(--cell-radius)",
      },
      isToday: {
        true: "rounded-(--cell-radius) bg-(--muted) text-(--foreground) data-[selected=true]:rounded-none",
      },
      isSelectionStart: {
        true: "relative isolate z-0 rounded-s-(--cell-radius) bg-(--muted) after:absolute after:inset-y-0 after:end-0 after:w-[calc(var(--spacing,0.25rem)*4)] after:bg-(--muted)",
      },
      isSelectionEnd: {
        true: "relative isolate z-0 rounded-e-(--cell-radius) bg-(--muted) after:absolute after:inset-y-0 after:start-0 after:w-[calc(var(--spacing,0.25rem)*4)] after:bg-(--muted)",
      },
      isUnavailable: {
        true: "text-(--muted-foreground) opacity-50 [&>div]:line-through",
      },
      isDisabled: {
        true: "text-(--muted-foreground) opacity-50",
      },
      isOutsideMonth: {
        true: "text-(--muted-foreground) aria-selected:text-(--muted-foreground)",
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
        "p-[calc(var(--spacing,0.25rem)*2)] [--cell-radius:var(--radius,0.625rem)] [--cell-size:calc(var(--spacing,0.25rem)*7)] group/calendar w-fit bg-(--background) in-data-[slot=card-content]:bg-transparent in-data-[slot=popover-content]:bg-transparent",
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
        "p-[calc(var(--spacing,0.25rem)*2)] [--cell-radius:var(--radius,0.625rem)] [--cell-size:calc(var(--spacing,0.25rem)*7)] group/calendar w-fit bg-(--background) in-data-[slot=card-content]:bg-transparent in-data-[slot=popover-content]:bg-transparent",
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
    <div className="relative flex flex-col gap-[calc(var(--spacing,0.25rem)*4)] md:flex-row">
      <header className="absolute inset-x-0 top-0 flex w-full items-center justify-between gap-[calc(var(--spacing,0.25rem)*1)]">
        <Button
          variant={buttonVariant}
          slot="previous"
          className="size-(--cell-size) p-0 select-none aria-disabled:opacity-50"
        >
          <LibraryIcon asset="assets.icon-chevron-left" decorative className="size-[calc(var(--spacing,0.25rem)*4)]" />
        </Button>
        <Button
          variant={buttonVariant}
          slot="next"
          className="size-(--cell-size) p-0 select-none aria-disabled:opacity-50"
        >
          <LibraryIcon asset="assets.icon-chevron-right" decorative className="size-[calc(var(--spacing,0.25rem)*4)]" />
        </Button>
      </header>
      {Array.from({ length: numberOfMonths }, (_, i) => (
        <div key={i} className="flex w-full flex-col gap-[calc(var(--spacing,0.25rem)*4)]">
          <div className="flex h-(--cell-size) w-full items-center justify-center gap-[calc(var(--spacing,0.25rem)*1)] px-(--cell-size)">
            {captionLayout === "dropdown" ? (
              <>
                <MonthDropdown format={headerFormat} />
                <YearDropdown format={headerFormat} />
              </>
            ) : (
              <CalendarHeading
                offset={{ months: i }}
                format={headerFormat}
                className="text-(length:--text-sm) font-medium select-none"
              />
            )}
          </div>
          <CalendarGrid
            className="w-full border-collapse"
            offset={{ months: i }}
          >
            <AriaCalendarGridHeader>
              {(day) => (
                <CalendarHeaderCell className="rounded-(--cell-radius) text-[0.8rem] font-normal text-(--muted-foreground) select-none">
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
                        "relative isolate z-10 flex aspect-square h-full w-full min-w-(--cell-size) flex-col gap-[calc(var(--spacing,0.25rem)*1)] border-0 leading-none font-normal group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:border-(--ring) group-data-[focused=true]/day:outline-solid group-data-[focused=true]/day:outline-2 group-data-[focused=true]/day:outline-offset-2 group-data-[focused=true]/day:outline-(--ring) group-data-[focused=true]/day:outline-solid group-data-[focused=true]/day:outline-2 group-data-[focused=true]/day:outline-offset-2 group-data-[focused=true]/day:outline-(--ring) data-[range-end=true]:rounded-(--cell-radius) data-[range-end=true]:rounded-e-(--cell-radius) data-[range-end=true]:bg-(--primary) data-[range-end=true]:text-(--primary-foreground) data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-(--muted) data-[range-middle=true]:text-(--foreground) data-[range-start=true]:rounded-(--cell-radius) data-[range-start=true]:rounded-s-(--cell-radius) data-[range-start=true]:bg-(--primary) data-[range-start=true]:text-(--primary-foreground) data-[selected-single=true]:bg-(--primary) data-[selected-single=true]:text-(--primary-foreground) dark:hover:text-(--foreground) [&>span]:text-(length:--text-xs) [&>span]:opacity-70"
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
