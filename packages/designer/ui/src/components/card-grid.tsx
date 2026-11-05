// Studio card grid: the shadcn dashboard-01 section-cards grid
// (shadcn-aria dashboard-01@4.23.0, registry/aria-nova/blocks/dashboard-01/components/section-cards.tsx:16).
// Data-fit: section padding and card decoration stay with the caller; specimen comparisons stop at two
// columns. Container breakpoints follow the available main width.
import type { ComponentProps } from "react"
import { cn } from "../lib/utils"

const CARD_GRID_DENSITY = {
  cards: "grid-cols-1",
  specimens: "grid-cols-1 @xl/main:grid-cols-2",
} as const

/** Stock dashboard grid pattern, shared by Studio's specimen and option sections. */
function CardGrid({ density = "cards", className, ...props }: ComponentProps<"div"> & { density?: keyof typeof CARD_GRID_DENSITY }) {
  return (
    <div
      data-slot="card-grid"
      data-density={density}
      className={cn("grid gap-4", CARD_GRID_DENSITY[density], className)}
      {...props}
    />
  )
}

export { CardGrid }
