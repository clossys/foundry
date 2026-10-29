"use client"

import * as React from "react"
import { cn } from "../_parts/rail-utils/index.js"

function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  // Use native scrollbar-width and scrollbar-color to customize the scrollbar.
  return (
    <div
      data-slot="scroll-area"
      className={cn(
        "relative [scrollbar-width:thin] [scrollbar-color:var(--color-line-base)_transparent] overflow-auto focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring)",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export { ScrollArea }
