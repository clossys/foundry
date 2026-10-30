/**
 * Strategy v1 catalog: loadCatalog reads the six shipped JSON files and returns
 * fresh mutable data. validateCatalog accepts unknown data and reports CAT1–CAT7
 * findings with paths. The raw JSON lives under src/catalog in the npm package;
 * this location works from both source and the compiled dist/catalog.js entry.
 */
import { readFileSync } from "node:fs";
import type { ValidationIssue } from "./validation.js";
import { isPlainObject } from "./validation.js";

export interface CatalogCell {
  id: string;
  names: { l1: string; l2: string; l3: string; display: string };
  question: string;
  mustContain: { key: string; hint: string }[];
  functions: string[];
  links: { cites: string; label: string }[];
}
export interface CatalogNode {
  id: string;
  name: string;
  question: string;
  children: { id: string; name: string; leaves: string[] }[];
}
export interface StrategyCatalog {
  ia: { schemaVersion: 1; nodes: CatalogNode[] };
  cells: CatalogCell[];
  freeze: { frozenAt: string; leaves: string[] };
  archetypes: { default: string[]; extras: Record<string, string[]> };
  coherence: {
    links: { downstream: string; upstream: string; label: string }[];
    contradictions: { id: string; a: string; b: string | string[]; rule: string; kind: "script" | "judge" }[];
    storyline: string[];
  };
  lexicon: { banned: string[]; tradeOffMarkers: string[]; negativeKeys: string[] };
}
export type CatalogRule = "CAT0" | "CAT1" | "CAT2" | "CAT3" | "CAT4" | "CAT5" | "CAT6" | "CAT7";
export interface CatalogIssue extends ValidationIssue { rule: CatalogRule }
export type CatalogValidationResult = { ok: true; value: StrategyCatalog } | { ok: false; issues: CatalogIssue[] };

type Shape = "string" | readonly [Shape] | { [key: string]: Shape } | ((value: unknown) => boolean);
const strings: Shape = ["string"];
const shape: Shape = {
  ia: { schemaVersion: v => v === 1, nodes: [{ id: "string", name: "string", question: "string", children: [{ id: "string", name: "string", leaves: strings }] }] },
  cells: [{ id: "string", names: { l1: "string", l2: "string", l3: "string", display: "string" }, question: "string", mustContain: [{ key: "string", hint: "string" }], functions: strings, links: [{ cites: "string", label: "string" }] }],
  freeze: { frozenAt: "string", leaves: strings },
  archetypes: { default: strings, extras: v => isPlainObject(v) && Object.values(v).every(ids => Array.isArray(ids) && ids.every(id => typeof id === "string")) },
  coherence: { links: [{ downstream: "string", upstream: "string", label: "string" }], contradictions: [{ id: "string", a: "string", b: v => typeof v === "string" || (Array.isArray(v) && v.every(id => typeof id === "string")), rule: "string", kind: v => v === "script" || v === "judge" }], storyline: strings },
  lexicon: { banned: strings, tradeOffMarkers: strings, negativeKeys: strings },
};
function matches(value: unknown, expected: Shape): boolean {
  if (typeof expected === "function") return expected(value);
  if (expected === "string") return typeof value === "string";
  if (Array.isArray(expected)) return Array.isArray(value) && value.every(item => matches(item, expected[0]!));
  return isPlainObject(value) && Object.entries(expected).every(([key, child]) => matches(value[key], child));
}

/** Returns findings rather than throwing, including for malformed input (CAT0). */
export function validateCatalog(value: unknown): CatalogValidationResult {
  const issues: CatalogIssue[] = [];
  const add = (rule: CatalogRule, path: string, message: string) => { issues.push({ rule, path, message }); };
  if (!matches(value, shape)) return { ok: false, issues: [{ rule: "CAT0", path: "catalog", message: "Invalid catalog data shape" }] };
  const catalog = value as StrategyCatalog;
  const ids = new Set(catalog.cells.map(cell => cell.id));
  const placements = new Map<string, number>();
  const idPattern = /^[a-z]+(-[a-z]+)*\.[a-z]+(-[a-z]+)*\.[a-z]+(-[a-z]+)*$/;
  const name = (text: string, path: string) => {
    if (text.includes("&") || /\bor\b/i.test(text)) add("CAT3", path, "Node names must not contain & or the word or");
  };
  const resolves = (id: string, path: string) => { if (!ids.has(id)) add("CAT5", path, "Unknown cell id"); };
  const seenCells = new Set<string>();
  for (const [i, cell] of catalog.cells.entries()) {
    const path = `cells[${i}]`;
    if (!idPattern.test(cell.id)) add("CAT1", `${path}.id`, "Expected l1.l2.l3 kebab-case id");
    if (seenCells.has(cell.id)) add("CAT2", `${path}.id`, "Duplicate cell contract");
    seenCells.add(cell.id);
    for (const [key, text] of Object.entries(cell.names)) name(text, `${path}.names.${key}`);
    const keys = cell.mustContain.map(item => item.key);
    if (keys.length < 2 || keys.length > 4 || new Set(keys).size !== keys.length || keys.some(key => key.trim() === "")) add("CAT4", `${path}.mustContain`, "Expected 2–4 unique nonempty keys");
    cell.links.forEach((link, j) => resolves(link.cites, `${path}.links[${j}].cites`));
  }
  const nodeIds = new Set<string>();
  for (const [i, node] of catalog.ia.nodes.entries()) {
    const path = `ia.nodes[${i}]`;
    name(node.name, `${path}.name`);
    if (nodeIds.has(node.id)) add("CAT2", `${path}.id`, "Duplicate group id");
    nodeIds.add(node.id);
    for (const [j, child] of node.children.entries()) {
      const childPath = `${path}.children[${j}]`;
      name(child.name, `${childPath}.name`);
      if (nodeIds.has(child.id)) add("CAT2", `${childPath}.id`, "Duplicate group id");
      nodeIds.add(child.id);
      for (const [k, id] of child.leaves.entries()) {
        const leafPath = `${childPath}.leaves[${k}]`;
        placements.set(id, (placements.get(id) ?? 0) + 1);
        if (!ids.has(id) || id.split(".").slice(0, 2).join(".") !== child.id || child.id.split(".")[0] !== node.id) add("CAT2", leafPath, "Leaf must resolve and match its parent prefixes");
      }
    }
  }
  for (const id of ids) if (placements.get(id) !== 1) add("CAT2", "ia.nodes", "Each cell must be placed once");
  for (const [id, count] of placements) if (count !== 1) add("CAT2", "ia.nodes", "Duplicate leaf placement");
  catalog.coherence.links.forEach((link, i) => { resolves(link.upstream, `coherence.links[${i}].upstream`); resolves(link.downstream, `coherence.links[${i}].downstream`); });
  catalog.coherence.contradictions.forEach((pair, i) => { resolves(pair.a, `coherence.contradictions[${i}].a`); for (const id of [pair.b].flat()) resolves(id, `coherence.contradictions[${i}].b`); });
  catalog.coherence.storyline.forEach((id, i) => resolves(id, `coherence.storyline[${i}]`));
  catalog.archetypes.default.forEach((id, i) => resolves(id, `archetypes.default[${i}]`));
  const core = new Set(catalog.archetypes.default);
  for (const [archetype, extras] of Object.entries(catalog.archetypes.extras)) {
    for (const [i, id] of extras.entries()) {
      const path = `archetypes.extras.${archetype}[${i}]`;
      resolves(id, path);
      if (core.has(id)) add("CAT7", path, "Archetype extra repeats a default core cell");
    }
  }
  const frozen = new Set(catalog.freeze.leaves);
  if (frozen.size !== catalog.freeze.leaves.length) add("CAT6", "freeze.leaves", "Duplicate frozen leaf");
  for (const id of ids) if (!frozen.has(id)) add("CAT6", "freeze.leaves", "Cell is absent from the freeze");
  for (const id of frozen) if (!ids.has(id)) add("CAT6", "freeze.leaves", "Frozen cell is absent from the catalog");
  return issues.length ? { ok: false, issues } : { ok: true, value: catalog };
}

/** Loads and validates the packaged catalog, throwing if its files are invalid. */
export function loadCatalog(): StrategyCatalog {
  const read = (path: string): unknown => JSON.parse(readFileSync(new URL(`../src/catalog/${path}`, import.meta.url), "utf8"));
  const result = validateCatalog({
    ia: read("ia/strategy.json"), cells: read("cells/strategy.json"),
    freeze: read("ia/strategy.leaf-freeze.json"), archetypes: read("archetypes.json"),
    coherence: read("coherence.json"), lexicon: read("lexicon.json"),
  });
  if (!result.ok) throw new Error(`Invalid strategy catalog: ${result.issues.map(issue => `${issue.rule} ${issue.path}: ${issue.message}`).join("; ")}`);
  return result.value;
}
