/**
 * Agent-owned loops (foundry-build-0048 U9a): every content agent ships five loop candidates that extend Producer's
 * standard loops, and the agents' loops form one chain connected through Producer's loops.
 */
import { describe, expect, it } from "vitest";
import {
  AGENT_LOOPS, LOOP_AGENTS, agentLoopIssues, agentWriteClass, loopConnectedIssues, loopExtensionIssues, packageLoopSet, pathPattern, patternsMeet,
  readAgentPackageLoop, readPatterns, requiredSteps, upstreamIssue, standardOf, type AgentLoopName, type LoopAgent, type LoopSet,
} from "./agent-loops.js";
import type { LoopVersion } from "../records/types.js";

const clone = <T>(value: T): T => structuredClone(value);
const pkg = (agent: LoopAgent, loop: AgentLoopName) => {
  const read = readAgentPackageLoop(agent, loop);
  if (!read.ok) throw new Error(read.reason);
  return clone(read.content) as LoopVersion;
};
const standard = (loop: AgentLoopName) => {
  const read = standardOf(loop);
  if (!read.ok) throw new Error(read.reason);
  return read.standard;
};
/** The refusal of a write only Producer writes (U9a fix round 3). */
const producerOnly = (ref: string, step: string, path: string, agent: string) => `${ref}: step ${step} writes ${path}, which only Producer writes; an agent step writes only new candidates, its clossys/.state/checks/${agent}/<slot>/scratch/ and new producer/queue.slot entries`;
/** The package set with one agent loop replaced. */
const withVersion = (set: LoopSet, agent: LoopAgent, loop: AgentLoopName, content: unknown): LoopSet => {
  const versions = new Map([...set.versions].map(([name, loops]) => [name, new Map(loops)] as const));
  versions.get(agent)!.set(loop, content);
  return { ...set, versions };
};

describe("agent package loop candidates", () => {
  it.each(LOOP_AGENTS.flatMap(agent => AGENT_LOOPS.map(loop => [agent, loop] as const)))("%s/%s extends Producer's standard and can run", (agent, loop) => {
    const read = readAgentPackageLoop(agent, loop);
    expect(read.ok ? [] : [read.reason]).toEqual([]);
    expect(agentLoopIssues(agent, loop, read.ok ? read.content : undefined, { packageVersion: true })).toEqual([]);
  });

  it("names the agent on its own steps and drops the other agents' steps", () => {
    const create = pkg("designer", "loop.create");
    expect(create.steps.filter(step => step.decider.by === "agent").map(step => step.decider.by === "agent" && step.decider.agent)).toEqual(["designer", "designer"]);
    expect(pkg("writer", "loop.scope").steps.map(step => step.id)).toEqual(["demand", "scope-writer"]);
    expect(pkg("publisher", "loop.slot").steps.map(step => step.id)).toEqual(["overlap", "match", "decide-publisher", "sign", "place", "link"]);
  });
});

describe("loopExtensionIssues", () => {
  it("refuses a dropped required step (mutation: drop certify from designer/loop.create)", () => {
    const version = pkg("designer", "loop.create");
    version.steps = version.steps.filter(step => step.id !== "certify");
    expect(loopExtensionIssues("designer", "loop.create", version, standard("loop.create"))).toContain("designer/loop.create: drops required step certify of producer/loop.create");
  });

  it("refuses a dropped exit check and a changed failure route", () => {
    const version = pkg("writer", "loop.choose");
    const rank = version.steps.find(step => step.id === "rank")!;
    rank.checks = [];
    rank.onFail = { raise: "queue.clarify", then: "retry" };
    const issues = loopExtensionIssues("writer", "loop.choose", version, standard("loop.choose"));
    expect(issues).toContain("writer/loop.choose: step rank drops exit check candidates.certified");
    expect(issues.some(issue => issue.includes("step rank changes its failure route"))).toBe(true);
  });

  it("refuses dropping or narrowing an owner-class when", () => {
    const dropped = pkg("director", "loop.choose");
    delete (dropped.steps.find(step => step.id === "owner-pick") as { when?: unknown }).when;
    expect(loopExtensionIssues("director", "loop.choose", dropped, standard("loop.choose")).some(issue => issue.includes("owner-pick drops its when"))).toBe(true);
    const narrowed = pkg("director", "loop.choose");
    narrowed.steps.find(step => step.id === "owner-pick")!.when = { ia: [], slots: ["writer/narratives.legal-document"] };
    expect(loopExtensionIssues("director", "loop.choose", narrowed, standard("loop.choose"))).toContain("director/loop.choose: step owner-pick drops when.ia director");
  });

  it("refuses an owner step handed to an agent and another agent's step", () => {
    const version = pkg("designer", "loop.choose");
    const confirm = version.steps.find(step => step.id === "confirm")!;
    confirm.decider = { by: "agent", agent: "designer", verb: "pick", tier: "mid", skill: "packages/designer/actions/pick.designer/skill.md" };
    expect(loopExtensionIssues("designer", "loop.choose", version, standard("loop.choose")).some(issue => issue.includes("step confirm is decided by agent"))).toBe(true);
    const scope = pkg("designer", "loop.scope");
    scope.steps.unshift(clone(standard("loop.scope").steps.find(step => step.id === "scope-writer")!));
    expect(loopExtensionIssues("designer", "loop.scope", scope, standard("loop.scope")).some(issue => issue.includes("scope-writer is writer's step"))).toBe(true);
  });

  it("lets the agent change its own steps' skill, tier and reads, and add a step of its own", () => {
    const version = pkg("designer", "loop.create");
    const create = version.steps.find(step => step.id === "create")!;
    if (create.decider.by === "agent") create.decider.tier = "high";
    create.reads = [...create.reads, "designer/ia.json"];
    version.steps.splice(2, 0, { id: "self-review", does: "review the family before certification", decider: { by: "agent", agent: "designer", verb: "review", tier: "mid", skill: "packages/designer/actions/designer.candidates/skill.md" }, cli: "clossys next", reads: ["<slot>/candidates/*"], writes: ["clossys/.state/checks/<agent>/<slot-id>/scratch/review.json"], checks: [] });
    expect(loopExtensionIssues("designer", "loop.create", version, standard("loop.create"))).toEqual([]);
  });
});

describe("loopExtensionIssues: rounds, order, when, exit (U9a fix round 1)", () => {
  const issues = (agent: LoopAgent, loop: AgentLoopName, version: LoopVersion) => loopExtensionIssues(agent, loop, version, standard(loop));
  it("refuses more rounds than the standard allows, and a non-whole round count", () => {
    const more = pkg("writer", "loop.create");
    more.maxRounds = standard("loop.create").maxRounds + 1;
    expect(issues("writer", "loop.create", more)).toEqual([`writer/loop.create: maxRounds ${more.maxRounds} exceeds the standard's ${standard("loop.create").maxRounds}`]);
    const fewer = pkg("writer", "loop.create");
    fewer.maxRounds = 1;
    expect(issues("writer", "loop.create", fewer)).toEqual([]);
    const none = pkg("writer", "loop.create");
    none.maxRounds = 0;
    expect(issues("writer", "loop.create", none)).toEqual(["writer/loop.create: maxRounds must be a whole number of rounds (1 or more)"]);
  });
  it("refuses required steps run out of the standard's order", () => {
    const version = pkg("designer", "loop.choose");
    const at = (id: string) => version.steps.findIndex(step => step.id === id);
    const [pick] = version.steps.splice(at("pick"), 1);
    version.steps.splice(at("rank"), 0, pick!);
    expect(issues("designer", "loop.choose", version)).toContain("designer/loop.choose: step pick runs before a required step the standard runs first (the standard's order is kept)");
  });
  it("refuses a when added to a standard step that runs for every subject", () => {
    const version = pkg("publisher", "loop.create");
    version.steps.find(step => step.id === "certify")!.when = { ia: ["publisher/pages"] };
    expect(issues("publisher", "loop.create", version)).toEqual(["publisher/loop.create: step certify adds a when; the standard runs it for every subject"]);
  });
  it("refuses a changed exit or repeat, a failure route added to a step without one, and changed code-step reads", () => {
    const version = pkg("director", "loop.choose");
    version.exit = "whenever the agent likes";
    version.repeat = "never";
    version.steps.find(step => step.id === "pick")!.onFail = { raise: "queue.fix", then: "retry" };
    version.steps.find(step => step.id === "cascade")!.reads = [];
    expect(issues("director", "loop.choose", version)).toEqual([
      `director/loop.choose: changes the standard's exit (${standard("loop.choose").exit})`,
      `director/loop.choose: changes the standard's repeat (${standard("loop.choose").repeat})`,
      "director/loop.choose: step pick adds a failure route; the standard stops the run when it fails",
      "director/loop.choose: step cascade changes what the code step reads",
    ]);
  });
});

describe("loopExtensionIssues: the owner gate, route steps and write paths (U9a fix round 1)", () => {
  const issues = (agent: LoopAgent, loop: AgentLoopName, version: LoopVersion) => loopExtensionIssues(agent, loop, version, standard(loop));
  const added = (agent: LoopAgent, extra: Partial<LoopVersion["steps"][number]>) => ({
    id: "extra", does: "an added step", decider: { by: "agent" as const, agent, verb: "review" as const, tier: "low" as const }, cli: "clossys next", reads: [], writes: [], checks: [], ...extra,
  });
  it("refuses an agent step after the owner's confirm that re-pins the slot (writes <slot>/pin.json or runs clossys pin)", () => {
    const writes = pkg("director", "loop.choose");
    writes.steps.splice(writes.steps.findIndex(step => step.id === "confirm") + 1, 0, added("director", { id: "repin", writes: ["<slot>/pin.json"] }));
    expect(issues("director", "loop.choose", writes)).toEqual([producerOnly("director/loop.choose", "repin", "<slot>/pin.json", "director")]);
    const glob = pkg("director", "loop.choose");
    glob.steps.push(added("director", { id: "tidy", writes: ["<slot>/"] }));
    expect(issues("director", "loop.choose", glob)).toEqual([producerOnly("director/loop.choose", "tidy", "<slot>/", "director")]);
    const cli = pkg("director", "loop.choose");
    cli.steps.push(added("director", { id: "repin", cli: "clossys pin <ref> <candidate> --by agent:director" }));
    expect(issues("director", "loop.choose", cli)).toEqual(["director/loop.choose: step repin runs clossys pin <ref> <candidate> --by agent:director; only the standard's own step pins or answers, as the standard has it (the owner's choose gate)"]);
    // The standard's own pick step keeps its pin write and cli.
    expect(issues("director", "loop.choose", pkg("director", "loop.choose"))).toEqual([]);
    const answer = pkg("designer", "loop.create");
    answer.steps.push(added("designer", { id: "self-confirm", cli: "clossys answer queue.approve#x --yes" }));
    expect(issues("designer", "loop.create", answer).some(issue => issue.includes("step self-confirm runs clossys answer"))).toBe(true);
  });
  it("refuses an agent step that runs a Producer code step's cli (route, cascade, strict, ia sync)", () => {
    for (const cli of ["clossys check --route", "clossys check <dependants>", "clossys check --strict", "clossys ia sync"]) {
      const version = pkg("writer", "loop.create");
      version.steps.splice(version.steps.findIndex(step => step.id === "create") + 1, 0, added("writer", { id: "hand-on", cli }));
      expect(issues("writer", "loop.create", version), cli).toContain(`writer/loop.create: step hand-on runs ${cli}, a Producer code step; an agent step never routes, cascades, syncs, settles or judges the tree`);
    }
  });
  it("refuses a route step after a step the standard does not route (a failed required step would pass on)", () => {
    const version = pkg("writer", "loop.create");
    version.steps.splice(version.steps.findIndex(step => step.id === "create") + 1, 0, added("writer", { id: "route", cli: "clossys check --route", decider: { by: "code" } as never }));
    expect(issues("writer", "loop.create", version)).toContain("writer/loop.create: step route routes the findings of create, which the standard does not; a failed step would pass on");
  });
  it("refuses a write outside the tree or into another agent's tree after normalization", () => {
    for (const path of ["../writer/voice.tone/slot.json", "designer/../writer/voice.tone/slot.json", "/etc/passwd", "<slot>/../../writer/x/slot.json"]) {
      const version = pkg("designer", "loop.create");
      version.steps.push(added("designer", { id: "stray", writes: [path] }));
      expect(issues("designer", "loop.create", version), path).toEqual([`designer/loop.create: step stray writes ${path}, outside the tree (absolute or through ..)`]);
    }
    const other = pkg("designer", "loop.create");
    other.steps.push(added("designer", { id: "stray", writes: ["clossys/agents/./writer/voice.tone/slot.json"] }));
    expect(issues("designer", "loop.create", other)).toEqual([producerOnly("designer/loop.create", "stray", "clossys/agents/./writer/voice.tone/slot.json", "designer")]);
  });
});

describe("agent write roots: a glob or placeholder that can reach another agent's tree (U9a fix round 2)", () => {
  const issues = (agent: LoopAgent, loop: AgentLoopName, version: LoopVersion) => loopExtensionIssues(agent, loop, version, standard(loop));
  const added = (agent: LoopAgent, extra: Partial<LoopVersion["steps"][number]>) => ({
    id: "extra", does: "an added step", decider: { by: "agent" as const, agent, verb: "review" as const, tier: "low" as const }, cli: "clossys next", reads: [], writes: [], checks: [], ...extra,
  });
  const REACHING = ["*/*/slot.json", "<dependant>/slot.json", "<requester>/notes.md", "clossys/agents/*/hero/slot.json", "*/", "<inputs>", "clossys/.state/checks/writer/x/scorecard.json", "clossys/.state/checks/*/x/scorecard.json", "clossys/.state/other/x.json", "producer/queue.*/entries/x.json", "producer/pins/x.json", "notes/x.md"];
  it("refuses, at load and at the pin gate, a declared write that could land outside the agent's own roots", () => {
    for (const path of REACHING) {
      const version = pkg("designer", "loop.create");
      version.steps.push(added("designer", { id: "reach", writes: [path] }));
      expect(issues("designer", "loop.create", version), path).toContain(producerOnly("designer/loop.create", "reach", path, "designer"));
    }
  });
  it("loop.connected (d) judges an agent write by the same roots", () => {
    for (const path of ["*/*/slot.json", "<dependant>/slot.json", "clossys/.state/checks/writer/x/scorecard.json"]) {
      const create = pkg("designer", "loop.create");
      create.steps.find(step => step.id === "create")!.writes.push(path);
      expect(loopConnectedIssues(withVersion(packageLoopSet(), "designer", "loop.create", create)), path).toContain(producerOnly("designer/loop.create", "create", path, "designer"));
    }
  });
  it("refuses an added step that runs clossys verdict, pick or approve (each pins)", () => {
    for (const cli of ["clossys verdict <ref> pass --by agent:director", "clossys pick <ref> <candidate>", "clossys approve <ref>"]) {
      const version = pkg("director", "loop.choose");
      version.steps.splice(version.steps.findIndex(step => step.id === "confirm") + 1, 0, added("director", { id: "self-pin", cli }));
      expect(issues("director", "loop.choose", version), cli).toEqual([`director/loop.choose: step self-pin runs ${cli}; only the standard's own step pins or answers, as the standard has it (the owner's choose gate)`]);
    }
  });
});

describe("agent write allowlist (U9a fix round 3)", () => {
  const issues = (agent: LoopAgent, loop: AgentLoopName, version: LoopVersion) => loopExtensionIssues(agent, loop, version, standard(loop));
  const added = (agent: LoopAgent, extra: Partial<LoopVersion["steps"][number]>) => ({
    id: "extra", does: "an added step", decider: { by: "agent" as const, agent, verb: "review" as const, tier: "low" as const }, cli: "clossys next", reads: [], writes: [], checks: [], ...extra,
  });
  const refused = (path: string, loop: AgentLoopName = "loop.choose") => {
    const version = pkg("designer", loop);
    version.steps.push(added("designer", { id: "extra", writes: [path] }));
    expect(issues("designer", loop, version), path).toContain(producerOnly(`designer/${loop}`, "extra", path, "designer"));
  };
  it("T1: refuses the owner's answer queues and routed findings (only queue.slot is an agent's)", () => {
    for (const path of ["producer/queue.approve/entries/<entry>.json", "producer/queue.pick/entries/*", "producer/queue.clarify/entries/x.json", "producer/queue.fix/entries/x.json"]) refused(path);
  });
  it("T2: refuses Producer's verdict files in the agent's own check folder", () => {
    for (const path of ["clossys/.state/checks/<agent>/<slot-id>/cascade.json", "clossys/.state/checks/<agent>/<slot-id>/certify.json", "clossys/.state/checks/<agent>/<slot-id>/scorecard.json", "clossys/.state/checks/<agent>/<slot-id>/<candidate>.json", "clossys/.state/checks/designer/x/extra.json", "clossys/.state/checks/<agent>/<slot-id>/other/x.json"]) refused(path);
  });
  it("T3 (B3): refuses Producer's records in the agent's own tree (slot record, pin, ledgers, retired, critiques, IA, loop pins)", () => {
    for (const path of ["<slot>/slot.json", "<slot>/pin.json", "<slot>/ledger.json", "<slot>/retired/x.json", "<slot>/critiques/x.json", "<slot>/notes.md", "designer/ia.json", "designer/ledger.json", "designer/loop.choose/pin.json", "<slot>/", "<slot>/*", "<slot>/candidates/", "<slot>/candidates/sub/x.json"]) refused(path);
  });
  it("T4: keeps new candidates, the agent's check scratch and new slot requests", () => {
    for (const path of ["<slot>/candidates/<name>-v<n>.json", "designer/hero/candidates/x-v2.md", "clossys/.state/checks/<agent>/<slot-id>/scratch/notes.json", "producer/queue.slot/entries/<request>.json"]) {
      const version = pkg("designer", "loop.create");
      version.steps.push(added("designer", { id: "own", writes: [path] }));
      expect(issues("designer", "loop.create", version), path).toEqual([]);
    }
    expect(agentWriteClass(pathPattern("<slot>/candidates/<name>-v<n>.json", "designer")!, "designer")).toBe("candidate");
    expect(agentWriteClass(pathPattern("clossys/.state/checks/<agent>/<slot-id>/scratch/notes.json", "designer")!, "designer")).toBe("check-scratch");
    expect(agentWriteClass(pathPattern("producer/queue.slot/entries/<request>.json", "designer")!, "designer")).toBe("queue-slot");
    expect(agentWriteClass(pathPattern("writer/hero/candidates/x-v2.md", "designer")!, "designer")).toBeUndefined();
  });
  it("T5: the standard's own step keeps exactly the writes its standard declares, and no more", () => {
    expect(issues("director", "loop.choose", pkg("director", "loop.choose"))).toEqual([]);
    const cascade = pkg("director", "loop.choose");
    cascade.steps.find(step => step.id === "pick")!.writes.push("clossys/.state/checks/<agent>/<slot-id>/cascade.json");
    expect(issues("director", "loop.choose", cascade)).toEqual([producerOnly("director/loop.choose", "pick", "clossys/.state/checks/<agent>/<slot-id>/cascade.json", "director")]);
    const brief = pkg("director", "loop.create");
    brief.steps.find(step => step.id === "refine-brief")!.writes.push("<slot>/pin.json");
    expect(issues("director", "loop.create", brief)).toEqual([producerOnly("director/loop.create", "refine-brief", "<slot>/pin.json", "director")]);
  });
  it("T6: loop.connected (d) refuses the same writes, and the package set stays connected", () => {
    expect(loopConnectedIssues(packageLoopSet())).toEqual([]);
    for (const path of ["clossys/.state/checks/designer/<slot-id>/cascade.json", "producer/queue.approve/entries/x.json"]) {
      const create = pkg("designer", "loop.create");
      create.steps.find(step => step.id === "create")!.writes.push(path);
      expect(loopConnectedIssues(withVersion(packageLoopSet(), "designer", "loop.create", create)), path).toContain(producerOnly("designer/loop.create", "create", path, "designer"));
    }
  });
  it("T7: loop.connected (c) flags a code step in an agent loop that writes an owner answer queue", () => {
    const create = pkg("designer", "loop.create");
    create.steps.find(step => step.id === "certify")!.writes.push("producer/queue.approve/entries/x.json");
    expect(loopConnectedIssues(withVersion(packageLoopSet(), "designer", "loop.create", create))).toContain("designer/loop.create: step certify writes producer/queue.approve/entries/x.json across agent trees; only Producer's own request, cascade and release steps do");
  });
  it("T8: refuses a pinning or answering cli however it is spaced, and retire", () => {
    for (const cli of ["clossys\tpin <ref> x", "clossys  answer <entry> approve", "clossys retire <ref>"]) {
      const version = pkg("designer", "loop.create");
      version.steps.push(added("designer", { id: "sneak", cli }));
      expect(issues("designer", "loop.create", version), JSON.stringify(cli)).toEqual([`designer/loop.create: step sneak runs ${cli.trim().split(/\s+/).join(" ")}; only the standard's own step pins or answers, as the standard has it (the owner's choose gate)`]);
    }
  });
});

describe("loop.connected", () => {
  it("holds for the package loops: every output consumed, every handoff wired, cross-agent work only through Producer", () => {
    expect(loopConnectedIssues(packageLoopSet())).toEqual([]);
  });

  it("refuses a removed handoff consumer (mutation: designer no longer reads director pins)", () => {
    const set = packageLoopSet();
    const broken = "handoff director -> designer: no step of designer's loops reads what director's loops write (its pins); the chain is broken here";
    const create = pkg("designer", "loop.create"), choose = pkg("designer", "loop.choose");
    for (const step of [...create.steps, ...choose.steps]) step.reads = step.reads.filter(path => path !== "director/*/pin.json");
    // Create and choose both read Director's pins: either one alone keeps the handoff.
    expect(loopConnectedIssues(withVersion(set, "designer", "loop.create", create))).not.toContain(broken);
    const issues = loopConnectedIssues(withVersion(withVersion(set, "designer", "loop.create", create), "designer", "loop.choose", choose));
    expect(issues).toContain(broken);
  });

  it("Producer's standard create and choose read the pins upstream of the slot's owner (<upstream>), never for Director", () => {
    expect(readPatterns("<upstream>/*/pin.json", "designer")).toEqual([["director", "*", "pin.json"]]);
    expect(readPatterns("<upstream>/*/pin.json", "writer")).toEqual([["director", "*", "pin.json"]]);
    expect(readPatterns("<upstream>/*/pin.json", "publisher")).toEqual([["designer", "*", "pin.json"], ["writer", "*", "pin.json"]]);
    expect(readPatterns("<upstream>/*/pin.json", "director")).toEqual([]);
    expect(readPatterns("<slot>/slot.json", "writer")).toEqual([["writer", "*", "slot.json"]]);
    // A set whose agents run only Producer's standards (what a consumer holding no loop slots runs) wires every handoff.
    const set = packageLoopSet();
    const standards = new Map([...set.versions].map(([agent, loops]) => [agent, new Map([...loops].map(([loop]) => {
      const own = standard(loop);
      return [loop, { ...own, steps: requiredSteps(own, agent) }] as const;
    }))] as const));
    expect(loopConnectedIssues({ ...set, versions: standards }).filter(issue => issue.startsWith("handoff "))).toEqual([]);
    // Mutation: the standards' upstream reads dropped, the Director handoffs break.
    const dropped = new Map([...standards].map(([agent, loops]) => [agent, new Map([...loops].map(([loop, version]) => [loop, { ...version, steps: version.steps.map(step => ({ ...step, reads: (step.reads ?? []).filter(path => !path.startsWith("<upstream>")) })) }] as const))] as const));
    expect(loopConnectedIssues({ ...set, versions: dropped }).filter(issue => issue.startsWith("handoff director"))).toHaveLength(2);
  });

  it("judges a chain handoff only between two agents the consumer runs (set.runs)", () => {
    // Every agent runs the standards with no upstream read, so every handoff is broken.
    const set = packageLoopSet();
    const broken = new Map([...set.versions].map(([agent, loops]) => [agent, new Map([...loops].map(([loop]) => {
      const own = standard(loop);
      return [loop, { ...own, steps: requiredSteps(own, agent).map(step => ({ ...step, reads: (step.reads ?? []).filter(path => !path.startsWith("<upstream>")) })) }] as const;
    }))] as const));
    const handoffs = (runs?: ReadonlySet<"director" | "designer" | "writer" | "publisher">) =>
      loopConnectedIssues({ ...set, versions: broken, ...(runs ? { runs } : {}) }).filter(issue => issue.startsWith("handoff ")).map(issue => issue.split(":")[0]);
    const all = ["handoff designer -> publisher", "handoff director -> designer", "handoff director -> writer", "handoff writer -> publisher"];
    // No runs (every agent) and all four run: every broken handoff is reported.
    expect(handoffs().sort()).toEqual(all);
    expect(handoffs(new Set(["director", "designer", "writer", "publisher"])).sort()).toEqual(all);
    // Publisher is not run: its two handoffs are no chain the consumer runs; the Director ones are still judged.
    expect(handoffs(new Set(["director", "designer", "writer"])).sort()).toEqual(["handoff director -> designer", "handoff director -> writer"]);
    // Director is not run: only the handoffs into Publisher are judged.
    expect(handoffs(new Set(["designer", "writer", "publisher"])).sort()).toEqual(["handoff designer -> publisher", "handoff writer -> publisher"]);
  });

  it("refuses <upstream> anywhere but the first segment of a read path, and in any write", () => {
    expect(upstreamIssue("<upstream>/*/pin.json", "read")).toBeUndefined();
    expect(upstreamIssue("director/*/pin.json", "read")).toBeUndefined();
    for (const path of ["clossys/agents/<upstream>/*/pin.json", "designer/<upstream>/pin.json", "<upstream>x/*/pin.json", "<upstream>/<upstream>/pin.json"]) {
      expect(upstreamIssue(path, "read"), path).toBe("<upstream> stands only as the first segment of a read path");
      // It reads nothing: never a `*` standing for every agent.
      expect(readPatterns(path, "designer"), path).toEqual([]);
    }
    expect(upstreamIssue("<upstream>/*/notes.md", "write")).toBe("<upstream> names only a read");
    // loop.connected reports a misplaced one in an agent's own loop.
    const create = pkg("designer", "loop.create");
    create.steps.find(step => step.id === "create")!.reads.push("clossys/agents/<upstream>/*/pin.json");
    expect(loopConnectedIssues(withVersion(packageLoopSet(), "designer", "loop.create", create))).toContain("designer/loop.create: step create reads clossys/agents/<upstream>/*/pin.json; <upstream> stands only as the first segment of a read path");
    // U26 r2 (blind B N5): the version does not load either: agentLoopIssues refuses a misplaced read and any write.
    expect(agentLoopIssues("designer", "loop.create", create, { packageVersion: true })).toContain("designer/loop.create: step create reads clossys/agents/<upstream>/*/pin.json; <upstream> stands only as the first segment of a read path");
    const writes = pkg("designer", "loop.create");
    writes.steps.find(step => step.id === "create")!.writes.push("<upstream>/*/notes.md");
    expect(agentLoopIssues("designer", "loop.create", writes, { packageVersion: true })).toContain("designer/loop.create: step create writes <upstream>/*/notes.md; <upstream> names only a read");
    // A leading <upstream> read, the standard's own shape, still loads.
    expect(agentLoopIssues("designer", "loop.create", pkg("designer", "loop.create"), { packageVersion: true })).toEqual([]);
  });

  it("refuses an output nothing consumes (mutation: writer create writes notes nobody reads)", () => {
    const create = pkg("writer", "loop.create");
    create.steps.find(step => step.id === "create")!.writes.push("<slot>/notes.md");
    expect(loopConnectedIssues(withVersion(packageLoopSet(), "writer", "loop.create", create))).toContain("writer/loop.create: step create writes <slot>/notes.md, which no Producer connection loop and no other agent's loop reads");
  });

  it("refuses an agent step writing another agent's slot (mutation: designer writes a writer slot)", () => {
    const create = pkg("designer", "loop.create");
    create.steps.find(step => step.id === "create")!.writes.push("writer/*/slot.json");
    expect(loopConnectedIssues(withVersion(packageLoopSet(), "designer", "loop.create", create))).toContain(producerOnly("designer/loop.create", "create", "writer/*/slot.json", "designer"));
  });

  it("refuses a Producer step changed to write across trees, and a missing loop", () => {
    const choose = pkg("publisher", "loop.choose");
    choose.steps.find(step => step.id === "rank")!.writes.push("<dependant>/slot.json");
    expect(loopConnectedIssues(withVersion(packageLoopSet(), "publisher", "loop.choose", choose)).some(issue => issue.includes("step rank writes <dependant>/slot.json across agent trees"))).toBe(true);
    const set = packageLoopSet();
    const versions = new Map([...set.versions].map(([name, loops]) => [name, new Map(loops)] as const));
    versions.get("writer")!.delete("loop.cascade");
    expect(loopConnectedIssues({ ...set, versions })).toContain("writer/loop.cascade: the agent holds no version of loop.cascade");
  });

  it("matches paths segment-wise: a star is one segment, a double star (directory prefix, every slot's pin) spans", () => {
    expect(pathPattern("<slot>/pin.json", "designer")).toEqual(["designer", "*", "pin.json"]);
    expect(pathPattern("clossys/agents/*/pin.json", "*")).toEqual(["**", "pin.json"]);
    expect(pathPattern("clossys/.state/checks/", "*")).toEqual(["clossys", ".state", "checks", "**"]);
    expect(pathPattern("<dependant>/slot.json", "writer")).toEqual(["*", "*", "slot.json"]);
    expect(pathPattern("<inputs>", "designer")).toBeUndefined();
    expect(patternsMeet(["**", "pin.json"], ["designer", "*", "pin.json"])).toBe(true);
    expect(patternsMeet(["clossys", ".state", "checks", "**"], ["clossys", ".state", "checks", "designer", "*", "scorecard.json"])).toBe(true);
    expect(patternsMeet(["designer", "*", "notes.md"], ["*", "*", "slot.json"])).toBe(false);
    expect(patternsMeet(["*", "*", "candidates", "*"], ["writer", "*", "notes.md"])).toBe(false);
    expect(patternsMeet(["publisher", "release.*", "candidates", "*-v*.json"], ["publisher", "release.site", "candidates", "site-v2.json"])).toBe(true);
  });
});
