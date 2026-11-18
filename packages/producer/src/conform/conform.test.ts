import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ASSERTIONS, OVERLAP_MIN } from "./assertions.js";
import { isContractRefusal, judgeDogfood, probeIaContract, probePinGate, PROBES, type PinGateResult, type ProbeFacts, type VerbProbe } from "./dogfood.js";
import { adapterIssues, CONFORM_AGENTS, missingPaths, readConformModel, type Adapter, type AgentModel, type ConformModel, type LiveSlot } from "./model.js";
import { cellOf, conform, formatReport, readRegistry } from "./run.js";
import { AGENT_LOOPS, agentLoopIssues, readAgentPackageLoop } from "../loop/agent-loops.js";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const FIXTURE = join(REPO, "packages/producer/test-fixtures/consumer/clossys");
const refused = (agent: string) => [{ target: `${agent}/conform.contract-probe-brief`, contract: "{}", accepted: false, message: "ia refused: contract" }];
const gateRefused = (agent: string) => ({ target: `${agent}/a.x`, candidate: "conform-probe-v1.md", accepted: false, message: "pin refused: a.x conform-probe-v1.md: conform-probe-v1.md has no submit record" });
const GOOD_FACTS: ProbeFacts = { emptyL2Detected: { director: true, writer: true }, requestVerb: true, critiqueMonorepoPath: false, iaContract: { director: refused("director"), writer: refused("writer") }, pinGate: { director: gateRefused("director"), writer: gateRefused("writer") } };

const slot = (id: string, inputs: string[], extra: Partial<LiveSlot> = {}): LiveSlot => ({
  id, source: "placed", schema: "clossys.slot/2", kind: "brief",
  contract: { requirements: [{ check: "text.nonempty" }], fixture: {} }, inputs, uses: [], standard: "std",
  family: { options: 1, varyOn: null, values: [] }, ledger: [{ op: "slot", decision: "create", overlaps: [] }],
  pin: { basis: "picked", refs: [{ to: "producer/checks.scorecard", rel: "cites", record: `director/${id}` }] }, ...extra,
});

/**
 * Director's own five loops (U9a), as its package candidates hold them, adopted and pinned by the consumer (a consumer
 * that places Director must hold all five); the cascade gains a Director step of its own (the standard cascade is all
 * code, so no step would reach the agent and W1 would be red).
 */
function ownLoops(): Record<string, any>[] {
  return AGENT_LOOPS.map(loop => {
    const read = readAgentPackageLoop("director", loop);
    if (!read.ok) throw new Error(read.reason);
    const content = structuredClone(read.content) as Record<string, any>;
    if (loop === "loop.cascade") content.steps.push({ id: "director-notes", does: "note the repinned briefs for the owner", decider: { by: "agent", agent: "director", verb: "check", tier: "low", skill: "packages/director/skills/director/SKILL.md" }, cli: "clossys next", reads: ["<slot>/slot.json"], writes: [".clossys/checks/director/<slot-id>/scratch/notes.json"], checks: [] });
    return { loop, declared: true, package: { ok: true, ref: `director/${loop}/package:v1`, content }, placed: true, pin: { ok: true, ref: `director/${loop}/${loop.slice(5)}-v1.json`, content: structuredClone(content) } };
  });
}

/** An agent and world on which every assertion and probe is green; each test mutates one fact. */
type Mutation = (agent: Record<string, any>, machinery: Record<string, any>, other: Record<string, any>, facts: Record<string, any>) => void;
function world(mutate: Mutation = () => {}): { agent: AgentModel; model: ConformModel; facts: ProbeFacts } {
  const agent: Record<string, any> = {
    agent: "director", packageDir: "/p", adapterIssues: [],
    adapter: { schema: "clossys.conform-adapter/1", agent: "director", trees: [], kinds: ["brief"], defaults: [], recipes: [], derive: [], edgeFiles: [], loops: [...AGENT_LOOPS], skill: "skill/SKILL.md", skills: {} },
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
    loops: ownLoops(),
    requests: [{ id: "q1", kind: "slot", from: "director/a.x", target: "director/z", status: "closed", link: "director/a.x", closed: "q1#3", notified: { to: "director/a.x", at: "2026-11-17T00:00:00Z" } }],
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
  S2: agent => { agent.trees[0].l1 = []; },
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
  C1: agent => { agent.live[1] = slot("a.y", ["b.other"], { family: { options: 3, varyOn: "tone", values: ["plain"] } }); },
  C2: agent => { agent.live[0] = slot("a.x", ["b.in"], { contract: { requirements: [{ check: "text.unregistered" }] } }); },
  C3: (_agent, _machinery, _other, facts) => { facts.pinGate.director = { ...facts.pinGate.director, accepted: true }; },
  C4: agent => { agent.live[0] = slot("a.x", ["b.in"], { pin: { basis: "picked", refs: [] } }); },
  X1: (_agent, machinery) => { machinery.rules.set("R07.5", { status: "pending", enforcedFor: [] }); },
  X2: agent => { agent.edges.push({ from: "a.x", to: "writer/b.retired", scope: "placed" }); },
  X3: agent => { agent.actions[0].reads.push("consumer:agents/writer/*/candidates/*"); },
  X4: (_agent, machinery) => { machinery.loops.set("loop.release", { steps: [{ checks: ["types.compile"] }] }); },
  W1: agent => { agent.skills[0].registered = false; },
  // Director's own create drops Producer's required certify step.
  W2: agent => { const create = agent.loops.find((loop: any) => loop.loop === "loop.create").package.content; create.steps = create.steps.filter((step: any) => step.id !== "certify"); },
};

describe("own loops (W2, foundry-build-0048 U9a)", () => {
  it("the world's own loops extend Producer's standard (the cascade's added Director step included)", () => {
    for (const loop of ownLoops()) expect(agentLoopIssues("director", loop.loop, loop.package.content, { packageVersion: true }), loop.loop).toEqual([]);
  });
  const w2 = (mutate: Mutation) => ASSERTIONS.W2!(world(mutate).agent, world(mutate).model, GOOD_FACTS).rows;
  it("refuses an undeclared loop", () => {
    expect(w2(agent => { agent.loops[0].declared = false; })).toEqual(["loop.scope: conform.json does not declare director's loop.scope"]);
  });
  it("once the consumer holds one loop slot, refuses a missing one, an unpinned one and a pinned version that drops a required step", () => {
    const placed = (agent: Record<string, any>) => { for (const loop of agent.loops) { loop.placed = true; loop.pin = structuredClone(loop.package); } };
    expect(w2(placed)).toEqual([]);
    expect(w2(agent => { placed(agent); agent.loops[1].placed = false; delete agent.loops[1].pin; })).toEqual(["director/loop.slot: missing (the consumer holds director's other loop slots, not this one)"]);
    expect(w2(agent => { placed(agent); agent.loops[2].pin = { ok: false, reason: "director/loop.create is not pinned" }; })).toEqual(["director/loop.create: unpinned: director/loop.create is not pinned"]);
    const dropped = w2(agent => { placed(agent); const choose = agent.loops[3].pin.content; choose.steps = choose.steps.slice(1); });
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped.every(row => row.startsWith("pinned director/loop.choose/package:v1: "))).toBe(true);
  });
  it("no vacuous pass: a consumer that places the agent but holds none of its loop slots is red, every loop missing", () => {
    const unadopted = (agent: Record<string, any>) => { for (const loop of agent.loops) { loop.placed = false; delete loop.pin; } };
    expect(w2(unadopted)).toEqual(AGENT_LOOPS.map(loop => `director/${loop}: missing (the consumer places director but holds none of its loop slots; run clossys loop director/${loop})`));
    // A consumer that does not place the agent at all judges only the package versions.
    expect(w2(agent => { unadopted(agent); agent.placedTree = []; })).toEqual([]);
  });
  it("W1 judges the version that runs: the consumer's pin where the slot is held, else the package candidate", () => {
    const rows = (mutate: Mutation) => ASSERTIONS.W1!(world(mutate).agent, world(mutate).model, GOOD_FACTS).rows;
    const dropNotes = (version: Record<string, any>) => { version.content.steps = version.content.steps.filter((step: any) => step.id !== "director-notes"); };
    // Director's pinned cascade without its own step reaches no Director step; the package candidate does not matter then.
    expect(rows(agent => { dropNotes(agent.loops[4].pin); })).toEqual(["loop.cascade: no step reaches director"]);
    expect(rows(agent => { dropNotes(agent.loops[4].package); })).toEqual([]);
    expect(rows(agent => { agent.loops[2].pin = { ok: false, reason: "gone" }; })).toEqual(["loop.create: director's own version cannot be read"]);
    // Not held: the package candidate.
    expect(rows(agent => { agent.loops[4].placed = false; dropNotes(agent.loops[4].package); })).toEqual(["loop.cascade: no step reaches director"]);
  });
});

describe("conformance registry", () => {
  const registry = readRegistry();
  it("declares the 24 assertions of the standard, each with a function and a mutation proof", () => {
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
    expect(director.red).toBe(24);
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
    const requirements = { requirements: [{ check: "text.nonempty" }, { check: "text.short" }] };
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
  it("lists a one-part split as a report-only finding, never red (S2, owner 2026-11-17)", () => {
    const built = world(agent => { agent.trees[0].l1[0].l2.pop(); agent.placedTree[0].l2[1].slots = []; });
    const judgement = ASSERTIONS.S2!(built.agent, built.model);
    expect(judgement.rows).toEqual([]);
    expect(judgement.findings).toEqual([expect.stringMatching(/^suspicious split: .* has one L2/), "suspicious split: a/a1 has one live L3", "suspicious split: a/a2 has no live L3"]);
    expect(cellOf("S2", "S2", judgement)).toMatchObject({ red: false, findings: judgement.findings });
    expect(formatReport(conform(built.model, readRegistry(), GOOD_FACTS))).toMatch(/GREEN S2 .*\n {8}~ suspicious split: /);
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
      expect(agent.cells).toHaveLength(24);
      expect(agent.dogfood).toHaveLength(5);
      // Shared today: placement records no decision; create, choose and cascade name the slot's owner, not a literal
      // agent, and the cascade step names no skill.
      for (const id of ["L2", "W1"]) expect(agent.cells.find(cell => cell.id === id)!.red, `${agent.agent} ${id}`).toBe(true);
      // U5: the scope and slot loops reach every agent through its own skill, so W1 keeps no scope or slot rows.
      expect(agent.cells.find(cell => cell.id === "W1")!.rows.filter(row => /^loop\.(scope|slot)\b|^(scope|slot):/.test(row)), agent.agent).toEqual([]);
      // The cascade rows (U6): a repin re-verdicts its dependants, every edge resolves, no input reads a candidate
      // file, release refuses needs-refresh.
      for (const id of ["X1", "X2", "X3", "X4"]) expect(agent.cells.find(cell => cell.id === id)!.rows, `${agent.agent} ${id}`).toEqual([]);
      // U9a: every agent declares its five own loops, each extending Producer's standard; W1 judges them, so only the
      // all-code cascade (no agent step, no skill) stays red. The fixture places director, designer and writer, adopts none of their
      // loop slots, so W2 is red with all five missing (no vacuous pass); its Publisher IA is empty and places nothing.
      expect(agent.cells.find(cell => cell.id === "W2")!.rows, agent.agent).toEqual(agent.agent === "publisher" ? [] : AGENT_LOOPS.map(loop => `${agent.agent}/${loop}: missing (the consumer places ${agent.agent} but holds none of its loop slots; run clossys loop ${agent.agent}/${loop})`));
      expect(agent.cells.find(cell => cell.id === "W1")!.rows, agent.agent).toEqual([`loop.cascade: no step reaches ${agent.agent}`, "cascade: names no skill"]);
    }
    // L1: the queue-entry/2 schema and loop.slot exist (U5), and no package slot edge names a slot no tree holds (U6
    // resolved every dangling edge), so no agent has an unfiled slotless need.
    const l1 = (agent: string) => report.agents.find(item => item.agent === agent)!.cells.find(cell => cell.id === "L1")!;
    for (const agent of CONFORM_AGENTS) expect(l1(agent).rows, agent).toEqual([]);
    // C1 (family): every Director, Designer and Writer slot carries the family the contracts migration seeded from the
    // option table (the re-keyed table classes every Director and Writer group); Publisher's slot/1 slots carry none.
    const c1 = (agent: string) => report.agents.find(item => item.agent === agent)!.cells.find(cell => cell.id === "C1")!;
    for (const agent of ["director", "designer", "writer"]) expect(c1(agent).red, agent).toBe(false);
    expect(c1("publisher").red).toBe(true);
    const director = report.agents.find(agent => agent.agent === "director")!;
    expect(director.cells.find(cell => cell.id === "K3")!.red).toBe(false);
    expect(report.ok).toBe(false);
  });
});

describe("pin gate probe (the real pin verb on a temporary copy)", () => {
  const model = readConformModel(REPO, FIXTURE);
  it("pins no hand-placed or uncertified candidate for any agent through any verb: each refusal is the CHOOSE gate's", async () => {
    const results = await probePinGate(FIXTURE, model.agents);
    // Publisher's live slots are clossys.slot/1 (no CREATE and CHOOSE contract yet), so its probe names that gap.
    expect(results.publisher).toBe("pin probe: publisher has no live clossys.slot/2 slot");
    for (const agent of ["director", "designer", "writer"]) {
      const result = results[agent];
      expect(typeof result, `${agent}: ${String(result)}`).toBe("object");
      const gate = result as PinGateResult;
      expect(gate.accepted, gate.target).toBe(false);
      expect(gate.message, gate.target).toMatch(/no submit record/);
      const verbs = gate.verbs!;
      // pin, pick and verdict for every agent, approve for Writer; each on the hand-placed and the submitted candidate.
      expect(verbs.map(run => `${run.case}:${run.verb}`).sort(), agent).toEqual(
        ["hand-placed", "submitted-uncertified"].flatMap(kind => ["pin", "pick", "verdict", ...(agent === "writer" ? ["approve"] : [])].map(verb => `${kind}:${verb}`)).sort());
      for (const run of verbs) {
        expect(run.exit, `${agent} ${run.case} ${run.verb}: ${run.message}`).not.toBe(0);
        expect(run.gated, `${agent} ${run.case} ${run.verb}: ${run.message}`).toBe(true);
      }
      // The submitted candidate reaches the certification: pin names its failing verdict, not a missing submit.
      expect(verbs.find(run => run.case === "submitted-uncertified" && run.verb === "pin")!.message).toMatch(/no passing verdict/);
      for (const verb of ["pick", "verdict", ...(agent === "writer" ? ["approve"] : [])]) {
        expect(verbs.find(run => run.case === "submitted-uncertified" && run.verb === verb)!.message, `${agent} ${verb}`).toMatch(/pinned only through the CHOOSE gate/);
      }
    }
    // The C3 cell reads the probe: green on these refusals, red once one agent's pin accepts.
    const facts = { emptyL2Detected: {}, requestVerb: true, critiqueMonorepoPath: false, iaContract: {}, pinGate: results };
    for (const agent of model.agents) expect(ASSERTIONS.C3!(agent, model, facts).rows.filter(row => row.startsWith("pin ") && row.includes("accepted")), agent.agent).toEqual([]);
    const writer = results.writer as PinGateResult;
    const opened = (verb: string, change: Partial<VerbProbe>) => ({ ...facts, pinGate: { ...results, writer: { ...writer, verbs: writer.verbs!.map(run => run.verb === verb && run.case === "submitted-uncertified" ? { ...run, ...change } : run) } } }) as ProbeFacts;
    const c3 = (given: ProbeFacts) => ASSERTIONS.C3!(model.agents.find(agent => agent.agent === "writer")!, model, given).rows;
    expect(c3(opened("approve", { exit: 0, gated: false }))).toContainEqual(expect.stringMatching(/^approve writer\/\S+ \S+ accepted a submitted candidate with no passing verdict \(exit 0\)$/));
    expect(c3(opened("pick", { exit: 1, gated: false, message: "pick refused: R02.2" }))).toContainEqual(expect.stringMatching(/^pick writer\/\S+ \S+ \(submitted-uncertified\) was refused before the CHOOSE gate \(exit 1\): pick refused: R02\.2$/));
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

describe("ia --contract probe (the real verb on a temporary copy)", { timeout: 60_000 }, () => {
  const model = readConformModel(REPO, FIXTURE);
  it("refuses an invalid contract for every agent through the kind's contract gate, and accepts one the gate passes (U5)", async () => {
    // SLOT-CREATE (foundry-build-0048 U5): a new leaf's contract must be valid for its kind family and name registered requirements.
    const refused = await probeIaContract(FIXTURE, model.agents);
    for (const agent of CONFORM_AGENTS) {
      const results = refused[agent] as { target: string; accepted: boolean; message: string }[];
      expect(Array.isArray(results), `${agent}: ${String(refused[agent])}`).toBe(true);
      for (const result of results) {
        expect(result.accepted, result.target).toBe(false);
        expect(result.message, result.target).toMatch(/contract \$\.requirements must be a non-empty list of \{check\} naming registered criteria \(contract-(brief|element|strings|page|publication)\)/);
        expect(isContractRefusal(result.message, result.target), result.target).toBe(true);
      }
    }
    // A clossys.slot-contract/1 contract that names a registered requirement but misses its fields is refused by the same path.
    const refusedAll = await probeIaContract(FIXTURE, model.agents, { schema: "clossys.slot-contract/1", requirements: [{ check: "text.nonempty" }] });
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
    // Mutation (the gate is not a blanket refusal): a contract naming a registered requirement is accepted for every family.
    const passed = await probeIaContract(FIXTURE, model.agents, { requirements: [{ check: "text.nonempty" }] });
    for (const agent of CONFORM_AGENTS) {
      const results = passed[agent] as { target: string; accepted: boolean; message: string }[];
      expect(Array.isArray(results), `${agent}: ${String(passed[agent])}`).toBe(true);
      for (const result of results) expect(result.accepted, `${result.target}: ${result.message}`).toBe(true);
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
