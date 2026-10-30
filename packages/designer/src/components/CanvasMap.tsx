"use client";
import { useRef } from "react";
import { Button } from "./Button.js";
type CanvasRect = { x: number; y: number; width: number; height: number };
type CanvasSize = { width: number; height: number };
type Viewport = { x: number; y: number; zoom: number };

export interface CanvasMapProps {
  /** Board rectangles in world coordinates; `label` names the board for pointer hover. */
  label: string; items: readonly { id: string; rect: CanvasRect; label?: string }[];
  bounds: CanvasRect; viewport: Viewport; viewSize: CanvasSize;
  onViewportChange(value: Viewport): void;
}
/** The part of a board inside the world bounds; a board never paints outside the map. */
function within(rect: CanvasRect, bounds: CanvasRect): CanvasRect | undefined {
  const x = Math.max(rect.x, bounds.x), y = Math.max(rect.y, bounds.y);
  const width = Math.min(rect.x + rect.width, bounds.x + bounds.width) - x, height = Math.min(rect.y + rect.height, bounds.y + bounds.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : undefined;
}
/** A world overview with the same coordinate projection as CanvasSurface. */
export function CanvasMap({ label, items, bounds, viewport, viewSize, onViewportChange }: CanvasMapProps) {
  const drag = useRef<{ pointer: number; x: number; y: number; viewport: Viewport } | null>(null);
  const visible = { x: -viewport.x / viewport.zoom, y: -viewport.y / viewport.zoom, width: viewSize.width / viewport.zoom, height: viewSize.height / viewport.zoom };
  const center = (x: number, y: number) => onViewportChange({ zoom: viewport.zoom,
    x: viewSize.width / 2 - x * viewport.zoom, y: viewSize.height / 2 - y * viewport.zoom });
  return <div data-studio-panel="minimap" className="w-full">
    <Button aria-label={label} variant="ghost" className="block w-full p-0" onPress={event => { if (event.pointerType === "keyboard" || event.pointerType === "virtual") center(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); }}
      render={props => <button {...props} onPointerDown={event => {
        const box = event.currentTarget.getBoundingClientRect();
        if (!box.width || !box.height) return;
        const x = bounds.x + (event.clientX - box.left) / box.width * bounds.width;
        const y = bounds.y + (event.clientY - box.top) / box.height * bounds.height;
        if (x < visible.x || x > visible.x + visible.width || y < visible.y || y > visible.y + visible.height) center(x, y);
        else { drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, viewport }; event.currentTarget.setPointerCapture(event.pointerId); }
      }} onPointerMove={event => {
        const current = drag.current; if (!current || current.pointer !== event.pointerId) return;
        const box = event.currentTarget.getBoundingClientRect(); if (!box.width || !box.height) return;
        onViewportChange({ ...current.viewport, x: current.viewport.x - (event.clientX - current.x) / box.width * bounds.width * current.viewport.zoom,
          y: current.viewport.y - (event.clientY - current.y) / box.height * bounds.height * current.viewport.zoom });
      }} onPointerUp={event => { if (drag.current?.pointer === event.pointerId) { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); } }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} />}>
      <svg aria-hidden="true" focusable="false" viewBox={`${bounds.x} ${bounds.y} ${Math.max(1, bounds.width)} ${Math.max(1, bounds.height)}`} className="canvas-map-rail-height w-full overflow-hidden rounded-control border border-line-base bg-surface-sunken touch-none">
        {items.map(item => { const rect = within(item.rect, bounds); return rect ? <rect key={item.id} data-canvas-map-item={item.id} x={rect.x} y={rect.y} width={rect.width} height={rect.height} className="fill-surface-raised stroke-line-base" vectorEffect="non-scaling-stroke">{item.label ? <title>{item.label}</title> : null}</rect> : null; })}
        <rect data-canvas-map-viewport="" x={visible.x} y={visible.y} width={visible.width} height={visible.height} className="fill-accent-tint stroke-accent" vectorEffect="non-scaling-stroke" />
      </svg>
    </Button>
  </div>;
}
