/**
 * S1-PLACED (owner, 2026-11-23): S1 judges the leaves `ia sync` places. For an agent sync scopes to consumed leaves
 * the expected set is exactly its consumed leaves: a Producer Studio slot is expected only when the consumed set holds it
 * (fix1), and a placed one that is not consumed is a known leaf. A placed package leaf outside the expected set is
 * allowed, and an invented leaf, a missing expected leaf or an empty expected set is red.
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

const { ASSERTIONS, KIND_CERTIFIER } = await import("./assertions.js");
const { cellOf } = await import("./run.js");
import type { AgentModel, ConformModel } from "./model.js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { certifyPublication } from "../constitution/certify/page.js";

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
  it("is green when every consumed leaf is placed", () => {
    expect(judge(["a.x"], ["a.x"])).toMatchObject({ rows: [], evidence: 1, red: false });
  });
  it("is red for an expected leaf that is missing", () => {
    const result = judge(["a.x"], ["a.x", "a.y"]);
    expect(result.red).toBe(true);
    expect(result.rows).toEqual(["sync places 2 leaves, the placed tree has 1 of them", "a.y: sync places it, not placed"]);
  });
  it("allows a placed package leaf outside the expected set", () => {
    expect(judge(["a.x", "a.z"], ["a.x"])).toMatchObject({ rows: [], evidence: 1, red: false });
  });
  it("gives no row for a Producer slot no publication reaches that is not placed", () => {
    expect(judge(["a.x"], ["a.x"])).toMatchObject({ rows: [], evidence: 1, red: false });
  });
  it("gives no row for a placed Producer slot that is not consumed", () => {
    expect(judge(["a.x", "themes.studio"], ["a.x"])).toMatchObject({ rows: [], evidence: 1, red: false });
  });
  it("is red for a consumed Producer slot that is not placed", () => {
    const result = judge(["a.x"], ["a.x", "themes.studio"]);
    expect(result.red).toBe(true);
    expect(result.rows).toEqual(["sync places 2 leaves, the placed tree has 1 of them", "themes.studio: sync places it, not placed"]);
  });
  it("is red for an invented leaf, neither a package leaf nor a Producer slot", () => {
    const result = judge(["a.x", "a.invented"], ["a.x"]);
    expect(result.red).toBe(true);
    expect(result.rows).toEqual(["sync places 1 leaves, the placed tree has 1 of them", "a.invented: placed, neither a package leaf nor a Producer slot"]);
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
  it("names the package tree in the Publisher summary, an IA sync does not manage", () => {
    const result = judge(["a.x"], [], "publisher");
    expect(result.red).toBe(true);
    expect(result.rows[0]).toBe("package tree has 3 leaves, the placed tree has 1 of them");
  });
});

/**
 * R4B: K3 finds a publication's certifier where it lives. certify/publication.ts does not exist; certifyPublication is in
 * certify/page.ts, so KIND_CERTIFIER maps publication to page, as it maps release to its own certify/release.ts.
 */
describe("K3 counts the existing certifier of every held kind (R4B)", () => {
  // The certifier set conform reads: the certify/<name>.ts files that exist (model.ts readMachinery).
  const certifyDir = fileURLToPath(new URL("../constitution/certify/", import.meta.url));
  const certifiers = new Set(["element", "brief", "strings", "page", "publication", "release", "seat"].filter(name => existsSync(`${certifyDir}${name}.ts`)));
  const k3 = (kinds: string[]) => ASSERTIONS.K3!(
    { agent: "publisher", adapter: { kinds } } as unknown as AgentModel,
    { machinery: { rules: new Map([["R05.1", { status: "enforced", enforcedFor: [] }]]), certifiers } } as unknown as ConformModel,
  );

  it("maps a publication to certify/page.ts, which holds certifyPublication", () => {
    expect(KIND_CERTIFIER).toEqual({ release: "release", publication: "page" });
    expect(certifiers.has("publication")).toBe(false);
    expect(certifiers.has("page")).toBe(true);
    expect(typeof certifyPublication).toBe("function");
  });
  it("is green for Publisher's held kinds, publication included", () => {
    expect(k3(["page", "layout", "chrome", "publication", "release"])).toEqual({ rows: [], evidence: 5 });
  });
  it("stays red for a held kind with no certifier", () => {
    expect(k3(["publication", "invented"]).rows).toEqual(["invented: no certifier"]);
  });
});
