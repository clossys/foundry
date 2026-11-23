/**
 * S1-PLACED (owner, 2026-11-23): S1 judges the leaves `ia sync` places. For an agent sync scopes to consumed leaves
 * the expected set is its consumed package leaves plus the Producer-contributed slots; a placed package leaf outside
 * it is allowed, and an invented leaf, a missing expected leaf or an empty expected set is red.
 */
import { describe, expect, it, vi } from "vitest";

const consumed = vi.hoisted(() => ({ keys: new Set<string>() }));
vi.mock("../records/slot-model/consumed.js", async importOriginal => ({
  ...(await importOriginal<typeof import("../records/slot-model/consumed.js")>()),
  consumedLeaves: () => consumed.keys,
}));
vi.mock("../records/slot-model/foundry-ia.js", async importOriginal => ({
  ...(await importOriginal<typeof import("../records/slot-model/foundry-ia.js")>()),
  studioDesignerSlots: () => [{ id: "themes.studio" }],
}));

const { ASSERTIONS } = await import("./assertions.js");
const { cellOf } = await import("./run.js");
import type { AgentModel, ConformModel } from "./model.js";

/** A Designer with package leaves a.x, a.y, a.z, placing `placed`, whose consumer consumes `reach`. */
function judge(placed: string[], reach: string[], agentName = "designer") {
  consumed.keys = new Set(reach.map(id => `${agentName}/${id}`));
  const agent = {
    agent: agentName, loops: [],
    trees: [{ file: "t.json", slots: {}, l1: [{ id: "a", parked: false, l2: [{ id: "a1", parked: false, leaves: ["a.x", "a.y", "a.z"] }] }] }],
    placedTree: [{ id: "a", l2: [{ id: "a1", slots: placed }] }],
  } as unknown as AgentModel;
  const model = { consumer: "/w/clossys" } as unknown as ConformModel;
  const judgement = ASSERTIONS.S1!(agent, model);
  return { ...judgement, red: cellOf("S1", "S1", judgement).red };
}

describe("S1 judges the leaves sync places (S1-PLACED)", () => {
  it("is green when every consumed leaf and Producer slot is placed", () => {
    expect(judge(["a.x", "themes.studio"], ["a.x"])).toMatchObject({ rows: [], evidence: 2, red: false });
  });
  it("is red for an expected leaf that is missing", () => {
    const result = judge(["a.x"], ["a.x", "a.y"]);
    expect(result.red).toBe(true);
    expect(result.rows).toEqual(["sync places 3 leaves, the placed tree has 1 of them", "a.y: sync places it, not placed", "themes.studio: sync places it, not placed"]);
  });
  it("allows a placed package leaf outside the expected set", () => {
    expect(judge(["a.x", "a.z", "themes.studio"], ["a.x"])).toMatchObject({ rows: [], evidence: 2, red: false });
  });
  it("is red for an invented leaf, neither a package leaf nor a Producer slot", () => {
    const result = judge(["a.x", "themes.studio", "a.invented"], ["a.x"]);
    expect(result.red).toBe(true);
    expect(result.rows).toEqual(["sync places 2 leaves, the placed tree has 2 of them", "a.invented: placed, neither a package leaf nor a Producer slot"]);
  });
  it("is red, never green, on an empty expected set", () => {
    const result = judge(["a.x"], [], "writer");
    expect(result.evidence).toBe(0);
    expect(result.red).toBe(true);
    expect(result.rows).toContain("nothing to judge: sync places no leaves");
  });
  it("keeps the whole package tree as the expected set for an agent sync does not scope", () => {
    const result = judge(["a.x"], [], "director");
    expect(result.red).toBe(true);
    expect(result.rows).toEqual(["sync places 3 leaves, the placed tree has 1 of them", "a.y: sync places it, not placed", "a.z: sync places it, not placed"]);
  });
});
