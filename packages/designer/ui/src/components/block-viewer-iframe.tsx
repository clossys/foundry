// Studio specimen window: a stock shadcn card (components.card) holding a projected specimen route in an
// unstyled iframe at the card's width and a fixed CSS-pixel height.
import { Card } from "@/components/ui/card"

type Viewport = 375 | 768 | 1280

/** Only already-projected, local specimen routes are accepted; never arbitrary URLs or code. */
export function specimenSource(src: string, viewport?: Viewport): string {
  if (/[\\\s\u0000-\u001f\u007f]/.test(src) || !src.startsWith("/") || src.startsWith("//")) {
    throw new Error("Expected a local specimen route")
  }
  const url = new URL(src, "https://example.com")
  if (url.pathname !== "/__specimen" && !url.pathname.startsWith("/preview/")) {
    throw new Error("Expected a projected specimen route")
  }
  if (viewport !== undefined) {
    const widths = url.searchParams.getAll("width")
    // Producer's existing routes default to 1280 when width is absent.
    if (![375, 768, 1280].includes(viewport) || widths.length > 1 || (widths.length ? widths[0] !== String(viewport) : viewport !== 1280)) {
      throw new Error("Specimen viewport does not match its projected source")
    }
  }
  return src
}

export interface BlockViewerIframeProps {
  src: string
  title: string
  viewport: Viewport
  iframeKey: string | number
  iframeHeight?: number
  interactive?: boolean
}

/** A projected specimen route in a stock card window. */
export function BlockViewerIframe({ src, title, viewport, iframeKey, iframeHeight = 930, interactive = false }: BlockViewerIframeProps) {
  if (!Number.isFinite(iframeHeight) || iframeHeight <= 0 || iframeHeight > 10000) throw new Error("Invalid specimen height")
  return (
    <Card size="sm" data-specimen-viewport={viewport}>
      <iframe key={iframeKey} src={specimenSource(src, viewport)} title={title} loading="lazy" inert={!interactive} width="100%" height={iframeHeight} />
    </Card>
  )
}

export interface BlockViewerCardIframeProps extends Omit<BlockViewerIframeProps, "interactive"> {
  /** Wraps the frame (a card body). */
  wrap?: (frame: React.ReactNode) => React.ReactNode
}

/** A gallery card's view-only specimen window. */
export function BlockViewerCardIframe({ wrap = frame => frame, iframeHeight = 480, ...props }: BlockViewerCardIframeProps) {
  return wrap(<BlockViewerIframe {...props} iframeHeight={iframeHeight} interactive={false} />)
}
