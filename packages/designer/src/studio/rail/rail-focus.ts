"use client";
import { createContext, useContext, useState, type RefObject } from "react";
import type { LayerId } from "../../catalog-core/index.js";

/**
 * The rail control that held focus when a layer change swapped the canvas: the explorer's layer select, or one
 * explorer tree row (by its node id).
 */
export type RailFocus = { readonly kind: "layer" } | { readonly kind: "row"; readonly id: string };

/**
 * A whole studio renders one canvas for the value layers (Tokens, Assets) and another for the contract layers, each
 * with its own rail. Crossing between them unmounts the rail that held focus, so the control that changed the layer
 * records itself here and the new rail's equivalent control takes focus as it mounts. Absent: one canvas serves
 * every layer, so no rail is ever swapped.
 */
export const RailFocusHandoff = createContext<RefObject<RailFocus | undefined> | null>(null);

const VALUE_LAYERS: ReadonlySet<LayerId> = new Set(["themes", "assets"]);
/** True when a change between these layers swaps the canvas, and with it the rail. */
export const swapsCanvas = (from: LayerId, to: LayerId): boolean => VALUE_LAYERS.has(from) !== VALUE_LAYERS.has(to);

/** Records the control a layer change leaves from, only when that change swaps the canvas. */
export function useRailFocusRecord(): (from: LayerId, to: LayerId, focus: RailFocus) => void {
  const handoff = useContext(RailFocusHandoff);
  return (from, to, focus) => { if (handoff && swapsCanvas(from, to)) handoff.current = focus; };
}

/** The focus this rail control inherits from a swapped rail, read once as it mounts. */
export function useInheritedRailFocus(): RailFocus | undefined {
  const handoff = useContext(RailFocusHandoff);
  const [inherited] = useState(() => handoff?.current);
  return inherited;
}
