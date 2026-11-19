"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "./reduced-motion.js";

/**
 * Gradient mesh (foundry-build-0048 A4, kept by U23): three soft colour fields that slowly drift,
 * fixed in place under reduced motion. A Foundry part with a recorded no-alternative basis (source
 * ladder L4 in catalog/rules/backdrop-components.json): no adopted registry item paints a drifting
 * multi-colour field. Built from stock Tailwind token utilities and the Web Animations API only;
 * the adapter (InteractiveBackdrop.tsx) wraps it in the decorative layer.
 */

/** Each token colour as a literal utility, so the stylesheet carries every one. */
const GROUND: Readonly<Record<string, string>> = {
  primary: "bg-primary", secondary: "bg-secondary", accent: "bg-accent", foreground: "bg-foreground", "muted-foreground": "bg-muted-foreground", border: "bg-border",
};
/** The ground colour keys, for the test that pins them one-to-one to the registry colours. */
export const GRADIENT_MESH_GROUND_KEYS: readonly string[] = Object.freeze(Object.keys(GROUND));

/** The ground utility of a registry colour; throws for a colour the map lacks, so a field never paints with no ground. */
export function gradientMeshGroundClass(color: string): string {
  if (!Object.hasOwn(GROUND, color)) throw new Error(`GradientMesh: registry colour ${JSON.stringify(color)} has no ground utility`);
  return GROUND[color]!;
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

export interface GradientMeshProps { readonly from: string; readonly via: string; readonly to: string; readonly speed: number; readonly intensity: number }

/** Three soft colour fields that slowly drift; fixed in place under reduced motion or at speed 0. */
export function GradientMesh({ from, via, to, speed, intensity }: GradientMeshProps) {
  const reduced = useReducedMotion();
  const animated = !reduced && speed > 0;
  const blobs = useRef<(HTMLDivElement | null)[]>([]);
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
    <div data-gradient-mesh={animated ? "animated" : "static"} className="absolute inset-0">
      {MESH_BLOBS.map((blob, index) => (
        <div key={index} ref={node => { blobs.current[index] = node; }} className={`absolute rounded-full blur-3xl ${blob.place} ${gradientMeshGroundClass(colors[index]!)}`} style={{ opacity: intensity }} />
      ))}
    </div>
  );
}
