// Studio specimen figure: a specimen with the shadcn table caption beneath
// (shadcn-aria table@4.23.0, TableCaption: `text-sm text-muted-foreground`).
import type { ComponentProps, ReactNode } from "react"
import { cn } from "../lib/utils"

/** A specimen with its caption beneath (a version badge, a reason): one grid cell of a side-by-side comparison. */
function SpecimenFigure({ caption, className, children, ...props }: ComponentProps<"figure"> & { caption: ReactNode }) {
  return (
    <figure data-slot="specimen-figure" className={cn("flex min-w-0 flex-col gap-2", className)} {...props}>
      {children}
      <figcaption className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">{caption}</figcaption>
    </figure>
  )
}

export { SpecimenFigure }
