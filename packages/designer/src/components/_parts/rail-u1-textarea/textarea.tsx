"use client"

import * as React from "react"
import { cn } from "../../_parts/rail-u1-utils/index.js"
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
          "border-(--color-line-strong) dark:bg-(--color-line-strong)/30 focus-visible:border-(--color-focus-ring) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) aria-invalid:outline-solid aria-invalid:outline-(length:--ui-border-focus) aria-invalid:outline-offset-(--ui-focus-offset) aria-invalid:outline-(--color-status-danger) dark:aria-invalid:ring-(--color-status-danger)/40 aria-invalid:border-(--color-status-danger) dark:aria-invalid:border-(--color-status-danger)/50 disabled:bg-(--color-line-strong)/50 dark:disabled:bg-(--color-line-strong)/80 rounded-(--radius-control) border-(length:--ui-border-hairline) bg-transparent px-(--spacing-md) py-(--spacing-sm) text-(length:--text-base) transition-colors duration-(--ui-duration-default) ease-(--ease-default) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) aria-invalid:outline-solid aria-invalid:outline-(length:--ui-border-focus) aria-invalid:outline-offset-(--ui-focus-offset) aria-invalid:outline-(--color-status-danger) md:text-(length:--text-sm) flex field-sizing-content min-h-(--spacing-4xl) w-full focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) placeholder:text-(--color-ink-muted) disabled:cursor-not-allowed disabled:opacity-(--ui-alpha-disabled)",
          className
        )
      )}
      {...props}
    />
  )
}

export { Textarea }
