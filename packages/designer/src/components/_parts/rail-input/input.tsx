"use client"

import * as React from "react"
import { cn } from "../../_parts/rail-utils/index.js"
import {
  composeRenderProps,
  Input as InputPrimitive,
} from "react-aria-components"

function Input({
  className,
  type,
  ...props
}: React.ComponentProps<typeof InputPrimitive>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={composeRenderProps(className, (className) =>
        cn(
          "dark:bg-(--input)/30 border-(--input) focus-visible:border-(--ring) focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) aria-invalid:outline-solid aria-invalid:outline-2 aria-invalid:outline-offset-2 aria-invalid:outline-(--destructive) dark:aria-invalid:ring-(--destructive)/40 aria-invalid:border-(--destructive) dark:aria-invalid:border-(--destructive)/50 disabled:bg-(--input)/50 dark:disabled:bg-(--input)/80 h-[calc(var(--spacing,0.25rem)*8)] rounded-(--radius) border bg-transparent px-[calc(var(--spacing,0.25rem)*3)] py-[calc(var(--spacing,0.25rem)*1)] text-(length:--text-base) motion-safe:transition-colors motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0 file:h-[calc(var(--spacing,0.25rem)*6)] file:text-(length:--text-sm) file:font-medium md:text-(length:--text-sm) w-full min-w-0 file:inline-flex file:border-0 file:bg-transparent file:text-(--foreground) placeholder:text-(--muted-foreground) disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          className
        )
      )}
      {...props}
    />
  )
}

export { Input }
