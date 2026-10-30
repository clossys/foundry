"use client";

import { useState } from "react";
import { Skeleton } from "../../../components/Skeleton.js";
import { Badge } from "../../../components/Badge.js";

export interface SystemThumbnailProps { leaf: string; src: string; state: "missing" | "fresh" | "stale"; label: string; staleLabel: string }
function ThumbnailImage({ leaf, src, state, label, staleLabel }: SystemThumbnailProps) {
  const [loaded, setLoaded] = useState(false);
  return <figure data-leaf={leaf} className="relative">
    {!loaded || state === "missing" ? <Skeleton shape="block" aria-label={label} className="h-4xl w-full" /> : null}
    {state !== "missing" ? <img src={src} alt={label} loading="lazy" decoding="async" onLoad={() => setLoaded(true)} onError={() => setLoaded(false)} className={loaded ? "block w-full" : "absolute inset-0 h-full w-full opacity-0"} /> : null}
    {state === "stale" ? <Badge>{staleLabel}</Badge> : null}
  </figure>;
}
/** Images are passive specimens; changing the source resets loading/error state. */
export function SystemThumbnail(props: SystemThumbnailProps) { return <ThumbnailImage key={`${props.leaf}:${props.src}`} {...props} />; }
