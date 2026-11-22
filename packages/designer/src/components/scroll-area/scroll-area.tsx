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
        "relative [scrollbar-width:thin] [scrollbar-color:var(--border,oklch(0.922_0_0))_transparent] overflow-auto focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export { ScrollArea }
