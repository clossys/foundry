/**
 * `clossys loop <agent>/loop.<name>` and the agent loop tree checks (foundry-build-0048 U9a): the verb adopts the
 * agent's five loop slots and pins each through the pin gate, the runner then runs the agent's pinned version, and
 * `loop.agent-standard` / `loop.connected` refuse a consumer whose agent loops are missing, unpinned, drop a required
 * step or break the chain.
 */
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// Load the CLI first, as every caller does: owner.ts sits in an import cycle with the pipeline handlers.
import "./main.js";
import { runLoopCli } from "./loop.js";
import { runIaCli } from "./owner.js";
import { runLoopAgentStandard, runLoopConnected } from "../check/loop-connected.js";
import { AGENT_LOOPS, LOOP_AGENTS, standardOf } from "../loop/agent-loops.js";
import { inOwnWriteRoot, planRun, resumeRun, routeHandsOn, startRun, undeclaredWrites, type AgentOutcome, type RunHooks } from "../loop/runner.js";
import { runCli } from "./main.js";
import { FIXTURE_CONSUMER_ROOT } from "../records/slot-model/fixture-consumer.test.js";
import { readiness } from "../records/slots.js";
import { refVerbatimSuite } from "../check/record-suites.js";
import { runConstitution } from "../constitution/run.js";
import { NO_HISTORY } from "../constitution/__fixtures__/workspace.js";

const AT = "2026-11-17T12:00:00Z";
const temps: string[] = [];
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function copy(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "agent-loops-cli-")));
  temps.push(root);
  cpSync(join(FIXTURE_CONSUMER_ROOT, "clossys"), join(root, "clossys"), { recursive: true });
  return root;
}
function tree(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) tree(path, base, out); else out[relative(base, path)] = readFileSync(path, "utf8");
  }
  return out;
}
const slotDir = (root: string, agent: string, loop: string) => join(root, "clossys", "agents", agent, loop);
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const loop = (root: string, target: string, ...extra: string[]) => runLoopCli([target, "--root", root, "--at", AT, ...extra], root);

/**
 * Each test adopts and pins loops through the built CLI paths: measured 0.4-11 s alone (the constitution test is the
 * slowest), past vitest's 5 s default. 30 s leaves the full suite's parallel load room without hiding a hang.
 */
const LONG = 30_000;

describe("clossys loop", () => {
  it("adopts the agent's five loop slots, pins each through the gate, and the runner runs the agent's pin", async () => {
    const root = copy();
    const result = await loop(root, "director/loop.create");
    expect(result.exitCode, result.message).toBe(0);
    // The verdict is the runner's own plan for one of director's slots, not a load the verb steers.
    expect(result.message).toMatch(/^VERDICT: PASS director\/loop\.create runs director\/loop\.create\/create-v1\.json \(planned for director\/[a-z.-]+; pinned, extends producer\/loop\.create\)/);
    expect(result.message).toContain("adopted director's five loop slots");
    for (const each of AGENT_LOOPS) {
      const pin = readJson(join(slotDir(root, "director", each), "pin.json"));
      // A planner-basis pin the gate wrote: certified, scored, recorded; never hand-placed.
      expect(pin, each).toMatchObject({ schema: "clossys.pin/2", basis: "planner", decidedBy: "planner:package-default", createdBy: { cli: "clossys pin" } });
      expect(readJson(join(slotDir(root, "director", each), "slot.json")), each).toMatchObject({ kind: "loop", standard: "loop", contract: { loop: each, extends: `producer/${each}` } });
    }
    // An agent loop slot is a readiness root: it extends Producer's standard and no upstream pin feeds it.
    for (const each of AGENT_LOOPS) expect(readiness(join(root, "clossys"), "director", each), each).toEqual({ ready: true, blockedBy: [] });
    // Director is clean; designer and writer, which the fixture's IA places, have not adopted theirs yet (no vacuous
    // pass). The fixture's Publisher IA is empty: it places nothing, so publisher owes no loop slots.
    const findings = runLoopAgentStandard(root).findings;
    expect(findings.filter(finding => finding.subject.startsWith("director/"))).toEqual([]);
    expect(new Set(findings.map(finding => finding.subject.split("/")[0]))).toEqual(new Set(["designer", "writer"]));
  }, LONG);

  it("is idempotent: a second run adopts and pins nothing and writes no byte", async () => {
    const root = copy();
    expect((await loop(root, "writer/loop.choose")).exitCode).toBe(0);
    const before = tree(join(root, "clossys"));
    const again = await loop(root, "writer/loop.choose", "--at", "2026-11-18T00:00:00Z");
    expect(again.exitCode, again.message).toBe(0);
    expect(again.message).not.toContain("adopted");
    expect(again.message).not.toContain("pinned writer/");
    expect(tree(join(root, "clossys"))).toEqual(before);
  }, LONG);

  it("--check writes nothing and fails on a consumer that holds no agent loops", async () => {
    const root = copy();
    const before = tree(join(root, "clossys"));
    const result = await loop(root, "publisher/loop.create", "--check");
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/^VERDICT: FAIL publisher\/loop\.create/);
    expect(result.message).toContain("holds no publisher loop slots");
    expect(tree(join(root, "clossys"))).toEqual(before);
    // No vacuous pass: the fixture's IA places director, designer and writer (Publisher's IA is empty) and holds none
    // of their loop slots, so loop.agent-standard is red with every loop of those three missing. The loops that run
    // are Producer's standards, which wire no agent handoff of their own, so loop.connected is red too.
    const missing = runLoopAgentStandard(root).findings;
    expect(missing).toHaveLength(3 * AGENT_LOOPS.length);
    expect(missing.some(finding => finding.subject.startsWith("publisher/"))).toBe(false);
    for (const finding of missing) expect(finding.detail, finding.subject).toMatch(/^missing: the consumer places [a-z]+ but holds none of its loop slots/);
    // Handoffs are judged only between agents the consumer runs: publisher, unplaced, is in none.
    expect(runLoopConnected(root).findings.map(finding => finding.subject)).toEqual(["handoff director -> designer", "handoff director -> writer"]);
  }, LONG);

  it("never replaces a pin that is there but does not resolve (an owner pin stays the owner's)", async () => {
    const root = copy();
    expect((await loop(root, "writer/loop.create")).exitCode).toBe(0);
    const file = join(slotDir(root, "writer", "loop.choose"), "pin.json");
    const pin = readJson(file);
    const broken = `${JSON.stringify({ ...pin, decidedBy: "owner:2026-11-17", basis: "picked", sha256: "0".repeat(64) }, null, 2)}\n`;
    writeFileSync(file, broken);
    const again = await loop(root, "writer/loop.create", "--at", "2026-11-18T00:00:00Z");
    expect(again.exitCode).toBe(1);
    expect(again.message).toContain("writer/loop.choose holds a pin that does not resolve");
    expect(readFileSync(file, "utf8")).toBe(broken);
  }, LONG);

  it("ia sync keeps an adopted agent's loops L1 and its loop slots: they are Producer-standard, not package leaves", async () => {
    const root = copy();
    expect((await loop(root, "writer/loop.create")).exitCode).toBe(0);
    const iaBefore = readFileSync(join(root, "clossys", "agents", "writer", "ia.json"), "utf8");
    const sync = await runIaCli(["sync", "--root", root], root);
    expect(sync.exitCode, sync.message).toBe(0);
    const ia = readJson(join(root, "clossys", "agents", "writer", "ia.json"));
    expect(JSON.stringify(ia)).toContain("loop.cascade");
    for (const each of AGENT_LOOPS) expect(readJson(join(slotDir(root, "writer", each), "pin.json")).candidate, each).toMatch(/-v1\.json$/);
    expect((await loop(root, "writer/loop.create", "--check")).exitCode).toBe(0);
    expect(iaBefore).toContain("loop.cascade");
  }, LONG);

  it("refuses a target that is no agent loop", async () => {
    const root = copy();
    await expect(loop(root, "producer/loop.create")).rejects.toThrow(/no agent loop/);
    await expect(loop(root, "designer/loop.release")).rejects.toThrow(/no agent loop/);
  }, LONG);
});

describe("the constitution on adopted agent loops", () => {
  it("judges each adopted, gate-pinned loop slot by its own standard: no copy, lineage, immutability, cascade or derivation row", async () => {
    const root = copy();
    for (const agent of LOOP_AGENTS) expect((await loop(root, `${agent}/loop.create`)).exitCode, agent).toBe(0);
    const focus = LOOP_AGENTS.flatMap(agent => AGENT_LOOPS.map(slot => ({ agent, slot })));
    const report = runConstitution({ root, consumer: join(root, "clossys"), history: () => NO_HISTORY, focus, now: () => 0 });
    // Known, outside this unit: the pin gate (cli/pin.ts writeTargetPin) appends no pin event to the slot ledger, so
    // every gate pin carries R02.3 (ledger event) and R14.1 (record trail) rows, the same for any slot it pins.
    const rows = report.rows.filter(row => !["R02.3", "R14.1"].includes(row.check));
    expect(rows.map(row => `${row.check} ${row.agent}/${row.slot}: ${row.reason}`)).toEqual([]);
    expect(report.records).toMatchObject({ slots: 20, pins: 20, candidates: 20 });
  }, LONG);
});

describe("loop.agent-standard on a consumer (mutation-proven)", () => {
  it("refuses a missing loop slot, an unpinned one and a pinned version that drops a required step", async () => {
    const root = copy();
    for (const agent of LOOP_AGENTS) expect((await loop(root, `${agent}/loop.create`)).exitCode, agent).toBe(0);
    expect(runLoopAgentStandard(root).findings).toEqual([]);
    for (const agent of LOOP_AGENTS) for (const each of AGENT_LOOPS) expect(readiness(join(root, "clossys"), agent, each), `${agent}/${each}`).toEqual({ ready: true, blockedBy: [] });
    // Designer's element checks read no loop slot (scripts/slot-pins.mjs isOwnLoopSlot): its loop pins are no library pins.
    expect((await refVerbatimSuite(root)).findings).toEqual([]);

    // Mutation 1: the consumer holds four of designer's loops, not loop.slot.
    rmSync(slotDir(root, "designer", "loop.slot"), { recursive: true, force: true });
    expect(runLoopAgentStandard(root).findings).toEqual([expect.objectContaining({ subject: "designer/loop.slot", detail: expect.stringMatching(/^missing: /) })]);

    // Mutation 2: writer's loop.scope loses its pin.
    rmSync(join(slotDir(root, "writer", "loop.scope"), "pin.json"));
    expect(runLoopAgentStandard(root).findings).toContainEqual(expect.objectContaining({ subject: "writer/loop.scope", detail: expect.stringMatching(/is not pinned/) }));

    // Mutation 3: publisher's pinned create drops Producer's required certify step (a hand-edited candidate whose pin
    // sha is forged to match, so only the standard judgement can refuse it).
    const dir = slotDir(root, "publisher", "loop.create");
    const file = join(dir, "candidates", "create-v1.json");
    const doc = readJson(file);
    doc.content.steps = doc.content.steps.filter((step: { id: string }) => step.id !== "certify");
    const bytes = `${JSON.stringify(doc, null, 2)}\n`;
    writeFileSync(file, bytes);
    const pin = readJson(join(dir, "pin.json"));
    writeFileSync(join(dir, "pin.json"), `${JSON.stringify({ ...pin, sha256: createHash("sha256").update(bytes).digest("hex") }, null, 2)}\n`);
    const findings = runLoopAgentStandard(root).findings;
    expect(findings).toContainEqual(expect.objectContaining({ subject: "publisher/loop.create/create-v1.json", detail: expect.stringContaining("certify") }));
    // The verb's own judgement reads the same pin and fails.
    const check = await loop(root, "publisher/loop.create", "--check");
    expect(check.exitCode).toBe(1);
    expect(check.message).toMatch(/certify/);
  }, LONG);

  it("the pin gate refuses an agent loop candidate that drops a required step", async () => {
    const root = copy();
    expect((await loop(root, "designer/loop.choose")).exitCode).toBe(0);
    const dir = slotDir(root, "designer", "loop.choose");
    const doc = readJson(join(dir, "candidates", "choose-v1.json"));
    const required = doc.content.steps[0].id as string;
    doc.content.steps = doc.content.steps.slice(1);
    doc.clossys.id = "designer/loop.choose/choose-v2.json";
    writeFileSync(join(dir, "candidates", "choose-v2.json"), `${JSON.stringify(doc, null, 2)}\n`);
    const pinBefore = readFileSync(join(dir, "pin.json"), "utf8");
    const { runPinCli } = await import("./pin.js");
    const refused = await runPinCli(["designer/loop.choose", "choose-v2.json", "--by", "planner:package-default", "--at", AT, "--root", root], root);
    expect(refused.exitCode, refused.message).not.toBe(0);
    // The certifier's own refusal (certify/loop.ts), not only the hand-placed-file one.
    expect(refused.message).toContain(`drops required step ${required} of producer/loop.choose`);
    expect(readFileSync(join(dir, "pin.json"), "utf8")).toBe(pinBefore);
  }, LONG);
});

describe("loop.connected on a consumer (mutation-proven)", () => {
  it("refuses a pinned version that stops reading the upstream agent's pins (a broken handoff)", async () => {
    const root = copy();
    for (const agent of LOOP_AGENTS) expect((await loop(root, `${agent}/loop.create`)).exitCode, agent).toBe(0);
    expect(runLoopConnected(root).findings).toEqual([]);
    // Mutation: designer's pinned create no longer reads anything of Director's (its pin sha forged to match).
    const dir = slotDir(root, "designer", "loop.create");
    const file = join(dir, "candidates", "create-v1.json");
    const doc = readJson(file);
    for (const step of doc.content.steps) step.reads = (step.reads as string[]).filter(path => !/director/.test(path));
    const bytes = `${JSON.stringify(doc, null, 2)}\n`;
    writeFileSync(file, bytes);
    const pin = readJson(join(dir, "pin.json"));
    writeFileSync(join(dir, "pin.json"), `${JSON.stringify({ ...pin, sha256: createHash("sha256").update(bytes).digest("hex") }, null, 2)}\n`);
    expect(runLoopConnected(root).findings).toContainEqual(expect.objectContaining({ subject: "handoff director -> designer" }));
  }, LONG);
});

/** The fixture with one open loop.slot request owned by `agent` (raised by writer's article copy, which cites it). */
async function withRequest(root: string, need: string): Promise<string> {
  const requester = join(root, "clossys", "agents", "writer", "sections.article.copy", "slot.json");
  const doc = readJson(requester);
  doc.refs.push({ to: need, rel: "input" });
  writeFileSync(requester, `${JSON.stringify(doc, null, 2)}\n`);
  const raised = await runCli(["request", "--target", need, "--from", "writer/sections.article.copy", "--why", "the article cites it", "--at", AT, "--by", "writer", "--root", root], root);
  expect(raised.exitCode, raised.message).toBe(0);
  return (raised.output as { id: string }).id;
}
/** A slot of the agent's own (not a loop slot), as the verb plans on. */
const firstSlot = (root: string, agent: string) => readdirSync(join(root, "clossys", "agents", agent)).sort().find(id => !id.startsWith("loop.") && statSync(join(root, "clossys", "agents", agent, id, "slot.json"), { throwIfNoEntry: false }))!;
const waitAll: RunHooks = { agent: () => "wait", code: () => ({ exit: 0, wrote: [] }) };

describe("the runner runs the owning agent's pin for all five loops (planRun / startRun / resumeRun)", () => {
  it("plans every loop on the agent's pin once adopted, and Producer's standard before", async () => {
    const root = copy();
    const request = await withRequest(root, "director/narratives.origin");
    const slot = `director/${firstSlot(root, "director")}`;
    const inputs = {
      "loop.scope": { loop: "loop.scope", agent: "director" },
      "loop.slot": { loop: "loop.slot", request },
      "loop.create": { loop: "loop.create", slot },
      "loop.choose": { loop: "loop.choose", slot },
      "loop.cascade": { loop: "loop.cascade", slot },
    } as const;
    const runs = () => Object.fromEntries(AGENT_LOOPS.map(each => {
      const plan = planRun(root, inputs[each], AT);
      return [each, plan.ok ? plan.state.version.ref : plan.reason];
    }));
    expect(runs()).toEqual(Object.fromEntries(AGENT_LOOPS.map(each => [each, expect.stringMatching(new RegExp(`^producer/${each.replace(".", "\\.")}/package:`))])));
    expect((await loop(root, "director/loop.create")).exitCode).toBe(0);
    expect(runs()).toEqual(Object.fromEntries(AGENT_LOOPS.map(each => [each, `director/${each}/${each.slice(5)}-v1.json`])));
    // The plan names whose loop it runs, so a resume reloads the same version.
    const scope = planRun(root, inputs["loop.scope"], AT);
    expect(scope.ok && scope.state.agent).toBe("director");
    // Without --agent, loop.scope is Producer's cross-agent scope; another agent's loop is not the subject's to run.
    const cross = planRun(root, { loop: "loop.scope" }, AT);
    expect(cross.ok && cross.state.version.ref).toMatch(/^producer\/loop\.scope\/package:/);
    const wrong = planRun(root, { loop: "loop.create", slot, agent: "writer" }, AT);
    expect(wrong.ok ? "planned" : wrong.reason).toMatch(/--agent writer: loop\.create runs director's loop/);
    const bad = planRun(root, { loop: "loop.scope", agent: "producer" }, AT);
    expect(bad.ok ? "planned" : bad.reason).toMatch(/is not a content agent/);
  }, LONG);

  it("starts and resumes a scope and a slot run on the agent's pin", async () => {
    const root = copy();
    const request = await withRequest(root, "director/narratives.origin");
    expect((await loop(root, "director/loop.create")).exitCode).toBe(0);
    const scope = await startRun(root, { loop: "loop.scope", agent: "director" }, waitAll, { now: () => new Date(AT) });
    expect(scope.state?.version.ref, scope.message).toBe("director/loop.scope/scope-v1.json");
    expect(scope.packet).toMatchObject({ step: "scope-director", agent: "director" });
    // A resume reloads the run's agent's loop (not Producer's, whose sha differs) and goes on.
    const answer: AgentOutcome = { exit: 0, model: "test-model", wrote: [] };
    const resumed = await resumeRun(root, scope.state!.runId, { agent: () => answer, code: () => ({ exit: 0, wrote: [] }) }, { now: () => new Date(AT) });
    expect(resumed.message).not.toMatch(/the loop now runs/);
    expect(resumed.state?.steps.map(step => step.id)).toContain("scope-director");
    const slot = await startRun(root, { loop: "loop.slot", request }, waitAll, { now: () => new Date(AT) });
    expect(slot.state?.version.ref, slot.message).toBe("director/loop.slot/slot-v1.json");
    expect(slot.state?.agent).toBe("director");
  }, LONG);

  it("refuses at load an agent pin that does not extend its standard (a forged pin)", async () => {
    const root = copy();
    expect((await loop(root, "director/loop.create")).exitCode).toBe(0);
    const dir = slotDir(root, "director", "loop.create");
    const file = join(dir, "candidates", "create-v1.json");
    const doc = readJson(file);
    doc.content.steps = doc.content.steps.filter((step: { id: string }) => step.id !== "certify");
    const bytes = `${JSON.stringify(doc, null, 2)}\n`;
    writeFileSync(file, bytes);
    const pin = readJson(join(dir, "pin.json"));
    writeFileSync(join(dir, "pin.json"), `${JSON.stringify({ ...pin, sha256: createHash("sha256").update(bytes).digest("hex") }, null, 2)}\n`);
    const plan = planRun(root, { loop: "loop.create", slot: `director/${firstSlot(root, "director")}` }, AT);
    expect(plan.ok ? plan.state.version.ref : plan.reason).toMatch(/^director\/loop\.create\/create-v1\.json does not extend producer\/loop\.create: .*drops required step certify/);
  }, LONG);

  it("stops an agent step of the agent's own loop that writes what the step does not declare", async () => {
    const root = copy();
    expect((await loop(root, "designer/loop.create")).exitCode).toBe(0);
    const slot = `designer/${firstSlot(root, "designer")}`;
    // refine-brief declares <slot>/slot.json; writer's slot is another agent's tree.
    const stray: RunHooks = { agent: () => ({ exit: 0, model: "test-model", wrote: ["writer/sections.article.copy/slot.json"] }), code: () => ({ exit: 0, wrote: [] }) };
    const run = await startRun(root, { loop: "loop.create", slot }, stray, { now: () => new Date(AT) });
    expect(run.state?.version.ref).toBe("designer/loop.create/create-v1.json");
    expect(run.exitCode).toBe(1);
    expect(run.message).toMatch(/step refine-brief wrote writer\/sections\.article\.copy\/slot\.json, which designer\/loop\.create\/create-v1\.json does not declare it writes/);
    // Its own declared write goes on.
    const own: RunHooks = { agent: packet => packet.step === "refine-brief" ? { exit: 0, model: "test-model", wrote: [`${slot}/slot.json`] } : "wait", code: () => ({ exit: 0, wrote: [] }) };
    const ok = await startRun(root, { loop: "loop.create", slot, trigger: "T3" }, own, { now: () => new Date("2026-11-17T12:05:00Z") });
    expect(ok.message).not.toMatch(/does not declare/);
    expect(ok.state?.steps.map(step => step.id)).toContain("refine-brief");
    // Through .. or outside the root is never a declared write.
    const state = ok.state!;
    const step = { id: "refine-brief", does: "", decider: { by: "agent", agent: "designer", verb: "brief", tier: "mid" }, cli: "", reads: [], writes: ["<slot>/slot.json"], checks: [] } as never;
    expect(undeclaredWrites(root, state, step, [`${slot}/../../writer/sections.article.copy/slot.json`, "/etc/passwd", `${slot}/slot.json`])).toEqual([`${slot}/../../writer/sections.article.copy/slot.json`, "/etc/passwd"]);
    // A path through .. is refused even where it normalizes onto a declared write.
    expect(undeclaredWrites(root, state, step, [`${slot}/sub/../slot.json`])).toEqual([`${slot}/sub/../slot.json`]);
    // A glob or placeholder declared write (had it passed the load) still writes only the agent's own roots, judged on
    // the real path: another agent's slot, another agent's check folder and a symlink into another tree are refused.
    const glob = { ...(step as object), writes: ["*/*/slot.json", "<dependant>/slot.json", ".clossys/checks/*/x/scorecard.json", "<slot>/", "producer/queue.slot/entries/*"] } as never;
    expect(undeclaredWrites(root, state, glob, ["writer/sections.article.copy/slot.json", ".clossys/checks/writer/x/scorecard.json", `${slot}/slot.json`, "producer/queue.slot/entries/r-1.json"])).toEqual(["writer/sections.article.copy/slot.json", ".clossys/checks/writer/x/scorecard.json"]);
    symlinkSync(join(root, "clossys", "agents", "writer", "sections.article.copy"), join(root, "clossys", "agents", slot, "linked"));
    expect(undeclaredWrites(root, state, glob, [`${slot}/linked/slot.json`, `${slot}/fresh/notes.md`])).toEqual([`${slot}/linked/slot.json`]);
    expect(inOwnWriteRoot(root, "designer", `${slot}/linked/slot.json`)).toBe(false);
    expect(inOwnWriteRoot(root, "designer", ".clossys/checks/designer/x/scorecard.json")).toBe(true);
    expect(inOwnWriteRoot(root, "designer", "producer/queue.slot/entries")).toBe(false);
  }, LONG);

  it("hands a failed step's findings to a route step only where Producer's standard does", () => {
    // loop.audit is no agent loop: its own route step always hands on.
    const any = { id: "x", does: "", decider: { by: "code" }, cli: "clossys check --strict", reads: [], writes: [], checks: [] } as never;
    expect(routeHandsOn({ loop: "loop.audit", version: { ref: "producer/loop.audit/package:audit-v1.json" } } as never, any, any)).toBe(true);
    const create = standardOf("loop.create");
    expect(create.ok).toBe(true);
    if (!create.ok) return;
    const steps = create.standard.steps;
    const certify = steps.find(step => step.id === "certify")!;
    const route = { id: "route", does: "routes", decider: { by: "code" }, cli: "clossys check --route", reads: [], writes: [], checks: [] } as never;
    const agentState = { loop: "loop.create", version: { ref: "designer/loop.create/create-v1.json" } } as never;
    // The standard has no route step after certify: an agent version may not add one, so a failed certify stops.
    expect(routeHandsOn(agentState, certify, route)).toBe(false);
    // A Producer version is the standard itself.
    expect(routeHandsOn({ loop: "loop.create", version: { ref: "producer/loop.create/package:create-v1.json" } } as never, certify, route)).toBe(true);
  });
});

