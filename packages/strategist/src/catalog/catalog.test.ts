import { describe, expect, it } from "vitest";
import { loadCatalog, validateCatalog, type StrategyCatalog } from "../catalog.js";
import { readFileSync } from "node:fs";

describe("strategy catalog", () => {
  it("loads the 57 leaves, 28 L2, 7 L1 and 24 default core cells", () => {
    const catalog = loadCatalog();
    expect(catalog.cells).toHaveLength(57);
    expect(catalog.ia.nodes).toHaveLength(7);
    expect(catalog.ia.nodes.flatMap(node => node.children)).toHaveLength(28);
    expect(catalog.archetypes.default).toHaveLength(24);
    expect(catalog.freeze.leaves).toHaveLength(57);
    expect(catalog.coherence.links).toHaveLength(11);
    expect(catalog.coherence.contradictions).toHaveLength(7);
    expect(validateCatalog(catalog).ok).toBe(true);
  });

  const mutations: [string, string, (catalog: StrategyCatalog) => void][] = [
    ["invalid leaf id", "CAT1", c => { c.cells[0]!.id = "bad"; }],
    ["duplicate leaf contract", "CAT2", c => { c.cells.push(structuredClone(c.cells[0]!)); }],
    ["duplicate placement", "CAT2", c => { c.ia.nodes[0]!.children[0]!.leaves.push(c.cells[0]!.id); }],
    ["wrong prefix", "CAT2", c => { c.ia.nodes[0]!.children[0]!.leaves[0] = c.cells[5]!.id; }],
    ["ampersand name", "CAT3", c => { c.ia.nodes[0]!.name = "A & B"; }],
    ["or name", "CAT3", c => { c.cells[0]!.names.l3 = "This or that"; }],
    ["one must-contain key", "CAT4", c => { c.cells[0]!.mustContain.splice(1); }],
    ["duplicate key", "CAT4", c => { c.cells[0]!.mustContain[1]!.key = c.cells[0]!.mustContain[0]!.key; }],
    ["dangling cell link", "CAT5", c => { c.cells[0]!.links.push({ cites: "unknown.cell.id", label: "Missing" }); }],
    ["dangling coherence link", "CAT5", c => { c.coherence.links[0]!.upstream = "unknown.cell.id"; }],
    ["dangling contradiction", "CAT5", c => { c.coherence.contradictions[0]!.b = ["unknown.cell.id"]; }],
    ["dangling storyline", "CAT5", c => { c.coherence.storyline.push("unknown.cell.id"); }],
    ["dangling archetype", "CAT5", c => { c.archetypes.extras.services!.push("unknown.cell.id"); }],
    ["unfrozen leaf", "CAT6", c => { c.freeze.leaves.pop(); }],
    ["absent frozen leaf", "CAT6", c => { c.freeze.leaves.push("unknown.cell.id"); }],
    ["core repeated as extra", "CAT7", c => { c.archetypes.extras.services!.push(c.archetypes.default[0]!); }],
  ];
  it.each(mutations)("rejects %s", (_name, rule, mutate) => {
    const catalog = loadCatalog();
    mutate(catalog);
    const result = validateCatalog(catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some(issue => issue.rule === rule)).toBe(true);
  });
  it.each([null, {}, { cells: [] }, [], "catalog"])("rejects malformed data: %j", value => {
    expect(validateCatalog(value).ok).toBe(false);
  });
  it("loads fresh data without sharing mutable state", () => {
    const first = loadCatalog();
    first.cells.pop();
    expect(loadCatalog().cells).toHaveLength(57);
  });
  it("preserves packet cell contracts and grouping mechanically", () => {
    const packet = JSON.parse(readFileSync(new URL("../../docs/v2/catalog/tree.json", import.meta.url), "utf8"));
    const catalog = loadCatalog();
    expect(catalog.cells).toEqual(packet.cells.map(({ id, names, question, mustContain, functions, links }: StrategyCatalog["cells"][number]) => ({ id, names, question, mustContain, functions, links })));
    expect(catalog.ia.nodes).toEqual(packet.tree.map((node: {children: {cells: string[]}[]}) => ({ ...node, children: node.children.map(({cells, ...child}) => ({ ...child, leaves: cells })) })));
    expect(catalog.freeze.leaves).toEqual(packet.cells.map((cell: {id: string}) => cell.id));
    expect(catalog.coherence).toEqual(packet.coherence);
  });
});
