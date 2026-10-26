import type { LayerId } from "../catalog-core/index.js";
export const STUDIO_LAYERS: readonly LayerId[] = ["tokens", "assets", "components", "sections", "frames"];
export const studioLayerHref = (layer: LayerId): string => `#studio-layer=${layer}`;
export function studioLayerFromFragment(fragment: string): LayerId | undefined {
  const match = /^#studio-layer=(tokens|assets|components|sections|frames)$/.exec(fragment);
  return match?.[1] as LayerId | undefined;
}
export const initialStudioLayer = (): LayerId | undefined => typeof window === "undefined" ? undefined : studioLayerFromFragment(window.location.hash);
