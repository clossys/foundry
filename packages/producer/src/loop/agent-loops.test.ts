/**
 * Agent-owned loops (foundry-build-0048 U9a): every content agent ships five loop candidates that extend Producer's
 * standard loops, and the agents' loops form one chain connected through Producer's loops.
 */
import { describe, expect, it } from "vitest";
import {
  AGENT_LOOPS, LOOP_AGENTS, agentLoopIssues, loopConnectedIssues, loopExtensionIssues, packageLoopSet, pathPattern, patternsMeet,
  readAgentPackageLoop, standardOf, type AgentLoopName, type LoopAgent, type LoopSet,
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
    expect(pkg("writer", "loop.scope").steps.map(step => step.id)).toEqual(["scope-writer", "demand"]);
    expect(pkg("publisher", "loop.slot").steps.map(step => step.id)).toEqual(["overlap", "decide-publisher", "sign", "place", "link"]);
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
    version.steps.splice(2, 0, { id: "self-review", does: "review the family before certification", decider: { by: "agent", agent: "designer", verb: "review", tier: "mid", skill: "packages/designer/actions/designer.candidates/skill.md" }, cli: "clossys next", reads: ["<slot>/candidates/*"], writes: ["<slot>/ledger.json"], checks: [] });
    expect(loopExtensionIssues("designer", "loop.create", version, standard("loop.create"))).toEqual([]);
  });
});

describe("loop.connected", () => {
  it("holds for the package loops: every output consumed, every handoff wired, cross-agent work only through Producer", () => {
    expect(loopConnectedIssues(packageLoopSet())).toEqual([]);
  });

  it("refuses a removed handoff consumer (mutation: designer no longer reads director pins)", () => {
    const set = packageLoopSet();
    const create = pkg("designer", "loop.create");
    for (const step of create.steps) step.reads = step.reads.filter(path => path !== "director/*/pin.json");
    const issues = loopConnectedIssues(withVersion(set, "designer", "loop.create", create));
    expect(issues).toContain("handoff director -> designer: no step of designer's loops reads what director's loops write (its pins); the chain is broken here");
  });

  it("refuses an output nothing consumes (mutation: writer create writes notes nobody reads)", () => {
    const create = pkg("writer", "loop.create");
    create.steps.find(step => step.id === "create")!.writes.push("<slot>/notes.md");
    expect(loopConnectedIssues(withVersion(packageLoopSet(), "writer", "loop.create", create))).toContain("writer/loop.create: step create writes <slot>/notes.md, which no Producer connection loop and no other agent's loop reads");
  });

  it("refuses an agent step writing another agent's slot (mutation: designer writes a writer slot)", () => {
    const create = pkg("designer", "loop.create");
    create.steps.find(step => step.id === "create")!.writes.push("writer/*/slot.json");
    expect(loopConnectedIssues(withVersion(packageLoopSet(), "designer", "loop.create", create)).some(issue => issue.startsWith("designer/loop.create: step create writes writer/*/slot.json, outside designer's tree"))).toBe(true);
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
    expect(pathPattern(".clossys/checks/", "*")).toEqual([".clossys", "checks", "**"]);
    expect(pathPattern("<dependant>/slot.json", "writer")).toEqual(["*", "*", "slot.json"]);
    expect(pathPattern("<inputs>", "designer")).toBeUndefined();
    expect(patternsMeet(["**", "pin.json"], ["designer", "*", "pin.json"])).toBe(true);
    expect(patternsMeet([".clossys", "checks", "**"], [".clossys", "checks", "designer", "*", "scorecard.json"])).toBe(true);
    expect(patternsMeet(["designer", "*", "notes.md"], ["*", "*", "slot.json"])).toBe(false);
    expect(patternsMeet(["*", "*", "candidates", "*"], ["writer", "*", "notes.md"])).toBe(false);
    expect(patternsMeet(["publisher", "release.*", "candidates", "*-v*.json"], ["publisher", "release.site", "candidates", "site-v2.json"])).toBe(true);
  });
});
