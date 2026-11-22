import { describe, expect, it } from "vitest";
import { check, type CatalogData, type DtcgToken, type FillDoc, type Placement, type Slot, type Source } from "./index.js";

/**
 * C4 coverage and retired slots (U-CHECKALIGN, owner 2026-11-22 Q1): a retired slot stays registered but is no longer
 * offered, so a complete library needs no consumer fill for it. A parked slot is still required, and a fill a retired
 * slot still ships is judged in full.
 */
const source: Source = { id: "foundry", kind: "base", author: "foundry", license: "MIT" };
const slot = (id: string, members: Slot["contract"]["members"] = { mode: "open", pattern: "^[a-z0-9-]+$" }): Slot =>
  ({ id, layer: "themes", contract: { kind: "token", tier: "scale", $type: "number", members, modes: ["light"] }, requires: [], status: "draft" });
const fill = (leaf: string): FillDoc => ({
  $extensions: { "com.clossys.fill": { id: `foundry/themes.${leaf}`, slot: `themes.${leaf}`, source: "foundry", mode: "implementation", sourceAddress: "fixture", relation: "same-contract", builtOn: [], conforms: [], evidence: [], author: "foundry", trust: "foundry", license: "MIT", status: "draft", originKinds: ["authored"] } },
  themes: { [leaf]: { default: { $type: "number", $value: 1, $extensions: { "com.clossys.origin": { kind: "authored", license: "MIT" } } } as DtcgToken } },
});
const placement: Placement = {
  layer: "themes",
  nodes: [{ id: "motion", label: "Motion", children: [{ id: "motion-sample", label: "Sample", leaves: ["themes.sample", "themes.gone", "themes.resting"] }] }],
  parked: [{ leaf: "themes.resting", basis: "fixture: not consumed today" }],
};
function world(retired: readonly string[]) {
  const fills = [fill("sample")];
  const catalog: CatalogData = {
    slots: [slot("themes.sample"), slot("themes.gone"), slot("themes.resting")], fills, sources: [source], standards: [], placements: [placement],
    retired: retired.map(id => ({ id, retiredAt: "2026-11-22", decidedBy: "fixture", reason: "fixture" })),
  };
  return { catalog, library: { source, fills, complete: true } };
}
const coverage = (input: ReturnType<typeof world>) => check(input).findings.filter(finding => finding.code === "C4" && finding.rule === "coverage")
  .map(finding => `${finding.severity} ${finding.subject}`).sort();

describe("C4 coverage: retired slots need no consumer fill", () => {
  it("passes a retired slot with no fill and still fails a parked one", () => {
    expect(coverage(world(["themes.gone"]))).toEqual(["error themes.resting"]);
  });

  it("mutation: the same slot, not retired, fails coverage", () => {
    expect(coverage(world([]))).toEqual(["error themes.gone", "error themes.resting"]);
  });

  it("a parked slot stays required even when it is the only gap", () => {
    expect(coverage(world(["themes.gone"])).filter(line => line.endsWith("themes.resting"))).toEqual(["error themes.resting"]);
    const unparked = world(["themes.gone", "themes.resting"]);
    expect(coverage(unparked)).toEqual([]);
  });

  it("a fill a retired slot still ships is judged in full", () => {
    const input = world(["themes.gone"]);
    const closed = slot("themes.gone", { mode: "closed", names: ["default", "fast"] });
    input.catalog.slots = [input.catalog.slots[0]!, closed, input.catalog.slots[2]!];
    input.catalog.fills.push(fill("gone"));
    expect(coverage(input)).toEqual(["error themes.gone.fast", "error themes.resting"]);
  });
});
