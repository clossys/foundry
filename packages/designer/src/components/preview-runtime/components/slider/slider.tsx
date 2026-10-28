"use client"

import { cn } from "../_parts/utils/index.js"
import {
  SliderFill,
  Slider as SliderPrimitive,
  SliderThumb,
  SliderTrack,
  type SliderProps as SliderPrimitiveProps,
} from "react-aria-components"

type SliderValue = number | number[]
type SliderProps<T extends SliderValue = SliderValue> = Omit<
  SliderPrimitiveProps<T>,
  "className"
> & {
  className?: string
}

function Slider<T extends SliderValue = SliderValue>({
  className,
  ...props
}: SliderProps<T>) {
  return (
    <SliderPrimitive
      className={cn(
        "data-vertical:min-h-[var(--spacing-6xl)] group relative flex w-full touch-none items-center select-none data-disabled:opacity-(--ui-alpha-disabled,50%) data-vertical:h-full data-vertical:w-auto data-vertical:flex-col",
        className
      )}
      data-slot="slider"
      {...props}
    >
      {({ state }) => {
        return (
          <>
            <SliderTrack
              data-slot="slider-track"
              className="bg-(--color-surface-sunken) rounded-full data-horizontal:h-(--spacing-xs) data-horizontal:w-full data-vertical:h-full data-vertical:w-(--spacing-xs) relative grow overflow-hidden select-none"
            >
              <SliderFill
                data-slot="slider-range"
                className="bg-(--color-action) absolute select-none data-horizontal:h-full data-vertical:w-full"
              />
            </SliderTrack>
            {state.values.map((_, index) => (
              <SliderThumb
                data-slot="slider-thumb"
                key={index}
                index={index}
                className="border-(--color-focus-ring) outline-solid outline-(length:--ui-border-focus,3px) outline-offset-(--ui-focus-offset) outline-(--color-focus-ring) relative size-(--ui-control-mark) rounded-full border-(length:--ui-border-hairline,1px) bg-(--color-surface-raised) transition-[color,box-shadow] duration-(--ui-duration-default) ease-(--default-transition-timing-function) after:absolute after:-inset-(--spacing-sm) hover:ring-(length:--ui-border-rule,3px) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring)  active:ring-(length:--ui-border-rule,3px) block shrink-0 select-none group-data-horizontal:top-[50%] group-data-vertical:left-[50%] disabled:pointer-events-none disabled:opacity-(--ui-alpha-disabled,50%)"
              />
            ))}
          </>
        )
      }}
    </SliderPrimitive>
  )
}

export { Slider }
