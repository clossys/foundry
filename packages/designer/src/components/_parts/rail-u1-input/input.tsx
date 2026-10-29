"use client"

import * as React from "react"
import { cn } from "../../_parts/rail-u1-utils/index.js"
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
          "dark:bg-(--color-line-strong)/30 border-(--color-line-strong) focus-visible:border-(--color-focus-ring) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) aria-invalid:outline-solid aria-invalid:outline-(length:--ui-border-focus) aria-invalid:outline-offset-(--ui-focus-offset) aria-invalid:outline-(--color-status-danger) dark:aria-invalid:ring-(--color-status-danger)/40 aria-invalid:border-(--color-status-danger) dark:aria-invalid:border-(--color-status-danger)/50 disabled:bg-(--color-line-strong)/50 dark:disabled:bg-(--color-line-strong)/80 h-(--spacing-2xl) rounded-(--radius-control) border-(length:--ui-border-hairline) bg-transparent px-(--spacing-md) py-(--spacing-xs) text-(length:--text-base) transition-colors duration-(--ui-duration-default) ease-(--ease-default) file:h-(--spacing-xl) file:text-(length:--text-sm) file:font-(weight:--font-weight-medium) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) aria-invalid:outline-solid aria-invalid:outline-(length:--ui-border-focus) aria-invalid:outline-offset-(--ui-focus-offset) aria-invalid:outline-(--color-status-danger) md:text-(length:--text-sm) w-full min-w-0 focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) file:inline-flex file:border-0 file:bg-transparent file:text-(--color-ink-primary) placeholder:text-(--color-ink-muted) disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-(--ui-alpha-disabled)",
          className
        )
      )}
      {...props}
    />
  )
}

export { Input }
