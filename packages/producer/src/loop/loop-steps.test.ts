/**
 * foundry-build-0048 LOOP-STEPS, through the operator CLI on the consumer fixture (no stub, no model):
 *
 * 1. consumer-agent-step-rewrite-refused: an agent decide step that runs its skill's own sequence (`clossys request <id>
 *    --check`, then `--decide`) writes its entry twice through its own verbs and is accepted; a forged event (another
 *    seat's: the owner, the planner, another agent), a file no verb of the step wrote, and an entry state neither the
 *    before nor the after bytes give are still refused.
 * 2. consumer-agent-step-upstream-raise-refused: a create step that raises the upstream change its skill tells it to
 *    parks the run on that entry and runs the step again once it closes; a raise that is not the verb's own entry is refused.
 * 3. consumer-slot-request-route-handler-mismatch: loop.slot answers only an entry routed to it (HandlerMismatchError).
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../cli/main.js";
import { runRunCli } from "../cli/run.js";
import type { LedgerEntry } from "../records/types.js";
import { sha256Hex } from "../records/hash.js";
import { entryStepShas, keepSnapshot, keptTexts, stepEntryTexts, treeSnapshot } from "./agent-snapshot.js";
import { readRunState, stepEntryKeys } from "./runner.js";
import type { LoopName } from "./names.js";

const MODEL = "stub-model";
const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "loop-steps-")));
  roots.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  const cli = (...argv: string[]) => runCli([...argv, "--root", root], root);
  const run = (loop: LoopName, ...argv: string[]) => runRunCli([loop, ...argv, "--root", root], root);
  const file = (path: string) => join(root, "clossys", "agents", path);
  const read = (path: string) => JSON.parse(readFileSync(file(path), "utf8"));
  return { root, cli, run, file, read };
}
/**
 * The fixture world with its engine index rebuilt through the verb (`clossys index --rebuild`). The committed fixture's
 * index still names the disk bytes of records the seeder retired (designer/components.link, components.media-player), so
 * every agent step on the raw copy is refused for `clossys/.state/index.json: is not the rebuild of the log`: a known base
 * red (flows.test.ts 36/46 at base, receipt-b1strict-r2.md), not this unit's.
 */
async function world(...cites: Array<[slot: string, need: string]>) {
  const w = fixture();
  for (const [slot, need] of cites) cite(w, slot, need);
  const rebuilt = await w.cli("index", "--rebuild");
  expect(rebuilt.exitCode, rebuilt.message).toBe(0);
  return w;
}
/** A slot's slot.json gains an input naming `need` (a page's slotless need), set before the index is rebuilt. */
function cite(w: World, slot: string, need: string) {
  const file = w.file(`${slot}/slot.json`);
  const doc = JSON.parse(readFileSync(file, "utf8"));
  doc.refs.push({ to: need, rel: "input" });
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
}
type World = ReturnType<typeof fixture>;
const waitingRun = (message: string | undefined) => /run (\S+):/.exec(message ?? "")![1]!;
const ledgerOf = (w: World, queue: string, runId: string) => JSON.parse(readFileSync(w.file(`producer/${queue}/entries/${runId}.json`), "utf8")) as LedgerEntry;

describe("an agent decide step runs its skill's --check then --decide (consumer-agent-step-rewrite-refused)", { timeout: 120_000 }, () => {
  const REQUESTER = "writer/sections.article.copy";
  /** An open slot request the writer answers by reusing narratives.guide, with loop.slot waiting on decide-writer. */
  async function decideWaiting() {
    const w = await world([REQUESTER, "writer/narratives.how-to"]);
    const raised = await w.cli("request", "--target", "writer/narratives.how-to", "--from", REQUESTER, "--why", "a how-to the article links", "--by", "writer");
    expect(raised.exitCode, raised.message).toBe(0);
    const id = (raised.output as { id: string }).id;
    const start = await w.run("loop.slot", "--request", id);
    expect(start.message).toMatch(/step decide-writer waits for agent:writer \(decide, mid\)/);
    return { w, id, runId: waitingRun(start.message), entry: `producer/queue.slot/entries/${id}.json` };
  }

  it("accepts the skill's sequence: --check then --decide reuse write the entry twice, and the run ends done", async () => {
    const { w, id, runId, entry } = await decideWaiting();
    // The run kept the entry's bytes before the step, bound to the snapshot's mark of it.
    const kept = readRunState(w.root, runId)!.agentSnapshot!;
    expect(Object.keys(kept.texts ?? {})).toEqual([`clossys/agents/${entry}`]);
    expect(keptTexts(kept, kept.files)).toEqual(kept.texts);
    const checked = await w.cli("request", id, "--check");
    expect(checked.exitCode, checked.message).toBe(0);
    expect((await w.cli("request", id, "--decide", "reuse", "--slot", "writer/narratives.guide", "--by", "writer")).exitCode).toBe(0);
    const done = await w.run("loop.slot", "--resume", "--run", runId, "--step-exit", "0", "--model", MODEL, "--wrote", entry);
    expect(done.message).toMatch(/done: loop\.slot done/);
    expect(done.exitCode).toBe(0);
    expect(w.read(entry)).toMatchObject({ status: "closed", decision: "reuse", link: "writer/narratives.guide" });
    expect(ledgerOf(w, "ledger.slot", runId).steps.map(step => `${step.id}:${step.exit}`)).toEqual(["overlap:0", "match:0", "decide-writer:0", "link:0"]);
  });

  for (const [seat, argv] of [
    ["the owner", ["--decide", "reuse", "--slot", "writer/narratives.guide", "--by", "owner"]],
    ["the planner", ["--check", "--by", "planner"]],
    ["another agent", ["--check", "--by", "director"]],
  ] as const) {
    it(`refuses a write of the entry in the step by ${seat} (a forged event)`, async () => {
      const { w, id, runId, entry } = await decideWaiting();
      if (argv[0] === "--decide") expect((await w.cli("request", id, "--check")).exitCode).toBe(0);
      else expect((await w.cli("request", id, ...argv)).exitCode).toBe(0);
      if (argv[0] === "--decide") expect((await w.cli("request", id, ...argv)).exitCode).toBe(0);
      else expect((await w.cli("request", id, "--decide", "reuse", "--slot", "writer/narratives.guide", "--by", "writer")).exitCode).toBe(0);
      const refused = await w.run("loop.slot", "--resume", "--run", runId, "--step-exit", "0", "--model", MODEL, "--wrote", entry);
      expect(refused.exitCode, refused.message).toBe(1);
      expect(refused.message).toMatch(new RegExp(`step decide-writer changed clossys/\\.state/events\\.jsonl event seq \\d+ \\(request\\.write request:${id}\\): is by ${argv.at(-1)}, not the step's agent agent:writer`));
      expect(w.read(entry).status).toBe("open");
    });
  }

  it("refuses a file no verb of the step wrote, reported or not", async () => {
    for (const reported of [false, true]) {
      const { w, id, runId, entry } = await decideWaiting();
      expect((await w.cli("request", id, "--check")).exitCode).toBe(0);
      expect((await w.cli("request", id, "--decide", "reuse", "--slot", "writer/narratives.guide", "--by", "writer")).exitCode).toBe(0);
      writeFileSync(w.file("writer/narratives.guide/notes.json"), "{}\n");
      const refused = await w.run("loop.slot", "--resume", "--run", runId, "--step-exit", "0", "--model", MODEL, "--wrote", entry, ...(reported ? ["--wrote", "writer/narratives.guide/notes.json"] : []));
      expect(refused.exitCode, refused.message).toBe(1);
      expect(refused.message).toMatch(reported
        ? /step decide-writer wrote writer\/narratives\.guide\/notes\.json, which \S+ does not declare it writes/
        : /step decide-writer added writer\/narratives\.guide\/notes\.json without reporting it \(--wrote\)/);
      expect(w.read(entry).status).toBe("open");
    }
  });

  it("refuses an earlier write of the entry whose bytes are no state between before and after (a hand edit the verb then rewrote)", async () => {
    const { w, id, runId, entry } = await decideWaiting();
    expect((await w.cli("request", id, "--check")).exitCode).toBe(0);
    // A hand edit after --check, logged as if the verb wrote it: the agent appends its own request.write naming the
    // hand-edited bytes, then --decide writes over it. No verb of the step wrote those bytes.
    const doc = w.read(entry);
    doc.why = "a why neither before nor after holds";
    writeFileSync(w.file(entry), `${JSON.stringify(doc, null, 2)}\n`);
    const { recordEvent } = await import("../engine/log.js");
    recordEvent([w.file(entry)], { actor: "producer", kind: "request.write", subject: `request:${id}` });
    doc.why = "a how-to the article links";
    writeFileSync(w.file(entry), `${JSON.stringify(doc, null, 2)}\n`);
    expect((await w.cli("request", id, "--decide", "reuse", "--slot", "writer/narratives.guide", "--by", "writer")).exitCode).toBe(0);
    const refused = await w.run("loop.slot", "--resume", "--run", runId, "--step-exit", "0", "--model", MODEL, "--wrote", entry);
    expect(refused.exitCode, refused.message).toBe(1);
    expect(refused.message).toMatch(new RegExp(`its sha256 of clossys/agents/producer/queue\\.slot/entries/${id}\\.json is not the file's bytes when it was written`));
  });

  // Fix round 1 F2 (B-P1, B-P2): each earlier event naming the entry carries a state the step left, once and in order.
  it("refuses a forged earlier write that names a state no write of the step left at that point (B-P1)", async () => {
    const { w, id, runId, entry } = await decideWaiting();
    const before = w.read(entry);
    expect((await w.cli("request", id, "--check")).exitCode).toBe(0);
    // The after bytes, learned by running --decide on a copy of this world (inside the test's own tmp dirs).
    const clone = realpathSync(mkdtempSync(join(tmpdir(), "loop-steps-clone-")));
    roots.push(clone);
    cpSync(w.root, clone, { recursive: true });
    expect((await runCli(["request", id, "--decide", "reuse", "--slot", "writer/narratives.guide", "--by", "writer", "--root", clone], clone)).exitCode).toBe(0);
    const after = JSON.parse(readFileSync(join(clone, "clossys", "agents", entry), "utf8"));
    // Every after value with the events cut after `checked`: a mix entryStepStates gives, never on disk.
    const mix = { ...after, events: after.events.slice(0, before.events.length + 1) };
    const { logEvent } = await import("../engine/log.js");
    logEvent(w.root, { actor: "producer", kind: "request.write", subject: `request:${id}`, inputs: [{ path: `clossys/agents/${entry}`, sha256: sha256Hex(Buffer.from(`${JSON.stringify(mix, null, 2)}\n`, "utf8")) }] } as never);
    expect((await w.cli("request", id, "--decide", "reuse", "--slot", "writer/narratives.guide", "--by", "writer", "--at", after.events.at(-1).at)).exitCode).toBe(0);
    expect(readFileSync(w.file(entry), "utf8")).toBe(readFileSync(join(clone, "clossys", "agents", entry), "utf8"));
    const refused = await w.run("loop.slot", "--resume", "--run", runId, "--step-exit", "0", "--model", MODEL, "--wrote", entry);
    expect(refused.exitCode, refused.message).toBe(1);
    expect(refused.message).toMatch(new RegExp(`names clossys/agents/producer/queue\\.slot/entries/${id}\\.json with ${before.events.length + 1} events after a write that left ${before.events.length + 1}: each write of the entry appends its own event, once and in order`));
    expect(w.read(entry).status).toBe("open");
  });

  it("refuses a replayed write of the entry, and a write of it under another entry's subject (B-P2)", async () => {
    for (const forge of ["replay", "subject"] as const) {
      const { w, id, runId, entry } = await decideWaiting();
      expect((await w.cli("request", id, "--check")).exitCode).toBe(0);
      const { recordEvent } = await import("../engine/log.js");
      if (forge === "replay") recordEvent([w.file(entry)], { actor: "producer", kind: "request.write", subject: `request:${id}` });
      else recordEvent([w.file(entry)], { actor: "writer", kind: "request.write", subject: "request:some-other-request" });
      expect((await w.cli("request", id, "--decide", "reuse", "--slot", "writer/narratives.guide", "--by", "writer")).exitCode).toBe(0);
      const refused = await w.run("loop.slot", "--resume", "--run", runId, "--step-exit", "0", "--model", MODEL, "--wrote", entry);
      expect(refused.exitCode, refused.message).toBe(1);
      expect(refused.message).toMatch(forge === "replay"
        ? new RegExp(`names clossys/agents/producer/queue\\.slot/entries/${id}\\.json with (\\d+) events after a write that left \\1: each write`)
        : new RegExp(`names subject request:some-other-request, not request:${id}, the entry it writes`));
      expect(w.read(entry).status).toBe("open");
    }
  });

  // Fix round 1 F3 (A-P1): a hand edit of the step's own entry, logged as one forged verb write, is refused.
  it("refuses a hand-appended event on the entry logged as one forged verb write (A-P1)", async () => {
    for (const op of ["answered", "checked"] as const) {
      const { w, id, runId, entry } = await decideWaiting();
      expect((await w.cli("request", id, "--check")).exitCode).toBe(0);
      expect((await w.cli("request", id, "--decide", "reuse", "--slot", "writer/narratives.guide", "--by", "writer")).exitCode).toBe(0);
      const doc = w.read(entry);
      const at = doc.events.at(-1).at;
      doc.events.push(op === "answered"
        ? { id: `${id}#${doc.events.length + 1}`, at, op, by: "owner", via: "cli", quote: "close it" }
        : { id: `${id}#${doc.events.length + 1}`, at, op, by: "owner", detail: "looked again" });
      writeFileSync(w.file(entry), `${JSON.stringify(doc, null, 2)}\n`);
      const { recordEvent } = await import("../engine/log.js");
      recordEvent([w.file(entry)], { actor: "producer", kind: "request.write", subject: `request:${id}` });
      const refused = await w.run("loop.slot", "--resume", "--run", runId, "--step-exit", "0", "--model", MODEL, "--wrote", entry);
      expect(refused.exitCode, refused.message).toBe(1);
      expect(refused.message).toMatch(op === "answered"
        ? new RegExp(`names a state of clossys/agents/producer/queue\\.slot/entries/${id}\\.json the request writer never writes`)
        : new RegExp(`is by producer, but the request writer names owner for the state of clossys/agents/producer/queue\\.slot/entries/${id}\\.json it carries`));
      expect(w.read(entry).status).toBe("open");
    }
  });

  it("stops a run whose kept entry bytes do not hash to the snapshot's mark (fail closed)", async () => {
    const { w, runId, entry } = await decideWaiting();
    const file = join(w.root, "clossys", ".state", "runs", "loops", `${runId}.json`);
    const state = JSON.parse(readFileSync(file, "utf8"));
    state.agentSnapshot.texts[`clossys/agents/${entry}`] += " ";
    writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
    const stopped = await w.run("loop.slot", "--resume", "--run", runId, "--step-exit", "0", "--model", MODEL, "--wrote", entry);
    expect(stopped.exitCode, stopped.message).toBe(2);
    expect(stopped.message).toMatch(/the snapshot the run kept before agent:writer ran is missing or corrupt/);
  });

  it("entryStepShas gives only states mixing before and after values, after-events cut inside the step", () => {
    const bytes = (doc: unknown) => `${JSON.stringify(doc, null, 2)}\n`;
    const sha = (doc: unknown) => sha256Hex(Buffer.from(bytes(doc), "utf8"));
    const before = { id: "r", status: "open", overlaps: [], events: [{ op: "raised" }] };
    const checked = { id: "r", status: "open", overlaps: [{ slot: "a" }], events: [{ op: "raised" }, { op: "checked" }] };
    const after = { id: "r", status: "open", overlaps: [{ slot: "a" }], decision: "reuse", events: [{ op: "raised" }, { op: "checked" }, { op: "decided" }] };
    const states = entryStepShas(bytes(before), bytes(after));
    expect(states.has(sha(checked))).toBe(true);
    // A value neither side holds, the events of before or after themselves, or a rewritten prior event are no state.
    expect(states.has(sha({ ...checked, status: "closed" }))).toBe(false);
    expect(states.has(sha(before))).toBe(false);
    expect(states.has(sha(after))).toBe(false);
    expect(entryStepShas(bytes(before), bytes({ ...after, events: [{ op: "forged" }, ...after.events.slice(1)] })).size).toBe(0);
    expect(entryStepShas(bytes({ id: "r" }), bytes(after)).size).toBe(0);
  });

  it("keeps the bytes of only the queue entries a step names exactly", () => {
    const w = fixture();
    const keys = stepEntryKeys({ request: "20261120T0800Z-x" }, { writes: ["producer/queue.slot/entries/<request>.json", "producer/queue.slot/entries/*", "designer/*/slot.json"] });
    expect(keys).toEqual(["clossys/agents/producer/queue.slot/entries/20261120T0800Z-x.json"]);
    const before = treeSnapshot(w.root, "20261120T0800Z-none");
    expect(stepEntryTexts(w.root, before, [...keys, "clossys/agents/designer/assets.app-icon/slot.json"])).toEqual({});
    expect(keptTexts(keepSnapshot("s", before), before)).toEqual({});
    expect(keptTexts({ ...keepSnapshot("s", before), texts: { "clossys/agents/designer/assets.app-icon/slot.json": "{}" } }, before)).toBeUndefined();
  });
});

describe("a create step raises the upstream change its skill tells it to (consumer-agent-step-upstream-raise-refused)", { timeout: 120_000 }, () => {
  const SLOT = "designer/assets.app-icon";
  const UPSTREAM = "director/context.customer.need";
  /**
   * loop.create on the designer slot, waiting on its create step. DET-STEPS: the code steps triage and adopt run first;
   * with no slot-wide trigger triage settles refine-brief, and an assets slot is no byte-exact adopt slot, so the agent
   * creates.
   */
  async function createWaiting() {
    const w = await world();
    const start = await w.run("loop.create", "--slot", SLOT);
    expect(start.message, start.message).toMatch(/step create waits for agent:designer \(create-candidates, mid\)/);
    const runId = waitingRun(start.message);
    expect(readRunState(w.root, runId)!.steps.map(step => `${step.id}:${step.exit}`)).toEqual(["triage:0", "adopt:0"]);
    expect(readRunState(w.root, runId)!.settled).toEqual({ "refine-brief": "triage" });
    return { w, runId };
  }
  const raise = async (w: World, ...more: string[]) => {
    const raised = await w.cli("request", "--kind", "change", "--subject", UPSTREAM, "--from", SLOT, "--want", "candidate", "--why", "the icon needs the customer need pinned", ...more);
    expect(raised.exitCode, raised.message).toBe(0);
    return (raised.output as { id: string }).id;
  };

  it("parks the run on the raised change and runs the create step again once it closes", async () => {
    const { w, runId } = await createWaiting();
    const id = await raise(w);
    const entry = `producer/queue.change/entries/${id}.json`;
    const parked = await w.run("loop.create", "--resume", "--run", runId, "--step-exit", "2", "--model", MODEL, "--wrote", entry);
    expect(parked.exitCode, parked.message).toBe(0);
    expect(parked.message).toMatch(new RegExp(`step create raised queue\\.change#${id} and waits until it closes`));
    const state = readRunState(w.root, runId)!;
    expect(state).toMatchObject({ status: "waiting", waiting: { step: "create", on: "entry", entry: `queue.change#${id}`, then: "retry" } });
    expect(state.raised).toContain(`queue.change#${id}`);
    expect(state.steps.at(-1)).toMatchObject({ id: "create", exit: 2 });
    // Still open: the run still waits, and the create step does not run.
    const still = await w.run("loop.create", "--resume", "--run", runId);
    expect(still.exitCode, still.message).toBe(0);
    expect(still.message).toMatch(new RegExp(`create still waits on queue\\.change#${id}`));
    // The change routes to the owner first (row owner.class); the owner's answer closes it, and the step runs again.
    expect(w.read(entry).assignee).toBe("owner");
    const closed = await w.cli("request", id, "--answer", "decline", "--via", "cli", "--quote", "not now");
    expect(closed.exitCode, closed.message).toBe(0);
    expect(w.read(entry)).toMatchObject({ status: "closed", outcome: "declined" });
    const again = await w.run("loop.create", "--resume", "--run", runId);
    expect(again.exitCode, again.message).toBe(0);
    expect(again.message).toMatch(/step create waits for agent:designer \(create-candidates, mid\)/);
    expect(readRunState(w.root, runId)!.refs).toContainEqual({ to: "producer/queue.change", record: id, rel: "cites" });
  });

  it("refuses a raise that is not the verb's own entry: another seat's raise, or a hand edit of it", async () => {
    for (const forge of ["owner", "edit"] as const) {
      const { w, runId } = await createWaiting();
      const id = await raise(w, ...(forge === "owner" ? ["--by", "owner"] : []));
      const entry = `producer/queue.change/entries/${id}.json`;
      if (forge === "edit") {
        const doc = w.read(entry);
        doc.why = "words the verb never wrote";
        writeFileSync(w.file(entry), `${JSON.stringify(doc, null, 2)}\n`);
      }
      const refused = await w.run("loop.create", "--resume", "--run", runId, "--step-exit", "2", "--model", MODEL, "--wrote", entry);
      expect(refused.exitCode, refused.message).toBe(1);
      expect(refused.message).toMatch(new RegExp(`step create raised producer/queue\\.change/entries/${id}\\.json: not the entry clossys request raises for designer \\(${id}\\): ${forge === "edit" ? "\\w+" : "events"} differs`));
      expect(readRunState(w.root, runId)!.status).toBe("stopped");
    }
  });

  // Fix round 1 F1 (A-P2, B-P3, A-P3, B-P4): a request.create in a create step is the verb's own log of a raise.
  it("refuses a forged request.create over a file the agent wrote by hand, with no raise (A-P2, B-P3)", async () => {
    const { w, runId } = await createWaiting();
    mkdirSync(w.file(`${SLOT}/candidates`), { recursive: true });
    const candidate = `${SLOT}/candidates/forged.md`;
    writeFileSync(w.file(candidate), "# hand written\n");
    const { recordEvent } = await import("../engine/log.js");
    recordEvent([w.file(candidate)], { actor: "producer", kind: "request.create", subject: "request:20261101T0000Z-slot-not-real" });
    const refused = await w.run("loop.create", "--resume", "--run", runId, "--step-exit", "2", "--model", MODEL, "--wrote", candidate);
    expect(refused.exitCode, refused.message).toBe(1);
    expect(refused.message).toMatch(/event seq \d+ \(request\.create request:20261101T0000Z-slot-not-real\): a request event names exactly one input, the queue entry it writes/);
    expect(readRunState(w.root, runId)!.status).toBe("stopped");
  });

  it("refuses an extra request.create over a real raise, under another subject or by another actor (A-P3, B-P4)", async () => {
    for (const [actor, subject] of [["code:clossys request", "request:someone-elses"], ["code:clossys pin", "request:not-this-one"]] as const) {
      const { w, runId } = await createWaiting();
      const id = await raise(w);
      const entry = `producer/queue.change/entries/${id}.json`;
      const { recordEvent } = await import("../engine/log.js");
      recordEvent([w.file(entry)], { actor, kind: "request.create", subject });
      const refused = await w.run("loop.create", "--resume", "--run", runId, "--step-exit", "2", "--model", MODEL, "--wrote", entry);
      expect(refused.exitCode, refused.message).toBe(1);
      // The verb's own request.create is no longer the last event naming the entry: the step logged a write it never made.
      expect(refused.message).toMatch(new RegExp(`\\(request\\.create request:${id}\\): its sha256 of clossys/agents/producer/queue\\.change/entries/${id}\\.json is not the entry's bytes after the step`));
      expect(readRunState(w.root, runId)!.status).toBe("stopped");
    }
  });

  it("refuses a raise logged by no request.create of the verb: none, another actor's, or another subject's", async () => {
    for (const forge of ["none", "actor", "subject"] as const) {
      const { w, runId } = await createWaiting();
      const log = join(w.root, "clossys", ".state", "events.jsonl"), index = join(w.root, "clossys", ".state", "index.json");
      const [logBefore, indexBefore] = [readFileSync(log), readFileSync(index)];
      const id = await raise(w);
      const entry = `producer/queue.change/entries/${id}.json`;
      // The verb's own event is taken out of the log (and the index put back with it); a forged one may stand in for it.
      writeFileSync(log, logBefore);
      writeFileSync(index, indexBefore);
      const { recordEvent } = await import("../engine/log.js");
      if (forge === "actor") recordEvent([w.file(entry)], { actor: "code:clossys request", kind: "request.create", subject: `request:${id}` });
      if (forge === "subject") recordEvent([w.file(entry)], { actor: "producer", kind: "request.create", subject: "request:someone-elses" });
      const refused = await w.run("loop.create", "--resume", "--run", runId, "--step-exit", "2", "--model", MODEL, "--wrote", entry);
      expect(refused.exitCode, refused.message).toBe(1);
      expect(refused.message).toMatch(new RegExp({
        none: `producer/queue\\.change/entries/${id}\\.json was raised in step create with no request\\.create event of the request verb`,
        actor: `is by code:clossys request, not producer, the code the request verb runs when it raises`,
        subject: `names subject request:someone-elses, not request:${id}, the entry it writes`,
      }[forge]));
      expect(readRunState(w.root, runId)!.status).toBe("stopped");
    }
  });

  // Fix round 1 N1: the skill's "or a slot need" raise parks the run as the change raise does.
  it("parks the run on a slot need the create step raises", async () => {
    const w = await world([SLOT, "designer/frames.nowhere-shell"]);
    const start = await w.run("loop.create", "--slot", SLOT);
    const runId = waitingRun(start.message);
    expect((await w.run("loop.create", "--resume", "--run", runId, "--step-exit", "0", "--model", MODEL)).message).toMatch(/step create waits for agent:designer/);
    const raised = await w.cli("request", "--target", "designer/frames.nowhere-shell", "--from", SLOT, "--why", "the icon sits in a shell no slot holds", "--by", "designer");
    expect(raised.exitCode, raised.message).toBe(0);
    const id = (raised.output as { id: string }).id;
    const parked = await w.run("loop.create", "--resume", "--run", runId, "--step-exit", "2", "--model", MODEL, "--wrote", `producer/queue.slot/entries/${id}.json`);
    expect(parked.exitCode, parked.message).toBe(0);
    expect(parked.message).toMatch(new RegExp(`step create raised queue\\.slot#${id} and waits until it closes`));
    expect(readRunState(w.root, runId)).toMatchObject({ status: "waiting", waiting: { step: "create", on: "entry", entry: `queue.slot#${id}`, then: "retry" } });
  });

  // CP1-CHECKS (CP1-REPORT review N4): an agent step of an agent loop that obeys the report rule (a verb refused with no
  // next step: file `clossys request --kind report` and stop) is judged by the report's own shape, not refused for it.
  it("an agent loop step may file its own loop's report", async () => {
    const report = async (w: World, from: string) => {
      const filed = await w.cli("request", "--kind", "report", "--about", "verb/next", "--what", "gap", "--why", "clossys next refused with no next step", "--from", from, "--by", "designer");
      expect(filed.exitCode, filed.message).toBe(0);
      return `producer/queue.report/entries/${(filed.output as { id: string }).id}.json`;
    };
    const { w, runId } = await createWaiting();
    const entry = await report(w, "designer/loop.create");
    const stopped = await w.run("loop.create", "--resume", "--run", runId, "--step-exit", "2", "--model", MODEL, "--wrote", entry);
    expect(stopped.exitCode, stopped.message).toBe(2);
    expect(stopped.message).not.toMatch(/refuses it|does not declare it writes/);
    expect(stopped.message).toMatch(/step create could not run \(exit 2\)/);
    expect(w.read(entry)).toMatchObject({ kind: "report", status: "open", from: "designer/loop.create", about: "verb/next" });
    // Only the report of the step's own loop: one from another loop is still a write the step does not declare.
    const other = await createWaiting();
    const foreign = await report(other.w, "designer/loop.refine");
    const refused = await other.w.run("loop.create", "--resume", "--run", other.runId, "--step-exit", "2", "--model", MODEL, "--wrote", foreign);
    expect(refused.exitCode, refused.message).toBe(1);
    expect(refused.message).toMatch(/refuses it|does not declare it writes/);
  });

  it("refuses an unreported raise, and a raise from another slot than the run's", async () => {
    const { w, runId } = await createWaiting();
    const id = await raise(w);
    const unreported = await w.run("loop.create", "--resume", "--run", runId, "--step-exit", "2", "--model", MODEL);
    expect(unreported.exitCode, unreported.message).toBe(1);
    expect(unreported.message).toMatch(new RegExp(`added producer/queue\\.change/entries/${id}\\.json without reporting it \\(--wrote\\)`));
    const other = await createWaiting();
    const raised = await other.w.cli("request", "--kind", "change", "--subject", UPSTREAM, "--from", "designer/assets.favicon", "--want", "candidate", "--why", "x");
    expect(raised.exitCode, raised.message).toBe(0);
    const otherId = (raised.output as { id: string }).id;
    const refused = await other.w.run("loop.create", "--resume", "--run", other.runId, "--step-exit", "2", "--model", MODEL, "--wrote", `producer/queue.change/entries/${otherId}.json`);
    expect(refused.exitCode, refused.message).toBe(1);
    expect(refused.message).toMatch(new RegExp(`step create raised producer/queue\\.change/entries/${otherId}\\.json: from designer/assets\\.favicon: the step raises only from the run's own slot ${SLOT}`));
  });
});

describe("loop.slot answers only an entry routed to it (consumer-slot-request-route-handler-mismatch)", { timeout: 120_000 }, () => {
  it("routes a homeless slot need in an agent's tree to that agent's loop.slot, which answers it", async () => {
    const w = await world(["designer/assets.app-icon", "designer/frames.nowhere-shell"]);
    const raised = await w.cli("request", "--target", "designer/frames.nowhere-shell", "--from", "designer/assets.app-icon", "--why", "a shell no slot holds", "--by", "designer");
    expect(raised.exitCode, raised.message).toBe(0);
    const request = raised.output as { id: string; route: { row: string; handler: { loop: string; skill: string } } };
    expect(request.route.row).toMatch(/^slot\.(home|agent)$/);
    expect(request.route).toMatchObject({ handler: { loop: "loop.slot", skill: "packages/designer/actions/designer.slot/skill.md" } });
    const start = await w.run("loop.slot", "--request", request.id);
    expect(start.exitCode, start.message).toBe(0);
    expect(start.message).toMatch(/step decide-designer waits for agent:designer/);
  });

  it("refuses with a HandlerMismatchError an entry whose route names a handler of another loop", async () => {
    const w = await world(["designer/assets.app-icon", "designer/frames.nowhere-shell"]);
    const raised = await w.cli("request", "--target", "designer/frames.nowhere-shell", "--from", "designer/assets.app-icon", "--why", "a shell no slot holds", "--by", "designer");
    const id = (raised.output as { id: string }).id;
    const file = w.file(`producer/queue.slot/entries/${id}.json`);
    const doc = JSON.parse(readFileSync(file, "utf8"));
    for (const [route, why] of [
      [{ ...doc.route, row: "slot.scope", handler: { skill: "packages/designer/actions/designer.scope/skill.md", loop: "loop.scope" } }, /routed slot\.scope -> designer to loop\.scope \(packages\/designer\/actions\/designer\.scope\/skill\.md\), not loop\.slot/],
      [{ ...doc.route, handler: { skill: "packages/designer/actions/designer.candidates/skill.md", loop: "loop.create" } }, /to loop\.create \(packages\/designer\/actions\/designer\.candidates\/skill\.md\), not loop\.slot/],
    ] as const) {
      const routed = { ...doc, route };
      writeFileSync(file, `${JSON.stringify(routed, null, 2)}\n`);
      const cli = await w.run("loop.slot", "--request", id);
      expect(cli.exitCode).not.toBe(0);
      expect(cli.message).toMatch(/HandlerMismatchError: --request \S+: /);
      expect(cli.message).toMatch(why);
      writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    }
    expect(existsSync(file)).toBe(true);
  });
});
