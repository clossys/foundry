"use client"

import * as React from "react"
import { cn } from "./utils.js"
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
          "border-(--color-line-strong) dark:bg-(--color-line-strong)/30 focus-visible:border-(--color-focus-ring) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) aria-invalid:outline-solid aria-invalid:outline-(length:--ui-border-focus,3px) aria-invalid:outline-offset-(--ui-focus-offset) aria-invalid:outline-(--color-status-danger) dark:aria-invalid:ring-(--color-status-danger)/40 aria-invalid:border-(--color-status-danger) dark:aria-invalid:border-(--color-status-danger)/50 disabled:bg-(--color-line-strong)/50 dark:disabled:bg-(--color-line-strong)/80 rounded-(--radius-control) border-(length:--ui-border-hairline,1px) bg-transparent px-(--spacing-md) py-(--spacing-sm) text-(length:--text-base) transition-colors duration-(--ui-duration-default) ease-(--default-transition-timing-function) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) aria-invalid:outline-solid aria-invalid:outline-(length:--ui-border-focus,3px) aria-invalid:outline-offset-(--ui-focus-offset) aria-invalid:outline-(--color-status-danger) md:text-(length:--text-sm) flex field-sizing-content min-h-(--spacing-4xl) w-full placeholder:text-(--color-ink-muted) disabled:cursor-not-allowed disabled:opacity-(--ui-alpha-disabled,50%)",
          className
        )
      )}
      {...props}
    />
  )
}

export { Textarea }
