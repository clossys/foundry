"use client"

import { Icon as LibraryIcon } from "../icon/index.js"
import { cn } from "../_parts/utils/index.js"
import {
  Checkbox as CheckboxPrimitive,
  composeRenderProps,
  type CheckboxProps,
} from "react-aria-components"

function Checkbox({ className, children, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive
      data-slot="checkbox"
      className={cn(
        "border-(--input) dark:bg-(--input)/30 data-checked:bg-(--primary) data-checked:text-(--primary-foreground) dark:data-checked:bg-(--primary) data-checked:border-(--primary) aria-invalid:aria-checked:border-(--primary) aria-invalid:border-(--destructive) dark:aria-invalid:border-(--destructive)/50 focus-visible:border-(--ring) focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) aria-invalid:outline-solid aria-invalid:outline-2 aria-invalid:outline-offset-2 aria-invalid:outline-(--destructive) dark:aria-invalid:ring-(--destructive)/40 flex size-[calc(var(--spacing,0.25rem)*4)] items-center justify-center rounded-[4px] border transition-colors group-has-disabled/field:opacity-50 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) aria-invalid:outline-solid aria-invalid:outline-2 aria-invalid:outline-offset-2 aria-invalid:outline-(--destructive)  group-has-[:focus-visible]/field-label:not-data-checked:border-(--input) group-has-[:focus-visible]/field-label:data-checked:border-(--primary) data-selected:bg-(--primary) data-selected:text-(--primary-foreground) dark:data-selected:bg-(--primary) data-selected:border-(--primary) data-focus-visible:border-(--ring) data-focus-visible:outline-solid data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-(--ring) data-focus-visible:outline-solid data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-(--ring) data-invalid:data-selected:border-(--primary) data-invalid:border-(--destructive) dark:data-invalid:border-(--destructive)/50 data-invalid:outline-solid data-invalid:outline-2 data-invalid:outline-offset-2 data-invalid:outline-(--destructive) dark:data-invalid:ring-(--destructive)/40 data-invalid:outline-solid data-invalid:outline-2 data-invalid:outline-offset-2 data-invalid:outline-(--destructive) peer relative shrink-0 after:absolute after:-inset-x-3 after:-inset-y-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      {composeRenderProps(
        children,
        (children, { isSelected, isIndeterminate }) => (
          <>
            <span
              data-slot="checkbox-indicator"
              className="[&>svg]:size-[calc(var(--spacing,0.25rem)*3.5)] grid place-content-center text-current transition-none"
            >
              {isIndeterminate ? (<span aria-hidden="true" data-slot="checkbox-indeterminate" className="w-[calc(var(--spacing,0.25rem)*2)] border-t" style={{ borderColor: "currentColor" }} />) : isSelected ? (<LibraryIcon asset="assets.icon-check" decorative />) : null}
            </span>
            {children}
          </>
        )
      )}
    </CheckboxPrimitive>
  )
}

export { Checkbox }
