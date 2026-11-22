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
      className={cn("grid gap-[calc(var(--spacing,0.25rem)*2)] w-full", className)}
      {...props}
    />
  )
}

function RadioGroupItem({ className, children, ...props }: RadioProps) {
  return (
    <RadioPrimitive
      data-slot="radio-group-item"
      className={cn(
        "border-(--input) dark:bg-(--input)/30 data-checked:bg-(--primary) data-checked:text-(--primary-foreground) dark:data-checked:bg-(--primary) data-checked:border-(--primary) aria-invalid:aria-checked:border-(--primary) aria-invalid:border-(--destructive) focus-visible:border-(--ring) focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) aria-invalid:outline-solid aria-invalid:outline-2 aria-invalid:outline-offset-2 aria-invalid:outline-(--destructive) dark:aria-invalid:ring-(--destructive)/40 dark:aria-invalid:border-(--destructive)/50 flex size-[calc(var(--spacing,0.25rem)*4)] rounded-full focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) aria-invalid:outline-solid aria-invalid:outline-2 aria-invalid:outline-offset-2 aria-invalid:outline-(--destructive)  group-has-[:focus-visible]/field-label:not-data-checked:border-(--input) group-has-[:focus-visible]/field-label:data-checked:border-(--primary) data-selected:bg-(--primary) data-selected:text-(--primary-foreground) dark:data-selected:bg-(--primary) data-selected:border-(--primary) data-focus-visible:border-(--ring) data-focus-visible:outline-solid data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-(--ring) data-focus-visible:outline-solid data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-(--ring) data-invalid:data-selected:border-(--primary) data-invalid:border-(--destructive) data-invalid:outline-solid data-invalid:outline-2 data-invalid:outline-offset-2 data-invalid:outline-(--destructive) dark:data-invalid:ring-(--destructive)/40 dark:data-invalid:border-(--destructive)/50 data-invalid:outline-solid data-invalid:outline-2 data-invalid:outline-offset-2 data-invalid:outline-(--destructive) group/radio-group-item peer relative aspect-square shrink-0 border after:absolute after:-inset-x-3 after:-inset-y-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      {composeRenderProps(children, (children, { isSelected }) => (
        <>
          <span
            data-slot="radio-group-indicator"
            className="flex size-[calc(var(--spacing,0.25rem)*4)] items-center justify-center"
          >
            {isSelected && <span className="bg-(--primary-foreground) absolute top-1/2 start-1/2 size-[calc(var(--spacing,0.25rem)*2)] -translate-x-1/2 rtl:translate-x-1/2 -translate-y-1/2 rounded-full" />}
          </span>
          {children}
        </>
      ))}
    </RadioPrimitive>
  )
}

export { RadioGroup, RadioGroupItem }
