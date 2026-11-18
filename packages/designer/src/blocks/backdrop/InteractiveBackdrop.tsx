"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import {
  interactiveBackdropDescriptorIssues,
  resolveInteractiveBackdropParams,
  type InteractiveBackdropColor,
  type InteractiveBackdropComponent,
  type InteractiveBackdropDescriptor,
  type InteractiveBackdropParams,
} from "../../tokens/interactive-backdrops.js";

/**
 * The Foundry interactive backdrops (foundry-build-0048 A4): three decorative layers a consumer picks
 * with a data-only descriptor `{component, params}` (tokens/interactive-backdrops.ts holds the
 * list and each param schema). They are Foundry code built from React and stock Tailwind token
 * utilities only; a consumer never authors backdrop code.
 *
 * Every layer is decorative: `aria-hidden="true"`, `pointer-events: none` on the layer (descendants
 * inherit it), no focusable or text content. Every layer honours `prefers-reduced-motion`: under
 * `reduce`, on the server, before hydration, with a speed of 0 or where `matchMedia` is missing it
 * renders a still frame of the same art and starts no animation frame, listener or animation.
 * Colours are token utilities from the literal maps below (theme conformance: no inline colour);
 * the canvas reads the painted token back from its own `text-*` class.
 */

/** Each token colour as literal utilities, so the stylesheet carries every one. */
const FILL: Readonly<Record<InteractiveBackdropColor, string>> = {
  primary: "fill-primary", secondary: "fill-secondary", accent: "fill-accent", foreground: "fill-foreground", "muted-foreground": "fill-muted-foreground", border: "fill-border",
};
const STROKE: Readonly<Record<InteractiveBackdropColor, string>> = {
  primary: "stroke-primary", secondary: "stroke-secondary", accent: "stroke-accent", foreground: "stroke-foreground", "muted-foreground": "stroke-muted-foreground", border: "stroke-border",
};
const GROUND: Readonly<Record<InteractiveBackdropColor, string>> = {
  primary: "bg-primary", secondary: "bg-secondary", accent: "bg-accent", foreground: "bg-foreground", "muted-foreground": "bg-muted-foreground", border: "bg-border",
};
const INK: Readonly<Record<InteractiveBackdropColor, string>> = {
  primary: "text-primary", secondary: "text-secondary", accent: "text-accent", foreground: "text-foreground", "muted-foreground": "text-muted-foreground", border: "text-border",
};

const REDUCE = "(prefers-reduced-motion: reduce)";
function subscribeMotion(onChange: () => void): () => void {
  if (typeof matchMedia !== "function") return () => {};
  const query = matchMedia(REDUCE);
  query.addEventListener?.("change", onChange);
  return () => query.removeEventListener?.("change", onChange);
}
/** Still unless the browser says motion is welcome. */
const motionReduced = (): boolean => typeof matchMedia !== "function" || matchMedia(REDUCE).matches;
/** The server and the first hydration frame always render the still frame. */
const serverMotionReduced = (): boolean => true;
/** Whether the visitor asked for reduced motion (true on the server and where it cannot be read). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, motionReduced, serverMotionReduced);
}

const pointerEvents = "none" as const;
function Layer({ component, animated, children }: { component: InteractiveBackdropComponent; animated: boolean; children: ReactNode }) {
  return (
    <div aria-hidden="true" data-interactive-backdrop={component} data-motion={animated ? "animated" : "static"} className="pointer-events-none absolute inset-0 overflow-hidden" style={{ pointerEvents }}>
      {children}
    </div>
  );
}

/** A deterministic scatter (no Math.random: the server and the still frame draw the same field). */
function scatter(count: number): { x: number; y: number; dx: number; dy: number }[] {
  let seed = (count * 2654435761) >>> 0;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  return Array.from({ length: count }, () => ({ x: next(), y: next(), dx: next() * 2 - 1, dy: next() * 2 - 1 }));
}
const LINK_DISTANCE = 0.12;
const VIEW_WIDTH = 160, VIEW_HEIGHT = 90;

/** Drifting points on a canvas, linked when near if `links`; a still scatter under reduced motion. */
export function ParticleField({ params }: { params: InteractiveBackdropParams<"particle-field"> }) {
  const reduced = useReducedMotion();
  const animated = !reduced && params.speed > 0;
  const canvas = useRef<HTMLCanvasElement>(null);
  const { color, density, speed, size, links } = params;
  useEffect(() => {
    const node = canvas.current;
    if (!animated || !node || typeof requestAnimationFrame !== "function") return;
    const context = node.getContext("2d");
    if (!context) return;
    const points = scatter(density);
    const paint = getComputedStyle(node).color;
    let frame = 0, last = 0;
    const step = (time: number) => {
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(node.clientWidth * ratio)), height = Math.max(1, Math.round(node.clientHeight * ratio));
      if (node.width !== width) node.width = width;
      if (node.height !== height) node.height = height;
      const delta = last ? Math.min(time - last, 64) : 16;
      last = time;
      context.clearRect(0, 0, width, height);
      context.fillStyle = paint;
      context.strokeStyle = paint;
      for (const point of points) {
        point.x = (point.x + point.dx * speed * delta * 0.00003 + 1) % 1;
        point.y = (point.y + point.dy * speed * delta * 0.00003 + 1) % 1;
        context.globalAlpha = 0.6;
        context.beginPath();
        context.arc(point.x * width, point.y * height, size * ratio, 0, Math.PI * 2);
        context.fill();
      }
      if (links) {
        context.lineWidth = ratio;
        for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
          const a = points[i]!, b = points[j]!;
          const distance = Math.hypot(a.x - b.x, (a.y - b.y) * (height / width));
          if (distance >= LINK_DISTANCE) continue;
          context.globalAlpha = 0.25 * (1 - distance / LINK_DISTANCE);
          context.beginPath();
          context.moveTo(a.x * width, a.y * height);
          context.lineTo(b.x * width, b.y * height);
          context.stroke();
        }
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [animated, density, speed, size, links, color]);
  if (animated) return <Layer component="particle-field" animated><canvas ref={canvas} className={`block h-full w-full ${INK[color]}`} /></Layer>;
  const points = scatter(density);
  const near = links ? points.flatMap((a, i) => points.slice(i + 1).filter(b => Math.hypot(a.x - b.x, (a.y - b.y) * (VIEW_HEIGHT / VIEW_WIDTH)) < LINK_DISTANCE).map(b => [a, b] as const)) : [];
  return (
    <Layer component="particle-field" animated={false}>
      <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" className={`h-full w-full ${FILL[color]} ${STROKE[color]}`}>
        {near.map(([a, b], index) => <line key={`l${index}`} x1={a.x * VIEW_WIDTH} y1={a.y * VIEW_HEIGHT} x2={b.x * VIEW_WIDTH} y2={b.y * VIEW_HEIGHT} strokeOpacity={0.25} strokeWidth={0.15} />)}
        {points.map((point, index) => <circle key={index} cx={point.x * VIEW_WIDTH} cy={point.y * VIEW_HEIGHT} r={size / 4} fillOpacity={0.6} strokeWidth={0} />)}
      </svg>
    </Layer>
  );
}

const MESH_BLOBS = [
  { place: "-start-1/4 -top-1/4 size-3/4", drift: ["translate(0%, 0%)", "translate(18%, 12%)"] },
  { place: "-end-1/4 top-1/4 size-2/3", drift: ["translate(0%, 0%)", "translate(-16%, -10%)"] },
  { place: "-bottom-1/3 start-1/4 size-3/4", drift: ["translate(0%, 0%)", "translate(10%, -14%)"] },
] as const;

/** The slowest gradient-mesh drift, in ms (speed 0.01); a smaller positive speed drifts no slower. */
export const GRADIENT_MESH_MAX_DURATION = 2_400_000;
/** One gradient-mesh drift's duration for `speed` (> 0): 24 s at speed 1, always a finite number of ms. */
export function gradientMeshDuration(speed: number): number {
  return Math.min(GRADIENT_MESH_MAX_DURATION, Math.round(24000 / speed));
}

/** Three soft colour fields that slowly drift; fixed in place under reduced motion. */
export function GradientMesh({ params }: { params: InteractiveBackdropParams<"gradient-mesh"> }) {
  const reduced = useReducedMotion();
  const animated = !reduced && params.speed > 0;
  const blobs = useRef<(HTMLDivElement | null)[]>([]);
  const { from, via, to, speed, intensity } = params;
  useEffect(() => {
    if (!animated) return;
    const running = blobs.current.flatMap((node, index) => {
      if (!node || typeof node.animate !== "function") return [];
      const [start, end] = MESH_BLOBS[index]!.drift;
      return [node.animate([{ transform: start }, { transform: end }], { duration: gradientMeshDuration(speed), iterations: Infinity, direction: "alternate", easing: "ease-in-out" })];
    });
    return () => { for (const animation of running) animation.cancel(); };
  }, [animated, speed]);
  const colors = [from, via, to] as const;
  return (
    <Layer component="gradient-mesh" animated={animated}>
      {MESH_BLOBS.map((blob, index) => (
        <div key={index} ref={node => { blobs.current[index] = node; }} className={`absolute rounded-full blur-3xl ${blob.place} ${GROUND[colors[index]!]}`} style={{ opacity: intensity }} />
      ))}
    </Layer>
  );
}

const GRID_WIDTH = 960, GRID_HEIGHT = 540;

/** A line grid with a glow that follows the pointer (and pulses if `pulse`); centred and still under reduced motion. */
export function GridGlow({ params }: { params: InteractiveBackdropParams<"grid-glow"> }) {
  const reduced = useReducedMotion();
  const { line, glow, cell, follow, pulse } = params;
  const animated = !reduced && (follow || pulse);
  const spot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = spot.current;
    const frame = node?.parentElement;
    if (!animated || !node || !frame) return;
    const stops: (() => void)[] = [];
    if (follow && typeof window.addEventListener === "function") {
      const move = (event: PointerEvent) => {
        const box = frame.getBoundingClientRect();
        if (!box.width || !box.height) return;
        node.style.left = `${Math.min(100, Math.max(0, ((event.clientX - box.left) / box.width) * 100))}%`;
        node.style.top = `${Math.min(100, Math.max(0, ((event.clientY - box.top) / box.height) * 100))}%`;
      };
      window.addEventListener("pointermove", move, { passive: true });
      stops.push(() => window.removeEventListener("pointermove", move));
    }
    if (pulse && typeof node.animate === "function") {
      const animation = node.animate([{ opacity: 0.2 }, { opacity: 0.45 }], { duration: 3200, iterations: Infinity, direction: "alternate", easing: "ease-in-out" });
      stops.push(() => animation.cancel());
    }
    return () => { for (const stop of stops) stop(); };
  }, [animated, follow, pulse]);
  const columns = Array.from({ length: Math.floor(GRID_WIDTH / cell) + 1 }, (_, index) => index * cell);
  const rows = Array.from({ length: Math.floor(GRID_HEIGHT / cell) + 1 }, (_, index) => index * cell);
  return (
    <Layer component="grid-glow" animated={animated}>
      <div className="absolute inset-0">
        <svg viewBox={`0 0 ${GRID_WIDTH} ${GRID_HEIGHT}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" className={`absolute inset-0 h-full w-full ${STROKE[line]}`} fill="none">
          {columns.map(x => <line key={`x${x}`} x1={x} y1={0} x2={x} y2={GRID_HEIGHT} strokeWidth={1} strokeOpacity={0.35} vectorEffect="non-scaling-stroke" />)}
          {rows.map(y => <line key={`y${y}`} x1={0} y1={y} x2={GRID_WIDTH} y2={y} strokeWidth={1} strokeOpacity={0.35} vectorEffect="non-scaling-stroke" />)}
        </svg>
        <div ref={spot} data-grid-glow="" className={`absolute size-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl ${GROUND[glow]}`} style={{ left: "50%", top: "50%", opacity: 0.35 }} />
      </div>
    </Layer>
  );
}

/**
 * The one entry a pinned descriptor renders through: it judges the descriptor and renders that
 * Foundry component with every param resolved to its schema default when absent. An invalid
 * descriptor (refused upstream at submit, pin and compile) renders nothing, so an unchecked value
 * never paints and a decorative layer never takes the page down.
 */
export function InteractiveBackdrop({ descriptor }: { descriptor: InteractiveBackdropDescriptor }) {
  if (interactiveBackdropDescriptorIssues(descriptor).length) return null;
  switch (descriptor.component) {
    case "particle-field": return <ParticleField params={resolveInteractiveBackdropParams(descriptor)} />;
    case "gradient-mesh": return <GradientMesh params={resolveInteractiveBackdropParams(descriptor)} />;
    case "grid-glow": return <GridGlow params={resolveInteractiveBackdropParams(descriptor)} />;
  }
}
