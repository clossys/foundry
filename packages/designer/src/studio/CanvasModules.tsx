"use client";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { CanvasZoom } from "../components/CanvasZoom.js";
import { CanvasMap } from "../components/CanvasMap.js";
import { StudioRail } from "./rail/StudioRail.js";
import type { StudioLabels } from "./types.js";
import type { useCanvasWorld } from "./useCanvasWorld.js";
import type { CanvasRect } from "../blocks/canvas/models.js";

/**
 * The canvas's modules, moved (not rebuilt) into the Designer's right rail: the explorer, the inspector body, the
 * canvas map (measured from the rendered boards) and the zoom control. Nothing registers into frame chrome.
 */
export function CanvasModules({ canvas, labels, explorer, explorerHeader, inspector }: { canvas: ReturnType<typeof useCanvasWorld>; labels: StudioLabels; explorer: ReactNode; explorerHeader?: ReactNode; inspector: ReactNode }) {
  const [items, setItems] = useState<readonly { id: string; rect: CanvasRect; label?: string }[]>([]);
  const [size, setSize] = useState({ width: 1, height: 1 });
  useLayoutEffect(() => {
    const surface = canvas.surface.current, world = canvas.world.current;
    if (!surface || !world) return;
    const measure = () => {
      const box = surface.getBoundingClientRect();
      setSize({ width: Math.max(1, surface.clientWidth || box.width), height: Math.max(1, surface.clientHeight || box.height) });
      // Each canvas board is the registered library-board Section inside its structural board wrapper.
      setItems([...world.querySelectorAll<HTMLElement>("[data-studio-canvas-board]:not([hidden])")].map(wrapper => {
        const board = wrapper.querySelector<HTMLElement>("section[data-library-board]") ?? wrapper;
        const rect = board.getBoundingClientRect();
        const label = board.ownerDocument.getElementById(board.getAttribute("aria-labelledby") ?? "")?.textContent ?? undefined;
        return { id: wrapper.dataset.studioCanvasBoard!, label, rect: { x: (rect.left - box.left - canvas.pose.x) / canvas.pose.zoom,
          y: (rect.top - box.top - canvas.pose.y) / canvas.pose.zoom, width: rect.width / canvas.pose.zoom, height: rect.height / canvas.pose.zoom } };
      }));
    };
    measure(); const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : undefined;
    observer?.observe(surface); observer?.observe(world); return () => observer?.disconnect();
  }, [canvas.bounds, canvas.pose]);
  return <StudioRail labels={labels} explorer={explorer} explorerHeader={explorerHeader} inspector={inspector}
    map={<CanvasMap label={labels.canvas.minimap} items={items} bounds={canvas.bounds} viewport={canvas.pose} viewSize={size} onViewportChange={canvas.setPose} />}
    zoom={<CanvasZoom value={canvas.pose.zoom} min={.12} max={2} labels={{ group: labels.canvas.zoomLabel, out: labels.canvas.zoomOut, in: labels.canvas.zoomIn, fit: labels.canvas.fit, percent: labels.canvas.zoomLabel }} onChange={value => canvas.actions.current?.zoom(value / canvas.pose.zoom)} onFit={() => canvas.actions.current?.fit()} />} />;
}
