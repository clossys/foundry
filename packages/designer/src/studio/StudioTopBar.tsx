"use client";
import type { ReactElement } from "react";
import { Link } from "../components/Link.js";
import type { LayerId } from "../catalog-core/index.js";
import { STUDIO_LAYERS, studioLayerHref } from "./layer-navigation.js";
import type { StudioHeaderProps, StudioLabels } from "./types.js";
/** Layer navigation only. All state, history and score details belong to StudioRightPanel. */
export function StudioTopBar({ labels, layer = "tokens", layers = ["tokens"], onLayer, layerHref = studioLayerHref, onLayerNavigate }: StudioHeaderProps & {
  labels: StudioLabels; layer?: LayerId; layers?: readonly LayerId[]; onLayer: (layer: LayerId) => Promise<boolean>;
}): ReactElement {
  return <nav aria-label={labels.layers.label} className="flex min-w-0 gap-sm overflow-x-auto whitespace-nowrap">
    {STUDIO_LAYERS.map(id => <Link key={id} href={layerHref(id)} isDisabled={!layers.includes(id)} aria-current={id === layer ? "page" : undefined}
      className="shrink-0 px-sm py-xs" aria-label={!layers.includes(id) ? `${labels.layers[id]}: ${labels.layers.disabled}` : undefined}
      onClick={event => {
        const target = event.currentTarget.getAttribute("target");
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.currentTarget.hasAttribute("download") || target && target.toLowerCase() !== "_self") return;
        event.preventDefault(); void (async () => { if (!await onLayer(id)) return; const href = layerHref(id); if (onLayerNavigate) await onLayerNavigate(id, href); else window.location.assign(href); })(); }}>
      {labels.layers[id]}
    </Link>)}
  </nav>;
}
