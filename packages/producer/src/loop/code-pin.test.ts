/**
 * DET-STEPS round 2, planner D5 "Pick = A": code pins (basis scorecard, decidedBy code:scorecard) only the scorecard's
 * single top row, and never a slot with an owner-pick or confirm step. The pin gate still judges every pin.
 *
 * The world is the pin-gate hero world (test-fixtures/consumer with the hero's render sample recorded and its upstream
 * pinned): designer/sections.hero has no owner step and is a whole slot, so it is the one code may pin.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { ownerEntry } from "../cli/__fixtures__/owner-entry.js";
import { pinUpstream } from "../cli/__fixtures__/upstream.js";
import { runPinCli } from "../cli/pin.js";
import { pinGate } from "../constitution/pin-gate.js";
import { buildCandidateHeader, candidatePath, serializeCandidate, writeCandidateFile } from "../records/candidate.js";
import { skillPath } from "../records/ledger.js";
import { buildPin, cliActor, CODE_SCORECARD, pinIssues, pinPath, writePinDoc } from "../records/pin.js";
import { answerRequest, raiseWork } from "../records/request.js";
import { appendSlotDocEvent, writeCandidate, writeCandidateBytes } from "../records/slot-write.js";
import { gapsOf } from "../pipeline/interview.js";
import { codeSlotRefusals, heldDecisionRefusal, ownerStepRefusal, scorecardTopRefusal } from "./code-pin.js";
import { readAgentLoopPin, type AgentLoopName, type LoopAgent } from "./agent-loops.js";
import { readPackageLoop } from "./files.js";
import type { LoopName } from "./names.js";
import { startRun, type AgentPacket, type CodeCall, type RunHooks } from "./runner.js";

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const AT = "2026-11-17T12:00:00Z";
const LATER = "2026-11-17T13:00:00Z";
const HERO = "sections.hero";
const QUEUE_ID = "20261117T1200Z-hero";
const HERO_SOURCE = { kind: "derived", ref: ["tailark-oss/mist-hero-section-1@8139698"], hash: "sha256:315ecac252ac891e44ae37f2c2d946312c78f3998fd7ed5d7279ab0f1582ce52", license: "MIT" };
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const heroCode = (heading: string) => ({
  $schema: "https://ui.shadcn.com/schema/registry-item.json",
  name: "hero",
  type: "registry:block",
  files: [{ path: "hero.tsx", type: "registry:block", content: `export function Hero() { return <section><h1>${heading}</h1></section>; }\n` }],
  meta: { slot: HERO, source: HERO_SOURCE },
});

function heroWorld() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "code-pin-")));
  roots.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  const consumer = join(root, "clossys");
  const file = join(consumer, "agents", "designer", HERO, "slot.json");
  const doc = JSON.parse(readFileSync(file, "utf8"));
  doc.contract.props = [];
  doc.contract.fixture = { schema: "clossys.element-preview/1", fixtures: { file: "hero.tsx", export: "Hero", props: {} } };
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  appendSlotDocEvent(consumer, "designer", HERO, { by: "planner", at: AT, verb: "ia", skill: skillPath("producer", "ia"), fields: { kind: "ia", note: "fixture render sample" } });
  pinUpstream(consumer, "designer", HERO, AT);
  const pinFile = join(consumer, "agents", "designer", HERO, "pin.json");
  return {
    root, consumer, pinFile,
    submit: (heading: string) => writeCandidate(consumer, "designer", HERO, "hero", heroCode(heading), { at: AT, provenance: { by: "agent:designer", model: "claude-opus-5-5", tier: "high" } }),
    codePin: (candidate: string) => runPinCli([`designer/${HERO}`, candidate, "--by", CODE_SCORECARD, "--at", AT, "--root", root], root),
    ownerPin: (candidate: string) => {
      ownerEntry(consumer, { id: QUEUE_ID, about: `designer/${HERO}`, answer: { candidate }, at: AT });
      return runPinCli([`designer/${HERO}`, candidate, "--by", `owner:queue.pick#${QUEUE_ID}`, "--at", AT, "--root", root], root);
    },
    scorecard: () => pinGate(root, consumer, "designer", HERO, "", AT).scorecard,
  };
}

/** The owner's pin of a consumer loop version (as loop-reachable.test pins one): `change` edits the package v1. */
function pinConsumerLoop(root: string, loop: LoopName, change: (content: { steps: { id: string; when?: unknown }[] } & Record<string, unknown>) => unknown): void {
  const packaged = readPackageLoop(loop);
  if (!packaged.ok) throw new Error(packaged.reason);
  const name = `${loop.slice(5)}-v2.json`;
  const header = buildCandidateHeader({ agent: "producer", slotId: loop, name, createdBy: { actor: "planner", ref: "test" }, createdAt: "2026-11-17T07:00:00Z", source: { kind: "original", ref: [] } });
  const sha256 = writeCandidateFile(candidatePath(root, "producer", loop, name), serializeCandidate(name, header, change(structuredClone(packaged.content) as never)));
  const id = `20261117T0700Z-${loop.replace(".", "-")}`;
  writePinDoc(pinPath(root, "producer", loop), buildPin({ agent: "producer", slotId: loop, record: { candidate: name, sha256, decidedBy: `owner:queue.pick#${id}`, basis: "picked", at: "2026-11-17T07:00:00Z" }, refs: [{ to: "producer/queue.pick" as never, record: id, rel: "answers" }], createdBy: cliActor("clossys pin") }));
}

/** The planner's repin of an adopted agent loop slot through the pin gate: `change` edits the agent's pinned version. */
async function pinAgentLoop(root: string, agent: LoopAgent, loop: AgentLoopName, change: (content: { steps: { id: string; when?: unknown }[] } & Record<string, unknown>) => unknown): Promise<void> {
  const own = readAgentLoopPin(root, agent, loop);
  if (!own?.ok) throw new Error(own?.reason ?? `${agent}/${loop} is not adopted`);
  const name = `${loop.slice(5)}-v2.json`;
  const header = buildCandidateHeader({ agent, slotId: loop, name, createdBy: { actor: "planner", ref: "test" }, createdAt: AT, source: { kind: "original", ref: [] } });
  writeCandidateBytes(join(root, "clossys"), agent, loop, name, serializeCandidate(name, header, change(structuredClone(own.content) as never)), { at: AT });
  const pinned = await runPinCli([`${agent}/${loop}`, name, "--by", "planner:test", "--at", AT, "--root", root], root);
  if (pinned.exitCode !== 0) throw new Error(pinned.message);
}

/** loop.choose's own hooks: every code verb passes; the agent seat's pick is recorded and does nothing. */
function hooks(onCode?: (call: CodeCall) => void): RunHooks & { readonly agentSteps: string[]; readonly codeSteps: string[] } {
  const agentSteps: string[] = [];
  const codeSteps: string[] = [];
  return {
    agentSteps, codeSteps,
    agent(packet: AgentPacket) { agentSteps.push(packet.step); return { exit: 0, model: "stub-model" }; },
    code(call: CodeCall) { codeSteps.push(call.step); onCode?.(call); return { exit: 0 }; },
  };
}
const settleOf = (root: string, runId: string) => JSON.parse(readFileSync(join(root, "clossys", ".state", "runs", "loops", `${runId}.settle`, "score.json"), "utf8"));
const clock = () => { let tick = 0; return () => new Date(Date.parse("2026-11-17T12:30:00Z") + 1000 * tick++); };

describe("clossys pin --by code:scorecard: code pins the scorecard's single top row on a slot with no owner step", () => {
  it("pins a lone submitted, certified candidate: basis scorecard, decidedBy code:scorecard, status confirm, the scorecard cited", async () => {
    const w = heroWorld();
    const good = w.submit("Ship your site this week");
    const result = await w.codePin(good.name);
    expect(result.exitCode, result.message).toBe(0);
    const pin = JSON.parse(readFileSync(w.pinFile, "utf8"));
    const record = pin.record ?? pin;
    expect(record).toMatchObject({ candidate: good.name, decidedBy: CODE_SCORECARD, basis: "scorecard" });
    expect(record.status ?? "confirm").not.toBe("pinned");
    expect(JSON.stringify(pin.refs)).toContain("producer/checks.scorecard");
    expect(pinIssues(pin)).toEqual([]);
  }, 60_000);

  it("refuses a tie: two passing rows with the same reasons are the agent's pick (mutation 1)", async () => {
    const w = heroWorld();
    const first = w.submit("Ship your site this week");
    const second = w.submit("Launch your site this week");
    const card = w.scorecard();
    expect(card.candidates.filter(row => row.submitted && row.certified)).toHaveLength(2);
    expect(scorecardTopRefusal(card, card.candidates[0]!.candidate)).toMatch(/tie/);
    const result = await w.codePin(card.candidates[0]!.candidate);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/tie/);
    expect(existsSync(w.pinFile)).toBe(false);
    expect([first.name, second.name]).toContain(card.candidates[0]!.candidate);
  }, 60_000);

  it("refuses a pick that is not the top row and a slot with no passing row", () => {
    const empty = { candidates: [] } as unknown as Parameters<typeof scorecardTopRefusal>[0];
    expect(scorecardTopRefusal(empty, "hero-v1.json")).toMatch(/no submitted, certified row/);
    const card = { candidates: [{ candidate: "a.json", submitted: true, certified: true, reasons: [] }, { candidate: "b.json", submitted: true, certified: true, reasons: ["one"] }] } as unknown as Parameters<typeof scorecardTopRefusal>[0];
    expect(scorecardTopRefusal(card, "a.json")).toBeUndefined();
    expect(scorecardTopRefusal(card, "b.json")).toMatch(/not the scorecard's top row/);
  });

  it("refuses every owner-pick and confirm slot by name: Director, legal prose, themes, assets (mutation 2)", () => {
    const w = heroWorld();
    for (const [agent, slotId, kind] of [
      ["director", "advantage.model.margin", "owner-pick"],
      ["writer", "narratives.legal-document", "owner-pick"],
      ["designer", "themes.accent", "confirm"],
      ["designer", "assets.favicon", "confirm"],
    ] as const) {
      // The first loop holding an agent pick step names it (loop.fill before loop.choose in LOOP_NAMES).
      expect(ownerStepRefusal(w.root, agent, slotId), `${agent}/${slotId}`).toMatch(new RegExp(`has the ${kind} step loop\\.\\w+/${kind} \\(queue\\.${kind === "owner-pick" ? "pick" : "approve"}\\)`));
      expect(codeSlotRefusals(w.root, agent, slotId).join("; ")).toMatch(/never code's/);
    }
    expect(ownerStepRefusal(w.root, "designer", HERO)).toBeUndefined();
    expect(codeSlotRefusals(w.root, "designer", HERO)).toEqual([]);
  });

  it("refuses the hero once the consumer's own loop version gives it a confirm step, before the gate judges anything", async () => {
    const w = heroWorld();
    const good = w.submit("Ship your site this week");
    // R3: the fixture adopts each placed agent's loops, so the consumer's own loop.choose for the hero is designer's.
    await pinAgentLoop(w.root, "designer", "loop.choose", content => ({ ...content, steps: content.steps.map(step => step.id === "confirm" ? { ...step, when: { ia: ["designer/themes", "designer/assets", "designer/sections", "writer/voice"] } } : step) }));
    expect(ownerStepRefusal(w.root, "designer", HERO)).toMatch(/has the confirm step loop\.choose\/confirm/);
    const result = await w.codePin(good.name);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/is not code's to pin/);
    expect(existsSync(w.pinFile)).toBe(false);
  }, 60_000);

  it("never replaces an owner pick: the held owner decision refuses the code pin and stays", async () => {
    const w = heroWorld();
    const good = w.submit("Ship your site this week");
    const owner = await w.ownerPin(good.name);
    expect(owner.exitCode, owner.message).toBe(0);
    const held = readFileSync(w.pinFile, "utf8");
    const result = await w.codePin(good.name);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/code never replaces an owner or planner decision/);
    expect(readFileSync(w.pinFile, "utf8")).toBe(held);
  }, 60_000);

  it("refuses code:scorecard with another basis, and basis scorecard decided by anyone but code", async () => {
    const w = heroWorld();
    const good = w.submit("Ship your site this week");
    await expect(runPinCli([`designer/${HERO}`, good.name, "--by", CODE_SCORECARD, "--basis", "agent", "--at", AT, "--root", w.root], w.root)).rejects.toThrow(/--by code:scorecard is a code pin: its basis is scorecard/);
    expect(existsSync(w.pinFile)).toBe(false);
    const pin = buildPin({ agent: "designer", slotId: HERO, record: { candidate: good.name, sha256: "0".repeat(64), decidedBy: "agent:designer", basis: "scorecard" as never, at: AT }, refs: [], createdBy: cliActor("clossys pin") });
    expect(pinIssues(pin).join("; ")).toMatch(/scorecard/);
  }, 60_000);
});

describe("DET-STEPS fix r1 ruling: a code pin gets the owner surfaces of an agent pick", () => {
  it("raises agent-pick.unconfirmed for a code pin, offers its confirm option, and the owner's answer confirms it (clossys pin --confirm)", async () => {
    const w = heroWorld();
    const good = w.submit("Ship your site this week");
    expect((await w.codePin(good.name)).exitCode).toBe(0);
    const unconfirmed = () => gapsOf(w.root, { agent: "designer" }).gaps.filter(gap => gap.code === "agent-pick.unconfirmed" && gap.item === `designer/${HERO}`);
    expect(unconfirmed()).toEqual([expect.objectContaining({ kind: "coverage", agent: "designer", step: "pin.designer", decider: "owner", message: `designer/${HERO}: code pick (${CODE_SCORECARD}) ${good.name} waits for the owner's confirmation` })]);
    const entry = raiseWork(w.consumer, { kind: "change", target: `designer/${HERO}`, from: "owner", want: "repin", why: "confirm the hero", source: "cli", by: "owner", at: AT }).request;
    const option = entry.options?.find(each => each.then.args[2] === "--confirm");
    expect(option, JSON.stringify(entry.options)).toMatchObject({ label: expect.stringContaining(`Confirm ${CODE_SCORECARD}'s pick ${good.name}`), then: { verb: "pin", args: [`designer/${HERO}`, good.name, "--confirm"] } });
    const answered = await answerRequest(w.consumer, entry.id, { option: option!.id, at: LATER, via: "chat", quote: "Confirm it." });
    expect(answered.ok, answered.message).toBe(true);
    const pin = JSON.parse(readFileSync(w.pinFile, "utf8"));
    expect(pin).toMatchObject({ candidate: good.name, sha256: good.sha256, decidedBy: CODE_SCORECARD, basis: "scorecard", status: "pinned", confirmed: { by: "owner", ref: `producer/queue.change#${entry.id}`, at: LATER } });
    expect(pinIssues(pin, { agent: "designer", slotId: HERO })).toEqual([]);
    expect(unconfirmed()).toEqual([]);
  }, 120_000);

  it("runTargetConfirm confirms a code pin with the owner's typed answer, and still refuses an owner pin", async () => {
    const w = heroWorld();
    const good = w.submit("Ship your site this week");
    expect((await w.codePin(good.name)).exitCode).toBe(0);
    const entry = raiseWork(w.consumer, { kind: "change", target: `designer/${HERO}`, from: "owner", want: "repin", why: "confirm the hero", source: "cli", by: "owner", at: AT }).request;
    const option = entry.options!.find(each => each.then.args[2] === "--confirm")!;
    expect((await answerRequest(w.consumer, entry.id, { option: option.id, at: LATER, via: "chat", quote: "Confirm it." })).ok).toBe(true);
    const confirmed = readFileSync(w.pinFile, "utf8");
    // Confirmed once: a second --confirm is refused and changes nothing.
    const again = await runPinCli([`designer/${HERO}`, good.name, "--confirm", "--by", `owner:queue.change#${entry.id}`, "--at", LATER, "--root", w.root], w.root);
    expect(again.exitCode).toBe(1);
    expect(readFileSync(w.pinFile, "utf8")).toBe(confirmed);
    // An owner pin is its own decision: --confirm refuses its basis.
    const o = heroWorld();
    const pick = o.submit("Ship your site this week");
    expect((await o.ownerPin(pick.name)).exitCode).toBe(0);
    const refused = await runPinCli([`designer/${HERO}`, pick.name, "--confirm", "--by", `owner:queue.pick#${QUEUE_ID}`, "--at", LATER, "--root", o.root], o.root);
    expect(refused).toMatchObject({ exitCode: 1, message: expect.stringMatching(/is pinned with basis picked; only an agent or code pick is confirmed/) });
  }, 120_000);

  it("heldDecisionRefusal refuses a pin.json code cannot read as a valid pin/2: an int2 pin/1, broken JSON, an invalid pin/2", () => {
    const w = heroWorld();
    mkdirSync(join(w.consumer, "agents", "designer", HERO), { recursive: true });
    expect(heldDecisionRefusal(w.root, "designer", HERO)).toBeUndefined();
    writeFileSync(w.pinFile, `${JSON.stringify({ candidate: "hero-v1.json", sha256: "0".repeat(64), decidedBy: "owner", basis: "picked", at: AT })}\n`);
    expect(heldDecisionRefusal(w.root, "designer", HERO)).toMatch(/cannot read as a valid clossys\.pin\/2 \(pin\.json is an int2 pin \(pin\/1\)/);
    expect(codeSlotRefusals(w.root, "designer", HERO).join("; ")).toMatch(/code never replaces a pin it cannot read/);
    writeFileSync(w.pinFile, "{ not json");
    expect(heldDecisionRefusal(w.root, "designer", HERO)).toMatch(/pin\.json is not JSON/);
    const pin = buildPin({ agent: "designer", slotId: HERO, record: { candidate: "hero-v1.json", sha256: "0".repeat(64), decidedBy: CODE_SCORECARD, basis: "scorecard", at: AT }, refs: [{ to: "producer/checks.scorecard" as never, rel: "cites" }], createdBy: cliActor("clossys pin") });
    writePinDoc(w.pinFile, { ...pin, id: "designer/sections.footer/pin" } as never);
    expect(heldDecisionRefusal(w.root, "designer", HERO)).toMatch(/code never replaces a pin it cannot read/);
    writePinDoc(w.pinFile, pin);
    expect(heldDecisionRefusal(w.root, "designer", HERO)).toBeUndefined();
  });
});

describe("loop.choose's score step (clossys settle pick): code settles the pick, or the agent picks", () => {
  it("settles a lone certified candidate: the code pin is written and the agent pick never runs", async () => {
    const w = heroWorld();
    const good = w.submit("Ship your site this week");
    const h = hooks();
    const run = await startRun(w.root, { loop: "loop.choose", slot: `designer/${HERO}` }, h, { now: clock() });
    expect(run.state, run.message).toBeDefined();
    const settle = settleOf(w.root, run.state!.runId);
    expect(settle).toMatchObject({ schema: "clossys.settle/1", rule: "pick", outcome: "settled", settles: ["pick"], answer: `pin ${good.name}` });
    expect(h.agentSteps).not.toContain("pick");
    const pin = JSON.parse(readFileSync(w.pinFile, "utf8"));
    expect(pin.record ?? pin).toMatchObject({ candidate: good.name, decidedBy: CODE_SCORECARD, basis: "scorecard" });
  }, 60_000);

  it("hands a tie to the agent: outcome agent, nothing pinned by code, the pick step runs", async () => {
    const w = heroWorld();
    w.submit("Ship your site this week");
    w.submit("Launch your site this week");
    const h = hooks();
    const run = await startRun(w.root, { loop: "loop.choose", slot: `designer/${HERO}` }, h, { now: clock() });
    const settle = settleOf(w.root, run.state!.runId);
    expect(settle).toMatchObject({ rule: "pick", outcome: "agent", settles: [], why: expect.stringMatching(/tie.*the agent picks/) });
    expect(h.agentSteps).toContain("pick");
    expect(existsSync(w.pinFile)).toBe(false);
  }, 60_000);

  it("defers to the agent when the code pin cannot be written (its scorecard folder is a file), and records the deferral", async () => {
    const w = heroWorld();
    w.submit("Ship your site this week");
    // After rank, the slot's checks folder becomes a file: the gate still reads, the code pin's scorecard write fails.
    const checks = join(w.root, "clossys", ".state", "checks", "designer", HERO);
    const h = hooks(call => { if (call.step === "rank") { rmSync(checks, { recursive: true, force: true }); mkdirSync(join(checks, ".."), { recursive: true }); writeFileSync(checks, "not a folder\n"); } });
    const run = await startRun(w.root, { loop: "loop.choose", slot: `designer/${HERO}` }, h, { now: clock() });
    const settle = settleOf(w.root, run.state!.runId);
    expect(settle).toMatchObject({ rule: "pick", outcome: "deferred", settles: [], why: expect.stringMatching(/^code could not decide/) });
    expect(h.codeSteps).toContain("rank");
    expect(h.agentSteps).toContain("pick");
    expect(existsSync(w.pinFile)).toBe(false);
  }, 60_000);
});
