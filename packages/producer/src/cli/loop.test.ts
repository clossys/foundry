/**
 * `clossys loop <agent>/loop.<name>` and the agent loop tree checks (foundry-build-0048 U9a): the verb adopts the
 * agent's five loop slots and pins each through the pin gate, the runner then runs the agent's pinned version, and
 * `loop.agent-standard` / `loop.connected` refuse a consumer whose agent loops are missing, unpinned, drop a required
 * step or break the chain.
 */
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// Load the CLI first, as every caller does: owner.ts sits in an import cycle with the pipeline handlers.
import "./main.js";
import { runLoopCli } from "./loop.js";
import { runIaCli } from "./owner.js";
import { runLoopAgentStandard, runLoopConnected } from "../check/loop-connected.js";
import { AGENT_LOOPS, LOOP_AGENTS } from "../loop/agent-loops.js";
import { loadLoopVersion } from "../loop/version.js";
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

/** Each test adopts and pins loops through the built CLI paths; the whole suite runs these in parallel with heavier files. */
const LONG = 120_000;

describe("clossys loop", () => {
  it("adopts the agent's five loop slots, pins each through the gate, and the runner runs the agent's pin", async () => {
    const root = copy();
    const result = await loop(root, "director/loop.create");
    expect(result.exitCode, result.message).toBe(0);
    expect(result.message).toMatch(/^VERDICT: PASS director\/loop\.create runs director\/loop\.create\/create-v1\.json \(pinned, extends producer\/loop\.create\)/);
    expect(result.message).toContain("adopted director's five loop slots");
    for (const each of AGENT_LOOPS) {
      const pin = readJson(join(slotDir(root, "director", each), "pin.json"));
      // A planner-basis pin the gate wrote: certified, scored, recorded; never hand-placed.
      expect(pin, each).toMatchObject({ schema: "clossys.pin/2", basis: "planner", decidedBy: "planner:package-default", createdBy: { cli: "clossys pin" } });
      expect(readJson(join(slotDir(root, "director", each), "slot.json")), each).toMatchObject({ kind: "loop", standard: "loop", contract: { loop: each, extends: `producer/${each}` } });
    }
    // An agent loop slot is a readiness root: it extends Producer's standard and no upstream pin feeds it.
    for (const each of AGENT_LOOPS) expect(readiness(join(root, "clossys"), "director", each), each).toEqual({ ready: true, blockedBy: [] });
    const load = loadLoopVersion(root, "loop.create", "director");
    expect(load.ok && load.loaded.ref).toBe("director/loop.create/create-v1.json");
    expect(runLoopAgentStandard(root).findings).toEqual([]);
    expect(runLoopConnected(root).findings).toEqual([]);
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
    // An unadopted consumer runs Producer's standard for the agent: the checks pass on it.
    expect(runLoopAgentStandard(root).findings).toEqual([]);
    expect(runLoopConnected(root).findings).toEqual([]);
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
