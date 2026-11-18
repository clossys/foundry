/**
 * flows.md F1-F8 replayed through `clossys run` with a stub decider. Each test builds a consumer in a tmp dir that
 * holds structure only: slot ids from the real package IA trees, placeholder candidates, no names, brands or prices.
 * The stub stands in for every agent skill and for the CLI verbs a code step runs; no model is called.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runRunCli } from "../cli/run.js";
import { answerQueueEntry } from "../queue/answer.js";
import { findQueueEntry, listQueueEntryFiles, readQueueEntry } from "../queue/entry.js";
import { raiseFeedback } from "../queue/feedback.js";
import { buildCandidateHeader, candidateCreatedBy, candidatePath, parseCandidateName, serializeCandidate, writeCandidateFile } from "../records/candidate.js";
import { writeTargetPin, type TargetPinInput } from "../records/pin-map.js";
import { isRecordSlot } from "../records/resolve.js";
import { buildPin, cliActor, pinIssues, pinPath, writePinDoc } from "../records/pin.js";
import { readPinFile } from "../records/pin-map.js";
import { runCli, type CliResult } from "../cli/main.js";
import { runReleaseCli } from "../cli/release.js";
import { releaseWorld, geographyBrief, stubBuilder, type ReleaseWorld } from "../release/__fixtures__/world.js";
import { sha256Hex } from "../records/hash.js";
import { writeSlot } from "../records/slot.js";
import { writeCandidate } from "../records/slot-write.js";
import type { AgentId, LedgerEntry, QueueEntry, Slot } from "../records/types.js";
import { readPackageLoop } from "./files.js";
import { raiseEntry } from "./route.js";
import { cliHooks } from "./cli.js";
import { MissingSkillError, skillFor, stepArgv } from "./slots.js";
import { fillAll, ledgerDir, readRunState, resumeRun, runInit, runStatePath, runsDir, startRun, type AgentOutcome, type AgentPacket, type CodeCall, type CodeOutcome, type Exit, type RunHooks } from "./runner.js";
import type { LoopName } from "./names.js";

const MODEL = "stub-model";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** A deterministic clock: one minute per call, so entry and run ids differ. */
function clock(start = "2026-11-20T08:00:00Z"): () => Date {
  let at = Date.parse(start);
  return () => { const now = new Date(at); at += 60_000; return now; };
}

type Ia = Slot["ia"];
/** Real IA positions, as `clossys ia sync` writes them (the package IA ids as they are, dots included: B12). */
const SLOTS: Record<string, { agent: AgentId; kind: Slot["kind"]; ia: Ia }> = {
  "director/context.market.size": { agent: "director", kind: "brief", ia: { l0: "strategy", l1: "context", l2: "context.market", order: 0 } },
  "designer/themes.background": { agent: "designer", kind: "element/token", ia: { l0: "themes", l1: "themes.colors", l2: "colors-surfaces", order: 0 } },
  "designer/components.button": { agent: "designer", kind: "element/component", ia: { l0: "components", l1: "components.actions", l2: "actions-buttons", order: 0 } },
  "designer/sections.features": { agent: "designer", kind: "element/section", ia: { l0: "sections", l1: "sections.explain", l2: "explain-promotion", order: 0 } },
  "writer/lexicon.formality": { agent: "writer", kind: "voice", ia: { l0: "voice", l1: "voice.tone", l2: "attitude", order: 0 } },
  "writer/narratives.legal-document": { agent: "writer", kind: "prose", ia: { l0: "prose", l1: "prose.reference", l2: "policies", order: 0 } },
};

const SKILLS = (agent: AgentId): string[] => [`packages/${agent}/actions/${agent}.brief/skill.md`, `packages/${agent}/actions/${agent}.candidates/skill.md`, `packages/${agent}/actions/pick.${agent}/skill.md`];

function world(refs: readonly string[]) {
  const root = mkdtempSync(join(tmpdir(), "loop-flows-"));
  roots.push(root);
  const put = (rel: string, text: string): void => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  put("clossys/clossys.config.ts", "export default {};\n");
  for (const agent of ["director", "designer", "writer", "publisher", "producer"] as AgentId[]) {
    put(`packages/${agent}/package.json`, JSON.stringify({ name: `@clossys/${agent}`, version: "0.0.0" }));
    for (const skill of SKILLS(agent)) put(skill, "# placeholder skill\n");
  }
  const slotFile = (ref: string): string => join(root, "clossys", "agents", ref, "slot.json");
  const api = {
    root,
    slot(ref: string, extra: Partial<Slot> = {}): void {
      const spec = SLOTS[ref]!;
      const slotId = ref.split("/")[1]!;
      writeSlot(slotFile(ref), {
        schema: "clossys.slot/2", id: slotId, agent: spec.agent, kind: spec.kind, status: "starter",
        createdBy: { actor: "code", cli: "clossys ia sync", version: "0.1.0" }, createdAt: "2026-11-20T07:00:00Z", refs: [],
        ia: spec.ia, base: null, standard: `${spec.agent}.placeholder`,
        brief: { purpose: "placeholder", mustDo: [], inputs: [], acceptance: [] }, contract: {}, tighten: [], ...extra,
      } as Slot);
    },
    readSlot(ref: string): Slot { return JSON.parse(readFileSync(slotFile(ref), "utf8")) as Slot; },
    entry(name: string): QueueEntry {
      const found = findQueueEntry(root, name);
      if (!found.ok) throw new Error(found.reason);
      const read = readQueueEntry(found.at);
      if (!read.ok) throw new Error(`unreadable ${name}`);
      return read.entry;
    },
    ledger(loop: LoopName): LedgerEntry[] {
      const dir = ledgerDir(root, loop);
      return existsSync(dir) ? readdirSync(dir).sort().map(name => JSON.parse(readFileSync(join(dir, name), "utf8")) as LedgerEntry) : [];
    },
  };
  for (const ref of refs) api.slot(ref);
  return api;
}

interface Stub extends RunHooks {
  readonly calls: { step: string; kind: "agent" | "code"; wait?: boolean }[];
  readonly code_: CodeCall[];
}

/**
 * The stub decider. Agents: refine-brief writes nothing; create-candidates writes one placeholder candidate; pick pins
 * the newest candidate (basis agent). Code: `clossys check <ref>` passes unless `checkExits` says otherwise; an owner
 * pick's `clossys pin` writes the owner pin; release steps write a placeholder manifest.
 */
function stub(root: string, options: { checkExits?: Exit[]; waitOnce?: string[]; codeFor?: (call: CodeCall) => CodeOutcome | undefined; agentFor?: (packet: AgentPacket) => AgentOutcome | undefined } = {}): Stub {
  const calls: Stub["calls"] = [];
  const code_: CodeCall[] = [];
  const checkExits = [...(options.checkExits ?? [])];
  const waitOnce = new Set(options.waitOnce ?? []);
  // Before the run clock (08:00): the owner's confirm on a pin is never dated before the pin.
  const at = "2026-11-20T07:59:00Z";
  return {
    calls, code_,
    agent(packet: AgentPacket): AgentOutcome {
      if (waitOnce.delete(packet.step)) { calls.push({ step: packet.step, kind: "agent", wait: true }); return "wait"; }
      calls.push({ step: packet.step, kind: "agent" });
      const custom = options.agentFor?.(packet);
      if (custom) return custom;
      const [agent, slotId] = packet.ref!.split("/") as [AgentId, string];
      if (packet.verb === "create-candidates") {
        const dir = join(root, "clossys", "agents", packet.ref!, "candidates");
        const n = existsSync(dir) ? readdirSync(dir).length + 1 : 1;
        const name = `placeholder-v${n}.json`;
        const createdBy = candidateCreatedBy(root, { actor: "agent", agent, skill: packet.skill!, model: MODEL, tier: packet.tier });
        const header = buildCandidateHeader({ agent, slotId, name, createdBy, createdAt: at, source: { kind: "original", ref: [] } });
        writeCandidateFile(candidatePath(root, agent, slotId, name), serializeCandidate(name, header, { placeholder: n }));
        return { exit: 0, model: MODEL, wrote: [`${packet.ref}/candidates/${name}`] };
      }
      if (packet.verb === "pick") {
        const dir = join(root, "clossys", "agents", packet.ref!, "candidates");
        const name = readdirSync(dir).sort().pop()!;
        pinAs(root, { agent, slotId, candidate: name, decidedBy: `agent:${agent}`, basis: "agent", at, createdBy: cliActor("clossys pick") });
        return { exit: 0, model: MODEL, wrote: [`${packet.ref}/pin.json`], cli: `clossys pick ${packet.ref} ${name} --by agent:${agent}` };
      }
      return { exit: 0, model: MODEL };
    },
    code(call: CodeCall): CodeOutcome {
      calls.push({ step: call.step, kind: "code" });
      code_.push(call);
      const custom = options.codeFor?.(call);
      if (custom) return custom;
      const args = call.argv[0] === "clossys" ? call.argv.slice(1) : call.argv;
      if (args[0] === "pin") {
        const ref = args[1]!;
        const [agent, slotId] = ref.split("/") as [AgentId, string];
        const name = args[2]!;
        const by = args[4]!;
        const [queue, id] = by.slice("owner:".length).split("#") as [string, string];
        pinAs(root, { agent, slotId, candidate: name, decidedBy: by, basis: "picked", at, refs: [{ to: `producer/${queue}` as never, record: id, rel: "answers" }], createdBy: cliActor("clossys pin") });
        return { exit: 0, wrote: [`${ref}/pin.json`] };
      }
      if (call.argv[1] === "check" && call.ref) return { exit: checkExits.length ? checkExits.shift()! : 0 };
      return { exit: 0 };
    },
  };
}

/**
 * Pins as `clossys pin` / `clossys pick` do: writeTargetPin for a consumer slot (a pin map record for a Writer prose
 * or copy slot), a plain pin/2 for a slot with no slot.json (the release slot).
 */
function pinAs(root: string, input: Omit<TargetPinInput, "record">): void {
  const { agent, slotId } = input;
  if (!existsSync(join(root, "clossys", "agents", agent, slotId, "slot.json"))) {
    const sha256 = fileSha(candidatePath(root, agent, slotId, input.candidate));
    writePinDoc(pinPath(root, agent, slotId), buildPin({ agent, slotId, record: { candidate: input.candidate, sha256, decidedBy: input.decidedBy, basis: input.basis, at: input.at }, refs: [...(input.refs ?? [])], createdBy: input.createdBy as never }));
    return;
  }
  const record = isRecordSlot(root, agent, slotId) ? parseCandidateName(input.candidate)!.name : undefined;
  writeTargetPin(root, { ...input, ...(record !== undefined ? { record } : {}) });
}

/** sha256 of the candidate bytes, as resolve.ts computes it. */
const fileSha = (file: string): string => sha256Hex(readFileSync(file));

const ownerAnswer = (root: string, entry: string, answer: string, now: () => Date) =>
  answerQueueEntry(root, { entry, answer, by: "owner", via: "chat", quote: `owner said: ${answer}` }, now());

const stepLine = (entry: LedgerEntry) => entry.steps.map(step => `${step.id}:${step.decider.by}${step.decider.by === "agent" ? `/${step.decider.model}` : ""}:${step.exit}`);

describe("F1 init (T1)", () => {
  it("runs ia sync and check, then writes <stamp>-fill-init with outcome initialized", async () => {
    const w = world(["designer/components.button"]);
    const hooks = stub(w.root);
    const result = await runInit(w.root, hooks, { now: clock() });
    expect(result.exitCode).toBe(0);
    const [entry] = w.ledger("loop.fill");
    expect(entry!.id).toMatch(/^20261120T0800Z-fill-init$/);
    expect(entry).toMatchObject({ status: "done", outcome: "initialized", loop: "loop.fill", loopVersion: "fill-v1.json", trigger: { kind: "init" } });
    expect(stepLine(entry!)).toEqual(["ia-sync:code:0", "check:code:0"]);
    expect(entry!.checks).toEqual({ "ia.orphans": "pass", "records.computed-match": "pass", "pins.resolve": "pass" });
  });

  it("stops the init at a failing ia sync", async () => {
    const w = world([]);
    const result = await runInit(w.root, stub(w.root, { codeFor: call => call.step === "ia-sync" ? { exit: 1 } : undefined }), { now: clock() });
    expect(result.exitCode).toBe(1);
    expect(w.ledger("loop.fill")[0]).toMatchObject({ status: "stopped", outcome: "init stopped at ia-sync (exit 1)" });
  });
});

describe("F2 starter fill: loop.fill (T2)", () => {
  it("fills in chain order: Director with the owner's pick, then Designer slots, Theme confirmed by the owner", async () => {
    const w = world(["designer/themes.background", "designer/components.button", "director/context.market.size"]);
    const now = clock();
    const hooks = stub(w.root);

    // Director first (chain order); its run waits on the owner's queue.pick.
    let results = await fillAll(w.root, hooks, { now });
    expect(results).toHaveLength(1);
    expect(results[0]!.state).toMatchObject({ subject: { agent: "director", slotId: "context.market.size" }, status: "waiting" });
    const pick = results[0]!.entry!;
    expect(pick).toMatch(/^queue\.pick#/);
    expect(w.entry(pick).options!.map(option => option.candidate)).toEqual(["placeholder-v1.json"]);
    ownerAnswer(w.root, pick, "placeholder-v1.json", now);
    const director = await resumeRun(w.root, results[0]!.state!.runId, hooks, { now });
    expect(director.state!.status).toBe("done");

    // Then Designer, IA order: components before themes; themes waits on the owner's confirm.
    results = await fillAll(w.root, hooks, { now });
    expect(results.map(result => result.state!.subject!.slotId)).toEqual(["components.button", "themes.background"]);
    const approve = results[1]!.entry!;
    expect(approve).toMatch(/^queue\.approve#/);
    ownerAnswer(w.root, approve, "approve", now);
    expect((await resumeRun(w.root, results[1]!.state!.runId, hooks, { now })).state!.status).toBe("done");
    expect(await fillAll(w.root, hooks, { now })).toEqual([]);

    const ledger = w.ledger("loop.fill");
    expect(ledger.map(entry => entry.outcome)).toEqual([
      "director/context.market.size done; pinned placeholder-v1.json",
      "designer/components.button done; pinned placeholder-v1.json",
      "designer/themes.background done; pinned placeholder-v1.json",
    ]);
    expect(ledger.map(stepLine)).toEqual([
      ["refine-brief:agent/stub-model:0", "create:agent/stub-model:0", "check:code:0", "owner-pick:human:0", "cascade:code:0"],
      ["refine-brief:agent/stub-model:0", "create:agent/stub-model:0", "check:code:0", "pick:agent/stub-model:0", "cascade:code:0"],
      ["refine-brief:agent/stub-model:0", "create:agent/stub-model:0", "check:code:0", "pick:agent/stub-model:0", "confirm:human:0", "cascade:code:0"],
    ]);
    for (const entry of ledger) expect(entry).toMatchObject({ status: "done", loopVersion: "fill-v1.json", trigger: { kind: "starter-fill" } });
    // The agent steps name the skill path (system.md 14.1), the tier and the serving model; the version names no model.
    expect(ledger[1]!.steps[1]!.decider).toEqual({ by: "agent", agent: "designer", verb: "create-candidates", tier: "mid", model: MODEL, skill: "packages/designer/actions/designer.candidates/skill.md" });
    expect(ledger[0]!.decisions).toEqual([{ entry: pick, answer: "placeholder-v1.json" }]);
    expect(ledger[0]!.refs).toContainEqual({ to: "producer/queue.pick", record: pick.split("#")[1], rel: "answers" });
    expect(ledger[1]!.steps[1]!.wrote).toEqual([{ file: "designer/components.button/candidates/placeholder-v1.json", sha256: expect.stringMatching(/[0-9a-f]{64}$/) }]);
    // The owner's pick reached the pin through `clossys pin ... --by owner:queue.pick#<id>`.
    expect(hooks.code_.find(call => call.argv[0] === "pin")!.cli).toBe(`clossys pin director/context.market.size placeholder-v1.json --by owner:${pick}`);
  });

  it("goes back to create after a failed check, and raises queue.clarify after maxRounds", async () => {
    const w = world(["designer/components.button"]);
    const now = clock();
    const once = await startRun(w.root, { loop: "loop.fill", slot: "designer/components.button" }, stub(w.root, { checkExits: [1] }), { now });
    expect(once.state!.status).toBe("done");
    expect(stepLine(w.ledger("loop.fill")[0]!)).toEqual(["refine-brief:agent/stub-model:0", "create:agent/stub-model:0", "check:code:1", "create:agent/stub-model:0", "check:code:0", "pick:agent/stub-model:0", "cascade:code:0"]);
    // The round's queue.fix was answered by the run's pin (code close).
    const fix = once.state!.raised.find(name => name.startsWith("queue.fix#"))!;
    expect(w.entry(fix)).toMatchObject({ status: "answered" });
    expect(w.entry(fix).events.at(-1)).toMatchObject({ by: "code:clossys run", op: "answered" });

    const w2 = world(["designer/components.button"]);
    const stuck = await startRun(w2.root, { loop: "loop.fill", slot: "designer/components.button" }, stub(w2.root, { checkExits: [1, 1, 1] }), { now });
    expect(stuck.exitCode).toBe(1);
    expect(w2.ledger("loop.fill")[0]).toMatchObject({ status: "stopped", outcome: expect.stringMatching(/check failed 3 rounds \(maxRounds\); raised queue\.clarify#/) });
  });
});

describe("F3 tighten brief (T3) and F7 upstream cascade (T7)", () => {
  it("refines a pinned slot, marks its consumedBy dependant needs-refresh, and the dependant's run sets it back live", async () => {
    const w = world(["designer/themes.background", "designer/components.button"]);
    const now = clock();
    w.slot("designer/themes.background", { refs: [{ to: "designer/components.button", rel: "consumedBy" }] });
    const hooks = stub(w.root);
    await startRun(w.root, { loop: "loop.fill", slot: "designer/components.button" }, hooks, { now });

    const theme = await startRun(w.root, { loop: "loop.refine", slot: "designer/themes.background" }, hooks, { now });
    ownerAnswer(w.root, theme.entry!, "approve", now);
    const done = await resumeRun(w.root, theme.state!.runId, hooks, { now });
    expect(done.state!.status).toBe("done");
    const refine = w.ledger("loop.refine")[0]!;
    expect(refine).toMatchObject({ trigger: { kind: "tighten-brief" }, loopVersion: "refine-v1.json" });
    expect(stepLine(refine)).toEqual(["refine-brief:agent/stub-model:0", "create:agent/stub-model:0", "check:code:0", "pick:agent/stub-model:0", "confirm:human:0", "cascade:code:0"]);
    // G7: a code step's wrote carries the written file's real sha256 (formerly null for a non-candidate).
    expect(refine.steps.at(-1)!.wrote).toEqual([{ file: "designer/components.button/slot.json", sha256: fileSha(join(w.root, "clossys", "agents", "designer", "components.button", "slot.json")) }]);
    expect(w.readSlot("designer/components.button").status).toBe("needs-refresh");

    const cascade = await startRun(w.root, { loop: "loop.refine", slot: "designer/components.button" }, hooks, { now });
    expect(cascade.state!.trigger.kind).toBe("upstream-cascade");
    expect(cascade.state!.status).toBe("done");
    expect(w.readSlot("designer/components.button").status).toBe("live");
  });

  it("G3: a declared refine-brief skill the agent package lacks stops the run (exit 2) naming it, never a packet without it", async () => {
    const w = world(["designer/themes.background"]);
    rmSync(join(w.root, "packages", "designer", "actions", "designer.brief", "skill.md"));
    expect(() => skillFor(w.root, "packages/<agent>/actions/<agent>.brief/skill.md", "designer")).toThrow(MissingSkillError);
    expect(skillFor(w.root, undefined, "designer")).toBeUndefined();
    const hooks = stub(w.root);
    const run = await startRun(w.root, { loop: "loop.refine", slot: "designer/themes.background" }, hooks, { now: clock() });
    expect(run.exitCode).toBe(2);
    expect(run.message).toContain("packages/designer/actions/designer.brief/skill.md");
    expect(hooks.calls.filter(call => call.kind === "agent")).toEqual([]);
  });
});

describe("F4 add L3 (T4)", () => {
  it("fills a consumer-added slot from the queue.fix that asked for it and answers the fix with the pin", async () => {
    const w = world(["writer/narratives.legal-document"]);
    const now = clock();
    // `clossys ia add` writes the new slot (base null); the downstream agent's request is a queue.fix to its owner.
    w.slot("designer/sections.features");
    const { entry } = raiseEntry(w.root, { queue: "queue.fix", subject: { to: "designer/sections.features", rel: "input" }, decider: "agent:designer", ask: "need designer/sections.features for a page", slug: "sections-features" }, "2026-11-20T07:30:00Z");
    const result = await startRun(w.root, { loop: "loop.fill", from: `queue.fix#${entry.id}` }, stub(w.root), { now });
    expect(result.state!.status).toBe("done");
    const ledger = w.ledger("loop.fill")[0]!;
    expect(ledger.trigger).toEqual({ kind: "add-l3", ref: { to: "producer/queue.fix", record: entry.id, rel: "raisedBy" } });
    expect(stepLine(ledger)).toEqual(["refine-brief:agent/stub-model:0", "create:agent/stub-model:0", "check:code:0", "pick:agent/stub-model:0", "cascade:code:0"]);
    expect(w.entry(`queue.fix#${entry.id}`)).toMatchObject({ status: "answered" });
    expect(ledger.refs).toContainEqual({ to: "producer/queue.fix", record: entry.id, rel: "answers" });
  });
});

describe("F5 owner feedback (T5)", () => {
  it("runs loop.refine from the owner's queue.fix, the owner confirms Voice, and the fix is answered by the new pin", async () => {
    const w = world(["writer/lexicon.formality"]);
    const now = clock();
    const fix = raiseFeedback(w.root, { ref: "writer/lexicon.formality", words: "warmer, less formal", via: "chat", quote: "warmer, less formal" }, now());
    expect(fix).toMatchObject({ queue: "queue.fix", decider: "agent:writer", createdBy: { actor: "owner" } });
    const hooks = stub(w.root);
    const run = await startRun(w.root, { loop: "loop.refine", from: `queue.fix#${fix.id}` }, hooks, { now });
    expect(run.state!.trigger.kind).toBe("owner-feedback");
    expect(run.entry).toMatch(/^queue\.approve#/);
    ownerAnswer(w.root, run.entry!, "approve", now);
    await resumeRun(w.root, run.state!.runId, hooks, { now });
    const ledger = w.ledger("loop.refine")[0]!;
    expect(ledger).toMatchObject({ status: "done", trigger: { kind: "owner-feedback", ref: { to: "producer/queue.fix", record: fix.id, rel: "raisedBy" } } });
    expect(stepLine(ledger)).toEqual(["refine-brief:agent/stub-model:0", "create:agent/stub-model:0", "check:code:0", "pick:agent/stub-model:0", "confirm:human:0", "cascade:code:0"]);
    // refine-brief got the entry so the agent reads the owner's words.
    expect(hooks.calls[0]).toEqual({ step: "refine-brief", kind: "agent" });
    const answered = w.entry(`queue.fix#${fix.id}`);
    expect(answered.status).toBe("answered");
    expect(answered.events.at(-1)).toMatchObject({ by: "code:clossys run" });
  });
});

describe("F6 failed check (T6)", () => {
  it("routes audit findings: queue.fix to the slot's agent, queue.clarify to the owner, deduped; then refine runs from the fix", async () => {
    const w = world(["writer/narratives.legal-document"]);
    const now = clock();
    const findings = [
      { check: "constitution.strict", subject: "writer/narratives.legal-document/slot.json", detail: "placeholder finding" },
      { check: "refs.dangling", subject: "facts", detail: "clossys/facts.json does not exist" },
    ];
    const audit = (): Stub => stub(w.root, { codeFor: call => call.step === "strict" ? { exit: 1, findings } : undefined });
    const first = await startRun(w.root, { loop: "loop.audit" }, audit(), { now });
    expect(first.exitCode).toBe(0);
    const raised = first.state!.raised;
    expect(raised).toHaveLength(2);
    expect(w.entry(raised[0]!)).toMatchObject({ queue: "queue.fix", decider: "agent:writer", subject: { to: "writer/narratives.legal-document" } });
    expect(w.entry(raised[1]!)).toMatchObject({ queue: "queue.clarify", decider: "owner", subject: { to: "producer/queue.clarify" } });
    const second = await startRun(w.root, { loop: "loop.audit" }, audit(), { now });
    expect(second.state!.raised).toEqual([]);
    const ledger = w.ledger("loop.audit");
    expect(ledger.map(entry => entry.outcome)).toEqual([`raised ${raised.join(", ")}`, "no new entry"]);
    expect(stepLine(ledger[0]!)).toEqual(["strict:code:1", "route:code:0"]);
    expect(ledger[0]!.checks).toEqual({ "constitution.strict": "fail", "ia.orphans": "fail", "refs.dangling": "fail" });

    const hooks = stub(w.root);
    const refine = await startRun(w.root, { loop: "loop.refine", from: raised[0]! }, hooks, { now });
    expect(refine.state!.trigger.kind).toBe("failed-check");
    ownerAnswer(w.root, refine.entry!, refine.entry!.startsWith("queue.pick") ? "placeholder-v1.json" : "approve", now);
    expect((await resumeRun(w.root, refine.state!.runId, hooks, { now })).state!.status).toBe("done");
    expect(w.entry(raised[0]!).status).toBe("answered");
  });

  it("G7: a built-in code step (route) appends its run record, and the ledger carries the sha256 of every file it wrote", async () => {
    const w = world(["writer/narratives.legal-document"]);
    writeFileSync(join(w.root, ".gitignore"), "/.clossys/runs/\n");
    const findings = [{ check: "constitution.strict", subject: "writer/narratives.legal-document/slot.json", detail: "placeholder finding" }];
    const run = await startRun(w.root, { loop: "loop.audit" }, stub(w.root, { codeFor: call => call.step === "strict" ? { exit: 1, findings } : undefined }), { now: clock() });
    expect(run.state!.raised).toHaveLength(1);
    const store = join(w.root, ".clossys", "runs", "loop.audit.route.jsonl");
    expect(existsSync(store)).toBe(true);
    const record = JSON.parse(readFileSync(store, "utf8").trim().split("\n").at(-1)!) as { schema: string; step: string; invocation: string; exit: number; writes: { path: string; sha256: string }[] };
    expect(record).toMatchObject({ schema: "clossys.pipeline-run/1", step: "loop.audit.route", invocation: "check --route", exit: 0 });
    const entry = `clossys/agents/producer/queue.fix/entries/${run.state!.raised[0]!.split("#")[1]}.json`;
    const written = record.writes.find(row => row.path === entry);
    expect(written?.sha256).toBe(fileSha(join(w.root, entry)));
    const route = w.ledger("loop.audit")[0]!.steps.find(step => step.id === "route")!;
    expect(route.wrote!.length).toBeGreaterThan(0);
    for (const row of route.wrote!) expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

/** A consumer the real clossys release accepts (0016 fixture), and the verbs the loop's code steps call. */
const realRelease = (): ReleaseWorld => { const world = releaseWorld(); roots.push(world.root); return world; };
const releaseVerbs = (verbs: string[][], now: () => Date) => (argv: readonly string[], cwd: string): Promise<CliResult> => {
  verbs.push([...argv]);
  return argv[0] === "compile" ? Promise.resolve({ exitCode: 0 as const, message: "compiled (stub)" })
    : argv[0] === "release" ? runReleaseCli(argv.slice(1), cwd, { builder: stubBuilder, now }) : runCli(argv, cwd);
};
const latestLedger = (root: string, loop: LoopName): LedgerEntry => {
  const dir = ledgerDir(root, loop);
  return JSON.parse(readFileSync(join(dir, readdirSync(dir).sort().pop()!), "utf8")) as LedgerEntry;
};

describe("F8 new release: loop.release (T8)", () => {
  const manifest = "publisher/release.site/candidates/site-v1.json";
  const release = (root: string, gates: CodeOutcome) => stub(root, {
    codeFor: call => {
      if (call.step === "manifest") {
        mkdirSync(dirname(join(root, "clossys", "agents", manifest)), { recursive: true });
        writeFileSync(join(root, "clossys", "agents", manifest), "{}\n");
        return { exit: 0, wrote: [manifest] };
      }
      if (call.step === "gates") return gates;
      return undefined;
    },
  });

  it("ends at the owner-signed ready-pin with status pinned-ready", async () => {
    // The real chain: clossys release builds, writes the manifest and runs the gates; clossys pin takes the ready-pin.
    const w = realRelease();
    const now = clock();
    const verbs: string[][] = [];
    const hooks = cliHooks(w.root, undefined, releaseVerbs(verbs, now));
    const run = await startRun(w.root, { loop: "loop.release", publication: "site" }, hooks, { now });
    expect(run.entry, run.message).toMatch(/^queue\.approve#/);
    const found = findQueueEntry(w.root, run.entry!);
    expect(found.ok && readQueueEntry(found.at)).toMatchObject({ ok: true, entry: { default: "not-ready", subject: { to: "publisher/release.site" } } });
    // 0016 R1: the sign-off names the one manifest it approves, by option candidate and by a sha256 ref.
    const signoff = found.ok ? readQueueEntry(found.at) : undefined;
    const signed = signoff?.ok ? signoff.entry : undefined;
    expect(signed?.options?.find(option => option.id === "ready")?.candidate).toBe("site-v1.json");
    expect(signed?.refs).toEqual(expect.arrayContaining([expect.objectContaining({ to: "publisher/release.site/site-v1.json", rel: "input", sha256: expect.stringMatching(/[0-9a-f]{64}$/) })]));
    ownerAnswer(w.root, run.entry!, "ready", now);
    const done = await resumeRun(w.root, run.state!.runId, hooks, { now });
    expect(done.exitCode, done.message).toBe(0);
    const ledger = latestLedger(w.root, "loop.release");
    expect(ledger).toMatchObject({ status: "pinned-ready", outcome: "site site-v1.json pinned ready", trigger: { kind: "new-release" } });
    expect(stepLine(ledger)).toEqual(["compile:code:0", "build:code:0", "manifest:code:0", "gates:code:0", "signoff:human:0", "pin:code:0"]);
    expect(ledger.checks["release.ready"]).toBe("pass");
    expect(verbs.at(-1)).toEqual(["pin", "publisher/release.site", "site-v1.json", "--by", `owner:${run.entry}`, "--root", w.root]);
  });

  it("stops the release at failing gates, raising a queue.fix per finding for loop.refine", async () => {
    const w = world(["writer/narratives.legal-document"]);
    const now = clock();
    const run = await startRun(w.root, { loop: "loop.release", publication: "site" }, release(w.root, { exit: 1, findings: [{ check: "copy.sample-remaining", subject: "writer/narratives.legal-document", detail: "still on sample" }] }), { now });
    expect(run.exitCode).toBe(1);
    const ledger = w.ledger("loop.release")[0]!;
    expect(ledger).toMatchObject({ status: "stopped" });
    expect(stepLine(ledger)).toEqual(["compile:code:0", "build:code:0", "manifest:code:0", "gates:code:1"]);
    expect(ledger.checks["release.ready"]).toBeUndefined();
    expect(w.entry(run.state!.raised[0]!)).toMatchObject({ queue: "queue.fix", decider: "agent:writer" });
  });

  it("an owner not-ready answer stops the run without the ready-pin", async () => {
    const w = world([]);
    const now = clock();
    const hooks = release(w.root, { exit: 0 });
    const run = await startRun(w.root, { loop: "loop.release", publication: "site" }, hooks, { now });
    ownerAnswer(w.root, run.entry!, "not-ready", now);
    await resumeRun(w.root, run.state!.runId, hooks, { now });
    expect(w.ledger("loop.release")[0]).toMatchObject({ status: "stopped" });
    expect(hooks.code_.some(call => call.step === "pin")).toBe(false);
  });
});

describe("resume", () => {
  it("never runs a finished step again", async () => {
    const w = world(["designer/components.button"]);
    const now = clock();
    const hooks = stub(w.root, { waitOnce: ["create"] });
    const first = await startRun(w.root, { loop: "loop.fill", slot: "designer/components.button" }, hooks, { now });
    expect(first.state!.waiting).toEqual({ step: "create", on: "agent" });
    expect(first.packet).toMatchObject({ step: "create", agent: "designer", verb: "create-candidates", tier: "mid" });
    const second = await resumeRun(w.root, first.state!.runId, hooks, { now });
    expect(second.state!.status).toBe("done");
    expect(hooks.calls.filter(call => call.step === "refine-brief")).toHaveLength(1);
    expect(hooks.calls.filter(call => call.step === "create")).toEqual([{ step: "create", kind: "agent", wait: true }, { step: "create", kind: "agent" }]);
    expect(w.ledger("loop.fill")[0]!.steps.map(step => step.id)).toEqual(["refine-brief", "create", "check", "pick", "cascade"]);
    // A finished run does not resume.
    expect((await resumeRun(w.root, first.state!.runId, hooks, { now })).exitCode).toBe(2);
  });

  it("refuses to resume once the loop version changed under the run", async () => {
    const w = world(["designer/components.button"]);
    const now = clock();
    const hooks = stub(w.root, { waitOnce: ["create"] });
    const first = await startRun(w.root, { loop: "loop.fill", slot: "designer/components.button" }, hooks, { now });
    pinConsumerLoop(w.root, "loop.fill", content => ({ ...content, maxRounds: 2 }));
    const refused = await resumeRun(w.root, first.state!.runId, hooks, { now });
    expect(refused.exitCode).toBe(2);
    expect(refused.message).toMatch(/started on producer\/loop\.fill\/package:fill-v1\.json/);
    expect(readRunState(w.root, first.state!.runId)!.status).toBe("waiting");
  });

  it("runs the consumer's pinned loop version over package v1, and refuses a pinned version that fails loop.reachable", async () => {
    const w = world(["designer/components.button"]);
    const now = clock();
    pinConsumerLoop(w.root, "loop.fill", content => ({ ...content, steps: content.steps.filter(step => step.id !== "refine-brief") }));
    const run = await startRun(w.root, { loop: "loop.fill", slot: "designer/components.button" }, stub(w.root), { now });
    expect(run.state!.version).toMatchObject({ source: "pin", candidate: "fill-v2.json", ref: "producer/loop.fill/fill-v2.json" });
    expect(w.ledger("loop.fill")[0]!.loopVersion).toBe("fill-v2.json");
    expect(w.ledger("loop.fill")[0]!.steps.map(step => step.id)).toEqual(["create", "check", "pick", "cascade"]);

    const broken = world(["designer/components.button"]);
    pinConsumerLoop(broken.root, "loop.fill", content => ({ ...content, steps: content.steps.filter(step => step.id !== "pick") }));
    const refused = await startRun(broken.root, { loop: "loop.fill", slot: "designer/components.button" }, stub(broken.root), { now });
    expect(refused.exitCode).toBe(2);
    expect(refused.message).toMatch(/fails loop\.reachable: .*the exit can be reached without pins\.resolve/);
  });
});

describe("clossys run loop.<name> (cli/run.ts loop mode)", () => {
  it("prints the agent packet, waits, and resumes with the step exit and serving model", async () => {
    const w = world(["designer/components.button"]);
    const start = await runRunCli(["loop.fill", "--slot", "designer/components.button", "--root", w.root], w.root);
    expect(start.exitCode).toBe(0);
    expect(start.message).toMatch(/step refine-brief waits for agent:designer \(refine-brief, mid\)/);
    expect(start.message).toMatch(/skill packages\/designer\/actions\/designer\.brief\/skill\.md/);
    const refused = await runRunCli(["loop.fill", "--resume", "--step-exit", "0", "--root", w.root], w.root);
    expect(refused.exitCode).toBe(2);
    expect(refused.message).toMatch(/name the model/);
    const next = await runRunCli(["loop.fill", "--resume", "--step-exit", "0", "--model", MODEL, "--root", w.root], w.root);
    expect(next.exitCode).toBe(0);
    expect(next.message).toMatch(/step create waits for agent:designer/);
  });

  it("keeps chain mode for every other argv and refuses an unknown loop", async () => {
    const w = world([]);
    const unknown = await runRunCli(["loop.ship", "--root", w.root], w.root);
    expect(unknown.exitCode).toBe(2);
    expect(unknown.message).toMatch(/loop\.ship is not a loop/);
    const help = await runRunCli(["--help"], w.root);
    expect(help.message).toMatch(/clossys run loop\.<fill\|refine\|create\|choose\|release\|audit\|cascade>/);
  });
});

const queueCount = (root: string, queue: string): number => listQueueEntryFiles(root).filter(file => file.queue === queue).length;
const pinText = (root: string, ref: string): string | null => { const file = join(root, "clossys", "agents", ref, "pin.json"); return existsSync(file) ? readFileSync(file, "utf8") : null; };

describe("review rulings (foundry-build-0013 fix r1)", () => {
  it("B1: the owner picks Director and legal-prose slots directly; the agent pick never runs for them", async () => {
    for (const ref of ["director/context.market.size", "writer/narratives.legal-document"]) {
      const w = world([ref]);
      const now = clock();
      const hooks = stub(w.root);
      const run = await startRun(w.root, { loop: "loop.fill", slot: ref }, hooks, { now });
      expect(run.entry, ref).toMatch(/^queue\.pick#/);
      expect(pinText(w.root, ref), ref).toBeNull();
      ownerAnswer(w.root, run.entry!, "placeholder-v1.json", now);
      expect((await resumeRun(w.root, run.state!.runId, hooks, { now })).state!.status, ref).toBe("done");
      expect(hooks.calls.map(call => call.step), ref).toEqual(["refine-brief", "create", "check", "owner-pick"]);
      expect(w.ledger("loop.fill")[0]!.steps.map(step => step.id), ref).toEqual(["refine-brief", "create", "check", "owner-pick", "cascade"]);
      expect(pinText(w.root, ref), ref).toMatch(new RegExp(`"decidedBy": "owner:${run.entry!.replace(/[.#]/g, "\\$&")}"`));
    }
  });

  it("B3: pins.resolve is computed from the files: an agent pick that says 0 but pins nothing stops the run", async () => {
    const w = world(["designer/components.button"]);
    const hooks = stub(w.root, { agentFor: packet => packet.step === "pick" ? { exit: 0, model: MODEL } : undefined });
    const run = await startRun(w.root, { loop: "loop.fill", slot: "designer/components.button" }, hooks, { now: clock() });
    expect(run.exitCode).toBe(1);
    const ledger = w.ledger("loop.fill")[0]!;
    expect(ledger).toMatchObject({ status: "stopped", outcome: expect.stringMatching(/step pick failed: pins\.resolve: designer\/components\.button does not resolve: no pin and no package default/) });
    expect(ledger.checks["pins.resolve"]).toBe("fail");
    expect(stepLine(ledger).at(-1)).toBe("pick:agent/stub-model:1");
  });

  it("B3: the exit checks are verified again at finish: a pin gone after the pick step ends the run not-done", async () => {
    const w = world(["designer/components.button"]);
    pinConsumerLoop(w.root, "loop.fill", content => {
      const steps = [...content.steps];
      const check = steps.find(step => step.id === "check")!;
      steps.splice(steps.findIndex(step => step.id === "pick") + 1, 0, { ...check, id: "post", checks: [] } as never);
      return { ...content, steps };
    });
    const hooks = stub(w.root, { codeFor: call => { if (call.step !== "post") return undefined; unlinkSync(pinPath(w.root, "designer", "components.button")); return { exit: 0 }; } });
    const run = await startRun(w.root, { loop: "loop.fill", slot: "designer/components.button" }, hooks, { now: clock() });
    expect(run.exitCode).toBe(1);
    expect(w.ledger("loop.fill")[0]).toMatchObject({ status: "stopped", outcome: expect.stringMatching(/^the run cannot end done: pins\.resolve: designer\/components\.button does not resolve: no pin and no package default/), checks: { "pins.resolve": "fail" } });
  });

  it("B3: release.ready is recomputed from the files at finish, so a ready-pin gone stale by then never ends pinned-ready", async () => {
    const w = realRelease();
    const now = clock();
    const verbs = releaseVerbs([], now);
    // The pin verb succeeds, then the geography brief adds a locale the copy lacks: the gates the manifest recorded are red now.
    const hooks = cliHooks(w.root, undefined, async (argv, cwd) => {
      const result = await verbs(argv, cwd);
      if (argv[0] === "pin") w.repin("director/focus.reach.geography", 2, geographyBrief("en, fr, de"));
      return result;
    });
    const started = await startRun(w.root, { loop: "loop.release", publication: "site" }, hooks, { now });
    ownerAnswer(w.root, started.entry!, "ready", now);
    const done = await resumeRun(w.root, started.state!.runId, hooks, { now });
    expect(done.exitCode).toBe(1);
    const ledger = latestLedger(w.root, "loop.release");
    expect(ledger.status).not.toBe("pinned-ready");
    expect(ledger.checks["release.ready"]).toBe("fail");
    expect(ledger.outcome).toMatch(/release\.ready: .*fails now/);
  });

  it("B4: the real CLI code hook hands back the files every code step wrote: verb-reported and changed on disk", async () => {
    const w = realRelease();
    const now = clock();
    const hooks = cliHooks(w.root, undefined, releaseVerbs([], now));
    const started = await startRun(w.root, { loop: "loop.release", publication: "site" }, hooks, { now });
    expect(started.entry, started.message).toMatch(/^queue\.approve#/);
    expect(started.state!.vars.manifest).toBe("site-v1.json");
    const wrote = (id: string) => started.state!.steps.find(step => step.id === id)!.wrote!.map(row => row.file);
    expect(wrote("manifest")).toEqual(["publisher/release.site/candidates/site-v1.json"]);
    expect(wrote("build").some(file => file.startsWith(".clossys/builds/"))).toBe(true);
    ownerAnswer(w.root, started.entry!, "ready", now);
    const done = await resumeRun(w.root, started.state!.runId, hooks, { now });
    expect(done.state!.status).toBe("pinned-ready");
    // clossys pin reports no wrote; the hook still hands back the pin it changed under clossys/agents/.
    expect(latestLedger(w.root, "loop.release").steps.at(-1)!.wrote!.map(row => row.file)).toContain("publisher/release.site/pin.json");
  });

  it("B5: the owner's approve writes confirmed on the agent's pin", async () => {
    const w = world(["designer/themes.background"]);
    const now = clock();
    const hooks = stub(w.root);
    const run = await startRun(w.root, { loop: "loop.fill", slot: "designer/themes.background" }, hooks, { now });
    expect(run.entry).toMatch(/^queue\.approve#/);
    ownerAnswer(w.root, run.entry!, "approve", now);
    expect((await resumeRun(w.root, run.state!.runId, hooks, { now })).state!.status).toBe("done");
    const pin = readPinFile(pinPath(w.root, "designer", "themes.background"), { agent: "designer", slotId: "themes.background" });
    expect(pin.kind).toBe("pin");
    if (pin.kind !== "pin") return;
    expect(pin.issues).toEqual([]);
    expect(pinIssues(pin.doc, { agent: "designer", slotId: "themes.background" })).toEqual([]);
    expect(pin.doc).toMatchObject({ basis: "agent", decidedBy: "agent:designer", confirmed: { by: "owner", ref: run.entry } });
    expect(pin.doc.refs).toContainEqual({ to: "producer/queue.approve", record: run.entry!.split("#")[1], rel: "answers" });
  });

  it("B5: the owner's reject removes the agent's pin and the run ends not-done", async () => {
    const w = world(["designer/themes.background"]);
    const now = clock();
    const hooks = stub(w.root);
    const run = await startRun(w.root, { loop: "loop.fill", slot: "designer/themes.background" }, hooks, { now });
    expect(pinText(w.root, "designer/themes.background")).not.toBeNull();
    ownerAnswer(w.root, run.entry!, "reject", now);
    const ended = await resumeRun(w.root, run.state!.runId, hooks, { now });
    expect(ended.state!.status).toBe("stopped");
    expect(pinText(w.root, "designer/themes.background")).toBeNull();
    const ledger = w.ledger("loop.fill")[0]!;
    expect(ledger).toMatchObject({ status: "stopped", outcome: `the owner answered reject on ${run.entry}` });
    expect(ledger.steps.at(-1)).toMatchObject({ id: "confirm", exit: 1, wrote: [{ file: "designer/themes.background/pin.json", sha256: null }] });
  });

  it("B5: a reject puts back the pin the slot had when the run started", async () => {
    const w = world(["designer/themes.background"]);
    const now = clock();
    const first = await startRun(w.root, { loop: "loop.fill", slot: "designer/themes.background" }, stub(w.root), { now });
    ownerAnswer(w.root, first.entry!, "approve", now);
    await resumeRun(w.root, first.state!.runId, stub(w.root), { now });
    const before = pinText(w.root, "designer/themes.background");
    const again = await startRun(w.root, { loop: "loop.refine", slot: "designer/themes.background" }, stub(w.root), { now });
    expect(pinText(w.root, "designer/themes.background")).not.toBe(before);
    ownerAnswer(w.root, again.entry!, "reject", now);
    await resumeRun(w.root, again.state!.runId, stub(w.root), { now });
    expect(pinText(w.root, "designer/themes.background")).toBe(before);
  });

  it("B6: --from must be about the --slot subject", async () => {
    const w = world(["designer/components.button", "writer/lexicon.formality"]);
    const fix = raiseFeedback(w.root, { ref: "writer/lexicon.formality", words: "warmer", via: "chat", quote: "warmer" }, new Date("2026-11-20T07:30:00Z"));
    const refused = await startRun(w.root, { loop: "loop.refine", slot: "designer/components.button", from: `queue.fix#${fix.id}` }, stub(w.root), { now: clock() });
    expect(refused.exitCode).toBe(2);
    expect(refused.message).toBe(`run: --from queue.fix#${fix.id} is about writer/lexicon.formality, not --slot designer/components.button`);
    expect(w.entry(`queue.fix#${fix.id}`).status).toBe("open");
  });

  it("B6: finish never code-closes an owner's clarify", async () => {
    const w = world(["designer/components.button"]);
    const { entry } = raiseEntry(w.root, { queue: "queue.clarify", subject: { to: "designer/components.button", rel: "input" }, decider: "owner", ask: "which button?", slug: "components-button" }, "2026-11-20T07:30:00Z");
    const run = await startRun(w.root, { loop: "loop.refine", from: `queue.clarify#${entry.id}` }, stub(w.root), { now: clock() });
    expect(run.state!.status).toBe("done");
    expect(w.entry(`queue.clarify#${entry.id}`).status).toBe("open");
    expect(w.ledger("loop.refine")[0]!.refs).not.toContainEqual({ to: "producer/queue.clarify", record: entry.id, rel: "answers" });
  });

  it("B7: constitution.strict is recorded as not run by the CLI's strict step, never as a pass", async () => {
    const w = world(["designer/components.button"]);
    const run = await startRun(w.root, { loop: "loop.audit" }, cliHooks(w.root, undefined, async () => ({ exitCode: 0, message: "" }) as CliResult), { now: clock() });
    expect(run.state!.status).toBe("done");
    const ledger = w.ledger("loop.audit")[0]!;
    expect(ledger.checks["constitution.strict"]).toBeUndefined();
    expect(ledger.checks).toHaveProperty("ia.orphans");
    expect(ledger.checks).toHaveProperty("refs.dangling");
    expect(ledger.outcome).toMatch(/; not run: constitution\.strict$/);
  });

  it("B8: --slot, --from, --publication and --run are checked against their id patterns before use", async () => {
    const w = world(["designer/components.button"]);
    const hooks = stub(w.root);
    const now = clock();
    expect((await startRun(w.root, { loop: "loop.fill", slot: "designer/../../etc" }, hooks, { now })).message).toBe('run: --slot "designer/../../etc" is not a slot ref (<agent>/<slot-id>)');
    expect((await startRun(w.root, { loop: "loop.fill", from: "queue.fix#../../x" }, hooks, { now })).message).toBe('run: --from "queue.fix#../../x" is not a queue entry (queue.<pick|approve|clarify|fix>#<id>)');
    expect((await startRun(w.root, { loop: "loop.release", publication: "../site" }, hooks, { now })).message).toBe('run: --publication "../site" is not a publication id');
    expect((await resumeRun(w.root, "../../x", hooks, { now })).message).toBe('run: "../../x" is not a run id (<yyyymmdd>T<hhmm>Z-<slug>)');
    const cli = await runRunCli(["loop.fill", "--resume", "--run", "../../x", "--step-exit", "0", "--model", MODEL, "--root", w.root], w.root);
    expect(cli.exitCode).toBe(2);
    expect(cli.message).toMatch(/--run .*is not a run id/);
    await runRunCli(["loop.fill", "--slot", "designer/components.button", "--root", w.root], w.root);
    const wrote = await runRunCli(["loop.fill", "--resume", "--step-exit", "0", "--model", MODEL, "--wrote", "../../outside", "--root", w.root], w.root);
    expect(wrote.exitCode).toBe(2);
    expect(wrote.message).toMatch(/--wrote/);
    expect(hooks.calls).toEqual([]);
  });

  it("B8: a code step's argv is built per template token, never split on the whitespace of a filled value", () => {
    const filled = stepArgv("clossys brief <ref> --tighten <path> <op> <value> --why <why>", { ref: "designer/components.button", path: "mustDo", op: "add", value: "a b; rm -rf x", why: "the owner said so" });
    expect(filled.argv).toEqual(["clossys", "brief", "designer/components.button", "--tighten", "mustDo", "add", "a b; rm -rf x", "--why", "the owner said so"]);
    expect(filled.unfilled).toEqual([]);
  });

  it("B9: a run held by a live process is not resumed; a lock whose process is gone is taken over", async () => {
    const w = world(["designer/components.button"]);
    const now = clock();
    const hooks = stub(w.root, { waitOnce: ["create"] });
    const first = await startRun(w.root, { loop: "loop.fill", slot: "designer/components.button" }, hooks, { now });
    const lock = join(runsDir(w.root), `${first.state!.runId}.lock`);
    writeFileSync(lock, `${process.pid}\n`);
    const busy = await resumeRun(w.root, first.state!.runId, hooks, { now });
    expect(busy.exitCode).toBe(2);
    expect(busy.message).toMatch(new RegExp(`run ${first.state!.runId} is in use by process ${process.pid}`));
    expect(hooks.calls.filter(call => call.step === "create")).toHaveLength(1);
    writeFileSync(lock, "2147483646\n");
    expect((await resumeRun(w.root, first.state!.runId, hooks, { now })).state!.status).toBe("done");
    expect(existsSync(lock)).toBe(false);
  });

  it("B9: an owner entry raised before a crash is adopted on resume, never raised twice", async () => {
    const w = world(["designer/themes.background"]);
    const now = clock();
    const hooks = stub(w.root);
    const run = await startRun(w.root, { loop: "loop.fill", slot: "designer/themes.background" }, hooks, { now });
    const entry = w.entry(run.entry!);
    // The state as a crash right after the raise leaves it: the intent saved, the entry on disk, nothing after.
    const state = readRunState(w.root, run.state!.runId)!;
    state.status = "running"; delete state.waiting;
    state.raised = state.raised.filter(name => name !== run.entry);
    state.pendingRaise = { step: "confirm", queue: "queue.approve", at: entry.createdAt };
    writeFileSync(runStatePath(w.root, state.runId), JSON.stringify(state));
    const resumed = await resumeRun(w.root, state.runId, hooks, { now });
    expect(resumed.entry).toBe(run.entry);
    expect(queueCount(w.root, "queue.approve")).toBe(1);
    expect(readRunState(w.root, state.runId)).toMatchObject({ status: "waiting", waiting: { step: "confirm", entry: run.entry }, raised: [run.entry] });
  });

  it("B9: a run whose ledger was written before its state was saved ends on resume without running a step again", async () => {
    const w = world(["designer/themes.background"]);
    const now = clock();
    const hooks = stub(w.root);
    const run = await startRun(w.root, { loop: "loop.fill", slot: "designer/themes.background" }, hooks, { now });
    const waiting = readFileSync(runStatePath(w.root, run.state!.runId), "utf8");
    ownerAnswer(w.root, run.entry!, "approve", now);
    await resumeRun(w.root, run.state!.runId, hooks, { now });
    const pin = pinText(w.root, "designer/themes.background");
    writeFileSync(runStatePath(w.root, run.state!.runId), waiting);
    const calls = hooks.calls.length;
    const again = await resumeRun(w.root, run.state!.runId, hooks, { now });
    expect(again.exitCode).toBe(0);
    expect(again.state).toMatchObject({ status: "done" });
    expect(again.state!.steps.map(step => step.id)).toEqual(["refine-brief", "create", "check", "pick"]);
    expect(hooks.calls).toHaveLength(calls);
    expect(pinText(w.root, "designer/themes.background")).toBe(pin);
    expect(readdirSync(ledgerDir(w.root, "loop.fill"))).toHaveLength(1);
  });

  it("B9: the human step a run waits on runs on resume even when its when no longer matches the slot", async () => {
    const w = world(["designer/themes.background"]);
    const now = clock();
    const hooks = stub(w.root);
    const run = await startRun(w.root, { loop: "loop.fill", slot: "designer/themes.background" }, hooks, { now });
    expect(run.state!.waiting).toMatchObject({ step: "confirm" });
    w.slot("designer/themes.background", { ia: SLOTS["designer/components.button"]!.ia });
    ownerAnswer(w.root, run.entry!, "approve", now);
    expect((await resumeRun(w.root, run.state!.runId, hooks, { now })).state!.status).toBe("done");
    const ledger = w.ledger("loop.fill")[0]!;
    expect(stepLine(ledger)).toEqual(["refine-brief:agent/stub-model:0", "create:agent/stub-model:0", "check:code:0", "pick:agent/stub-model:0", "confirm:human:0", "cascade:code:0"]);
    expect(ledger.decisions).toEqual([{ entry: run.entry, answer: "approve" }]);
  });

  it("B9: --resume --step must name the step the run waits on", async () => {
    const w = world(["designer/components.button"]);
    await runRunCli(["loop.fill", "--slot", "designer/components.button", "--root", w.root], w.root);
    const wrong = await runRunCli(["loop.fill", "--resume", "--step", "create", "--step-exit", "0", "--model", MODEL, "--root", w.root], w.root);
    expect(wrong.exitCode).toBe(2);
    expect(wrong.message).toMatch(/waits on step refine-brief, not create/);
    const right = await runRunCli(["loop.fill", "--resume", "--step", "refine-brief", "--step-exit", "0", "--model", MODEL, "--root", w.root], w.root);
    expect(right.exitCode).toBe(0);
    expect(right.message).toMatch(/step create waits for agent:designer/);
  });
});

/** Writes `clossys/agents/producer/<loop>/candidates/<stem>-v2.json` (package v1 changed by `change`) and pins it. */
function pinConsumerLoop(root: string, loop: LoopName, change: (content: { maxRounds: number; steps: { id: string }[] } & Record<string, unknown>) => unknown): void {
  const packaged = readPackageLoop(loop);
  if (!packaged.ok) throw new Error(packaged.reason);
  const name = `${loop.slice(5)}-v2.json`;
  const header = buildCandidateHeader({ agent: "producer", slotId: loop, name, createdBy: { actor: "planner", ref: "test" }, createdAt: "2026-11-20T07:00:00Z", source: { kind: "original", ref: [] } });
  const sha256 = writeCandidateFile(candidatePath(root, "producer", loop, name), serializeCandidate(name, header, change(packaged.content as never)));
  // Which loop version runs is the owner's pick (B2): basis picked, decidedBy the owner's answer to a queue.pick.
  const id = `20261120T0700Z-${loop.replace(".", "-")}`;
  writePinDoc(pinPath(root, "producer", loop), buildPin({ agent: "producer", slotId: loop, record: { candidate: name, sha256, decidedBy: `owner:queue.pick#${id}`, basis: "picked", at: "2026-11-20T07:00:00Z" }, refs: [{ to: "producer/queue.pick" as never, record: id, rel: "answers" }], createdBy: cliActor("clossys pin") }));
}


describe("loop.create through the operator CLI with the real certify step (no stub; foundry-build-0048 U3 fix r1)", () => {
  const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
  const SLOT = "sections.hero.copy";
  const copy = (heading: string, action: string, tone?: string) => `---
${tone ? `vary: {"tone":"${tone}"}\n` : ""}slot: "${SLOT}"
locales: ["en"]
reason: "realises director:advantage.proposition.promise for the hero"
source: {"kind":"derived","ref":["director:identity.verbal.voice","director:advantage.proposition.promise","director:identity.naming.name"]}
---

## en
### header.heading
<!-- {"id":"header.heading","bindings":[]} -->
${heading}
### actions.primary.label
<!-- {"id":"actions.primary.label","bindings":[]} -->
${action}
`;
  function fixture() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "loop-create-real-")));
    roots.push(root);
    cpSync(FIXTURE, root, { recursive: true });
    const consumer = join(root, "clossys");
    const submit = (text: string) => writeCandidate(consumer, "writer", SLOT, "copy", text, { at: "2026-11-17T12:00:00Z", provenance: { by: "agent:writer", model: MODEL, tier: "high" } });
    const run = (...argv: string[]) => runRunCli(["loop.create", ...argv, "--root", root], root);
    return { root, submit, run };
  }
  async function toCreate(w: ReturnType<typeof fixture>): Promise<string> {
    const start = await w.run("--slot", `writer/${SLOT}`);
    expect(start.message).toMatch(/step refine-brief waits for agent:writer/);
    const runId = /run (\S+): step refine-brief/.exec(start.message ?? "")![1]!;
    expect((await w.run("--resume", "--run", runId, "--step-exit", "0", "--model", MODEL)).message).toMatch(/step create waits for agent:writer/);
    return runId;
  }
  const entry = (root: string, runId: string) => JSON.parse(readFileSync(join(root, "clossys", "agents", "producer", "ledger.create", "entries", `${runId}.json`), "utf8")) as LedgerEntry & { steps: { id: string; exit: number; cli: string; wrote: { file: string; sha256: string | null }[] }[]; checks: Record<string, string> };

  it("reaches the exit once three certified tones are submitted: certify is `clossys options --check`, and --wrote hashes the submitted file", async () => {
    const w = fixture();
    const runId = await toCreate(w);
    const made = [w.submit(copy("Ship your site this week", "Get started", "plain")), w.submit(copy("Launch the site you meant to build", "Start building", "bold")), w.submit(copy("Your site, ready when you are", "Come on in", "warm"))];
    // A --wrote file that does not exist is refused before the step is answered (a null hash proves nothing).
    const missing = await w.run("--resume", "--run", runId, "--step-exit", "0", "--model", MODEL, "--wrote", `clossys/agents/writer/${SLOT}/candidates/copy-v9.md`);
    expect(missing.exitCode).toBe(2);
    expect(missing.message).toMatch(/--wrote "clossys\/agents\/writer\/sections\.hero\.copy\/candidates\/copy-v9\.md" names no file/);
    const done = await w.run("--resume", "--run", runId, "--step-exit", "0", "--model", MODEL, ...made.flatMap(item => ["--wrote", `clossys/agents/writer/${SLOT}/candidates/${item.name}`]));
    expect(done.message).toMatch(new RegExp(`run ${runId}: done: writer/sections\\.hero\\.copy done`));
    expect(done.exitCode).toBe(0);
    const ledger = entry(w.root, runId);
    expect(ledger.steps.find(step => step.id === "certify")).toMatchObject({ cli: `clossys options writer/${SLOT} --check`, exit: 0 });
    expect(ledger.steps.find(step => step.id === "create")!.wrote).toEqual(made.map(item => ({ file: `writer/${SLOT}/candidates/${item.name}`, sha256: item.sha256 })));
    expect(ledger.checks["candidates.certified"]).toBe("pass");
    const report = JSON.parse(readFileSync(join(w.root, ".clossys", "checks", "writer", SLOT, "certify.json"), "utf8"));
    expect(report).toMatchObject({ schema: "clossys.certify/1", ok: true, distinct: 3, options: 3, why: [] });
  });

  it("gives a bad candidate a different verdict: certify exits 1 with the certifier's reason and the run never reaches done", async () => {
    const w = fixture();
    const runId = await toCreate(w);
    const bad = w.submit(copy("The seamless, magical, best-in-class solution that effortlessly transforms absolutely everything you do", "Click here right now to start your totally free trial today", "plain"));
    const result = await w.run("--resume", "--run", runId, "--step-exit", "0", "--model", MODEL, "--wrote", `clossys/agents/writer/${SLOT}/candidates/${bad.name}`);
    expect(result.message).not.toMatch(/: done:/);
    const state = readRunState(w.root, runId);
    expect(state?.status).not.toBe("done");
    expect(state?.steps.find(step => step.id === "certify")?.exit).toBe(1);
    const report = JSON.parse(readFileSync(join(w.root, ".clossys", "checks", "writer", SLOT, "certify.json"), "utf8"));
    expect(report.ok).toBe(false);
    expect(report.why.join("; ")).toMatch(/\[options-short\] holds 0 distinct option\(s\) on tone, needs 3/);
    expect(report.why.join("; ")).toMatch(new RegExp(`not passing: ${bad.name.replace(".", "\\.")} \\(\\[limit\\] en header\\.heading is \\d+ characters`));
  });
});
