"use client"

import { useEffect, useId, useRef, useState } from "react"
import { cn } from "../lib/utils"

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

/** Bounded content-size data fit. This is local adaptation code, not upstream BlockViewer code. */
export function specimenContentHeight(data: unknown, viewport: Viewport, width: number, ceiling: number): number | undefined {
  if (!data || typeof data !== "object") return undefined
  const size = data as Record<string, unknown>
  if (size.type !== "clossys:specimen-size" || size.width !== viewport || typeof size.height !== "number" || !Number.isFinite(size.height) || size.height <= 0) return undefined
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(ceiling) || ceiling <= 0) return undefined
  return Math.max(1, Math.min(ceiling, Math.ceil(size.height * Math.min(1, width / viewport))))
}

/** Bind one element/id/window/source for this lifecycle. A changed source gets a new keyed iframe. */
export function observeSpecimenSize(frame: HTMLIFrameElement, viewport: Viewport, ceiling: number, onHeight: (height: number) => void): () => void {
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
    if (height !== undefined) onHeight(height)
  }
  const load = () => {
    lastSize = undefined
    loaded = current()
    if (loaded) onHeight(ceiling)
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
}

/** Extraction of the official BlockViewerIframe. */
export function BlockViewerIframe(props: BlockViewerIframeProps) {
  return <BoundBlockViewerIframe key={JSON.stringify([props.iframeKey, props.src, props.viewport, props.iframeHeight])} {...props} />
}

function BoundBlockViewerIframe({ src, title, viewport, iframeKey, iframeHeight = 930, interactive = false, className }: BlockViewerIframeProps) {
  if (!Number.isFinite(iframeHeight) || iframeHeight <= 0 || iframeHeight > 10000) throw new Error("Invalid specimen height")
  const source = specimenSource(src, viewport)
  const id = useId()
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(iframeHeight)
  useEffect(() => {
    if (!ref.current) return
    return observeSpecimenSize(ref.current, viewport, iframeHeight, setHeight)
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
