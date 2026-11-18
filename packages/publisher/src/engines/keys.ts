/**
 * The five render engines Publisher lays a flow page out with. An engine key is an internal render primitive: it has
 * no slot identity, is never pinned, and is chosen only through a `layout.*` Composition slot's entry in
 * `src/catalog/layout-engines.json`.
 */
export const ENGINE_KEYS = ["stack", "split", "sidebar-content", "bento", "staggered-grid"] as const;
export type EngineKey = (typeof ENGINE_KEYS)[number];
const KEY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?![\s\S])/;
export function isEngineKey(value: unknown): value is EngineKey {
  return typeof value === "string" && KEY.test(value) && (ENGINE_KEYS as readonly string[]).includes(value);
}
