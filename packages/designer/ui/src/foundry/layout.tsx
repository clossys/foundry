// Foundry layout primitives: shared by every Studio view that lays out cards or specimens.
// Sizes come from the layout tokens in ../index.css (`--card-grid-*`, `--specimen-ratio-*`),
// so a view never carries its own grid or ratio classes.
import type { ComponentProps } from "react"
import { cn } from "../lib/utils"

/** A responsive card grid: as many `--card-grid-min` columns as fit, `--card-grid-gap` apart. */
function CardGrid({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-grid"
      className={cn("grid grid-cols-[repeat(auto-fill,minmax(min(100%,var(--card-grid-min)),1fr))] gap-(--card-grid-gap)", className)}
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

export { CardGrid, SpecimenFrame }
