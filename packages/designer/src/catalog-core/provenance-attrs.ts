/**
 * DOM provenance stamps (D1). The only source of the `data-ds-*` attribute names and values: the
 * component emitter embeds its result, section roots and the publisher page root spread it, and
 * provenance-scan reads the same names back. Pure and dependency-free, so any layer may import it.
 */
export type DsLayer = "components" | "sections" | "frames" | "pages";
export const DS_LAYERS: readonly DsLayer[] = Object.freeze(["components", "sections", "frames", "pages"]);
/** Attribute names, namespaced away from `data-slot` (shadcn@aria), `data-part`/`data-surface` (Foundry) and `data-layer` (specimens). */
export const DS_ATTR = Object.freeze({ layer: "data-ds-layer", leaf: "data-ds-leaf", fill: "data-ds-fill" } as const);
export interface DsAttrs {
  readonly "data-ds-layer": DsLayer;
  readonly "data-ds-leaf": string;
  readonly "data-ds-fill": string;
}
/** `components.button`; a page leaf is `pages.<route or instance id>`. */
const LEAF = /^(components|sections|frames)\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PAGE_LEAF = /^pages\.[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
/** `<source>/<leaf>`: attribute-safe text only, so a stamp can never break out of its attribute. */
const FILL = /^[A-Za-z0-9@][A-Za-z0-9@._-]*\/[a-z]+\.[A-Za-z0-9._-]+$/;

/** Throws on an unknown layer, a leaf outside its layer, or an unsafe fill id. */
export function dsAttrs(layer: DsLayer, leaf: string, fill: string): DsAttrs {
  if (!DS_LAYERS.includes(layer)) throw new Error(`provenance: unknown layer ${String(layer)}`);
  if (!(layer === "pages" ? PAGE_LEAF : LEAF).test(leaf) || !leaf.startsWith(`${layer}.`)) throw new Error(`provenance: leaf ${leaf} is not in layer ${layer}`);
  if (fill.length > 200 || !FILL.test(fill)) throw new Error(`provenance: unsafe fill id ${fill}`);
  return Object.freeze({ [DS_ATTR.layer]: layer, [DS_ATTR.leaf]: leaf, [DS_ATTR.fill]: fill } as DsAttrs);
}
/**
 * Rendered markup with every provenance stamp removed: for byte comparisons against markup captured
 * before stamping. Stamp values are attribute-safe by construction, so a quoted value never spans a quote.
 */
export function withoutDsAttrs(html: string): string {
  return html.replace(/ data-ds-(?:layer|leaf|fill)="[^"]*"/g, "");
}
/**
 * The stamp a composing section passed through props, for a delegate root that forwards no other
 * props: only the three string attributes cross, so a delegate never spreads unknown props to the DOM.
 */
export function dsPassThrough(props: object): Partial<DsAttrs> {
  const stamp: Record<string, string> = {};
  for (const name of Object.values(DS_ATTR)) { const value = (props as Record<string, unknown>)[name]; if (typeof value === "string") stamp[name] = value; }
  return stamp as Partial<DsAttrs>;
}
