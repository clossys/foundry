"use client"

import { cn } from "../_parts/utils/index.js"
import {
  composeRenderProps,
  Switch as SwitchPrimitive,
  type SwitchProps as SwitchPrimitiveProps,
} from "react-aria-components"

function Switch({
  className,
  size = "default",
  children,
  ...props
}: SwitchPrimitiveProps & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive
      data-slot="switch"
      data-size={size}
      className={cn(
        "data-checked:bg-(--color-action) data-unchecked:bg-(--color-line-strong) focus-visible:border-(--color-focus-ring) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) aria-invalid:outline-solid aria-invalid:outline-(length:--ui-border-focus,3px) aria-invalid:outline-offset-(--ui-focus-offset) aria-invalid:outline-(--color-status-danger) dark:aria-invalid:ring-(--color-status-danger)/40 aria-invalid:border-(--color-status-danger) dark:aria-invalid:border-(--color-status-danger)/50 dark:data-unchecked:bg-(--color-line-strong)/80 shrink-0 rounded-full border-(length:--ui-border-hairline,1px)  focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) aria-invalid:outline-solid aria-invalid:outline-(length:--ui-border-focus,3px) aria-invalid:outline-offset-(--ui-focus-offset) aria-invalid:outline-(--color-status-danger)   data-[size=default]:h-(--ui-control-switch-thumb) data-[size=default]:w-(--spacing-2xl) data-[size=sm]:h-(--ui-control-switch-thumb) data-[size=sm]:w-(--spacing-xl) data-selected:bg-(--color-action) not-data-selected:bg-(--color-line-strong) data-focus-visible:border-(--color-focus-ring) data-focus-visible:outline-solid data-focus-visible:outline-(length:--ui-border-focus,3px) data-focus-visible:outline-offset-(--ui-focus-offset) data-focus-visible:outline-(--color-focus-ring) dark:not-data-selected:bg-(--color-line-strong)/80 data-focus-visible:outline-solid data-focus-visible:outline-(length:--ui-border-focus,3px) data-focus-visible:outline-offset-(--ui-focus-offset) data-focus-visible:outline-(--color-focus-ring) data-invalid:outline-solid data-invalid:outline-(length:--ui-border-focus,3px) data-invalid:outline-offset-(--ui-focus-offset) data-invalid:outline-(--color-status-danger) dark:data-invalid:ring-(--color-status-danger)/40 data-invalid:border-(--color-status-danger) dark:data-invalid:border-(--color-status-danger)/50 data-invalid:outline-solid data-invalid:outline-(length:--ui-border-focus,3px) data-invalid:outline-offset-(--ui-focus-offset) data-invalid:outline-(--color-status-danger) peer group/switch relative inline-flex items-center transition-all duration-(--ui-duration-default) ease-(--default-transition-timing-function) after:absolute after:-inset-x-3 after:-inset-y-2 data-disabled:cursor-not-allowed data-disabled:opacity-(--ui-alpha-disabled,50%)",
        className
      )}
      {...props}
    >
      {composeRenderProps(children, (children, { isSelected }) => (
        <>
          <span
            data-slot="switch-thumb"
            data-selected={isSelected || undefined}
            className="bg-(--color-surface-base) dark:data-unchecked:bg-(--color-ink-primary) dark:data-checked:bg-(--color-ink-on-action) rounded-full group-data-[size=default]/switch:size-(--spacing-lg,calc(var(--spacing)*4)) group-data-[size=sm]/switch:size-(--spacing-md) group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-var(--ui-border-rule))] group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-var(--ui-border-rule))] group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0 dark:not-data-selected:bg-(--color-ink-primary) dark:data-selected:bg-(--color-ink-on-action) group-data-[size=default]/switch:data-selected:translate-x-[calc(100%-var(--ui-border-rule))] group-data-[size=sm]/switch:data-selected:translate-x-[calc(100%-var(--ui-border-rule))] group-data-[size=default]/switch:not-data-selected:translate-x-0 group-data-[size=sm]/switch:not-data-selected:translate-x-0 pointer-events-none block ring-0 transition-transform duration-(--ui-duration-default) ease-(--default-transition-timing-function)"
          />
          {children}
        </>
      ))}
    </SwitchPrimitive>
  )
}

export { Switch }
