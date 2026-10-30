"use client";

/**
 * A controlled board for consumer-owned sections and cells, exported by
 * `@clossys/designer/studio`. The canvas needs
 * no Studio provider, catalog, adapter or session. The host owns geometry,
 * viewport and selection, and resolves its registered content in `renderItem`.
 *
 * Use `itemInteraction="content"` for sections with native interactive cells;
 * the default `select` mode renders each item as a selectable button whose
 * contents must be passive. `children` shares the transformed world layer.
 * Wrap world content in `CanvasLod` with the same viewport zoom when it needs
 * detail tiers. All camera, gesture and accessibility behavior comes from the
 * shared canvas implementation.
 */
export { CanvasSurface } from "../blocks/canvas/CanvasSurface.js";
export type {
  CanvasSurfaceProps, CanvasSurfaceActions, CanvasOverlayInsets, CanvasOverlay, CanvasEdge,
} from "../blocks/canvas/CanvasSurface.js";
export type {
  CanvasPoint, CanvasSize, CanvasRect, CanvasItem, Viewport, Selection,
} from "../blocks/canvas/models.js";
export {
  CanvasLod, CanvasLodLayers, useCanvasLodTier, canvasLodTier,
  CANVAS_LOD_TIERS, CANVAS_LOD_TEXT, CANVAS_LEGIBLE_TEXT_PX,
  CANVAS_ZOOM_VAR, CANVAS_COUNTER_SCALED_TITLE,
} from "../blocks/canvas/CanvasLod.js";
export type { CanvasLodTier } from "../blocks/canvas/CanvasLod.js";
