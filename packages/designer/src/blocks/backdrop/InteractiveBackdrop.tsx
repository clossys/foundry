"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  BACKDROP_REGISTRY,
  backdropComponentRecord,
  interactiveBackdropDescriptorIssues,
  resolveInteractiveBackdropParams,
  type BackdropComponentRecord,
  type BackdropRegistry,
  type InteractiveBackdropDescriptor,
  type InteractiveBackdropParams,
} from "../../tokens/interactive-backdrops.js";
import { Particles } from "../../components/partners/magicui/particles.js";
import { FlickeringGrid } from "../../components/partners/magicui/flickering-grid.js";
import { GridPattern } from "../../components/partners/magicui/grid-pattern.js";
import { GradientMesh } from "./GradientMesh.js";
import { useReducedMotion } from "./reduced-motion.js";

export { useReducedMotion } from "./reduced-motion.js";

/**
 * The interactive backdrop adapter (foundry-build-0048 A4, U23 owner 2026-11-18): Foundry owns the
 * contract and the recipe, the engine is adopted OSS. A pinned descriptor `{component, params}`
 * names one adopted record of catalog/rules/backdrop-components.json; this adapter renders that
 * record's source component (a byte-exact Magic UI copy, or the one Foundry part with a recorded
 * no-alternative basis) with the descriptor's params mapped onto the source's own props as the
 * record says. It holds no component list or param schema of its own.
 *
 * Every layer is decorative: `aria-hidden="true"`, `pointer-events: none` on the layer (descendants
 * inherit it), no focusable or text content. Every layer honours `prefers-reduced-motion` by its
 * record's policy: `omit` renders no layer, `props` renders the component with its still props,
 * `component` lets the component render its own still frame. On the server and before hydration
 * the preference reads as reduced. Colours are token utilities from the literal map below (theme
 * conformance: no colour literal); a component that needs a concrete colour gets the painted
 * token read back from a probe carrying that utility.
 */

/** Each source component, keyed by its record's source (`<registry>/<item>`, or `foundry/<export>`). */
/** Each record's props are mapped from data, so the map is typed by the props it passes. */
const RENDERERS: Readonly<Record<string, ComponentType<Record<string, unknown>>>> = {
  "magicui/particles": Particles as ComponentType<Record<string, unknown>>,
  "magicui/flickering-grid": FlickeringGrid as ComponentType<Record<string, unknown>>,
  "magicui/grid-pattern": GridPattern as ComponentType<Record<string, unknown>>,
  "foundry/GradientMesh": GradientMesh as unknown as ComponentType<Record<string, unknown>>,
};
/** The renderer keys, for the test that pins them one-to-one to the registry. */
export const BACKDROP_RENDERER_KEYS: readonly string[] = Object.freeze(Object.keys(RENDERERS));

/** The renderer key a record's source names. */
export function backdropRendererKey(entry: BackdropComponentRecord): string {
  return "foundry" in entry.source ? `foundry/${entry.source.export}` : `${entry.source.registry}/${entry.source.item}`;
}

/** Each token colour as a literal utility, so the stylesheet carries every one. */
const INK: Readonly<Record<string, string>> = {
  primary: "text-primary", secondary: "text-secondary", accent: "text-accent", foreground: "text-foreground", "muted-foreground": "text-muted-foreground", border: "text-border",
};
/** The ink colour keys, for the test that pins them one-to-one to the registry colours. */
export const BACKDROP_INK_KEYS: readonly string[] = Object.freeze(Object.keys(INK));

/** The ink utility of a registry colour; throws for a colour the map lacks, so a colour never paints with no ink. */
export function backdropInkClass(color: string): string {
  if (!Object.hasOwn(INK, color)) throw new Error(`InteractiveBackdrop: registry colour ${JSON.stringify(color)} has no ink utility`);
  return INK[color]!;
}

/** A painted CSS colour as `#rrggbb`, read back through a 1x1 canvas; undefined where no canvas paints. */
function paintedHex(color: string): string | undefined {
  if (!color || typeof document === "undefined") return undefined;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return undefined;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const data = context.getImageData(0, 0, 1, 1).data;
  return `#${[data[0], data[1], data[2]].map(channel => (channel ?? 0).toString(16).padStart(2, "0")).join("")}`;
}

const pointerEvents = "none" as const;

/** One adopted record, rendered by its own policy. */
function AdoptedBackdrop({ entry, params, Renderer }: { entry: BackdropComponentRecord; params: InteractiveBackdropParams; Renderer: ComponentType<Record<string, unknown>> }) {
  const reduced = useReducedMotion();
  const hexKeys = Object.entries(entry.params).filter(([, spec]) => spec.type === "color" && spec.as === "hex").map(([key]) => key);
  const ink = Object.entries(entry.params).find(([, spec]) => spec.type === "color" && spec.as === "currentColor");
  const probes = useRef<Record<string, HTMLSpanElement | null>>({});
  const [hex, setHex] = useState<Record<string, string> | undefined>(hexKeys.length ? undefined : {});
  const tokens = hexKeys.map(key => String(params[key])).join(" ");
  useEffect(() => {
    if (!hexKeys.length) return;
    const read: Record<string, string> = {};
    for (const key of hexKeys) {
      const probe = probes.current[key];
      const value = probe ? paintedHex(getComputedStyle(probe).color) : undefined;
      if (!value) return;
      read[key] = value;
    }
    setHex(read);
  }, [tokens]);
  const animated = entry.motion === "animated" && !reduced;
  if (entry.motion === "animated" && reduced && entry.reducedMotion?.mode === "omit") return null;
  const props: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(entry.params)) {
    if (!spec.prop) continue;
    props[spec.prop] = spec.type === "color" && spec.as === "hex" ? hex?.[key] : params[key];
  }
  Object.assign(props, entry.props ?? {});
  if (entry.motion === "animated" && reduced && entry.reducedMotion?.mode === "props") Object.assign(props, entry.reducedMotion.props);
  const inkClass = ink ? backdropInkClass(String(params[ink[0]])) : "";
  return (
    <div aria-hidden="true" data-interactive-backdrop={entry.id} data-motion={animated ? "animated" : "static"} className={`pointer-events-none absolute inset-0 overflow-hidden ${inkClass}`} style={{ pointerEvents }}>
      {hexKeys.map(key => <span key={key} hidden data-backdrop-probe={key} ref={node => { probes.current[key] = node; }} className={backdropInkClass(String(params[key]))} />)}
      {hex ? <Renderer {...props} /> : null}
    </div>
  );
}

/**
 * The one entry a pinned descriptor renders through: it judges the descriptor against the registry
 * and renders that record's source component with every param resolved to its schema default when
 * absent. An invalid descriptor (refused upstream at submit, pin and compile), or a record with no
 * shipped renderer, renders nothing, so an unchecked value never paints and a decorative layer
 * never takes the page down.
 */
export function InteractiveBackdrop({ descriptor, registry = BACKDROP_REGISTRY }: { descriptor: InteractiveBackdropDescriptor; registry?: BackdropRegistry }) {
  if (interactiveBackdropDescriptorIssues(descriptor, registry).length) return null;
  const entry = backdropComponentRecord(descriptor.component, registry)!;
  const Renderer = RENDERERS[backdropRendererKey(entry)];
  if (!Renderer) return null;
  return <AdoptedBackdrop key={entry.id} entry={entry} params={resolveInteractiveBackdropParams(descriptor, registry)} Renderer={Renderer} />;
}
