/**
 * B5 on a ledgered consumer (foundry-build-0048 R05.2 CHOOSE, fix r1): a `clossys run` confirm step, run for real on a
 * temp copy of `test-fixtures/consumer`. The agent submits through the slot writer and picks through `clossys pick`
 * (the CHOOSE gate), so every pin.json byte state the run leaves has its ledger event. The owner's approve (the
 * confirmation) and the owner's reject (the pin the run started from, put back) are the runner's own pin writes: each
 * is ledgered and guarded as `clossys pin` writes it, so plain `clossys check` (runSlotResolve) never reports the
 * slot `pin-unledgered` after either answer.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";

// Every pin here runs the CHOOSE gate and the constitution guard over the whole fixture consumer.
vi.setConfig({ testTimeout: 300_000 });
import { pinUpstream } from "../cli/__fixtures__/upstream.js";
import { runPickCli } from "../cli/options.js";
import { runSlotResolve } from "../check/slot-resolve.js";
import { answerQueueEntry } from "../queue/answer.js";
import { sha256Hex } from "../records/hash.js";
import { readPinFile } from "../records/pin-map.js";
import { writeCandidate } from "../records/slot-write.js";
import { resumeRun, startRun, type AgentOutcome, type AgentPacket, type CodeOutcome, type RunHooks } from "./runner.js";

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
/** A Designer consumer-asset slot under designer/assets: loop.fill and loop.refine raise the owner's confirm for it. */
const SLOT = "assets.favicon";
const REF = `designer/${SLOT}`;
const AT = "2026-11-19T12:00:00Z";
const MODEL = "claude-opus-5-5";
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

/** A deterministic clock after the picks: one minute per call. */
function clock(start = "2026-11-20T08:00:00Z"): () => Date {
  let at = Date.parse(start);
  return () => { const now = new Date(at); at += 60_000; return now; };
}

/** A favicon candidate that passes the slot's contract and standard (asset.logo-mark) and cites pinned Director slots. */
const favicon = (strokeWidth: number) => ({
  name: "favicon", type: "registry:theme",
  files: [
    { path: "assets/favicon.svg", type: "registry:file", content: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}"><path d="M20 6 9 17l-5-5" /></svg>` },
    { path: `clossys/${SLOT}.json`, type: "registry:file", content: "{}" },
  ],
  meta: {
    slot: SLOT, source: { kind: "original", ref: [], license: "MIT" },
    element: { slot: SLOT, reason: "Realises director:identity.visual.imagery, director:identity.brand.essence and director:identity.brand.personality: one calm check mark." },
  },
});

function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "loop-ledgered-")));
  roots.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  const consumer = join(root, "clossys");
  pinUpstream(consumer, "designer", SLOT, AT);
  const dir = join(consumer, "agents", "designer", SLOT);
  return {
    root, consumer, dir,
    pinText: (): string => readFileSync(join(dir, "pin.json"), "utf8"),
    events: (): Record<string, unknown>[] => JSON.parse(readFileSync(join(dir, "ledger.json"), "utf8")).events as Record<string, unknown>[],
    /** The slot's `clossys check` findings (slot-resolve). */
    findings: async () => (await runSlotResolve(consumer)).rows.find(row => row.agent === "designer" && row.slot === SLOT),
  };
}

/**
 * The agent steps through the real writers (the slot writer's submit, `clossys pick` through the CHOOSE gate); every
 * code step passes. No `guard` override: the runner's own confirm and put-back run the installed constitution guard.
 */
/** The agent's submit: each new candidate differs from the slot's earlier ones (its stroke width). */
function submit(w: ReturnType<typeof world>): string {
  const made = existsSync(join(w.dir, "candidates")) ? readdirSync(join(w.dir, "candidates")).length : 0;
  return writeCandidate(w.consumer, "designer", SLOT, "favicon", favicon(made + 2), { at: AT, provenance: { by: "agent:designer", model: MODEL, tier: "high" } }).name;
}

/** The agent's pick of the slot's newest candidate, through `clossys pick` (the CHOOSE gate). */
async function pick(w: ReturnType<typeof world>): Promise<string> {
  const newest = readdirSync(join(w.dir, "candidates")).sort().pop()!;
  const picked = await runPickCli([REF, newest, "--by", "agent:designer", "--at", AT, "--root", w.root], w.root);
  expect(picked.exitCode, picked.message).toBe(0);
  return newest;
}

function realHooks(w: ReturnType<typeof world>): RunHooks {
  return {
    async agent(packet: AgentPacket): Promise<AgentOutcome> {
      if (packet.verb === "create-candidates") return { exit: 0, model: MODEL, wrote: [`${REF}/candidates/${submit(w)}`] };
      if (packet.verb === "pick") {
        const picked = await pick(w);
        return { exit: 0, model: MODEL, wrote: [`${REF}/pin.json`], cli: `clossys pick ${REF} ${picked} --by agent:designer` };
      }
      return { exit: 0, model: MODEL };
    },
    code(): CodeOutcome { return { exit: 0 }; },
  };
}

const answer = (root: string, entry: string, option: string, now: () => Date) =>
  answerQueueEntry(root, { entry, answer: option, by: "owner", via: "chat", quote: `owner said: ${option}` }, now());

/** The run's confirm step, answered by the owner. */
async function confirmStep(w: ReturnType<typeof world>, loop: "loop.fill" | "loop.refine", option: "approve" | "reject", now: () => Date) {
  const hooks = realHooks(w);
  const run = await startRun(w.root, { loop, slot: REF }, hooks, { now });
  expect(run.entry, run.message).toMatch(/^queue\.approve#/);
  // The agent's pick is ledgered: `clossys check` already passes the slot before the owner answers.
  expect((await w.findings())?.findings).toEqual([]);
  answer(w.root, run.entry!, option, now);
  const ended = await resumeRun(w.root, run.state!.runId, hooks, { now });
  return { run, ended };
}

/** The slot passes `clossys check` and its pin.json bytes are the ones its last ledger event records. */
async function expectLedgered(w: ReturnType<typeof world>) {
  const row = await w.findings();
  expect(row?.findings.filter(finding => finding.code === "pin-unledgered")).toEqual([]);
  expect(row).toMatchObject({ status: "satisfied", findings: [] });
  const last = w.events().at(-1)!;
  expect(last.records).toContainEqual({ file: "pin.json", sha256: sha256Hex(w.pinText()) });
  return last;
}

describe("B5 confirm step on a ledgered consumer (R05.2 CHOOSE fix r1): clossys check passes after the owner answers", () => {
  it("approve: the confirmation lands with its confirm event, so the slot is never pin-unledgered", async () => {
    const w = world();
    const now = clock();
    const { run, ended } = await confirmStep(w, "loop.fill", "approve", now);
    expect(ended.state!.status, ended.message).toBe("done");
    const pin = readPinFile(join(w.dir, "pin.json"), { agent: "designer", slotId: SLOT });
    expect(pin.kind).toBe("pin");
    if (pin.kind !== "pin") return;
    expect(pin.doc).toMatchObject({ candidate: "favicon-v1.json", basis: "agent", decidedBy: "agent:designer", confirmed: { by: "owner", ref: run.entry } });
    const last = await expectLedgered(w);
    expect(last).toMatchObject({ op: "confirm", verb: "pin", by: `owner:${run.entry}`, candidate: "favicon-v1.json", sha256: pin.doc.sha256, confirmed: { by: "owner", ref: run.entry } });
  });

  it("reject: the pin the run started from is put back with its decision event, so the slot is never pin-unledgered", async () => {
    const w = world();
    const now = clock();
    // The slot already holds the agent's own (unconfirmed) pick of v1 when the run starts: the agent may pick again.
    submit(w);
    expect(await pick(w)).toBe("favicon-v1.json");
    const before = w.pinText();
    const { run, ended } = await confirmStep(w, "loop.refine", "reject", now);
    expect(readPinFile(join(w.dir, "pin.json"), { agent: "designer", slotId: SLOT }).kind).toBe("pin");
    expect(ended.state!.status).toBe("stopped");
    expect(ended.message).toContain(`the owner answered reject on ${run.entry}`);
    expect(w.pinText()).toBe(before);
    // The run's own pick (v2) was ledgered too before the owner rejected it.
    expect(w.events()).toContainEqual(expect.objectContaining({ op: "pick", candidate: "favicon-v2.json" }));
    const last = await expectLedgered(w);
    expect(last).toMatchObject({ op: "pick", candidate: "favicon-v1.json", decidedBy: "agent:designer", basis: "agent" });
  });
});
