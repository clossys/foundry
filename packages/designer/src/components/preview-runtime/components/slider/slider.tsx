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
        "data-vertical:min-h-[calc(var(--spacing,0.25rem)*32)] group relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:w-auto data-vertical:flex-col",
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
              className="bg-(--muted) rounded-full data-horizontal:h-[calc(var(--spacing,0.25rem)*1)] data-horizontal:w-full data-vertical:h-full data-vertical:w-[calc(var(--spacing,0.25rem)*1)] relative grow overflow-hidden select-none"
            >
              <SliderFill
                data-slot="slider-range"
                className="bg-(--primary) absolute select-none data-horizontal:h-full data-vertical:w-full"
              />
            </SliderTrack>
            {state.values.map((_, index) => (
              <SliderThumb
                data-slot="slider-thumb"
                key={index}
                index={index}
                className="border-(--ring) outline-solid outline-2 outline-offset-2 outline-(--ring) relative size-[calc(var(--spacing,0.25rem)*4)] rounded-full border bg-(--card) transition-[color,box-shadow] after:absolute after:-inset-[calc(var(--spacing,0.25rem)*2)] hover:ring-3 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)  active:ring-3 block shrink-0 select-none group-data-horizontal:top-[50%] group-data-vertical:start-[50%] disabled:pointer-events-none disabled:opacity-50"
              />
            ))}
          </>
        )
      }}
    </SliderPrimitive>
  )
}

export { Slider }
