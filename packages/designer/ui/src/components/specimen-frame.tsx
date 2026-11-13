// Studio specimen frame: a stock shadcn card (components.card) holding the specimen page in an unstyled iframe.
// The frame fills the card's width; its height is the ratio's fixed CSS-pixel height.
import { Card } from "@/components/ui/card"

const SPECIMEN_HEIGHT = { thumbnail: 240, mobile: 667, tablet: 1024, desktop: 800 } as const

export type SpecimenRatio = keyof typeof SPECIMEN_HEIGHT

/** A specimen window: the framed page at the card's width and the ratio's height. */
function SpecimenFrame({ src, title, ratio = "thumbnail", interactive = false, ...props }: Omit<React.ComponentProps<typeof Card>, "children"> & {
  src: string
  title: string
  ratio?: SpecimenRatio
  /** Thumbnails are inert so the card link owns every pointer and focus event. */
  interactive?: boolean
}) {
  return (
    <Card size="sm" data-specimen-ratio={ratio} {...props}>
      <iframe title={title} src={src} loading="lazy" inert={!interactive} width="100%" height={SPECIMEN_HEIGHT[ratio]} />
    </Card>
  )
}

export { SpecimenFrame }
