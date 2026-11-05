// Studio specimen frame: the shadcn aspect-ratio box (shadcn-aria aspect-ratio@4.23.0,
// `relative aspect-(--ratio)`) holding the BlockViewer iframe. The ratio is a Designer layout token.
import type { ComponentProps } from "react"
import { cn } from "../lib/utils"

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

export { SpecimenFrame }
