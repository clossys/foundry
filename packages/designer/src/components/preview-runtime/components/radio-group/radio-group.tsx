"use client"

import { cn } from "../_parts/utils/index.js"
import {
  composeRenderProps,
  RadioGroup as RadioGroupPrimitive,
  Radio as RadioPrimitive,
  type RadioGroupProps,
  type RadioProps,
} from "react-aria-components"

function RadioGroup({ className, ...props }: RadioGroupProps) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn("grid gap-(--spacing-sm) w-full", className)}
      {...props}
    />
  )
}

function RadioGroupItem({ className, children, ...props }: RadioProps) {
  return (
    <RadioPrimitive
      data-slot="radio-group-item"
      className={cn(
        "border-(--color-line-strong) dark:bg-(--color-line-strong)/30 data-checked:bg-(--color-action) data-checked:text-(--color-ink-on-action) dark:data-checked:bg-(--color-action) data-checked:border-(--color-action) aria-invalid:aria-checked:border-(--color-action) aria-invalid:border-(--color-status-danger) focus-visible:border-(--color-focus-ring) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) aria-invalid:outline-solid aria-invalid:outline-(length:--ui-border-focus,3px) aria-invalid:outline-offset-(--ui-focus-offset) aria-invalid:outline-(--color-status-danger) dark:aria-invalid:ring-(--color-status-danger)/40 dark:aria-invalid:border-(--color-status-danger)/50 flex size-(--ui-control-mark,calc(var(--spacing)*4)) rounded-full focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) aria-invalid:outline-solid aria-invalid:outline-(length:--ui-border-focus,3px) aria-invalid:outline-offset-(--ui-focus-offset) aria-invalid:outline-(--color-status-danger)  group-has-[:focus-visible]/field-label:not-data-checked:border-(--color-line-strong) group-has-[:focus-visible]/field-label:data-checked:border-(--color-action) data-selected:bg-(--color-action) data-selected:text-(--color-ink-on-action) dark:data-selected:bg-(--color-action) data-selected:border-(--color-action) data-focus-visible:border-(--color-focus-ring) data-focus-visible:outline-solid data-focus-visible:outline-(length:--ui-border-focus,3px) data-focus-visible:outline-offset-(--ui-focus-offset) data-focus-visible:outline-(--color-focus-ring) data-focus-visible:outline-solid data-focus-visible:outline-(length:--ui-border-focus,3px) data-focus-visible:outline-offset-(--ui-focus-offset) data-focus-visible:outline-(--color-focus-ring) data-invalid:data-selected:border-(--color-action) data-invalid:border-(--color-status-danger) data-invalid:outline-solid data-invalid:outline-(length:--ui-border-focus,3px) data-invalid:outline-offset-(--ui-focus-offset) data-invalid:outline-(--color-status-danger) dark:data-invalid:ring-(--color-status-danger)/40 dark:data-invalid:border-(--color-status-danger)/50 data-invalid:outline-solid data-invalid:outline-(length:--ui-border-focus,3px) data-invalid:outline-offset-(--ui-focus-offset) data-invalid:outline-(--color-status-danger) group/radio-group-item peer relative aspect-square shrink-0 border-(length:--ui-border-hairline,1px) after:absolute after:-inset-x-3 after:-inset-y-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-(--ui-alpha-disabled,50%)",
        className
      )}
      {...props}
    >
      {composeRenderProps(children, (children, { isSelected }) => (
        <>
          <span
            data-slot="radio-group-indicator"
            className="flex size-(--spacing-lg,calc(var(--spacing)*4)) items-center justify-center"
          >
            {isSelected && <span className="bg-(--color-ink-on-action) absolute top-1/2 start-1/2 size-(--spacing-sm) -translate-x-1/2 rtl:translate-x-1/2 -translate-y-1/2 rounded-full" />}
          </span>
          {children}
        </>
      ))}
    </RadioPrimitive>
  )
}

export { RadioGroup, RadioGroupItem }
