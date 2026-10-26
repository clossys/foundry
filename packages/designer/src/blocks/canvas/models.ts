export interface CanvasPoint { readonly x: number; readonly y: number }
export interface CanvasSize { readonly width: number; readonly height: number }
export interface CanvasRect extends CanvasPoint, CanvasSize {}
export interface Viewport extends CanvasPoint { readonly zoom: number }
export type Selection = readonly string[];
export interface CanvasItem { readonly id: string; readonly label: string; readonly rect: CanvasRect }
export type CanvasDirection = "left" | "right" | "up" | "down";
export interface CanvasMinimapModel { readonly worldBounds: CanvasRect; readonly viewport: CanvasRect; readonly visible: CanvasRect }

function finite(...values: number[]) {
  if (values.some(value => !Number.isFinite(value))) throw new RangeError("Canvas coordinates must be finite.");
}
function point(value: CanvasPoint) { finite(value.x, value.y); }
function size(value: CanvasSize, positive = false) {
  finite(value.width, value.height);
  if (value.width < 0 || value.height < 0 || (positive && (!value.width || !value.height)))
    throw new RangeError("Canvas dimensions must be nonnegative; view dimensions must be positive.");
}
function rect(value: CanvasRect) { point(value); size(value); }
function validViewport(value: Viewport): Viewport {
  point(value); finite(value.zoom);
  if (value.zoom <= 0) throw new RangeError("Canvas zoom must be positive.");
  return value;
}
function id(value: string) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError("Canvas ids must be nonempty strings.");
}
function ids(values: readonly string[]) {
  const seen = new Set<string>();
  for (const value of values) { id(value); if (seen.has(value)) throw new TypeError("Canvas ids must be unique."); seen.add(value); }
}
/** Validate public item geometry before rendering or spatial arithmetic. */
export function validateCanvasItems(items: readonly CanvasItem[]): void {
  ids(items.map(item => item.id));
  for (const item of items) {
    rect(item.rect);
    if (typeof item.label !== "string" || !item.label.trim()) throw new TypeError("Canvas items need accessible labels.");
  }
}

/** Translation is in screen pixels; world points map to screen = world * zoom + translation. */
export function panBy(viewport: Viewport, delta: CanvasPoint): Viewport {
  validViewport(viewport); point(delta);
  return validViewport({ ...viewport, x: viewport.x + delta.x, y: viewport.y + delta.y });
}
export function toWorld(viewport: Viewport, screen: CanvasPoint): CanvasPoint {
  validViewport(viewport); point(screen);
  const result = { x: (screen.x - viewport.x) / viewport.zoom, y: (screen.y - viewport.y) / viewport.zoom };
  point(result); return result;
}
export function toScreen(viewport: Viewport, world: CanvasPoint): CanvasPoint {
  validViewport(viewport); point(world);
  const result = { x: world.x * viewport.zoom + viewport.x, y: world.y * viewport.zoom + viewport.y };
  point(result); return result;
}
/**
 * A frame-level gesture owner asks the canvas surface it routes to for a zoom
 * at the surface center. `detail.factor` multiplies the current zoom.
 */
export const CANVAS_ZOOM_REQUEST_EVENT = "canvaszoomrequest";
export interface CanvasZoomRequestDetail { readonly factor: number }
/** One wheel normalization for every owner: line and page deltas, capped so each factor stays finite. */
export function wheelZoomFactor(deltaY: number, deltaMode: number, pageHeight: number): number {
  const units = deltaMode === 1 ? 16 : deltaMode === 2 ? pageHeight : 1;
  return Math.exp(-Math.max(-1000, Math.min(1000, deltaY * units)) * 0.002);
}
/** Safari `GestureEvent.scale` is cumulative from gesturestart; each change applies its ratio to the last. */
export function gestureZoomFactor(scale: number, previous: number): number {
  return Number.isFinite(scale) && scale > 0 && Number.isFinite(previous) && previous > 0 ? scale / previous : 1;
}
/** Scale around a screen-space anchor without moving the world point underneath it. */
export function zoomAt(viewport: Viewport, anchor: CanvasPoint, factor: number): Viewport {
  const world = toWorld(viewport, anchor);
  finite(factor);
  const zoom = viewport.zoom * factor;
  return validViewport({ x: anchor.x - world.x * zoom, y: anchor.y - world.y * zoom, zoom });
}
export function fitTo(bounds: CanvasRect, viewSize: CanvasSize, padding = 0): Viewport {
  rect(bounds); size(viewSize, true); finite(padding);
  if (padding < 0 || padding * 2 >= Math.min(viewSize.width, viewSize.height)) throw new RangeError("Canvas padding must leave a positive view area.");
  const scale = Math.min(bounds.width ? (viewSize.width - padding * 2) / bounds.width : Infinity,
    bounds.height ? (viewSize.height - padding * 2) / bounds.height : Infinity);
  const zoom = Number.isFinite(scale) ? scale : 1;
  return validViewport({ x: viewSize.width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: viewSize.height / 2 - (bounds.y + bounds.height / 2) * zoom, zoom });
}
/** With world bounds, constrain the visible world area; smaller worlds are centered per axis. */
export function clamp(viewport: Viewport, minZoom: number, maxZoom: number, worldBounds?: CanvasRect, viewSize?: CanvasSize): Viewport {
  validViewport(viewport); finite(minZoom, maxZoom);
  if (minZoom <= 0 || maxZoom < minZoom) throw new RangeError("Canvas zoom limits must be positive and ordered.");
  const zoom = Math.min(maxZoom, Math.max(minZoom, viewport.zoom));
  if (!worldBounds) return { ...viewport, zoom };
  if (!viewSize) throw new TypeError("Canvas world clamping requires viewSize.");
  rect(worldBounds); size(viewSize, true);
  const axis = (translation: number, origin: number, extent: number, view: number) => extent * zoom <= view
    ? (view - extent * zoom) / 2 - origin * zoom
    : Math.min(-origin * zoom, Math.max(view - (origin + extent) * zoom, translation));
  return validViewport({ x: axis(viewport.x, worldBounds.x, worldBounds.width, viewSize.width),
    y: axis(viewport.y, worldBounds.y, worldBounds.height, viewSize.height), zoom });
}
export function selectSingle(value: string): Selection { id(value); return [value]; }
export function toggleSelection(selection: Selection, value: string): Selection {
  ids(selection); id(value);
  return selection.includes(value) ? selection.filter(selected => selected !== value) : [...selection, value];
}
export function selectRange(order: readonly string[], anchor: string, target: string): Selection {
  ids(order); id(anchor); id(target);
  const start = order.indexOf(anchor), end = order.indexOf(target);
  return start < 0 || end < 0 ? [] : order.slice(Math.min(start, end), Math.max(start, end) + 1);
}
/** World-space rectangle intersection, inclusive of shared edges and zero-area rectangles. */
export function selectMarquee(items: readonly CanvasItem[], bounds: CanvasRect): Selection {
  validateCanvasItems(items); rect(bounds);
  return items.filter(({ rect: item }) => item.x <= bounds.x + bounds.width && item.x + item.width >= bounds.x &&
    item.y <= bounds.y + bounds.height && item.y + item.height >= bounds.y).map(item => item.id);
}
export function clearSelection(): Selection { return []; }
export function navigate(items: readonly CanvasItem[], current: string | null, direction: CanvasDirection): string | null {
  validateCanvasItems(items);
  if (!["left", "right", "up", "down"].includes(direction)) throw new TypeError("Unknown canvas direction.");
  const center = (item: CanvasItem) => ({ x: item.rect.x + item.rect.width / 2, y: item.rect.y + item.rect.height / 2 });
  const from = items.find(item => item.id === current);
  if (!from) return items[0]?.id ?? null;
  const origin = center(from);
  let nearest: string | null = null, distance = Infinity;
  for (const item of items) {
    const target = center(item), dx = target.x - origin.x, dy = target.y - origin.y;
    const ahead = direction === "left" ? dx < 0 : direction === "right" ? dx > 0 : direction === "up" ? dy < 0 : dy > 0;
    const candidate = Math.hypot(dx, dy);
    if (ahead && candidate < distance) { nearest = item.id; distance = candidate; }
  }
  return nearest;
}
export function minimapModel(worldBounds: CanvasRect, viewport: Viewport, viewSize: CanvasSize): CanvasMinimapModel {
  rect(worldBounds); size(viewSize, true);
  const origin = toWorld(viewport, { x: 0, y: 0 });
  const view = { ...origin, width: viewSize.width / viewport.zoom, height: viewSize.height / viewport.zoom };
  const normalize = (start: number, extent: number, worldStart: number, worldExtent: number) => {
    if (!worldExtent) return [0, 0] as const;
    const low = Math.min(1, Math.max(0, (start - worldStart) / worldExtent));
    const high = Math.min(1, Math.max(0, (start + extent - worldStart) / worldExtent));
    return [low, Math.max(0, high - low)] as const;
  };
  const [x, width] = normalize(view.x, view.width, worldBounds.x, worldBounds.width);
  const [y, height] = normalize(view.y, view.height, worldBounds.y, worldBounds.height);
  rect(view);
  return { worldBounds: { ...worldBounds }, viewport: view, visible: { x, y, width, height } };
}
