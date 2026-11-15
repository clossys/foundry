/**
 * flows.md F1-F8 replayed through `clossys run` with a stub decider. Each test builds a consumer in a tmp dir that
 * holds structure only: slot ids from the real package IA trees, placeholder candidates, no names, brands or prices.
 * The stub stands in for every agent skill and for the CLI verbs a code step runs; no model is called.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runRunCli } from "../cli/run.js";
import { answerQueueEntry } from "../queue/answer.js";
import { findQueueEntry, readQueueEntry } from "../queue/entry.js";
import { raiseFeedback } from "../queue/feedback.js";
import { buildCandidateHeader, candidateCreatedBy, candidatePath, serializeCandidate, writeCandidateFile } from "../records/candidate.js";
import { buildPin, cliActor, pinPath, writePinDoc } from "../records/pin.js";
import { sha256Hex } from "../records/hash.js";
import { writeSlot } from "../records/slot.js";
import type { AgentId, LedgerEntry, QueueEntry, Slot } from "../records/types.js";
import { readPackageLoop } from "./files.js";
import { raiseEntry } from "./route.js";
import { fillAll, ledgerDir, readRunState, resumeRun, runInit, startRun, type AgentOutcome, type AgentPacket, type CodeCall, type CodeOutcome, type Exit, type RunHooks } from "./runner.js";
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
/** Real IA positions (packages/<agent>/src/catalog/ia/*.json); Director's l2 ids carry a dot, which slot/2 ia refuses, so it is written with a dash. */
const SLOTS: Record<string, { agent: AgentId; kind: Slot["kind"]; ia: Ia }> = {
  "director/context.market.size": { agent: "director", kind: "brief", ia: { l0: "strategy", l1: "context", l2: "context-market", order: 0 } },
  "designer/themes.background": { agent: "designer", kind: "element/token", ia: { l0: "themes", l1: "colors", l2: "colors-surfaces", order: 0 } },
  "designer/components.button": { agent: "designer", kind: "element/component", ia: { l0: "components", l1: "actions", l2: "actions-buttons", order: 0 } },
  "designer/sections.features": { agent: "designer", kind: "element/section", ia: { l0: "sections", l1: "explain", l2: "explain-promotion", order: 0 } },
  "writer/lexicon.formality": { agent: "writer", kind: "voice", ia: { l0: "lexicon", l1: "voice", l2: "voice-tone", order: 0 } },
  "writer/passages.legal-prose": { agent: "writer", kind: "prose", ia: { l0: "passages", l1: "explain", l2: "explain-reading", order: 3 } },
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
function stub(root: string, options: { checkExits?: Exit[]; waitOnce?: string[]; codeFor?: (call: CodeCall) => CodeOutcome | undefined } = {}): Stub {
  const calls: Stub["calls"] = [];
  const code_: CodeCall[] = [];
  const checkExits = [...(options.checkExits ?? [])];
  const waitOnce = new Set(options.waitOnce ?? []);
  const at = "2026-11-20T09:00:00Z";
  return {
    calls, code_,
    agent(packet: AgentPacket): AgentOutcome {
      if (waitOnce.delete(packet.step)) { calls.push({ step: packet.step, kind: "agent", wait: true }); return "wait"; }
      calls.push({ step: packet.step, kind: "agent" });
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
        const sha256 = fileSha(candidatePath(root, agent, slotId, name));
        writePinDoc(pinPath(root, agent, slotId), buildPin({ agent, slotId, record: { candidate: name, sha256, decidedBy: `agent:${agent}`, basis: "agent", at }, createdBy: cliActor("clossys pick") }));
        return { exit: 0, model: MODEL, wrote: [`${packet.ref}/pin.json`], cli: `clossys pick ${packet.ref} ${name} --by agent:${agent}` };
      }
      return { exit: 0, model: MODEL };
    },
    code(call: CodeCall): CodeOutcome {
      calls.push({ step: call.step, kind: "code" });
      code_.push(call);
      const custom = options.codeFor?.(call);
      if (custom) return custom;
      if (call.argv[0] === "pin" && call.ref) {
        const [agent, slotId] = call.ref.split("/") as [AgentId, string];
        const name = call.argv[2]!;
        const by = call.argv[4]!;
        const [queue, id] = by.slice("owner:".length).split("#") as [string, string];
        const sha256 = fileSha(candidatePath(root, agent, slotId, name));
        writePinDoc(pinPath(root, agent, slotId), buildPin({ agent, slotId, record: { candidate: name, sha256, decidedBy: by, basis: "picked", at }, refs: [{ to: `producer/${queue}` as never, record: id, rel: "answers" }], createdBy: cliActor("clossys pin") }));
        return { exit: 0, wrote: [`${call.ref}/pin.json`] };
      }
      if (call.argv[1] === "check" && call.ref) return { exit: checkExits.length ? checkExits.shift()! : 0 };
      return { exit: 0 };
    },
  };
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
      ["refine-brief:agent/stub-model:0", "create:agent/stub-model:0", "check:code:0", "pick:agent/stub-model:0", "owner-pick:human:0", "cascade:code:0"],
      ["refine-brief:agent/stub-model:0", "create:agent/stub-model:0", "check:code:0", "pick:agent/stub-model:0", "cascade:code:0"],
      ["refine-brief:agent/stub-model:0", "create:agent/stub-model:0", "check:code:0", "pick:agent/stub-model:0", "confirm:human:0", "cascade:code:0"],
    ]);
    for (const entry of ledger) expect(entry).toMatchObject({ status: "done", loopVersion: "fill-v1.json", trigger: { kind: "starter-fill" } });
    // The agent steps name the skill path (system.md 14.1), the tier and the serving model; the version names no model.
    expect(ledger[1]!.steps[1]!.decider).toEqual({ by: "agent", agent: "designer", verb: "create-candidates", tier: "mid", model: MODEL, skill: "packages/designer/actions/designer.candidates/skill.md" });
    expect(ledger[0]!.decisions).toEqual([{ entry: pick, answer: "placeholder-v1.json" }]);
    expect(ledger[0]!.refs).toContainEqual({ to: "producer/queue.pick", record: pick.split("#")[1], rel: "answers" });
    expect(ledger[1]!.steps[1]!.wrote).toEqual([{ file: "designer/components.button/candidates/placeholder-v1.json", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
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
    expect(refine.steps.at(-1)!.wrote).toEqual([{ file: "designer/components.button/slot.json", sha256: null }]);
    expect(w.readSlot("designer/components.button").status).toBe("needs-refresh");

    const cascade = await startRun(w.root, { loop: "loop.refine", slot: "designer/components.button" }, hooks, { now });
    expect(cascade.state!.trigger.kind).toBe("upstream-cascade");
    expect(cascade.state!.status).toBe("done");
    expect(w.readSlot("designer/components.button").status).toBe("live");
  });
});

describe("F4 add L3 (T4)", () => {
  it("fills a consumer-added slot from the queue.fix that asked for it and answers the fix with the pin", async () => {
    const w = world(["writer/passages.legal-prose"]);
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
    const w = world(["writer/passages.legal-prose"]);
    const now = clock();
    const findings = [
      { check: "constitution.strict", subject: "writer/passages.legal-prose/slot.json", detail: "placeholder finding" },
      { check: "refs.dangling", subject: "facts", detail: "clossys/facts.json does not exist" },
    ];
    const audit = (): Stub => stub(w.root, { codeFor: call => call.step === "strict" ? { exit: 1, findings } : undefined });
    const first = await startRun(w.root, { loop: "loop.audit" }, audit(), { now });
    expect(first.exitCode).toBe(0);
    const raised = first.state!.raised;
    expect(raised).toHaveLength(2);
    expect(w.entry(raised[0]!)).toMatchObject({ queue: "queue.fix", decider: "agent:writer", subject: { to: "writer/passages.legal-prose" } });
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
});

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
    const w = world([]);
    const now = clock();
    const hooks = release(w.root, { exit: 0 });
    const run = await startRun(w.root, { loop: "loop.release", publication: "site" }, hooks, { now });
    expect(run.entry).toMatch(/^queue\.approve#/);
    expect(w.entry(run.entry!)).toMatchObject({ default: "not-ready", subject: { to: "publisher/release.site" } });
    ownerAnswer(w.root, run.entry!, "ready", now);
    const done = await resumeRun(w.root, run.state!.runId, hooks, { now });
    expect(done.exitCode).toBe(0);
    const ledger = w.ledger("loop.release")[0]!;
    expect(ledger).toMatchObject({ status: "pinned-ready", outcome: "site site-v1.json pinned ready", trigger: { kind: "new-release" } });
    expect(stepLine(ledger)).toEqual(["compile:code:0", "build:code:0", "manifest:code:0", "gates:code:0", "signoff:human:0", "pin:code:0"]);
    expect(ledger.checks["release.ready"]).toBe("pass");
    expect(hooks.code_.at(-1)!.cli).toBe(`clossys pin publisher/release.site site-v1.json --by owner:${run.entry}`);
  });

  it("stops the release at failing gates, raising a queue.fix per finding for loop.refine", async () => {
    const w = world(["writer/passages.legal-prose"]);
    const now = clock();
    const run = await startRun(w.root, { loop: "loop.release", publication: "site" }, release(w.root, { exit: 1, findings: [{ check: "copy.sample-remaining", subject: "writer/passages.legal-prose", detail: "still on sample" }] }), { now });
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
    expect(help.message).toMatch(/clossys run loop\.<fill\|refine\|release\|audit>/);
  });
});

/** Writes `clossys/agents/producer/<loop>/candidates/<stem>-v2.json` (package v1 changed by `change`) and pins it. */
function pinConsumerLoop(root: string, loop: LoopName, change: (content: { maxRounds: number; steps: { id: string }[] } & Record<string, unknown>) => unknown): void {
  const packaged = readPackageLoop(loop);
  if (!packaged.ok) throw new Error(packaged.reason);
  const name = `${loop.slice(5)}-v2.json`;
  const header = buildCandidateHeader({ agent: "producer", slotId: loop, name, createdBy: { actor: "planner", ref: "test" }, createdAt: "2026-11-20T07:00:00Z", source: { kind: "original", ref: [] } });
  const sha256 = writeCandidateFile(candidatePath(root, "producer", loop, name), serializeCandidate(name, header, change(packaged.content as never)));
  writePinDoc(pinPath(root, "producer", loop), buildPin({ agent: "producer", slotId: loop, record: { candidate: name, sha256, decidedBy: "planner", basis: "planner", at: "2026-11-20T07:00:00Z" }, createdBy: cliActor("clossys pin") }));
}

