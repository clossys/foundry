import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ASSERTIONS, OVERLAP_MIN } from "./assertions.js";
import { isContractRefusal, judgeDogfood, probeIaContract, PROBES, type ProbeFacts } from "./dogfood.js";
import { adapterIssues, CONFORM_AGENTS, missingPaths, readConformModel, type Adapter, type AgentModel, type ConformModel, type LiveSlot } from "./model.js";
import { cellOf, conform, formatReport, readRegistry } from "./run.js";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const FIXTURE = join(REPO, "packages/producer/test-fixtures/consumer/clossys");
const refused = (agent: string) => [{ target: `${agent}/conform.contract-probe-brief`, contract: "{}", accepted: false, message: "ia refused: contract" }];
const GOOD_FACTS: ProbeFacts = { emptyL2Detected: { director: true, writer: true }, requestVerb: true, critiqueMonorepoPath: false, iaContract: { director: refused("director"), writer: refused("writer") } };

const slot = (id: string, inputs: string[], extra: Partial<LiveSlot> = {}): LiveSlot => ({
  id, source: "placed", schema: "clossys.slot/2", kind: "brief",
  contract: { requirements: [{ criterion: "text.nonempty" }], fixture: {} }, inputs, uses: [], standard: "std",
  family: { options: [], varyOn: [], values: [] }, ledger: [{ op: "slot", decision: "create", overlaps: [] }],
  pin: { verdict: { pass: true }, basis: "scorecard:a" }, ...extra,
});

/** An agent and world on which every assertion and probe is green; each test mutates one fact. */
type Mutation = (agent: Record<string, any>, machinery: Record<string, any>, other: Record<string, any>, facts: Record<string, any>) => void;
function world(mutate: Mutation = () => {}): { agent: AgentModel; model: ConformModel; facts: ProbeFacts } {
  const agent: Record<string, any> = {
    agent: "director", packageDir: "/p", adapterIssues: [],
    adapter: { schema: "clossys.conform-adapter/1", agent: "director", trees: [], kinds: ["brief"], defaults: [], recipes: [], derive: [], edgeFiles: [], skill: "skill/SKILL.md", skills: {} },
    trees: [{ file: "t.json", slots: {}, freeze: { file: "f.json", exists: true, ids: ["a.x", "a.y"] }, l1: [{ id: "a", parked: false, l2: [{ id: "a1", parked: false, leaves: ["a.x"] }, { id: "a2", parked: false, leaves: ["a.y"] }] }] }],
    placedTree: [{ id: "a", l2: [{ id: "a1", slots: ["a.x"] }, { id: "a2", slots: ["a.y"] }] }],
    folders: ["a.x", "a.y"],
    live: [slot("a.x", ["b.in"]), slot("a.y", ["b.other"])], packageOnly: [],
    l2Of: new Map([["a.x", "a/a1"], ["a.y", "a/a2"]]),
    defaults: new Set(["a.x", "a.y"]),
    standards: [{ agent: "director", id: "std", issues: [], doc: { requirements: [{}], seeds: [] }, taste: { criteria: [{}] }, exemplars: [1, 2, 3, 4, 5] }],
    recipes: [{ dir: "r", exists: true, fixture: { output: "o.json", slot: "a.x", value: {} } }],
    derive: [{ module: "src/derive/m.ts", text: "export const derive = (data) => data.map(row => row.id);" }], hasDeriveDir: true,
    edges: [{ from: "a.x", to: "writer/b.in", scope: "placed" }, { from: "a.y", to: "b.other", target: "writer", scope: "package" }],
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
  const facts: Record<string, any> = structuredClone(GOOD_FACTS);
  const ids = () => new Map([["director", new Set<string>(agent.live.map((item: LiveSlot) => item.id))], ["writer", new Set<string>(other.live.map((item: LiveSlot) => item.id))]]);
  const packageIds = ids();
  other.packageIds = packageIds;
  mutate(agent, machinery, other, facts);
  const model = { repo: "/r", consumer: "/c", agents: [agent, other], machinery, liveIds: ids(), packageIds } as unknown as ConformModel;
  return { agent: agent as AgentModel, model, facts: facts as ProbeFacts };
}

const red = (id: string, built: ReturnType<typeof world>): boolean => {
  const judgement = ASSERTIONS[id]!(built.agent, built.model, built.facts);
  return cellOf(id, id, judgement).red;
};

/** One mutation per assertion: the fact that turns it red on the all-green world. */
const MUTATIONS: Record<string, Mutation> = {
  S1: agent => { agent.placedTree[0].l2[0].slots.push("a.z"); agent.folders.push("a.z"); },
  S2: agent => { agent.trees[0].l1[0].l2.pop(); },
  S3: agent => { agent.folders = ["a.x"]; },
  S4: agent => { agent.live.push(slot("b.x", ["b.in"])); agent.defaults.add("b.x"); },
  S5: agent => { agent.trees[0].freeze.ids = ["a.x"]; },
  L1: (_agent, machinery) => { machinery.slotRequestSchema = false; },
  L2: agent => { agent.live[0] = slot("a.x", ["b.in"], { ledger: [{ op: "slot" }] }); },
  L3: (_agent, _machinery, _other, facts) => { facts.iaContract.director = [{ ...facts.iaContract.director[0], accepted: true }]; },
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
  X2: agent => { agent.edges.push({ from: "a.x", to: "writer/b.retired", scope: "placed" }); },
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
    for (const id of Object.keys(MUTATIONS)) expect(ASSERTIONS[id]!(built.agent, built.model, built.facts), id).toMatchObject({ rows: [] });
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
    const matched = world(agent => { agent.edges.push({ from: "a.x", to: "b.*", target: "writer", scope: "package" }); });
    expect(ASSERTIONS.X2!(matched.agent, matched.model).rows).toEqual([]);
    const unmatched = world(agent => { agent.edges.push({ from: "a.x", to: "zz.*", target: "writer", scope: "package" }); });
    expect(ASSERTIONS.X2!(unmatched.agent, unmatched.model).rows).toEqual(["a.x -> zz.* (writer): no such package slot"]);
  });
  it("resolves a bare edge against its declared target or the agent and its upstream only, never any agent", () => {
    // director is upstream of writer: a bare writer id from director dangles unless the edge names writer.
    const bare = world(agent => { agent.edges.push({ from: "a.x", to: "b.in", scope: "placed" }); });
    expect(ASSERTIONS.X2!(bare.agent, bare.model).rows).toEqual(["a.x -> b.in: no such live slot"]);
    const targeted = world(agent => { agent.edges.push({ from: "a.x", to: "b.in", target: "writer", scope: "placed" }); });
    expect(ASSERTIONS.X2!(targeted.agent, targeted.model).rows).toEqual([]);
  });
  it("resolves a package edge in the package tree only; a placed edge also in placed slots", () => {
    const placedOnly: Mutation = (agent, _machinery, other) => { other.packageIds.get("writer").delete("b.in"); agent.edges[0] = { ...agent.edges[0], scope: "package" }; };
    expect(ASSERTIONS.X2!(world(placedOnly).agent, world(placedOnly).model).rows).toEqual(["a.x -> writer/b.in: no such package slot"]);
    const stillPlaced: Mutation = (_agent, _machinery, other) => { other.packageIds.get("writer").delete("b.in"); };
    expect(ASSERTIONS.X2!(world(stillPlaced).agent, world(stillPlaced).model).rows).toEqual([]);
  });
  it("pins the S4 name threshold: 0.75 overlaps, 0.67 siblings do not", () => {
    expect(OVERLAP_MIN).toBe(0.7);
    const pair = (a: string, b: string) => world(agent => { agent.live.push(slot(a, ["b.in"]), slot(b, ["b.in"])); });
    const near = pair("a.one-two-three", "a.one-two-three-four");
    expect(ASSERTIONS.S4!(near.agent, near.model).rows).toEqual(["a.one-two-three and a.one-two-three-four: same kind and inputs, similar purpose (0.75)"]);
    const siblings = pair("a.primary-foreground", "a.sidebar-primary-foreground");
    expect(ASSERTIONS.S4!(siblings.agent, siblings.model).rows).toEqual([]);
  });
  it("S4 finds a purpose overlap whatever the name: one subject across two trees, or one L2 with the same inputs and requirements", () => {
    const dual = world(agent => {
      agent.live.push(slot("passages.hero", ["z.one"], { contract: { sectionId: "sections.hero" } }));
      agent.packageOnly.push(slot("sections.hero.copy", ["designer/sections.hero"], { source: "package", contract: {} }));
    });
    expect(ASSERTIONS.S4!(dual.agent, dual.model).rows).toEqual(["passages.hero and sections.hero.copy: both are for sections.hero (same purpose)"]);
    const requirements = { requirements: [{ criterion: "text.nonempty" }, { criterion: "text.short" }] };
    const oneL2 = world(agent => {
      agent.live.push(slot("a.alpha", ["z.one"], { contract: requirements }), slot("a.omega", ["z.one"], { contract: requirements }));
      agent.l2Of.set("a.alpha", "a/a3"); agent.l2Of.set("a.omega", "a/a3");
    });
    expect(ASSERTIONS.S4!(oneL2.agent, oneL2.model).rows).toEqual(["a.alpha and a.omega: one L2 (a/a3), same inputs and requirements (same purpose)"]);
    // Mutation: the same pair under two L2 groups is no overlap.
    const twoL2 = world(agent => {
      agent.live.push(slot("a.alpha", ["z.one"], { contract: requirements }), slot("a.omega", ["z.one"], { contract: requirements }));
      agent.l2Of.set("a.alpha", "a/a3"); agent.l2Of.set("a.omega", "a/a4");
    });
    expect(ASSERTIONS.S4!(twoL2.agent, twoL2.model).rows).toEqual([]);
  });
  it("S4 keys a slot/1 bare input and a slot/2 agent-qualified input as one ref (a mixed store)", () => {
    const requirements = { requirements: [{ criterion: "text.nonempty" }] };
    // The agent's own leaf: bare `a.x` (slot/1) and `director/a.x` (slot/2) are one input.
    const own = world(agent => {
      agent.live.push(slot("a.one-two-three", ["a.x"]), slot("a.one-two-three-four", ["director/a.x"]));
      agent.live.push(slot("a.alpha", ["a.x"], { contract: requirements, schema: "clossys.slot/1" }), slot("a.omega", ["director:a.x"], { contract: requirements }));
      agent.l2Of.set("a.alpha", "a/a3"); agent.l2Of.set("a.omega", "a/a3");
    });
    expect(ASSERTIONS.S4!(own.agent, own.model).rows).toEqual([
      "a.one-two-three and a.one-two-three-four: same kind and inputs, similar purpose (0.75)",
      "a.alpha and a.omega: one L2 (a/a3), same inputs and requirements (same purpose)",
    ]);
    // An upstream leaf, from a downstream agent: the bare id resolves to the upstream agent that holds it.
    const upstream = world((_agent, _machinery, other) => {
      other.live.push(slot("b.one-two-three", ["a.x"]), slot("b.one-two-three-four", ["director/a.x"]));
    });
    const writer = upstream.model.agents[1]!;
    expect(ASSERTIONS.S4!(writer, upstream.model).rows).toEqual(["b.one-two-three and b.one-two-three-four: same kind and inputs, similar purpose (0.75)"]);
    // A bare id no agent holds stays bare: it is not the qualified ref of another agent's leaf.
    const unresolved = world((_agent, _machinery, other) => {
      other.live.push(slot("b.one-two-three", ["z.none"]), slot("b.one-two-three-four", ["director/z.none"]));
    });
    expect(ASSERTIONS.S4!(unresolved.model.agents[1]!, unresolved.model).rows).toEqual([]);
  });
  it("prints RED/GREEN per assertion with every red row, and is ok only when all green", () => {
    const report = conform(world(MUTATIONS.X2).model, readRegistry(), GOOD_FACTS);
    const text = formatReport(report);
    expect(text).toMatch(/RED {3}X2 .*\n {8}- a\.x -> writer\/b\.retired: no such live slot/);
    expect(text).toMatch(/GREEN S2 /);
    expect(report.ok).toBe(false);
  });
});

describe("dogfood probes", () => {
  const row = (probes: string[]) => ({ id: "DF.director.X", agent: "director", loop: "X", result: "RAN-WEAK", finding: "f", probes });
  const probeMutations: Record<string, [Mutation, Partial<ProbeFacts>?]> = {
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
    expect(judgeDogfood(row([name]), green.agent, green.model, green.facts).rows).toEqual([]);
    const [mutate, facts] = probeMutations[name]!;
    const bad = world(mutate);
    const judgement = judgeDogfood(row([name]), bad.agent, bad.model, { ...bad.facts, ...facts });
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
    const accepted = (agent: string) => [{ target: `${agent}/conform.contract-probe`, contract: "{}", accepted: true, message: "ia --dry" }];
    const report = conform(model, readRegistry(), { emptyL2Detected: Object.fromEntries(CONFORM_AGENTS.map(agent => [agent, false])), requestVerb: false, critiqueMonorepoPath: true, iaContract: Object.fromEntries(CONFORM_AGENTS.map(agent => [agent, accepted(agent)])) });
    for (const agent of report.agents) {
      expect(agent.cells).toHaveLength(23);
      expect(agent.dogfood).toHaveLength(5);
      // Shared today: placement records no decision, no cascade, no family data, no five loops.
      for (const id of ["L1", "L2", "C1", "X1", "X4", "W1"]) expect(agent.cells.find(cell => cell.id === id)!.red, `${agent.agent} ${id}`).toBe(true);
    }
    const director = report.agents.find(agent => agent.agent === "director")!;
    expect(director.cells.find(cell => cell.id === "K3")!.red).toBe(false);
    expect(report.agents.find(agent => agent.agent === "publisher")!.cells.find(cell => cell.id === "X3")!.red).toBe(true);
    // X2 over the package trees: Director feeds name Writer ids its package tree lacks; Designer's usage graph reads missing endpoints.
    const x2 = (agent: string) => report.agents.find(item => item.agent === agent)!.cells.find(cell => cell.id === "X2")!;
    expect(x2("director").red).toBe(true);
    expect(x2("director").rows.filter(row => row.includes("(writer)")).length).toBeGreaterThanOrEqual(120);
    expect(x2("designer").red).toBe(true);
    expect(x2("designer").rows.filter(row => / -> themes\.[a-z-]+\.[a-z]+: no such package slot$/.test(row)).length).toBe(258);
    expect(report.ok).toBe(false);
  });
});

describe("adapter paths", () => {
  const adapter = JSON.parse(readFileSync(join(REPO, "packages/director/conform.json"), "utf8")) as Adapter;
  it("finds no missing path in a real adapter, and a red row for each declared path that does not exist", () => {
    expect(missingPaths(adapter, REPO, join(REPO, "packages/director"))).toEqual([]);
    const broken = { ...adapter, trees: [...adapter.trees, { file: "src/missing-tree.json", freeze: null }], edgeFiles: [{ file: "src/missing-edges.json", format: "slots" as const }] };
    expect(missingPaths(broken, REPO, join(REPO, "packages/director"))).toEqual(["conform.json declares src/missing-tree.json, which does not exist", "conform.json declares src/missing-edges.json, which does not exist"]);
  });
});

describe("ia --contract probe (the real verb on a temporary copy)", () => {
  const model = readConformModel(REPO, FIXTURE);
  it("records today's acceptance of an invalid contract for every agent, and a refusal once the contract is one the verb checks", async () => {
    const accepted = await probeIaContract(FIXTURE, model.agents);
    for (const agent of CONFORM_AGENTS) {
      const results = accepted[agent];
      expect(Array.isArray(results), `${agent}: ${String(results)}`).toBe(true);
      expect((results as { accepted: boolean }[]).every(result => result.accepted), agent).toBe(true);
    }
    // Mutation: a clossys.slot-contract/1 contract missing its fields is refused by the same path, so the probe sees refusals.
    const refusedAll = await probeIaContract(FIXTURE, model.agents, { schema: "clossys.slot-contract/1" });
    for (const agent of CONFORM_AGENTS) {
      const results = refusedAll[agent] as { target: string; accepted: boolean; message: string }[];
      expect(Array.isArray(results), `${agent}: ${String(refusedAll[agent])}`).toBe(true);
      for (const result of results) {
        expect(result.accepted, result.target).toBe(false);
        // The refusal reason is the contract's own validation issue, not any message that mentions "contract".
        expect(result.message, result.target).toMatch(/contract \$\.slot is required \(clossys\.slot-contract\/1\)/);
        expect(isContractRefusal(result.message, result.target), result.target).toBe(true);
      }
    }
  });

  it("classifies only contract-content refusals: the probe id and paths are stripped before matching", () => {
    const target = "director/conform.contract-probe-brief";
    expect(isContractRefusal("ia refused: contract $.slot is required (clossys.slot-contract/1)", target)).toBe(true);
    // Mutation: "already placed" names the probe id, which holds "contract"; it is not a contract refusal.
    expect(isContractRefusal(`ia refused: ${target} is already placed; --under only places a new slot`, target)).toBe(false);
    expect(isContractRefusal("ia refused: --contract /tmp/conform-contract-x/contract.json is not a readable JSON file", target, ["/tmp/conform-contract-x"])).toBe(false);
    expect(isContractRefusal(`ia refused: ${target} has no position in director ia.json`, target)).toBe(false);
  });
});
