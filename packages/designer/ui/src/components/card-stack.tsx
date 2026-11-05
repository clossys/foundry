// Studio card stack: the vertical card flow of shadcn dashboard-01
// (shadcn-aria dashboard-01@4.23.0, registry/aria-nova/blocks/dashboard-01/page.tsx:25).
import type { ComponentProps } from "react"
import { cn } from "../lib/utils"

/** The stock vertical card flow of shadcn dashboard-01 (page.tsx): one full-width card per row. */
function CardStack({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-4 py-4 md:gap-6 md:py-6", className)} {...props} />
}

export { CardStack }
