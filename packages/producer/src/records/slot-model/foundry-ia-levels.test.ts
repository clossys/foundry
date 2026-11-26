/**
 * CP1-U3 G6b: the Designer and Writer packages' owner-decided L0 layers and closed axes (src/catalog/ia/levels.json)
 * pass through to the package IA and survive the adopt verb's consumed-leaf scoping, as the Director's do.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAgent } from "../../agents.js";
import { filterFoundryIa } from "./consumed.js";
import { PACKAGE_LEVELS_FILE, designerIa, writerIa, type FoundryIa } from "./index.js";
import { validateIa } from "./validate.js";

type Levels = { layers: { id: string; label: string; nodes: string[] }[]; axes: unknown };
const levels = (agent: "designer" | "writer") => JSON.parse(readFileSync(join(resolveAgent(agent).packageRoot, PACKAGE_LEVELS_FILE), "utf8")) as Levels;
const l1 = (ref: string) => ref.split("/")[0]!;

describe.each([["designer", designerIa], ["writer", writerIa]] as const)("the %s package IA", (agent, read) => {
  const pkg: FoundryIa = read();
  const shipped = levels(agent);

  it("carries the package's layers and axes", () => {
    expect(pkg.ia.axes).toEqual(shipped.axes);
    expect(pkg.ia.layers?.map(layer => [layer.id, layer.label])).toEqual(shipped.layers.filter(layer => pkg.ia.layers?.some(kept => kept.id === layer.id)).map(layer => [layer.id, layer.label]));
    expect(pkg.ia.layers?.length).toBeGreaterThan(0);
  });

  it("names every placed L1 in exactly one layer, and no L1 it does not place", () => {
    const placed = pkg.ia.nodes.map(node => node.id);
    const named = pkg.ia.layers!.flatMap(layer => layer.nodes.map(l1));
    expect([...named].sort()).toEqual([...placed].sort());
    for (const layer of pkg.ia.layers!) for (const ref of layer.nodes) expect(ref.startsWith(`${layer.id}.`) || shipped.layers.find(row => row.id === layer.id)!.nodes.includes(ref)).toBe(true);
  });

  it("keeps the layers through the adopt scoping (a consumed subset), and the adopted IA validates", () => {
    const first = pkg.ia.nodes[0]!;
    const keep = new Set([first.children[0]!.slots[0]!]);
    const adopted = filterFoundryIa(pkg, keep).ia;
    expect(adopted.axes).toEqual(shipped.axes);
    expect(adopted.layers).toEqual([{ ...pkg.ia.layers!.find(layer => layer.nodes.some(ref => l1(ref) === first.id))!, nodes: [first.id] }]);
    expect(validateIa(adopted, "ia.json", agent)).toEqual([]);
  });
});
