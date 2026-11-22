"use client"

import * as React from "react"
import { cn } from "../../_parts/rail-utils/index.js"
import {
  composeRenderProps,
  TextArea as TextareaPrimitive,
} from "react-aria-components"

function Textarea({
  className,
  ...props
}: React.ComponentProps<typeof TextareaPrimitive>) {
  return (
    <TextareaPrimitive
      data-slot="textarea"
      className={composeRenderProps(className, (className) =>
        cn(
          "border-(--input) dark:bg-(--input)/30 focus-visible:border-(--ring) focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) aria-invalid:outline-solid aria-invalid:outline-2 aria-invalid:outline-offset-2 aria-invalid:outline-(--destructive) dark:aria-invalid:ring-(--destructive)/40 aria-invalid:border-(--destructive) dark:aria-invalid:border-(--destructive)/50 disabled:bg-(--input)/50 dark:disabled:bg-(--input)/80 rounded-(--radius) border bg-transparent px-[calc(var(--spacing,0.25rem)*3)] py-[calc(var(--spacing,0.25rem)*2)] text-(length:--text-base) motion-safe:transition-colors motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0 md:text-(length:--text-sm) flex field-sizing-content min-h-[calc(var(--spacing,0.25rem)*16)] w-full placeholder:text-(--muted-foreground) disabled:cursor-not-allowed disabled:opacity-50",
          className
        )
      )}
      {...props}
    />
  )
}

export { Textarea }
