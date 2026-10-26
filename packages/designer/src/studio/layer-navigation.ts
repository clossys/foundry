import type { LayerId } from "../catalog-core/index.js";
export const STUDIO_LAYERS: readonly LayerId[] = ["tokens", "assets", "components", "sections", "frames"];
export const studioLayerHref = (layer: LayerId): string => `#studio-layer=${layer}`;
export function studioLayerFromFragment(fragment: string): LayerId | undefined {
  const match = /^#studio-layer=(tokens|assets|components|sections|frames)$/.exec(fragment);
  return match?.[1] as LayerId | undefined;
}
/** `?layer=<id>` deep link (shared URLs); only known layers are accepted. */
export function studioLayerFromSearch(search: string): LayerId | undefined {
  const value = new URLSearchParams(search).get("layer");
  return value && (STUDIO_LAYERS as readonly string[]).includes(value) ? value as LayerId : undefined;
}
/** Read synchronously by the providers' useState initialisers so the deep-linked layer is the first paint. */
export const initialStudioLayer = (): LayerId | undefined => typeof window === "undefined" ? undefined
  : studioLayerFromFragment(window.location.hash) ?? studioLayerFromSearch(window.location.search);
