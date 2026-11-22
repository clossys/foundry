"use client"

import * as React from "react"
import { cn } from "./utils.js"
import {
  LabelContext,
  Label as LabelPrimitive,
  type LabelProps,
} from "react-aria-components"

function Label({ className, htmlFor, slot, ...props }: LabelProps) {
  const label = (
    <LabelPrimitive
      data-slot="label"
      className={cn(
        "gap-[calc(var(--spacing,0.25rem)*2)] text-(length:--text-sm) leading-none font-medium group-data-[disabled=true]:opacity-50 peer-disabled:opacity-50 peer-data-disabled:opacity-50 flex items-center select-none group-data-[disabled=true]:pointer-events-none peer-disabled:cursor-not-allowed",
        className
      )}
      {...props}
      htmlFor={htmlFor}
      slot={slot}
    />
  )

  if (htmlFor && slot === undefined) {
    return <LabelContext.Provider value={null}>{label}</LabelContext.Provider>
  }

  return label
}

export { Label }
