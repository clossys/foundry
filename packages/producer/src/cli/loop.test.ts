/**
 * `clossys loop <agent>/loop.<name>` and the agent loop tree checks (foundry-build-0048 U9a): the verb adopts the
 * agent's five loop slots and pins each through the pin gate, the runner then runs the agent's pinned version, and
 * `loop.agent-standard` / `loop.connected` refuse a consumer whose agent loops are missing, unpinned, drop a required
 * step or break the chain.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// Load the CLI first, as every caller does: owner.ts sits in an import cycle with the pipeline handlers.
import "./main.js";
import { runLoopCli } from "./loop.js";
import { runIaCli } from "./owner.js";
import { runLoopAgentStandard, runLoopConnected } from "../check/loop-connected.js";
import { AGENT_LOOPS, LOOP_AGENTS, agentLoopIssues, standardOf } from "../loop/agent-loops.js";
import { agentWriteRef, planRun, resumeRun, routeHandsOn, runStatePath, startRun, undeclaredWrites, type AgentOutcome, type RunHooks } from "../loop/runner.js";
import { judgeSnapshot, snapshotDigest, treeSnapshot } from "../loop/agent-snapshot.js";
import { buildCandidateHeader, candidatePath, serializeCandidate, writeCandidateFile } from "../records/candidate.js";
import { buildPin, cliActor, pinPath, writePinDoc } from "../records/pin.js";
import { jsonBytes } from "../records/slot-model/layout.js";
import { writeCandidate, writeCandidateBytes } from "../records/slot-write.js";
import { readPackageLoop } from "../loop/files.js";
import { requestIssues } from "../records/request.js";
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
/**
 * U9 (sweep N1): a slot request exactly as `clossys request --by <agent>` writes it for the agent's own slot (schema
 * valid, named by its file), so the runner's shape guard judges only the one field a case changes.
 */
const raisedEntry = (id: string, from: string, target = "director/narratives.origin") => ({
  schema: "clossys.queue-entry/2", id, kind: "slot", from, assignee: target.split("/")[0], target, status: "open", opened: `${id}#1`,
  rel: "input", why: "the slot cites it", source: "cli", createdBy: { actor: "code", cli: "clossys request", version: "0.1.0" },
  createdAt: AT, refs: [{ to: from, rel: "raisedBy" }], events: [{ id: `${id}#1`, at: AT, op: "raised", by: from.split("/")[0], via: "cli", detail: "the slot cites it" }],
});

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
    const standardRefine = standardOf("loop.create");
    if (!standardRefine.ok) throw new Error(standardRefine.reason);
    // The standard's own refine-brief (its writes are exempt only while its id, decider and cli are the standard's).
    const step = standardRefine.standard.steps.find(each => each.id === "refine-brief")! as never;
    expect(undeclaredWrites(root, state, step, [`${slot}/../../writer/sections.article.copy/slot.json`, "/etc/passwd", `${slot}/slot.json`], {})).toEqual([`${slot}/../../writer/sections.article.copy/slot.json`, "/etc/passwd"]);
    // A path through .. is refused even where it normalizes onto a declared write.
    expect(undeclaredWrites(root, state, step, [`${slot}/sub/../slot.json`], {})).toEqual([`${slot}/sub/../slot.json`]);
    // A glob or placeholder declared write (had it passed the load) still writes only what the agent write allowlist
    // holds: another agent's slot, another agent's check folder, a request it did not raise (r-1 is no entry of its own)
    // and a symlink into another tree are refused; refine-brief's own slot record, as the standard declares it, goes on.
    const glob = { ...(step as object), writes: ["*/*/slot.json", "<dependant>/slot.json", ".clossys/checks/*/x/scorecard.json", "<slot>/", "producer/queue.slot/entries/*"] } as never;
    expect(undeclaredWrites(root, state, glob, ["writer/sections.article.copy/slot.json", ".clossys/checks/writer/x/scorecard.json", `${slot}/slot.json`, "producer/queue.slot/entries/r-1.json"], {})).toEqual(["writer/sections.article.copy/slot.json", ".clossys/checks/writer/x/scorecard.json", "producer/queue.slot/entries/r-1.json"]);
    symlinkSync(join(root, "clossys", "agents", "writer", "sections.article.copy"), join(root, "clossys", "agents", slot, "linked"));
    expect(undeclaredWrites(root, state, glob, [`${slot}/linked/slot.json`, `${slot}/fresh/notes.md`, `${slot}/candidates/fresh-v9.json`], {})).toEqual([`${slot}/linked/slot.json`, `${slot}/fresh/notes.md`]);
    expect(agentWriteRef(root, `${slot}/linked/slot.json`)).toEqual({ refused: expect.stringMatching(/is a symlink$/) });
    expect(agentWriteRef(root, ".clossys/checks/designer/x/scratch/a.json")).toEqual({ segments: [".clossys", "checks", "designer", "x", "scratch", "a.json"] });
    expect(agentWriteRef(root, `clossys/agents/${slot}/candidates/n.json`)).toEqual({ segments: [...slot.split("/"), "candidates", "n.json"] });
  }, LONG);

  it("refuses at run time what only Producer writes: owner queues, verdicts, slot records, links and others' requests (U9a fix round 3)", async () => {
    const root = copy();
    expect((await loop(root, "designer/loop.create")).exitCode).toBe(0);
    const slotId = firstSlot(root, "designer");
    const slot = `designer/${slotId}`;
    const plan = planRun(root, { loop: "loop.create", slot }, AT);
    expect(plan.ok ? plan.state.version.ref : plan.reason).toBe("designer/loop.create/create-v1.json");
    if (!plan.ok) return;
    const state = plan.state;
    const agents = join(root, "clossys", "agents");
    const step = (id: string, writes: string[]) => ({ id, does: "", decider: { by: "agent", agent: "designer", verb: "review", tier: "low" }, cli: "clossys next", reads: [], writes, checks: [] }) as never;
    const put = (rel: string, body: unknown) => { mkdirSync(join(root, rel, ".."), { recursive: true }); writeFileSync(join(root, rel), `${JSON.stringify(body, null, 2)}\n`); };
    const shapedRequest = raisedEntry("20261117T1200Z-forged", slot);

    // R1: the owner's approve queue is no agent's, even an entry shaped as a new request of its own; a check-folder glob
    // writes only the agent's scratch, never Producer's verdicts or other files beside them.
    put("clossys/agents/producer/queue.approve/entries/20261117T1200Z-forged.json", shapedRequest);
    expect(undeclaredWrites(root, state, step("extra", ["producer/queue.approve/entries/*"]), ["producer/queue.approve/entries/20261117T1200Z-forged.json"], {})).toEqual(["producer/queue.approve/entries/20261117T1200Z-forged.json"]);
    const checks = [`.clossys/checks/designer/${slotId}/cascade.json`, `.clossys/checks/designer/${slotId}/other/x.json`, `.clossys/checks/designer/${slotId}/scratch/n.json`];
    expect(undeclaredWrites(root, state, step("extra", [".clossys/checks/<agent>/<slot-id>/"]), checks, {})).toEqual(checks.slice(0, 2));

    // R2: a hard link from a new candidate to another agent's slot record or to the agent's own pin is refused.
    mkdirSync(join(agents, slot, "candidates"), { recursive: true });
    put(`clossys/agents/${slot}/pin.json`, { note: "the slot's pin" });
    linkSync(join(agents, "writer", "sections.article.copy", "slot.json"), join(agents, slot, "candidates", "h-v9.json"));
    linkSync(join(agents, slot, "pin.json"), join(agents, slot, "candidates", "p-v9.json"));
    writeFileSync(join(agents, slot, "candidates", "n-v9.json"), "{}\n");
    const candidates = step("extra", ["<slot>/candidates/*"]);
    expect(undeclaredWrites(root, state, candidates, [`${slot}/candidates/h-v9.json`, `${slot}/candidates/p-v9.json`, `${slot}/candidates/n-v9.json`], {})).toEqual([`${slot}/candidates/h-v9.json`, `${slot}/candidates/p-v9.json`]);

    // R3: a symlink between the agent's own slots is refused, not followed (round 2 resolved it and let it pass).
    symlinkSync(join(agents, "designer", "loop.create", "candidates", "create-v1.json"), join(agents, slot, "candidates", "s-v9.json"));
    expect(undeclaredWrites(root, state, candidates, [`${slot}/candidates/s-v9.json`], {})).toEqual([`${slot}/candidates/s-v9.json`]);

    // R4: the slot record is Producer's, but for the standard's own refine-brief, which declares it; refine-brief's pin is not.
    expect(undeclaredWrites(root, state, step("extra", ["<slot>/slot.json"]), [`${slot}/slot.json`], {})).toEqual([`${slot}/slot.json`]);
    const standardCreate = standardOf("loop.create");
    if (!standardCreate.ok) throw new Error(standardCreate.reason);
    const refine = standardCreate.standard.steps.find(each => each.id === "refine-brief")!;
    expect(undeclaredWrites(root, state, refine, [`${slot}/slot.json`], {})).toEqual([]);
    expect(undeclaredWrites(root, state, { ...refine, writes: ["<slot>/pin.json"] }, [`${slot}/pin.json`], {})).toEqual([`${slot}/pin.json`]);
    // U9a fix round 4 (blind1 B3): the same id running another cli is no longer the standard step: its slot record is refused.
    expect(undeclaredWrites(root, state, step("refine-brief", ["<slot>/slot.json"]), [`${slot}/slot.json`], {})).toEqual([`${slot}/slot.json`]);

    // R5: an added step writes only a new request of its own: never another agent's open request, nor one with events.
    const others = await withRequest(root, "director/narratives.origin");
    // Its own target, so `clossys request` below does not reuse it as the open duplicate.
    const shaped = raisedEntry("20261117T1200Z-two", slot, "director/advantage.model.pricing");
    const two = { ...shaped, events: [...shaped.events, { id: "20261117T1200Z-two#2", at: AT, op: "checked", by: "producer" }] };
    put("clossys/agents/producer/queue.slot/entries/20261117T1200Z-two.json", two);
    const designerSlot = join(agents, slot, "slot.json");
    const doc = readJson(designerSlot);
    doc.refs.push({ to: "director/narratives.origin", rel: "input" });
    writeFileSync(designerSlot, `${JSON.stringify(doc, null, 2)}\n`);
    const raised = await runCli(["request", "--target", "director/narratives.origin", "--from", slot, "--why", "the icon cites it", "--at", AT, "--by", "designer", "--root", root], root);
    expect(raised.exitCode, raised.message).toBe(0);
    const own = (raised.output as { id: string }).id;
    const requests = step("extra", ["producer/queue.slot/entries/*"]);
    expect(undeclaredWrites(root, state, requests, [`producer/queue.slot/entries/${others}.json`, "producer/queue.slot/entries/20261117T1200Z-two.json", `producer/queue.slot/entries/${own}.json`], {})).toEqual([`producer/queue.slot/entries/${others}.json`, "producer/queue.slot/entries/20261117T1200Z-two.json"]);
  }, LONG);

  it("refuses at load a forged designer loop.choose pin whose added step answers the owner's approve queue (B1, U9a fix round 3)", async () => {
    const root = copy();
    expect((await loop(root, "designer/loop.choose")).exitCode).toBe(0);
    const dir = slotDir(root, "designer", "loop.choose");
    const file = join(dir, "candidates", "choose-v1.json");
    const doc = readJson(file);
    doc.content.steps.push({ id: "self-approve", does: "answers the confirm entry", decider: { by: "agent", agent: "designer", verb: "review", tier: "low" }, cli: "clossys next", reads: [], writes: ["producer/queue.approve/entries/*"], checks: [] });
    const bytes = `${JSON.stringify(doc, null, 2)}\n`;
    writeFileSync(file, bytes);
    const pin = readJson(join(dir, "pin.json"));
    writeFileSync(join(dir, "pin.json"), `${JSON.stringify({ ...pin, sha256: createHash("sha256").update(bytes).digest("hex") }, null, 2)}\n`);
    const plan = planRun(root, { loop: "loop.choose", slot: `designer/${firstSlot(root, "designer")}` }, AT);
    expect(plan.ok ? plan.state.version.ref : plan.reason).toMatch(/^designer\/loop\.choose\/choose-v1\.json does not extend producer\/loop\.choose: .*step self-approve writes producer\/queue\.approve\/entries\/\*, which only Producer writes/);
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

describe("U9a fix round 4: agent steps are judged by what they changed, against the Producer loop the consumer runs now", () => {
  const minute = (n: number) => () => new Date(`2026-11-17T12:${String(n).padStart(2, "0")}:00Z`);
  /** The CLI's resume answer: once, for the step the run waits on; every other agent step (a later round's too) waits. */
  const answering = (stepId: string, wrote: string[]): RunHooks => {
    let pending = true;
    return { agent: packet => { if (!pending || packet.step !== stepId) return "wait"; pending = false; return { exit: 0, model: "test-model", wrote }; }, code: () => ({ exit: 0, wrote: [] }) };
  };
  /** Rewrites a JSON record with other bytes (a new indent each time) and the same content: a write the runner can see. */
  let indent = 3;
  const touch = (root: string, rel: string) => { const file = join(root, "clossys", "agents", rel); writeFileSync(file, `${JSON.stringify(readJson(file), null, indent++)}\n`); };
  const put = (root: string, rel: string, body: unknown) => { mkdirSync(join(root, rel, ".."), { recursive: true }); writeFileSync(join(root, rel), `${JSON.stringify(body, null, 2)}\n`); };
  const standardStep = (loopName: (typeof AGENT_LOOPS)[number], id: string) => {
    const read = standardOf(loopName);
    if (!read.ok) throw new Error(read.reason);
    return structuredClone(read.standard.steps.find(each => each.id === id)!);
  };

  it("keeps the tree before an agent step in the run state and refuses what the step changed but did not report (blind2 B1)", async () => {
    const root = copy();
    expect((await loop(root, "designer/loop.create")).exitCode).toBe(0);
    const slotId = firstSlot(root, "designer");
    const slot = `designer/${slotId}`;
    const waitAt = async (n: number) => {
      const run = await startRun(root, { loop: "loop.create", slot }, waitAll, { now: minute(n) });
      expect(run.packet?.step, run.message).toBe("refine-brief");
      return run.state!;
    };

    // The run waits on refine-brief with the snapshot taken before the agent was handed the step.
    const waiting = await waitAt(1);
    expect(waiting.agentSnapshot).toMatchObject({ step: "refine-brief", digest: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(waiting.agentSnapshot!.files[`clossys/agents/${slot}/slot.json`]).toMatch(/^file:[0-9a-f]{64}:1$/);
    expect(readJson(runStatePath(root, waiting.runId)).agentSnapshot.digest).toBe(waiting.agentSnapshot!.digest);
    // A write to another agent's slot record it did not report stops the run, though everything it reported is allowed.
    touch(root, `${slot}/slot.json`);
    touch(root, "writer/sections.article.copy/slot.json");
    const hidden = await resumeRun(root, waiting.runId, answering("refine-brief", [`${slot}/slot.json`]), { now: minute(2) });
    expect(hidden.exitCode).toBe(1);
    expect(hidden.message).toMatch(/step refine-brief changed writer\/sections\.article\.copy\/slot\.json without reporting it \(--wrote\); designer\/loop\.create\/create-v1\.json refuses it/);
    expect(readJson(runStatePath(root, waiting.runId)).agentSnapshot).toBeUndefined();

    // The honest step (its own slot record, reported) goes on.
    const honest = await waitAt(3);
    touch(root, `${slot}/slot.json`);
    const ok = await resumeRun(root, honest.runId, answering("refine-brief", [`${slot}/slot.json`]), { now: minute(4) });
    expect(ok.message).not.toMatch(/refuses it|does not declare/);
    expect(ok.state?.steps.map(step => step.id)).toContain("refine-brief");

    // A removed file is refused, whether or not it is reported (only the bound standard pick may clear its re-verdict).
    const cascade = `.clossys/checks/designer/${slotId}/cascade.json`;
    put(root, cascade, { schema: "clossys.reverdict/1", verdicts: [] });
    const removing = await waitAt(5);
    rmSync(join(root, cascade));
    const removed = await resumeRun(root, removing.runId, answering("refine-brief", [cascade]), { now: minute(6) });
    expect(removed.exitCode).toBe(1);
    expect(removed.message).toMatch(new RegExp(`step refine-brief removed \\.clossys/checks/designer/${slotId.replace(/\./g, "\\.")}/cascade\\.json`));

    // A repeated wait keeps the first snapshot: a write made while the run waited is still the step's.
    const twice = await waitAt(7);
    touch(root, "writer/sections.article.copy/slot.json");
    const still = await resumeRun(root, twice.runId, waitAll, { now: minute(8) });
    expect(still.state?.status).toBe("waiting");
    expect(still.state?.agentSnapshot?.digest).toBe(twice.agentSnapshot!.digest);
    const late = await resumeRun(root, twice.runId, answering("refine-brief", []), { now: minute(9) });
    expect(late.message).toMatch(/changed writer\/sections\.article\.copy\/slot\.json without reporting it/);

    // A symlink the step adds is refused, reported or not: the snapshot judges what is there, not what it points at.
    const linking = await waitAt(10);
    const link = `.clossys/checks/designer/${slotId}/linked.json`;
    symlinkSync(join(root, "clossys", "agents", slot, "slot.json"), join(root, link));
    const linked = await resumeRun(root, linking.runId, answering("refine-brief", [link]), { now: minute(11) });
    expect(linked.exitCode).toBe(1);
    expect(linked.message).toMatch(new RegExp(`step refine-brief added ${link.replace(/\./g, "\\.")}, which is a symlink`));
  }, LONG);

  it("stops a resume whose kept snapshot is missing or corrupt (fail closed)", async () => {
    const root = copy();
    expect((await loop(root, "designer/loop.create")).exitCode).toBe(0);
    const slot = `designer/${firstSlot(root, "designer")}`;
    for (const [n, spoil] of [
      [1, (doc: Record<string, any>) => { delete doc.agentSnapshot; }],
      [3, (doc: Record<string, any>) => { const key = Object.keys(doc.agentSnapshot.files).find(each => each.endsWith("/slot.json"))!; doc.agentSnapshot.files[key] = `file:${"0".repeat(64)}:1`; }],
      [5, (doc: Record<string, any>) => { doc.agentSnapshot.step = "create"; }],
      [7, (doc: Record<string, any>) => { doc.agentSnapshot.files["../outside.json"] = `file:${"0".repeat(64)}:1`; doc.agentSnapshot.digest = "0".repeat(64); }],
      // Whole and re-hashed, but naming a path outside the snapshot trees, or a mark no snapshot takes.
      [9, (doc: Record<string, any>) => { doc.agentSnapshot.files["../outside.json"] = `file:${"0".repeat(64)}:1`; doc.agentSnapshot.digest = snapshotDigest(doc.agentSnapshot.files); }],
      [11, (doc: Record<string, any>) => { const key = Object.keys(doc.agentSnapshot.files)[0]!; doc.agentSnapshot.files[key] = "gone"; doc.agentSnapshot.digest = snapshotDigest(doc.agentSnapshot.files); }],
    ] as const) {
      const run = await startRun(root, { loop: "loop.create", slot }, waitAll, { now: minute(n) });
      expect(run.packet?.step, run.message).toBe("refine-brief");
      const file = runStatePath(root, run.state!.runId);
      const doc = readJson(file);
      spoil(doc);
      writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
      const resumed = await resumeRun(root, run.state!.runId, answering("refine-brief", []), { now: minute(n + 1) });
      expect(resumed.exitCode, `case ${n}`).toBe(2);
      expect(resumed.message, `case ${n}`).toMatch(/step refine-brief: the snapshot the run kept before agent:designer ran is missing or corrupt/);
    }
  }, LONG);

  it("makes slot requests and candidates create-only: an entry or candidate there before the step is refused (blind1 B1, p1/p2)", async () => {
    const root = copy();
    expect((await loop(root, "designer/loop.create")).exitCode).toBe(0);
    const slotId = firstSlot(root, "designer");
    const slot = `designer/${slotId}`;
    const plan = planRun(root, { loop: "loop.create", slot }, AT);
    if (!plan.ok) throw new Error(plan.reason);
    const state = plan.state;
    const fresh = (id: string, from: string) => raisedEntry(id, from);
    const entry = (name: string) => `clossys/agents/producer/queue.slot/entries/${name}.json`;
    // p2: an added step of the agent's own may declare new slot requests: the loop certifies.
    const own = readJson(join(slotDir(root, "designer", "loop.create"), "candidates", "create-v1.json")).content;
    own.steps.push({ id: "extra", does: "raises requests", decider: { by: "agent", agent: "designer", verb: "decide", tier: "low" }, cli: "clossys request", reads: [], writes: ["producer/queue.slot/entries/*"], checks: [] });
    expect(agentLoopIssues("designer", "loop.create", own, { root })).toEqual([]);
    const extra = own.steps.at(-1);

    // p1: before the step a closed request and another agent's open request are there; the step rewrites both as
    // fresh requests of its own and raises one new one. Only the new one is allowed.
    put(root, entry("20261117T1100Z-closed"), { ...fresh("20261117T1100Z-closed", slot), status: "closed", events: [{ id: "c#1", at: AT, op: "raised", by: "designer" }, { id: "c#2", at: AT, op: "closed", by: "producer" }] });
    const others = await withRequest(root, "director/narratives.origin");
    put(root, `clossys/agents/${slot}/candidates/old-v1.json`, { note: "a candidate already there" });
    const before = treeSnapshot(root, state.runId);
    put(root, entry("20261117T1100Z-closed"), fresh("20261117T1100Z-closed", slot));
    put(root, entry(others), fresh(others, slot));
    put(root, entry("20261117T1200Z-new"), fresh("20261117T1200Z-new", slot));
    const requests = ["producer/queue.slot/entries/20261117T1100Z-closed.json", `producer/queue.slot/entries/${others}.json`, "producer/queue.slot/entries/20261117T1200Z-new.json"];
    expect(undeclaredWrites(root, state, extra, requests, before)).toEqual(requests.slice(0, 2));
    // The same writes judged as if nothing was there before pass: create-only is what refuses them.
    expect(undeclaredWrites(root, state, extra, requests, {})).toEqual([]);
    // No snapshot at all refuses every write (fail closed).
    expect(undeclaredWrites(root, state, extra, requests.slice(2), undefined)).toEqual(requests.slice(2));

    // The standard's own create step (wildcard candidates) may not rewrite a candidate that was there; a new one goes on.
    put(root, `clossys/agents/${slot}/candidates/old-v1.json`, { note: "rewritten" });
    put(root, `clossys/agents/${slot}/candidates/new-v1.json`, { note: "new" });
    const create = standardStep("loop.create", "create");
    expect(undeclaredWrites(root, state, create, [`${slot}/candidates/old-v1.json`, `${slot}/candidates/new-v1.json`], before)).toEqual([`${slot}/candidates/old-v1.json`]);

    // loop.scope's own wildcard is create-only too: its scope step rewrites no request that was there.
    const scopePlan = planRun(root, { loop: "loop.scope", agent: "designer" }, AT);
    if (!scopePlan.ok) throw new Error(scopePlan.reason);
    const scope = standardStep("loop.scope", "scope-designer");
    expect(undeclaredWrites(root, scopePlan.state, scope, requests, before)).toEqual(requests.slice(0, 2));

    // loop.slot's decide step answers its own request, named exactly: that one existing entry is its to change.
    const need = "designer/dogfood.own-loops-need";
    const request = await withRequest(root, need);
    const slotPlan = planRun(root, { loop: "loop.slot", request }, AT);
    if (!slotPlan.ok) throw new Error(slotPlan.reason);
    expect(slotPlan.state.agent).toBe("designer");
    const decide = standardStep("loop.slot", "decide-designer");
    const decideBefore = treeSnapshot(root, slotPlan.state.runId);
    expect(undeclaredWrites(root, slotPlan.state, decide, [`producer/queue.slot/entries/${request}.json`], decideBefore)).toEqual([]);
    expect(undeclaredWrites(root, slotPlan.state, decide, [`producer/queue.slot/entries/${others}.json`], decideBefore)).toEqual([`producer/queue.slot/entries/${others}.json`]);

    // blind1 #4: a dot path under clossys/agents/ is never an agent's write.
    expect(agentWriteRef(root, "designer/.hidden/slot.json")).toEqual({ refused: expect.stringMatching(/a dot path under clossys\/agents\/$/) });
  }, LONG);

  it("judges a new request's shape also under the scope step's wildcard: no answered, forged or owner-origin entry (U9 sweep N1)", async () => {
    const root = copy();
    expect((await loop(root, "designer/loop.create")).exitCode).toBe(0);
    const slot = `designer/${firstSlot(root, "designer")}`;
    const writerSlot = `writer/${firstSlot(root, "writer")}`;
    const scopePlan = planRun(root, { loop: "loop.scope", agent: "designer" }, AT);
    if (!scopePlan.ok) throw new Error(scopePlan.reason);
    const scope = standardStep("loop.scope", "scope-designer");
    expect(scope.writes).toEqual(["producer/queue.slot/entries/*"]);
    const before = treeSnapshot(root, scopePlan.state.runId);
    const at = (id: string) => `producer/queue.slot/entries/${id}.json`;
    const valid = raisedEntry("20261117T1200Z-valid", slot);
    const forged: Record<string, Record<string, unknown>> = {
      "20261117T1201Z-closed": (() => {
        const id = "20261117T1201Z-closed", base = raisedEntry(id, slot);
        return { ...base, status: "closed", decision: "reuse", reuse: "director/narratives.origin", overlaps: [{ slot: "director/narratives.origin", why: "the same need" }],
          link: "director/narratives.origin", notified: { to: slot, at: AT }, closed: `${id}#2`, closedAt: AT,
          events: [...base.events, { id: `${id}#2`, at: AT, op: "closed", by: "producer" }] };
      })(),
      "20261117T1202Z-notified": { ...raisedEntry("20261117T1202Z-notified", slot), notified: { to: slot, at: AT } },
      "20261117T1203Z-two": (() => { const base = raisedEntry("20261117T1203Z-two", slot); return { ...base, events: [...base.events, { id: "20261117T1203Z-two#2", at: AT, op: "checked", by: "producer" }] }; })(),
      "20261117T1204Z-checked": (() => { const base = raisedEntry("20261117T1204Z-checked", slot); return { ...base, events: [{ ...base.events[0]!, op: "checked" }] }; })(),
      "20261117T1205Z-owner": { ...raisedEntry("20261117T1205Z-owner", slot), from: "owner", refs: [] },
      "20261117T1206Z-writer": raisedEntry("20261117T1206Z-writer", writerSlot),
      "20261117T1207Z-by-owner": (() => { const base = raisedEntry("20261117T1207Z-by-owner", slot); return { ...base, events: [{ ...base.events[0]!, by: "owner" }] }; })(),
      "20261117T1208Z-owner-actor": { ...raisedEntry("20261117T1208Z-owner-actor", slot), createdBy: { actor: "owner", ref: "chat" } },
      "20261117T1209Z-feedback": { ...raisedEntry("20261117T1209Z-feedback", slot), source: "feedback", createdBy: { actor: "code", cli: "clossys feedback", version: "0.1.0" } },
      "20261117T1210Z-quote": (() => { const base = raisedEntry("20261117T1210Z-quote", slot); return { ...base, events: [{ ...base.events[0]!, via: "chat", quote: "the owner said so" }] }; })(),
      "20261117T1211Z-renamed": raisedEntry("20261117T1299Z-other", slot),
    };
    // Each forged entry is schema valid: the shape guard, not the record validator, refuses it.
    for (const [name, body] of Object.entries(forged)) expect(requestIssues(body), name).toEqual([]);
    const put = (id: string, body: unknown) => { const file = join(root, "clossys", "agents", at(id)); mkdirSync(join(file, ".."), { recursive: true }); writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`); };
    put("20261117T1200Z-valid", valid);
    for (const [name, body] of Object.entries(forged)) put(name, body);
    const names = Object.keys(forged);
    expect(undeclaredWrites(root, scopePlan.state, scope, [at("20261117T1200Z-valid"), ...names.map(at)], before)).toEqual(names.map(at));

    // The real verb's entry for the agent's own slot passes under the same wildcard.
    const designerSlot = join(root, "clossys", "agents", slot, "slot.json");
    const doc = readJson(designerSlot);
    doc.refs.push({ to: "director/narratives.origin", rel: "input" });
    writeFileSync(designerSlot, `${JSON.stringify(doc, null, 2)}\n`);
    const raised = await runCli(["request", "--target", "director/narratives.origin", "--from", slot, "--why", "the icon cites it", "--at", AT, "--by", "designer", "--root", root], root);
    expect(raised.exitCode, raised.message).toBe(0);
    const id = (raised.output as { id: string }).id;
    expect(undeclaredWrites(root, scopePlan.state, scope, [at(id)], before)).toEqual([]);
  }, LONG);

  it("binds a standard agent step's writes to its cli: a swapped cli fails certification and its writes are refused (blind1 B3, p3)", async () => {
    const root = copy();
    expect((await loop(root, "designer/loop.create")).exitCode).toBe(0);
    const slot = `designer/${firstSlot(root, "designer")}`;
    const choose = readJson(join(slotDir(root, "designer", "loop.choose"), "candidates", "choose-v1.json")).content;
    choose.steps.find((step: { id: string }) => step.id === "pick").cli = "write <slot>/pin.json yourself, then report it";
    expect(agentLoopIssues("designer", "loop.choose", choose, { root })).toEqual(expect.arrayContaining([expect.stringMatching(/step pick changes the standard agent step's cli \(clossys pin <ref> <candidate>/)]));
    const create = readJson(join(slotDir(root, "designer", "loop.create"), "candidates", "create-v1.json")).content;
    create.steps.find((step: { id: string }) => step.id === "refine-brief").cli = "edit <slot>/slot.json by hand";
    expect(agentLoopIssues("designer", "loop.create", create, { root })).toEqual(expect.arrayContaining([expect.stringMatching(/step refine-brief changes the standard agent step's cli \(clossys brief <ref> --tighten/)]));
    // Whitespace is not a change.
    const spaced = readJson(join(slotDir(root, "designer", "loop.choose"), "candidates", "choose-v1.json")).content;
    const pickStep = spaced.steps.find((step: { id: string }) => step.id === "pick");
    pickStep.cli = `  ${pickStep.cli.replace(/ /g, "   ")} `;
    expect(agentLoopIssues("designer", "loop.choose", spaced, { root })).toEqual([]);

    // At run time the swapped step's writes are no longer the standard's: its pin and its slot record are refused.
    const plan = planRun(root, { loop: "loop.choose", slot }, AT);
    if (!plan.ok) throw new Error(plan.reason);
    const pick = standardStep("loop.choose", "pick");
    expect(undeclaredWrites(root, plan.state, pick, [`${slot}/pin.json`], {})).toEqual([]);
    expect(undeclaredWrites(root, plan.state, { ...pick, cli: "write <slot>/pin.json yourself, then report it" }, [`${slot}/pin.json`], {})).toEqual([`${slot}/pin.json`]);
    const refine = standardStep("loop.create", "refine-brief");
    const createPlan = planRun(root, { loop: "loop.create", slot }, AT);
    if (!createPlan.ok) throw new Error(createPlan.reason);
    expect(undeclaredWrites(root, createPlan.state, { ...refine, cli: "edit <slot>/slot.json by hand" }, [`${slot}/slot.json`], {})).toEqual([`${slot}/slot.json`]);
  }, LONG);

  it("runs an agent loop only while it is certified against the Producer loop the owner pinned: a repin asks to recertify (blind1 B2)", async () => {
    const root = copy();
    expect((await loop(root, "designer/loop.create")).exitCode).toBe(0);
    const slot = `designer/${firstSlot(root, "designer")}`;
    const packaged = readPackageLoop("loop.choose");
    if (!packaged.ok) throw new Error(packaged.reason);
    // The agent's pin records the Producer loop it was certified against.
    expect(readJson(pinPath(root, "designer", "loop.choose")).refs).toEqual(expect.arrayContaining([{ to: "producer/loop.choose/package:choose-v1.json", rel: "uses", sha256: packaged.sha256 }]));
    const runs = () => { const plan = planRun(root, { loop: "loop.choose", slot }, AT); return plan.ok ? plan.state.version.ref : plan.reason; };
    expect(runs()).toBe("designer/loop.choose/choose-v1.json");

    // The owner repins producer/loop.choose to a version with an owner gate of its own after rank.
    const gated = structuredClone(packaged.content) as { steps: Record<string, unknown>[] };
    const gate = { id: "owner-review", does: "owner reads the ranking first", decider: { by: "human", who: "owner", raise: "queue.approve" }, cli: "clossys answer <entry> approve --by owner --via chat --quote <words>", reads: [], writes: [], checks: ["answer.quote-required"] };
    gated.steps.splice(1, 0, gate);
    const header = buildCandidateHeader({ agent: "producer", slotId: "loop.choose", name: "choose-v2.json", createdBy: { actor: "planner", ref: "test" }, createdAt: AT, source: { kind: "original", ref: [] } });
    const sha256 = writeCandidateFile(candidatePath(root, "producer", "loop.choose", "choose-v2.json"), serializeCandidate("choose-v2.json", header, gated));
    writePinDoc(pinPath(root, "producer", "loop.choose"), buildPin({ agent: "producer", slotId: "loop.choose", record: { candidate: "choose-v2.json", sha256, at: AT, decidedBy: "owner:queue.pick#20261117T1200Z-loop-choose", basis: "picked" }, refs: [{ to: "producer/queue.pick" as never, record: "20261117T1200Z-loop-choose", rel: "answers" }], createdBy: cliActor("clossys pin") }));
    // Neither version runs: not the agent's stale pin, and not Producer's new version in its place.
    expect(runs()).toMatch(/^designer\/loop\.choose\/choose-v1\.json was certified against producer\/loop\.choose\/package:choose-v1\.json \([0-9a-f]{12}\), but producer\/loop\.choose now runs producer\/loop\.choose\/choose-v2\.json \([0-9a-f]{12}\): recertify designer\/loop\.choose/);
    // Another loop the owner did not repin still runs the agent's own.
    const create = planRun(root, { loop: "loop.create", slot }, AT);
    expect(create.ok ? create.state.version.ref : create.reason).toBe("designer/loop.create/create-v1.json");

    // Recertifying needs every required step of the owner's version, its new owner gate included.
    const designerDir = slotDir(root, "designer", "loop.choose");
    const ownChoose = readJson(join(designerDir, "candidates", "choose-v1.json")).content;
    // Submitted through the candidate writer (a submit record), as the pin gate needs.
    const candidate = (name: string, content: unknown) => {
      const head = buildCandidateHeader({ agent: "designer", slotId: "loop.choose", name, createdBy: { actor: "planner", ref: "test" }, createdAt: AT, source: { kind: "original", ref: [] } });
      writeCandidateBytes(join(root, "clossys"), "designer", "loop.choose", name, serializeCandidate(name, head, content), { at: AT, fields: { rung: "adapt", reason: "recertified against the owner's loop.choose" } });
    };
    candidate("choose-v3.json", ownChoose);
    const stale = await runCli(["pin", "designer/loop.choose", "choose-v3.json", "--by", "planner:test", "--at", AT, "--root", root], root);
    expect(stale.exitCode).not.toBe(0);
    expect(stale.message).toMatch(/drops required step owner-review of producer\/loop\.choose/);
    const withGate = structuredClone(ownChoose);
    withGate.steps.splice(withGate.steps.findIndex((step: { id: string }) => step.id === "rank") + 1, 0, gate);
    candidate("choose-v4.json", withGate);
    const fresh = await runCli(["pin", "designer/loop.choose", "choose-v4.json", "--by", "planner:test", "--at", AT, "--root", root], root);
    expect(fresh.exitCode, fresh.message).toBe(0);
    expect(readJson(pinPath(root, "designer", "loop.choose")).refs).toEqual(expect.arrayContaining([{ to: "producer/loop.choose/choose-v2.json", rel: "uses", sha256 }]));
    expect(runs()).toBe("designer/loop.choose/choose-v4.json");
  }, LONG);

  it("accepts a change to the run slot's ledger only as a pure append of the step's own events (option b)", () => {
    const root = copy();
    const slotId = firstSlot(root, "designer");
    const subject = { agent: "designer", slotId };
    const key = `clossys/agents/designer/${slotId}/ledger.json`;
    const file = join(root, ...key.split("/"));
    const sha = (n: number) => String(n).repeat(64).slice(0, 64);
    const submit = { op: "submit", at: AT, by: "agent:designer.candidates", verb: "submit", skill: { path: "packages/designer/actions/designer.candidates/skill.md", sha256: null }, model: "m", tier: "mid", name: "hero-v1.json", sha256: sha(1) };
    const pickEvent = { op: "pick", at: AT, by: "agent:designer", verb: "pick", skill: { path: "packages/designer/actions/pick.designer/skill.md", sha256: null }, model: "none", tier: "none", candidate: "hero-v1.json", sha256: sha(1), decidedBy: "agent:designer", basis: "agent" };
    const ledger = (events: unknown[]) => jsonBytes({ schema: "clossys.ledger/1", events });
    const pick = standardStep("loop.choose", "pick");
    const createStep = standardStep("loop.create", "create");
    const refine = standardStep("loop.create", "refine-brief");
    const judge = (events: unknown[] | string, step = pick, prior: unknown[] | null = [submit]) => {
      if (prior === null) rmSync(file, { force: true }); else writeFileSync(file, ledger(prior));
      const before = treeSnapshot(root, "x");
      writeFileSync(file, typeof events === "string" ? events : ledger(events));
      return judgeSnapshot(root, before, treeSnapshot(root, "x"), new Set(), step, "designer", subject);
    };
    // The honest pick and the honest submit (onto no ledger at all) pass, unreported.
    expect(judge([submit, pickEvent])).toEqual({ issues: [], appended: [key] });
    expect(judge([submit], createStep, null)).toEqual({ issues: [], appended: [key] });
    // An edited prior event, a removed one, other bytes than the writer's, or no event appended: refused.
    expect(judge([{ ...submit, at: "2026-11-17T12:01:00Z" }, pickEvent]).issues).toEqual([expect.stringMatching(/is not a prefix of it \(a prior event was changed or removed\)/)]);
    expect(judge([pickEvent]).issues).toEqual([expect.stringMatching(/is not a prefix of it/)]);
    expect(judge(JSON.stringify({ schema: "clossys.ledger/1", events: [submit, pickEvent] })).issues).toEqual([expect.stringMatching(/is not in the ledger writer's bytes/)]);
    expect(judge(`${ledger([submit]).trimEnd()} \n`).issues).toEqual([expect.stringMatching(/is not in the ledger writer's bytes/)]);
    // A verb the step does not produce: a submit from the pick step, a pick from the create step, anything from refine-brief.
    expect(judge([submit, { ...submit, name: "hero-v2.json" }]).issues).toEqual([expect.stringMatching(/op submit verb submit is not what step pick \(pick\) produces \(pin, pick\)/)]);
    expect(judge([submit, pickEvent], createStep).issues).toEqual([expect.stringMatching(/op pick verb pick is not what step create \(create-candidates\) produces \(submit\)/)]);
    expect(judge([submit, pickEvent], refine).issues).toEqual([expect.stringMatching(/step refine-brief \(refine-brief\) appends no ledger events/)]);
    // Another slot or another agent named in the appended event: refused.
    expect(judge([submit, { ...pickEvent, slot: "designer/other.slot" }]).issues).toEqual([expect.stringMatching(/names slot designer\/other\.slot, not designer\//)]);
    expect(judge([submit, { ...pickEvent, by: "agent:writer" }]).issues).toEqual([expect.stringMatching(/is by agent:writer, not agent:designer/)]);
    expect(judge([submit, { ...pickEvent, decidedBy: "owner:chat" }]).issues).toEqual([expect.stringMatching(/is decided by owner:chat, not agent:designer/)]);
    expect(judge([submit, { ...pickEvent, op: "pin", verb: "pin", basis: undefined }]).issues).toEqual([expect.stringMatching(/pin needs basis/)]);
    // Another slot's ledger is no append of this step's: refused even when it is a valid append.
    const otherId = readdirSync(join(root, "clossys", "agents", "designer")).sort().filter(id => id !== slotId && !id.startsWith("loop.") && !id.startsWith("_"))[0]!;
    const other = join(root, "clossys", "agents", "designer", otherId, "ledger.json");
    writeFileSync(file, ledger([submit]));
    writeFileSync(other, ledger([submit]));
    const before = treeSnapshot(root, "x");
    writeFileSync(other, ledger([submit, pickEvent]));
    expect(judgeSnapshot(root, before, treeSnapshot(root, "x"), new Set(), pick, "designer", subject).issues).toEqual([`changed designer/${otherId}/ledger.json without reporting it (--wrote)`]);
    // A step of another agent than the run slot's: its own ledger of the same slot id is not the run slot's ledger.
    writeFileSync(file, ledger([submit]));
    const foreignRun = treeSnapshot(root, "x");
    writeFileSync(file, ledger([submit, pickEvent]));
    expect(judgeSnapshot(root, foreignRun, treeSnapshot(root, "x"), new Set(), pick, "designer", { agent: "writer", slotId }).issues).toEqual([`changed designer/${slotId}/ledger.json without reporting it (--wrote)`]);
    // A hard-linked ledger is no regular append.
    writeFileSync(file, ledger([submit]));
    const linkedBefore = treeSnapshot(root, "x");
    rmSync(file);
    writeFileSync(other, ledger([submit, pickEvent]));
    linkSync(other, file);
    expect(judgeSnapshot(root, linkedBefore, treeSnapshot(root, "x"), new Set(), pick, "designer", subject).issues).toEqual(expect.arrayContaining([expect.stringMatching(/ledger\.json: is not a regular file with one link/)]));
  }, LONG);

  it("lets the real verbs of the standard create and pick steps through; only the bound pick that wrote its pin may clear its own cascade re-verdict", async () => {
    const root = copy();
    expect((await loop(root, "writer/loop.create")).exitCode).toBe(0);
    const slotId = "sections.hero.copy";
    const slot = `writer/${slotId}`;
    const draft = (heading: string) => `---\nslot: "${slotId}"\nlocales: ["en"]\nreason: "realises director:advantage.proposition.promise for the hero"\nsource: {"kind":"derived","ref":["director:identity.verbal.voice","director:advantage.proposition.promise","director:identity.naming.name"]}\n---\n\n## en\n### header.heading\n<!-- {"id":"header.heading","bindings":[]} -->\n${heading}\n### actions.primary.label\n<!-- {"id":"actions.primary.label","bindings":[]} -->\nGet started\n`;
    const candidates = () => { const dir = join(root, "clossys", "agents", slot, "candidates"); return existsSync(dir) ? readdirSync(dir).sort() : []; };
    // loop.create: refine-brief answers with nothing written, then the create step runs the real submit verb.
    const created = await startRun(root, { loop: "loop.create", slot }, answering("refine-brief", []), { now: minute(1) });
    expect(created.packet?.step, created.message).toBe("create");
    const had = candidates();
    // The candidate writer behind the submit verb (clossys next --submit): the candidate and its submit event.
    const written = writeCandidate(join(root, "clossys"), "writer", slotId, "copy", draft("Ship your site this week"), { at: AT, provenance: { by: "agent:writer", model: "m", tier: "high" } });
    const added = candidates().filter(name => !had.includes(name));
    expect(added).toEqual([written.name]);
    const createDone = await resumeRun(root, created.state!.runId, answering("create", [`${slot}/candidates/${added[0]}`]), { now: minute(2) });
    expect(createDone.message).not.toMatch(/refuses it|does not declare/);
    expect(createDone.state?.steps.find(step => step.id === "create")?.exit).toBe(0);

    // The standard pick step's real verb (clossys pin <ref> <candidate> --by agent:writer), judged as the runner judges
    // it on resume (a run can reach pick only past rank's candidates.certified check, so the step is judged directly).
    const plan = planRun(root, { loop: "loop.choose", slot }, AT);
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.state.version.ref).toBe("writer/loop.choose/choose-v1.json");
    const pick = standardStep("loop.choose", "pick");
    const wrote = [`${slot}/pin.json`, `.clossys/checks/writer/${slotId}/scorecard.json`];
    const reported = new Set(wrote.map(file => file.startsWith(".clossys/") ? file : `clossys/agents/${file}`));
    const pickJudged = (withCascade: boolean) => {
      const cascade = join(root, ".clossys", "checks", "writer", slotId, "cascade.json");
      if (withCascade) { mkdirSync(join(cascade, ".."), { recursive: true }); writeFileSync(cascade, `${JSON.stringify({ schema: "clossys.reverdict/1", verdicts: [] })}\n`); }
      rmSync(pinPath(root, "writer", slotId), { force: true });
      const before = treeSnapshot(root, plan.state.runId);
      return { before, run: runCli(["pin", `${slot}#copy`, written.name, "--by", "agent:writer", "--at", AT, "--root", root], root) };
    };
    const clean = pickJudged(false);
    const cleanPin = await clean.run;
    expect(cleanPin.exitCode, cleanPin.message).toBe(0);
    const cleanAfter = treeSnapshot(root, plan.state.runId);
    const choose = standardOf("loop.choose");
    if (!choose.ok) throw new Error(choose.reason);
    const subject = plan.state.subject!;
    expect(judgeSnapshot(root, clean.before, cleanAfter, reported, pick, "writer", subject, choose.standard).issues).toEqual([]);
    expect(undeclaredWrites(root, plan.state, pick, wrote, clean.before)).toEqual([]);
    // With a cascade re-verdict there, the same pick removes it (clearReverdict): the bound standard pick that wrote its
    // pin may (planner decision, U9a fix round 4); without the standard to bind it to, the removal is refused.
    const clearing = pickJudged(true);
    const clearingPin = await clearing.run;
    expect(clearingPin.exitCode, clearingPin.message).toBe(0);
    const own = `.clossys/checks/writer/${slotId}/cascade.json`;
    const after = treeSnapshot(root, plan.state.runId);
    expect(clearing.before[own]).toMatch(/^file:/);
    expect(after[own]).toBeUndefined();
    const judge = (before: Record<string, string>, now: Record<string, string>, step: typeof pick, standard = choose.standard) => judgeSnapshot(root, before, now, reported, step, "writer", subject, standard).issues;
    expect(judge(clearing.before, after, pick)).toEqual([]);
    expect(judgeSnapshot(root, clearing.before, after, reported, pick, "writer", subject).issues).toEqual([`removed ${own}`]);
    // Refused: another slot's or another agent's re-verdict removed beside it.
    for (const foreign of [".clossys/checks/writer/sections.article.copy/cascade.json", `.clossys/checks/designer/${slotId}/cascade.json`]) {
      expect(judge({ ...clearing.before, [foreign]: clearing.before[own]! }, after, pick)).toEqual([`removed ${foreign}`]);
    }
    // Refused: the removal without the pin record it wrote (absent, or unchanged from before).
    const pinKey = `clossys/agents/${slot}/pin.json`;
    const noPin = { ...after }; delete noPin[pinKey];
    expect(judge(clearing.before, noPin, pick)).toContain(`removed ${own}`);
    expect(judge({ ...clearing.before, [pinKey]: after[pinKey]! }, after, pick)).toEqual([`removed ${own}`]);
    // Refused: a non-pick verb removing its own re-verdict (refine-brief of loop.create, or a cascade step).
    const create = standardOf("loop.create");
    if (!create.ok) throw new Error(create.reason);
    expect(judge(clearing.before, after, standardStep("loop.create", "refine-brief"), create.standard)).toContain(`removed ${own}`);
    expect(judge(clearing.before, after, { ...pick, decider: { ...pick.decider, verb: "create-candidates" } } as typeof pick)).toContain(`removed ${own}`);
    // Refused: a pick step whose cli is not the standard's (not the bound pick step), or one of another id.
    expect(judge(clearing.before, after, { ...pick, cli: "clossys next" })).toEqual([`removed ${own}`]);
    expect(judge(clearing.before, after, { ...pick, id: "pick-again" })).toEqual([`removed ${own}`]);
  }, LONG);
});
