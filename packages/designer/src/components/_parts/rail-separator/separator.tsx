import type * as React from "react"
"use client"

import { cn } from "../../_parts/rail-utils/index.js"
import { Separator as SeparatorPrimitive } from "react-aria-components"

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive>) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "block shrink-0 border-0 bg-(--color-line-base) aria-[orientation=horizontal]:h-(--ui-border-hairline) aria-[orientation=horizontal]:w-full aria-[orientation=vertical]:w-(--ui-border-hairline) aria-[orientation=vertical]:self-stretch [:is(hr)]:h-(--ui-border-hairline) [:is(hr)]:w-full",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
