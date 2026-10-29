"use client"

import * as React from "react"
import { cn } from "../../_parts/rail-utils/index.js"
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
        "gap-(--spacing-sm) text-(length:--text-sm) leading-(--leading-heading) font-(weight:--font-weight-medium) group-data-[disabled=true]:opacity-(--ui-alpha-disabled) peer-disabled:opacity-(--ui-alpha-disabled) peer-data-disabled:opacity-(--ui-alpha-disabled) flex items-center select-none group-data-[disabled=true]:pointer-events-none peer-disabled:cursor-not-allowed",
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
