import map from "../catalog/layout-engines.json" with { type: "json" };
import engines from "./engines.json" with { type: "json" };
import { isEngineKey, type EngineKey } from "./keys.js";

/**
 * A live `layout.*` Composition slot selects the render engine its pages are laid out with, through the one data map in
 * `src/catalog/layout-engines.json`. Engines are internal render primitives: nothing pins one, and no page names one
 * directly. A paged layout (a deck) renders through its format and has no flow engine.
 */
export interface LayoutEngineChoice { readonly slot: string; readonly engine: EngineKey; readonly config: string }
export interface LayoutEngineMap {
  readonly schema: string;
  readonly layouts: Readonly<Record<string, { readonly engine: string; readonly config: string }>>;
  readonly paged: readonly string[];
}
interface EngineRow { readonly engine: string; readonly status: string; readonly contract: { readonly configs: readonly { readonly id: string }[] } }

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); }
  return value;
};
export const LAYOUT_ENGINE_MAP: LayoutEngineMap = deepFreeze(map as LayoutEngineMap);
const ENGINE_ROWS = engines as readonly EngineRow[];
const LAYOUT_SLOT = /^layout\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function engineProblem(entry: unknown, rows: readonly EngineRow[]): string | undefined {
  if (!entry || typeof entry !== "object" || Object.keys(entry).sort().join(",") !== "config,engine") return "an entry is exactly { engine, config }";
  const { engine, config } = entry as { engine: unknown; config: unknown };
  const row = rows.find(row => row.engine === engine);
  if (!isEngineKey(engine) || !row) return `engine ${String(engine)} is not a Publisher render engine`;
  if (row.status === "held" || row.status === "deprecated") return `engine ${engine} is ${row.status}`;
  if (!row.contract.configs.some(known => known.id === config)) return `config ${String(config)} is not registered on engine ${engine}`;
  return undefined;
}

/**
 * The engine a `layout.*` slot renders with (`layout.x` or `publisher/layout.x`), or `null` for a paged layout.
 * Throws when the slot has no entry: a layout is never rendered by a default or a guessed engine.
 */
export function layoutEngineFor(ref: string, source: LayoutEngineMap = LAYOUT_ENGINE_MAP, rows: readonly EngineRow[] = ENGINE_ROWS): LayoutEngineChoice | null {
  const slot = ref.replace(/^publisher\//, "");
  if (!LAYOUT_SLOT.test(slot)) throw new TypeError(`${ref} is not a layout.* slot`);
  if (source.paged.includes(slot)) return null;
  const entry = Object.hasOwn(source.layouts, slot) ? source.layouts[slot] : undefined;
  const problem = entry === undefined ? "it has no entry in the layout engine map" : engineProblem(entry, rows);
  if (problem) throw new TypeError(`${slot} has no render engine: ${problem}`);
  return { slot, engine: entry!.engine as EngineKey, config: entry!.config };
}

/** The engine a page renders with, reached only through the `layout.*` slot the page pins. */
export function pageLayoutEngine(page: { readonly layout?: unknown }, source: LayoutEngineMap = LAYOUT_ENGINE_MAP): LayoutEngineChoice | null {
  if (typeof page.layout !== "string") throw new TypeError("A page pins its layout as a layout.* slot");
  return layoutEngineFor(page.layout, source);
}

/**
 * The map covers every live `layout.*` slot exactly once (as an engine entry or as paged), names no other slot, and
 * every entry names a live engine and a config registered on it.
 */
export function checkLayoutEngineMap(liveLayoutSlots: readonly string[], source: LayoutEngineMap = LAYOUT_ENGINE_MAP, rows: readonly EngineRow[] = ENGINE_ROWS): string[] {
  const findings: string[] = [];
  const live = new Set(liveLayoutSlots);
  const mapped = Object.keys(source.layouts);
  for (const slot of live) {
    const count = (mapped.includes(slot) ? 1 : 0) + source.paged.filter(paged => paged === slot).length;
    if (count !== 1) findings.push(`${slot}: ${count ? "is mapped more than once" : "has no render engine entry"}`);
  }
  for (const slot of [...mapped, ...source.paged]) if (!live.has(slot)) findings.push(`${slot}: is not a live layout.* slot`);
  for (const [slot, entry] of Object.entries(source.layouts)) {
    const problem = engineProblem(entry, rows);
    if (problem) findings.push(`${slot}: ${problem}`);
  }
  return findings;
}

/**
 * The live `layout.*` Composition slots among placed leaves: every layout leaf that is not parked. The map must cover
 * each one. Pure: the caller passes the placed leaves, so this module stays free of file-system reads.
 */
export function liveLayoutSlots(leaves: readonly { readonly id: string; readonly parked?: boolean }[]): string[] {
  return leaves.filter(leaf => leaf.id.startsWith("layout.") && !leaf.parked).map(leaf => leaf.id);
}
