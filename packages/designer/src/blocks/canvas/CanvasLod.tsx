"use client";
import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from "react";
import { TOKENS } from "../../tokens/tokens.js";

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

const Tier = createContext<CanvasLodTier>("full");
/**
 * The single owner of canvas level of detail. A canvas host wraps its world
 * content with the camera zoom; every `CanvasLodLayers` below follows it.
 * Content outside a canvas stays at the full tier.
 */
export function CanvasLod({ zoom, children }: { zoom: number; children: ReactNode }) {
  const tier = canvasLodTier(zoom);
  return <Tier.Provider value={tier}><div data-canvas-lod={tier} className="contents">{children}</div></Tier.Provider>;
}
export const useCanvasLodTier = () => useContext(Tier);

/**
 * Stacks a board's tier layers in one grid cell. Every supplied layer stays
 * mounted and in normal flow, so a tier change never moves or resizes the
 * board: only opacity crossfades, and inactive layers are inert and hidden
 * from assistive technology. Compact and overview layers take the width of
 * the full layer rather than widening the board. A missing layer falls back to
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
  return <div ref={host} data-canvas-lod-layers="" onFocus={event => { focused.current = event.target; }} style={{ display: "grid" }}>
    {supplied.map(id => <div key={id} data-canvas-lod-layer={id} inert={id !== active} aria-hidden={id === active ? undefined : true}
      className="transition-opacity motion-reduce:transition-none"
      style={{ gridArea: "1 / 1", opacity: id === active ? 1 : 0, ...(id === "full" ? {} : { inlineSize: 0, minInlineSize: "100%" }) }}>{layers[id]}</div>)}
  </div>;
}
