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
        "border-(--color-line-strong) dark:bg-(--color-line-strong)/30 data-checked:bg-(--color-action) data-checked:text-(--color-ink-on-action) dark:data-checked:bg-(--color-action) data-checked:border-(--color-action) aria-invalid:aria-checked:border-(--color-action) aria-invalid:border-(--color-status-danger) dark:aria-invalid:border-(--color-status-danger)/50 focus-visible:border-(--color-focus-ring) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) aria-invalid:outline-solid aria-invalid:outline-(length:--ui-border-focus,3px) aria-invalid:outline-offset-(--ui-focus-offset) aria-invalid:outline-(--color-status-danger) dark:aria-invalid:ring-(--color-status-danger)/40 flex size-(--spacing-lg,calc(var(--spacing)*4)) items-center justify-center rounded-(--radius-default) border-(length:--ui-border-hairline,1px) transition-colors duration-(--ui-duration-default) ease-(--default-transition-timing-function) group-has-disabled/field:opacity-(--ui-alpha-disabled,50%) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) aria-invalid:outline-solid aria-invalid:outline-(length:--ui-border-focus,3px) aria-invalid:outline-offset-(--ui-focus-offset) aria-invalid:outline-(--color-status-danger)  group-has-[:focus-visible]/field-label:not-data-checked:border-(--color-line-strong) group-has-[:focus-visible]/field-label:data-checked:border-(--color-action) data-selected:bg-(--color-action) data-selected:text-(--color-ink-on-action) dark:data-selected:bg-(--color-action) data-selected:border-(--color-action) data-focus-visible:border-(--color-focus-ring) data-focus-visible:outline-solid data-focus-visible:outline-(length:--ui-border-focus,3px) data-focus-visible:outline-offset-(--ui-focus-offset) data-focus-visible:outline-(--color-focus-ring) data-focus-visible:outline-solid data-focus-visible:outline-(length:--ui-border-focus,3px) data-focus-visible:outline-offset-(--ui-focus-offset) data-focus-visible:outline-(--color-focus-ring) data-invalid:data-selected:border-(--color-action) data-invalid:border-(--color-status-danger) dark:data-invalid:border-(--color-status-danger)/50 data-invalid:outline-solid data-invalid:outline-(length:--ui-border-focus,3px) data-invalid:outline-offset-(--ui-focus-offset) data-invalid:outline-(--color-status-danger) dark:data-invalid:ring-(--color-status-danger)/40 data-invalid:outline-solid data-invalid:outline-(length:--ui-border-focus,3px) data-invalid:outline-offset-(--ui-focus-offset) data-invalid:outline-(--color-status-danger) peer relative shrink-0 after:absolute after:-inset-x-3 after:-inset-y-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-(--ui-alpha-disabled,50%)",
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
              className="[&>svg]:size-(--ui-control-switch-thumb,calc(var(--spacing)*3.5)) grid place-content-center text-current transition-none"
            >
              {isIndeterminate ? (<span aria-hidden="true" data-slot="checkbox-indeterminate" className="w-(--spacing-sm) border-t-(length:--ui-border-hairline)" style={{ borderColor: "currentColor" }} />) : isSelected ? (<LibraryIcon asset="assets.icon-check" decorative />) : null}
            </span>
            {children}
          </>
        )
      )}
    </CheckboxPrimitive>
  )
}

export { Checkbox }
