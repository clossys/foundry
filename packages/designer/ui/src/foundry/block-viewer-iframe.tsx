"use client"

import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { cn } from "../lib/utils"
import { Badge } from "../components/ui/badge"
import { Skeleton } from "../components/ui/skeleton"

// Foundry extension (not a shadcn slot): the official shadcn BlockViewer iframe (apps/v4 block-viewer),
// extracted for Studio specimens. Source, ranges and adaptations: producer/studio/sections/studio-specimen/stock-layout.provenance.json.

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

type Viewport = 375 | 768 | 1280

/**
 * Bounded content-size data fit. This is local adaptation code, not upstream BlockViewer code.
 * A frame scaled from `viewport` reports `width: viewport`; a page laid out at the frame's own
 * width reports `layout: "reflow"` and its height is used unscaled.
 */
export function specimenContentHeight(data: unknown, viewport: Viewport, width: number, ceiling: number): number | undefined {
  if (!data || typeof data !== "object") return undefined
  const size = data as Record<string, unknown>
  const reflow = size.layout === "reflow"
  if (size.type !== "clossys:specimen-size" || (!reflow && size.width !== viewport) || typeof size.height !== "number" || !Number.isFinite(size.height) || size.height <= 0) return undefined
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(ceiling) || ceiling <= 0) return undefined
  return Math.max(1, Math.min(ceiling, Math.ceil(size.height * (reflow ? 1 : Math.min(1, width / viewport)))))
}

/** What a fitted frame reports to its host: its height and whether nothing in it paints. */
export interface SpecimenSize { height: number; empty: boolean; failed?: boolean }

/** Bind one element/id/window/source for this lifecycle. A changed source gets a new keyed iframe. */
export function observeSpecimenSize(frame: HTMLIFrameElement, viewport: Viewport, ceiling: number, onHeight: (height: number) => void, onSize?: (size: SpecimenSize) => void): () => void {
  const document = frame.ownerDocument
  const host = document.defaultView
  if (!host || !frame.id) return () => {}
  const id = frame.id
  const src = frame.getAttribute("src")
  const expected = new URL(specimenSource(src ?? "", viewport), host.location.href)
  const target = frame.contentWindow
  let active = true
  let loaded = false
  let lastSize: unknown
  const current = () => {
    if (!active || !frame.isConnected || frame.id !== id || document.getElementById(id) !== frame || frame.getAttribute("src") !== src || !target || frame.contentWindow !== target) return false
    try { return expected.origin === host.location.origin && target.location.href === expected.href } catch { return false }
  }
  const fit = () => {
    if (!loaded || !current()) return
    const height = specimenContentHeight(lastSize, viewport, frame.clientWidth, ceiling)
    if (height === undefined) return
    onHeight(height)
    onSize?.({ height, empty: (lastSize as Record<string, unknown>).empty === true, failed: (lastSize as Record<string, unknown>).failed === true })
  }
  const load = () => {
    lastSize = undefined
    loaded = current()
    if (!loaded) return
    onHeight(ceiling)
    // Ask a frame that already reported (before this listener existed) to report again.
    try { target!.postMessage({ type: "clossys:specimen-size-request" }, expected.origin) } catch { /* A frame that cannot be reached keeps its ceiling. */ }
  }
  const message = (event: MessageEvent) => {
    if (!loaded || !current() || event.origin !== expected.origin || event.source !== target) return
    if (specimenContentHeight(event.data, viewport, frame.clientWidth, ceiling) === undefined) return
    lastSize = event.data
    fit()
  }
  frame.addEventListener("load", load)
  host.addEventListener("message", message)
  const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(fit)
  observer?.observe(frame)
  // A cached frame may finish before React installs the effect listener.
  try { if (current() && target?.document.readyState === "complete") load() } catch { /* A navigated frame is rejected by current(). */ }
  return () => {
    active = false
    loaded = false
    lastSize = undefined
    observer?.disconnect()
    frame.removeEventListener("load", load)
    host.removeEventListener("message", message)
  }
}

export interface BlockViewerIframeProps {
  src: string
  title: string
  viewport: Viewport
  iframeKey: string | number
  iframeHeight?: number
  interactive?: boolean
  className?: string
  /** Called with each fitted size the frame reports (a host can show a placeholder until then). */
  onSize?: (size: SpecimenSize) => void
}

/** Extraction of the official BlockViewerIframe. */
export function BlockViewerIframe(props: BlockViewerIframeProps) {
  return <BoundBlockViewerIframe key={JSON.stringify([props.iframeKey, props.src, props.viewport, props.iframeHeight])} {...props} />
}

function BoundBlockViewerIframe({ src, title, viewport, iframeKey, iframeHeight = 930, interactive = false, className, onSize }: BlockViewerIframeProps) {
  if (!Number.isFinite(iframeHeight) || iframeHeight <= 0 || iframeHeight > 10000) throw new Error("Invalid specimen height")
  const source = specimenSource(src, viewport)
  const id = useId()
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(iframeHeight)
  const sized = useRef(onSize)
  sized.current = onSize
  useEffect(() => {
    if (!ref.current) return
    return observeSpecimenSize(ref.current, viewport, iframeHeight, setHeight, size => sized.current?.(size))
  }, [source, viewport, iframeHeight])

  return (
    <iframe
      key={iframeKey}
      src={source}
      height={height}
      loading="lazy"
      className={cn(
        "relative z-20 no-scrollbar w-full bg-background",
        className
      )}
      ref={ref}
      id={id}
      title={title}
      inert={!interactive}
    />
  )
}

/** How long a loaded frame may stay silent before it is shown at its ceiling anyway. */
const CARD_REVEAL_MS = 4000

export interface BlockViewerCardIframeProps extends Omit<BlockViewerIframeProps, "onSize" | "interactive"> {
  /** Accessible name of the placeholder while the frame loads. */
  loadingLabel: string
  /** Shown in place of a frame that paints nothing because its specimen reported an error. */
  failedLabel?: string
  /** Wraps the frame (a card body); not called when the frame paints nothing. */
  wrap?: (frame: ReactNode) => ReactNode
}

/**
 * A gallery card's view-only frame (Foundry extension, not upstream BlockViewer code): the stock
 * skeleton at a 16:9 card aspect while the frame loads, then the frame at the height it reports.
 * A frame that reports nothing painted renders nothing, so its card has no body, like an empty slot;
 * one that painted nothing because it failed shows `failedLabel` instead, so a failure is never silent.
 */
export function BlockViewerCardIframe({ loadingLabel, failedLabel, wrap = frame => frame, iframeHeight = 480, ...props }: BlockViewerCardIframeProps) {
  const key = JSON.stringify([props.iframeKey, props.src, props.viewport, iframeHeight])
  const [state, setState] = useState<{ key: string; size?: SpecimenSize }>({ key })
  const size = state.key === key ? state.size : undefined
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // A frame that loaded before hydration never fires the load handler below; reveal it anyway.
  useEffect(() => {
    const fallback = setTimeout(() => setState(current => current.key === key && current.size ? current : { key, size: { height: iframeHeight, empty: false } }), CARD_REVEAL_MS * 3)
    return () => { clearTimeout(fallback); clearTimeout(timer.current) }
  }, [key, iframeHeight])
  if (size?.empty) return size.failed && failedLabel ? wrap(<Badge variant="outline" data-preview-status="unavailable">{failedLabel}</Badge>) : null
  const loaded = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState(current => current.key === key && current.size ? current : { key, size: { height: iframeHeight, empty: false } }), CARD_REVEAL_MS)
  }
  return wrap(
    <div data-specimen-state={size ? "ready" : "loading"} className={cn("relative w-full", !size && "aspect-video overflow-hidden")} onLoadCapture={loaded}>
      {!size && <Skeleton className="absolute inset-0" aria-label={loadingLabel} role="status" />}
      <BlockViewerIframe {...props} iframeHeight={iframeHeight} interactive={false}
        className={cn(!size && "absolute inset-x-0 top-0 opacity-0", props.className)}
        onSize={next => { clearTimeout(timer.current); setState({ key, size: next }) }} />
    </div>
  )
}
