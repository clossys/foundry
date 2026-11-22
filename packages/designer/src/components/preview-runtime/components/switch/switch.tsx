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
        "data-checked:bg-(--primary) data-unchecked:bg-(--input) focus-visible:border-(--ring) focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) aria-invalid:outline-solid aria-invalid:outline-2 aria-invalid:outline-offset-2 aria-invalid:outline-(--destructive) dark:aria-invalid:ring-(--destructive)/40 aria-invalid:border-(--destructive) dark:aria-invalid:border-(--destructive)/50 dark:data-unchecked:bg-(--input)/80 shrink-0 rounded-full border border-transparent focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) aria-invalid:outline-solid aria-invalid:outline-2 aria-invalid:outline-offset-2 aria-invalid:outline-(--destructive)   data-[size=default]:h-[calc(var(--spacing,0.25rem)*3.5)] data-[size=default]:w-[calc(var(--spacing,0.25rem)*8)] data-[size=sm]:h-[calc(var(--spacing,0.25rem)*3.5)] data-[size=sm]:w-[calc(var(--spacing,0.25rem)*6)] data-selected:bg-(--primary) not-data-selected:bg-(--input) data-focus-visible:border-(--ring) data-focus-visible:outline-solid data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-(--ring) dark:not-data-selected:bg-(--input)/80 data-focus-visible:outline-solid data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-(--ring) data-invalid:outline-solid data-invalid:outline-2 data-invalid:outline-offset-2 data-invalid:outline-(--destructive) dark:data-invalid:ring-(--destructive)/40 data-invalid:border-(--destructive) dark:data-invalid:border-(--destructive)/50 data-invalid:outline-solid data-invalid:outline-2 data-invalid:outline-offset-2 data-invalid:outline-(--destructive) peer group/switch relative inline-flex items-center transition-all after:absolute after:-inset-x-3 after:-inset-y-2 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      {composeRenderProps(children, (children, { isSelected }) => (
        <>
          <span
            data-slot="switch-thumb"
            data-selected={isSelected || undefined}
            className="bg-(--background) dark:data-unchecked:bg-(--foreground) dark:data-checked:bg-(--primary-foreground) rounded-full group-data-[size=default]/switch:size-[calc(var(--spacing,0.25rem)*4)] group-data-[size=sm]/switch:size-[calc(var(--spacing,0.25rem)*3)] group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0 dark:not-data-selected:bg-(--foreground) dark:data-selected:bg-(--primary-foreground) group-data-[size=default]/switch:data-selected:translate-x-[calc(100%-2px)] group-data-[size=sm]/switch:data-selected:translate-x-[calc(100%-2px)] group-data-[size=default]/switch:not-data-selected:translate-x-0 group-data-[size=sm]/switch:not-data-selected:translate-x-0 pointer-events-none block ring-0 transition-transform"
          />
          {children}
        </>
      ))}
    </SwitchPrimitive>
  )
}

export { Switch }
