"use client";
import { createContext, useContext, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { TOKENS } from "../../tokens/tokens.js";
import { componentLeaf } from "../../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../../components/SemanticContent.js").SemanticContent>("components.semantic-content");

/** The three canvas detail tiers, from most to least detailed. */
export const CANVAS_LOD_TIERS = ["full", "compact", "overview"] as const;
export type CanvasLodTier = typeof CANVAS_LOD_TIERS[number];
/**
 * Smallest on-screen text size, in CSS pixels, that a tier may show.
 * New constant, proposed for owner sign-off; it is not a token value.
 */
export const CANVAS_LEGIBLE_TEXT_PX = 9;
/** The smallest text token each tier renders. A tier is shown only while that text stays legible. */
export const CANVAS_LOD_TEXT: Readonly<Record<CanvasLodTier, string>> = {
  full: "--text-caption",
  compact: "--text-h0",
  overview: "--text-display-m",
};
const textPx = (tier: CanvasLodTier) => Number.parseFloat(TOKENS[CANVAS_LOD_TEXT[tier]]!.value);
/** The most detailed tier whose smallest text remains legible at this zoom; overview has no floor. */
export function canvasLodTier(zoom: number): CanvasLodTier {
  return CANVAS_LOD_TIERS.find(tier => tier === "overview" || textPx(tier) * zoom >= CANVAS_LEGIBLE_TEXT_PX)!;
}

/** An inactive full layer keeps its width contribution and gives up its height and paint. */
const COLLAPSED = { blockSize: 0, overflow: "hidden", visibility: "hidden" } as const;

const Tier = createContext<CanvasLodTier>("full");
/**
 * The single owner of canvas level of detail. A canvas host wraps its world
 * content with the camera zoom; every `CanvasLodLayers` below follows it.
 * Content outside a canvas stays at the full tier.
 */
export function CanvasLod({ zoom, children }: { zoom: number; children: ReactNode }) {
  const tier = canvasLodTier(zoom);
  return <Tier.Provider value={tier}><SemanticContent as="div" data-canvas-lod={tier} className="contents" style={{ [CANVAS_ZOOM_VAR]: zoom } as CSSProperties}>{children}</SemanticContent></Tier.Provider>;
}
/** The camera zoom, exposed to world content as a unitless custom property. */
export const CANVAS_ZOOM_VAR = "--canvas-zoom";
/**
 * Counter-scales a canvas title: it keeps its own type-scale size and never
 * paints smaller on screen than the caption text token at any camera zoom.
 * Outside a canvas the zoom is 1, so the title is unchanged.
 */
export const CANVAS_COUNTER_SCALED_TITLE = "canvas-caption-zoom-floor";
export const useCanvasLodTier = () => useContext(Tier);

/**
 * Stacks a board's tier layers in one grid cell and paints only the active
 * one. The board takes the active layer's height: an inactive full layer stays
 * mounted with no block size so it still sets the board width (compact and
 * overview layers take that width rather than widening the board), and every
 * other inactive layer is hidden. A tier change swaps layers in one frame with
 * no crossfade, so two tiers never paint over each other. Inactive layers are
 * inert and hidden from assistive technology. A missing layer falls back to
 * the next more detailed one that is supplied.
 */
export function CanvasLodLayers({ full, compact, overview }: { full: ReactNode; compact?: ReactNode; overview?: ReactNode }) {
  const tier = useCanvasLodTier();
  const layers: Record<CanvasLodTier, ReactNode> = { full, compact, overview };
  const supplied = CANVAS_LOD_TIERS.filter(id => layers[id] !== undefined && layers[id] !== null);
  const active = CANVAS_LOD_TIERS.slice(0, CANVAS_LOD_TIERS.indexOf(tier) + 1).reverse().find(id => supplied.includes(id)) ?? "full";
  const host = useRef<HTMLDivElement>(null), focused = useRef<Element | null>(null);
  // Focus inside a layer that turns inert returns to the nearest focusable owner (the board).
  useLayoutEffect(() => {
    const root = host.current, last = focused.current;
    if (!root || !last || !root.contains(last)) return;
    const layer = last.closest<HTMLElement>("[data-canvas-lod-layer]");
    const current = document.activeElement;
    if (layer?.dataset.canvasLodLayer === active || (current !== last && current !== document.body && current !== null)) return;
    root.parentElement?.closest<HTMLElement>("[tabindex]")?.focus({ preventScroll: true });
  }, [active]);
  return <SemanticContent as="div" ref={host} data-canvas-lod-layers="" onFocus={event => { focused.current = event.target; }} style={{ display: "grid" }}>
    {supplied.map(id => <SemanticContent as="div" key={id} data-canvas-lod-layer={id} inert={id !== active} aria-hidden={id === active ? undefined : true}
      hidden={id !== active && id !== "full"}
      style={{ gridArea: "1 / 1", ...(id === "full" ? id === active ? {} : COLLAPSED : { inlineSize: 0, minInlineSize: "100%" }) }}>{layers[id]}</SemanticContent>)}
  </SemanticContent>;
}
