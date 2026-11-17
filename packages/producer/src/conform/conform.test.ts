import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ASSERTIONS } from "./assertions.js";
import { judgeDogfood, PROBES, type ProbeFacts } from "./dogfood.js";
import { adapterIssues, CONFORM_AGENTS, readConformModel, type AgentModel, type ConformModel, type LiveSlot } from "./model.js";
import { cellOf, conform, formatReport, readRegistry } from "./run.js";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const FIXTURE = join(REPO, "packages/producer/test-fixtures/consumer/clossys");
const GOOD_FACTS: ProbeFacts = { emptyL2Detected: { director: true, writer: true }, requestVerb: true, critiqueMonorepoPath: false };

const slot = (id: string, inputs: string[], extra: Partial<LiveSlot> = {}): LiveSlot => ({
  id, source: "placed", schema: "clossys.slot/2", kind: "brief",
  contract: { requirements: [{ criterion: "text.nonempty" }], fixture: {} }, inputs, uses: [], standard: "std",
  family: { options: [], varyOn: [], values: [] }, ledger: [{ op: "slot", decision: "create", overlaps: [] }],
  pin: { verdict: { pass: true }, basis: "scorecard:a" }, ...extra,
});

/** An agent and world on which every assertion and probe is green; each test mutates one fact. */
function world(mutate: (agent: Record<string, any>, machinery: Record<string, any>, other: Record<string, any>) => void = () => {}): { agent: AgentModel; model: ConformModel } {
  const agent: Record<string, any> = {
    agent: "director", packageDir: "/p", adapterIssues: [],
    adapter: { schema: "clossys.conform-adapter/1", agent: "director", trees: [], kinds: ["brief"], defaults: [], recipes: [], derive: [], edgeFiles: [], skill: "skill/SKILL.md", skills: {} },
    trees: [{ file: "t.json", slots: {}, freeze: { file: "f.json", exists: true, ids: ["a.x", "a.y"] }, l1: [{ id: "a", parked: false, l2: [{ id: "a1", parked: false, leaves: ["a.x"] }, { id: "a2", parked: false, leaves: ["a.y"] }] }] }],
    placedTree: [{ id: "a", l2: [{ id: "a1", slots: ["a.x"] }, { id: "a2", slots: ["a.y"] }] }],
    folders: ["a.x", "a.y"],
    live: [slot("a.x", ["b.in"]), slot("a.y", ["b.other"])],
    defaults: new Set(["a.x", "a.y"]),
    standards: [{ agent: "director", id: "std", issues: [], doc: { requirements: [{}], seeds: [] }, taste: { criteria: [{}] }, exemplars: [1, 2, 3, 4, 5] }],
    recipes: [{ dir: "r", exists: true, fixture: { output: "o.json", slot: "a.x", value: {} } }],
    derive: [{ module: "src/derive/m.ts", text: "export const derive = (data) => data.map(row => row.id);" }], hasDeriveDir: true,
    edges: [{ from: "a.x", to: "b.in" }, { from: "a.y", to: "writer/b.other" }],
    actions: [{ id: "act", reads: ["consumer:agents/director/*/candidates/*", "consumer:agents/writer/*/pin.json"] }],
    skillText: "submit, then verdict, critique-packet and the craft stages",
    skills: ["scope", "slot", "create", "choose", "cascade"].map(loop => ({ loop, path: `s/${loop}.md`, exists: true, registered: true })),
    requests: [{ id: "q1", need: "z", status: "closed", placed: "director/a.x", notified: "2026-11-17" }],
  };
  const other: Record<string, any> = { ...agent, agent: "writer", live: [slot("b.in", []), slot("b.other", [])] };
  const enforced = { status: "enforced", enforcedFor: [] };
  const machinery: Record<string, any> = {
    rules: new Map(["R15.1", "R15.2", "R05.1", "R05.2", "R07.5"].map(id => [id, enforced])),
    loops: new Map([...["scope", "slot", "create", "choose", "cascade"].map(loop => [`loop.${loop}`, { steps: [{ decider: { agent: "director" } }] }] as const), ["loop.release", { steps: [{ checks: ["slots.needs-refresh"] }] }]]),
    slotRequestSchema: true, certifiers: new Set(["brief"]),
    contractSchemas: new Map([["brief", { type: "object", required: ["requirements"] }]]), criteria: new Set(["text.nonempty"]),
  };
  mutate(agent, machinery, other);
  const liveIds = new Map([["director", new Set(agent.live.map((item: LiveSlot) => item.id))], ["writer", new Set(other.live.map((item: LiveSlot) => item.id))]]) as ConformModel["liveIds"];
  const model = { repo: "/r", consumer: "/c", agents: [agent, other], machinery, liveIds } as unknown as ConformModel;
  return { agent: agent as AgentModel, model };
}

const red = (id: string, built: ReturnType<typeof world>): boolean => {
  const judgement = ASSERTIONS[id]!(built.agent, built.model);
  return cellOf(id, id, judgement).red;
};

/** One mutation per assertion: the fact that turns it red on the all-green world. */
const MUTATIONS: Record<string, Parameters<typeof world>[0]> = {
  S1: agent => { agent.placedTree[0].l2[0].slots.push("a.z"); agent.folders.push("a.z"); },
  S2: agent => { agent.trees[0].l1[0].l2.pop(); },
  S3: agent => { agent.folders = ["a.x"]; },
  S4: agent => { agent.live.push(slot("b.x", ["b.in"])); agent.defaults.add("b.x"); },
  S5: agent => { agent.trees[0].freeze.ids = ["a.x"]; },
  L1: (_agent, machinery) => { machinery.slotRequestSchema = false; },
  L2: agent => { agent.live[0] = slot("a.x", ["b.in"], { ledger: [{ op: "slot" }] }); },
  L3: (_agent, machinery) => { machinery.contractSchemas.set("brief", { type: "object" }); },
  L4: agent => { delete agent.requests[0].notified; },
  L5: agent => { agent.derive[0].text = `export const IDS = ["a.one", "a.two", "a.three", "a.four", "a.five"];`; },
  K1: agent => { agent.standards[0].exemplars = [1, 2, 3]; },
  K2: agent => { agent.defaults = new Set(["a.x"]); },
  K3: (_agent, machinery) => { machinery.rules.set("R05.1", { status: "building", enforcedFor: [] }); },
  K4: agent => { delete agent.recipes[0].fixture; },
  C1: agent => { agent.live[1] = slot("a.y", ["b.other"], { family: { options: [] } }); },
  C2: agent => { agent.live[0] = slot("a.x", ["b.in"], { contract: { requirements: [{ criterion: "text.unregistered" }] } }); },
  C3: agent => { agent.live[0] = slot("a.x", ["b.in"], { pin: { verdict: { pass: false }, basis: "scorecard:a" } }); },
  C4: agent => { agent.live[0] = slot("a.x", ["b.in"], { pin: { verdict: { pass: true }, basis: "picked" } }); },
  X1: (_agent, machinery) => { machinery.rules.set("R07.5", { status: "pending", enforcedFor: [] }); },
  X2: agent => { agent.edges.push({ from: "a.x", to: "writer/b.retired" }); },
  X3: agent => { agent.actions[0].reads.push("consumer:agents/writer/*/candidates/*"); },
  X4: (_agent, machinery) => { machinery.loops.set("loop.release", { steps: [{ checks: ["types.compile"] }] }); },
  W1: agent => { agent.skills[0].registered = false; },
};

describe("conformance registry", () => {
  const registry = readRegistry();
  it("declares the 23 assertions of the standard, each with a function and a mutation proof", () => {
    expect(registry.assertions.map(entry => entry.id)).toEqual(Object.keys(MUTATIONS));
    expect(Object.keys(ASSERTIONS).sort()).toEqual(registry.assertions.map(entry => entry.id).sort());
    // Report-only: nothing is enforced yet.
    expect(registry.assertions.every(entry => entry.status === "building" && entry.enforcedFor.length === 0)).toBe(true);
  });
  it("turns every dogfood row into an assertion named after it, with known probes", () => {
    expect(registry.dogfood).toHaveLength(20);
    for (const agent of CONFORM_AGENTS) expect(registry.dogfood.filter(row => row.agent === agent).map(row => row.loop)).toEqual(["SCOPE", "SLOT-CREATE", "CREATE", "CHOOSE", "CASCADE"]);
    for (const row of registry.dogfood) {
      expect(row.id).toBe(`DF.${row.agent}.${row.loop}`);
      expect(["RAN-FAILED", "RAN-WEAK", "CANNOT-RUN"]).toContain(row.result);
      for (const probe of row.probes) expect(PROBES[probe], probe).toBeDefined();
    }
  });
});

describe("conformance runner", () => {
  it("is green on the all-green world", () => {
    const built = world();
    for (const id of Object.keys(MUTATIONS)) expect(ASSERTIONS[id]!(built.agent, built.model), id).toMatchObject({ rows: [] });
    for (const id of Object.keys(MUTATIONS)) expect(red(id, built), id).toBe(false);
  });
  it.each(Object.keys(MUTATIONS))("mutation proof: %s turns red", id => {
    expect(red(id, world(MUTATIONS[id]))).toBe(true);
    // The mutation is specific: the other assertions of a different lens stay green.
    const lens = readRegistry().assertions.find(entry => entry.id === id)!.lens;
    // A dangling edge is both an X2 row and an L1 need with no request: that pair moves together.
    const others = readRegistry().assertions.filter(entry => entry.lens !== lens && !(id === "X2" && entry.id === "L1"));
    for (const entry of others) expect(red(entry.id, world(MUTATIONS[id])), `${id} also turned ${entry.id}`).toBe(false);
  });
  it("counts an empty set as red (vacuous), never green", () => {
    const cell = cellOf("C3", "C3", { rows: [], evidence: 0 });
    expect(cell).toMatchObject({ red: true, vacuous: true });
    expect(cell.rows.at(-1)).toMatch(/empty is red/);
    const empty = world(agent => { agent.live = []; agent.recipes = []; agent.derive = []; agent.requests = []; });
    for (const id of ["K1", "K2", "K4", "C1", "C2", "C3", "C4", "L4", "L5"]) expect(red(id, empty), id).toBe(true);
  });
  it("reports an agent with no valid adapter as uncovered: every cell red", () => {
    const built = world(agent => { delete agent.adapter; agent.adapterIssues = ["packages/director/conform.json is missing or not JSON"]; });
    const report = conform(built.model, readRegistry(), GOOD_FACTS);
    const director = report.agents.find(agent => agent.agent === "director")!;
    expect(director.red).toBe(23);
    expect(director.cells[0]!.rows[0]).toMatch(/^uncovered: /);
    expect(report.ok).toBe(false);
  });
  it("resolves a trailing-* edge by prefix: dangling only when no live slot matches", () => {
    const matched = world(agent => { agent.edges.push({ from: "a.x", to: "b.*" }); });
    expect(ASSERTIONS.X2!(matched.agent, matched.model).rows).toEqual([]);
    const unmatched = world(agent => { agent.edges.push({ from: "a.x", to: "zz.*" }); });
    expect(ASSERTIONS.X2!(unmatched.agent, unmatched.model).rows).toEqual(["a.x -> zz.*: not a live slot"]);
  });
  it("prints RED/GREEN per assertion with every red row, and is ok only when all green", () => {
    const report = conform(world(MUTATIONS.X2).model, readRegistry(), GOOD_FACTS);
    const text = formatReport(report);
    expect(text).toMatch(/RED {3}X2 .*\n {8}- a\.x -> writer\/b\.retired: not a live slot/);
    expect(text).toMatch(/GREEN S2 /);
    expect(report.ok).toBe(false);
  });
});

describe("dogfood probes", () => {
  const row = (probes: string[]) => ({ id: "DF.director.X", agent: "director", loop: "X", result: "RAN-WEAK", finding: "f", probes });
  const probeMutations: Record<string, [Parameters<typeof world>[0], Partial<ProbeFacts>?]> = {
    "empty-l2": [() => {}, { emptyL2Detected: { director: false } }],
    "request-path": [() => {}, { requestVerb: false }],
    "invalid-contract": [MUTATIONS.L3],
    "critique-path": [() => {}, { critiqueMonorepoPath: true }],
    "pin-verdict": [MUTATIONS.C3],
    "repin-stale": [MUTATIONS.X1],
    "skill-craft": [agent => { agent.skillText = "submit then verdict"; }],
    "skill-basis": [agent => { agent.skillText += " pin --by owner --basis picked"; }],
    "contract-fixture": [agent => { agent.live = agent.live.map((item: LiveSlot) => ({ ...item, contract: { requirements: [] } })); }],
    "upstream-pinned": [(_agent, _machinery, other) => { other.live = other.live.map((item: LiveSlot) => { const { pin: _pin, ...rest } = item; return rest; }); }],
    "current-format": [agent => { agent.live[0] = slot("a.x", ["b.in"], { schema: "clossys.slot/1" }); }],
  };
  it("covers every probe with a mutation", () => expect(Object.keys(probeMutations).sort()).toEqual(Object.keys(PROBES).sort()));
  it.each(Object.keys(probeMutations))("probe %s: green on the green world, red under its mutation", name => {
    const green = world();
    expect(judgeDogfood(row([name]), green.agent, green.model, GOOD_FACTS).rows).toEqual([]);
    const [mutate, facts] = probeMutations[name]!;
    const bad = world(mutate);
    const judgement = judgeDogfood(row([name]), bad.agent, bad.model, { ...GOOD_FACTS, ...facts });
    expect(cellOf("DF", "DF", judgement).red).toBe(true);
  });
});

describe("conformance over the repo and its fixture", () => {
  const model = readConformModel(REPO, FIXTURE);
  it("reads a valid adapter for every agent", () => {
    for (const agent of model.agents) expect(agent.adapterIssues, agent.agent).toEqual([]);
    expect(adapterIssues({ schema: "clossys.conform-adapter/1", agent: "writer" }, "director").length).toBeGreaterThan(1);
  });
  it("judges every assertion and dogfood row per agent, with today's known reds", () => {
    const report = conform(model, readRegistry(), { emptyL2Detected: Object.fromEntries(CONFORM_AGENTS.map(agent => [agent, false])), requestVerb: false, critiqueMonorepoPath: true });
    for (const agent of report.agents) {
      expect(agent.cells).toHaveLength(23);
      expect(agent.dogfood).toHaveLength(5);
      // Shared today: placement records no decision, no cascade, no family data, no five loops.
      for (const id of ["L1", "L2", "C1", "X1", "X4", "W1"]) expect(agent.cells.find(cell => cell.id === id)!.red, `${agent.agent} ${id}`).toBe(true);
    }
    const director = report.agents.find(agent => agent.agent === "director")!;
    expect(director.cells.find(cell => cell.id === "K3")!.red).toBe(false);
    expect(report.agents.find(agent => agent.agent === "publisher")!.cells.find(cell => cell.id === "X3")!.red).toBe(true);
    expect(report.ok).toBe(false);
  });
});
