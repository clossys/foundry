// Shared Studio specimen layout. Card grid geometry is adopted from shadcn dashboard-01:
// references/shadcn-aria/dashboard-01@4.23.0/registry/aria-nova/blocks/dashboard-01/components/section-cards.tsx:16.
// Data-fit adaptations: section padding/card decoration stay with the caller; specimen
// comparisons stop at two columns. Container breakpoints follow available main width.
import type { ComponentProps, ReactNode } from "react"
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

const SPECIMEN_RATIO = {
  thumbnail: "aspect-(--specimen-ratio-thumbnail)",
  mobile: "aspect-(--specimen-ratio-mobile)",
  tablet: "aspect-(--specimen-ratio-tablet)",
  desktop: "aspect-(--specimen-ratio-desktop)",
} as const

export type SpecimenRatio = keyof typeof SPECIMEN_RATIO

/** A fixed-ratio specimen window: the framed page fills it and never sets the box's height. */
function SpecimenFrame({ src, title, ratio = "thumbnail", interactive = false, className, ...props }: Omit<ComponentProps<"div">, "children"> & {
  src: string
  title: string
  ratio?: SpecimenRatio
  /** Thumbnails are inert so the card link owns every pointer and focus event. */
  interactive?: boolean
}) {
  return (
    <div
      data-slot="specimen-frame"
      className={cn("relative w-full overflow-hidden rounded-md border bg-background", SPECIMEN_RATIO[ratio], className)}
      {...props}
    >
      <iframe title={title} src={src} loading="lazy" inert={!interactive} className="absolute inset-0 size-full border-0" />
    </div>
  )
}

/** A specimen with its caption beneath (a version badge, a reason): one grid cell of a side-by-side comparison. */
function SpecimenFigure({ caption, className, children, ...props }: ComponentProps<"figure"> & { caption: ReactNode }) {
  return (
    <figure data-slot="specimen-figure" className={cn("flex min-w-0 flex-col gap-2", className)} {...props}>
      {children}
      <figcaption className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">{caption}</figcaption>
    </figure>
  )
}

export { CardGrid, SpecimenFigure, SpecimenFrame }
