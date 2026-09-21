import { createElement, type ReactNode } from "react";
import type { RenderImageAsset, RenderImageSource, RenderVideoAsset, RenderAsset } from "../internal/assets.js";

function groupImageSourcesByFormat(sources: readonly RenderImageSource[]): Array<{ format: string | undefined; entries: RenderImageSource[] }> {
  const groups: Array<{ format: string | undefined; entries: RenderImageSource[] }> = [];
  const indexByFormat = new Map<string | undefined, number>();
  for (const source of sources) {
    let index = indexByFormat.get(source.format);
    if (index === undefined) {
      index = groups.length;
      indexByFormat.set(source.format, index);
      groups.push({ format: source.format, entries: [] });
    }
    groups[index]!.entries.push(source);
  }
  return groups;
}

/**
 * A `RenderImageAsset` with no `sources` (or an empty one) renders a single
 * `<img>`; when `sources` is present, wraps a responsive `<picture>`.
 */
export function buildResponsiveImageElement(asset: RenderImageAsset, altOverride?: string): ReactNode {
  const alt = altOverride ?? asset.alt;
  const sources = asset.sources ?? [];
  const fallbackImg = createElement("img", { src: asset.src, alt, width: asset.width, height: asset.height });
  if (sources.length === 0) return fallbackImg;

  const sourceElements = groupImageSourcesByFormat(sources).map((group, i) =>
    createElement("source", {
      key: `source-${i}`,
      srcSet: group.entries.map((entry) => `${entry.src} ${entry.width}w`).join(", "),
      ...(group.format !== undefined ? { type: group.format } : {}),
    }),
  );
  return createElement("picture", {}, ...sourceElements, fallbackImg);
}

export function buildVideoElement(asset: RenderVideoAsset, prefersReducedMotion: boolean | undefined, altOverride?: string): ReactNode {
  const alt = altOverride ?? asset.alt;
  const reducedMotionActive = prefersReducedMotion === true;

  if (reducedMotionActive && asset.reducedMotion === "static-poster") {
    return createElement("img", { src: asset.poster as string, alt, width: asset.width, height: asset.height });
  }

  const autoplaySuppressed = reducedMotionActive && (asset.reducedMotion === "pause" || asset.reducedMotion === "no-autoplay");
  const autoPlay = asset.autoplay === true && !autoplaySuppressed;

  const sourceElements = asset.sources.map((source, i) => createElement("source", { key: `source-${i}`, src: source.src, type: source.mimeType }));
  const trackElements = (asset.captions ?? []).map((caption, i) =>
    createElement("track", { key: `track-${i}`, kind: "captions", src: caption.src, srcLang: caption.srclang, label: caption.label }),
  );

  return createElement(
    "video",
    {
      width: asset.width,
      height: asset.height,
      ...(asset.poster !== undefined ? { poster: asset.poster } : {}),
      autoPlay,
      loop: asset.loop === true,
      muted: asset.muted === true,
      controls: true,
      "aria-label": alt,
    },
    ...sourceElements,
    ...trackElements,
    alt,
  );
}

export function buildAssetElement(asset: RenderAsset, options: { prefersReducedMotion?: boolean; altOverride?: string } = {}): ReactNode {
  const { prefersReducedMotion, altOverride } = options;
  return asset.type === "image" ? buildResponsiveImageElement(asset, altOverride) : buildVideoElement(asset, prefersReducedMotion, altOverride);
}
