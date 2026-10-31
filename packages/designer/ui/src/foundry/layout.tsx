// Foundry layout primitives: shared by every Studio view that lays out cards or specimens.
// Sizes come from the layout tokens in ../index.css (`--card-grid-*`, `--specimen-grid-min`,
// `--specimen-ratio-*`, `--measure`),
// so a view never carries its own grid or ratio classes.
import type { ComponentProps, ReactNode } from "react"
import { cn } from "../lib/utils"

const CARD_GRID_DENSITY = {
  /** Gallery cards: `--card-grid-min` columns, so a content column fills with several per row. */
  cards: "grid-cols-[repeat(auto-fill,minmax(min(100%,var(--card-grid-min)),1fr))]",
  /** Side-by-side specimens: wider `--specimen-grid-min` columns that fit as many as the column allows. */
  specimens: "grid-cols-[repeat(auto-fit,minmax(min(100%,var(--specimen-grid-min)),1fr))]",
} as const

/** A responsive grid that fills its column: as many min-width columns as fit, `--card-grid-gap` apart. */
function CardGrid({ density = "cards", className, ...props }: ComponentProps<"div"> & { density?: keyof typeof CARD_GRID_DENSITY }) {
  return (
    <div
      data-slot="card-grid"
      data-density={density}
      className={cn("grid w-full min-w-0 gap-(--card-grid-gap)", CARD_GRID_DENSITY[density], className)}
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
