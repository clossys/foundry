import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { judgeSnapshot, treeSnapshot } from "../loop/agent-snapshot.js";
import type { LoopStep } from "../records/types.js";
import { EngineEventError, EVENTS_FILE, INDEX_FILE, sha256, verifyChain } from "./chain.js";
import { appendEvent, deferEvents, dropHeldEvents, recordEvent } from "./log.js";

let root: string;
const slot = (n: number) => join(root, "clossys", "agents", "writer", `copy.slot-${n}`);
const pin = (n: number) => join(slot(n), "pin.json");
const write = (n: number, text: string) => {
  mkdirSync(slot(n), { recursive: true });
  writeFileSync(pin(n), text);
  return recordEvent([pin(n)], { actor: "code:test", kind: "pin.write", subject: `writer/copy.slot-${n}` });
};
/** A write the way an agent step's own verb makes it: by the step's agent, of a kind its verb (create-candidates) produces. */
const agentWrite = (n: number, text: string, file = pin(n)) => {
  mkdirSync(slot(n), { recursive: true });
  writeFileSync(file, text);
  return recordEvent([file], { actor: "agent:writer", kind: "slot.submit", subject: `writer/copy.slot-${n}` });
};
const subjects = () => verifyChain(root).events.map(event => event.subject);

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "engine-tx-")));
  mkdirSync(join(root, "clossys", "agents", "writer"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("record writes as event transactions (engine/log.ts deferEvents)", () => {
  it("holds every event until the write returns, then appends them in order", () => {
    const out = deferEvents(() => {
      expect(write(1, "a")).toBeUndefined();
      expect(write(2, "b")).toBeUndefined();
      expect(verifyChain(root).count).toBe(0);
      return "done";
    });
    expect(out).toBe("done");
    expect(subjects()).toEqual(["writer/copy.slot-1", "writer/copy.slot-2"]);
    expect(verifyChain(root).ok).toBe(true);
  });

  it("drops the held events of files the write put back, and keeps the rest", () => {
    deferEvents(() => {
      write(1, "a");
      write(2, "b");
      rmSync(pin(1));
      dropHeldEvents([pin(1)]);
    });
    expect(subjects()).toEqual(["writer/copy.slot-2"]);
  });

  it("logs nothing for a write that undoes itself and throws; keeps the events of one that throws without undoing", () => {
    expect(() => deferEvents(() => { write(1, "a"); rmSync(pin(1)); dropHeldEvents([pin(1)]); throw new Error("refused"); })).toThrow("refused");
    expect(verifyChain(root).count).toBe(0);
    expect(() => deferEvents(() => { write(2, "b"); throw new Error("late failure"); })).toThrow("late failure");
    expect(subjects()).toEqual(["writer/copy.slot-2"]);
  });

  it("joins a scope opened inside another to the outer one", () => {
    deferEvents(() => {
      deferEvents(() => { write(1, "a"); });
      expect(verifyChain(root).count).toBe(0);
      write(2, "b");
    });
    expect(subjects()).toEqual(["writer/copy.slot-1", "writer/copy.slot-2"]);
  });

  it("refuses a bad draft at the call that made it, not at the commit", () => {
    expect(() => deferEvents(() => { mkdirSync(slot(1), { recursive: true }); writeFileSync(pin(1), "a"); recordEvent([pin(1)], { actor: "two\nlines", kind: "pin.write", subject: "x" }); })).toThrow(EngineEventError);
    expect(verifyChain(root).count).toBe(0);
  });
});

describe("an agent step's engine changes (loop/agent-snapshot.ts engineLogIssue, engineIndexIssue)", () => {
  const step = { id: "create", cli: "clossys next --submit", decider: { by: "agent", agent: "writer", verb: "create-candidates", tier: "mid" } } as unknown as Pick<LoopStep, "id" | "decider" | "cli">;
  const key = (n: number) => `clossys/agents/writer/copy.slot-${n}/pin.json`;
  const judge = (before: Record<string, string>, reported: readonly string[], runId?: string) =>
    judgeSnapshot(root, before, treeSnapshot(root, "r1"), new Set(reported), step, "writer", undefined, undefined, runId).issues;
  /** The log's issues alone (an event with a hash off the file's bytes also leaves the index off its rebuild). */
  const logIssues = (before: Record<string, string>, reported: readonly string[], runId?: string) =>
    judge(before, reported, runId).filter(issue => issue.startsWith(`changed ${EVENTS_FILE}`));

  it("accepts the log and index a step's own verbs left: an append naming what it changed", () => {
    write(1, "a");
    const before = treeSnapshot(root, "r1");
    agentWrite(2, "b");
    agentWrite(1, "c");
    expect(judge(before, [key(1), key(2)])).toEqual([]);
  });

  it("refuses an appended event that names a file the step did not change", () => {
    write(1, "a");
    const before = treeSnapshot(root, "r1");
    agentWrite(2, "b");
    recordEvent([pin(1)], { actor: "agent:writer", kind: "slot.submit", subject: "writer/copy.slot-1" });
    expect(judge(before, [key(2)])).toEqual([`changed ${EVENTS_FILE} event seq 2 (slot.submit writer/copy.slot-1): names ${key(1)}, which step create did not change`]);
  });

  it("refuses a forged owner approval with a fake hash, and any event not by the step's agent, of another kind, or off the file's bytes", () => {
    write(1, "a");
    const before = treeSnapshot(root, "r1");
    agentWrite(2, "b");
    const fake = "0".repeat(64);
    const forged = appendEvent(root, { actor: "owner:approved-by-owner", kind: "owner.approve", subject: "writer/copy.slot-2", inputs: [{ path: key(2), sha256: fake }] });
    expect(verifyChain(root).ok).toBe(true); // the chain alone cannot tell: the forgery is a well-chained line
    expect(logIssues(before, [key(2)])).toEqual([`changed ${EVENTS_FILE} event seq ${forged.seq} (owner.approve writer/copy.slot-2): is by owner:approved-by-owner, not the step's agent agent:writer`]);
    const cases: readonly [Record<string, unknown>, RegExp][] = [
      [{ actor: "owner:approved-by-owner", sha256: sha256("b") }, /is by owner:approved-by-owner, not the step's agent agent:writer$/],
      [{ actor: "agent:designer" }, /is by agent:designer, not the step's agent agent:writer$/],
      [{ actor: "code:test" }, /is by code:test, not the step's agent agent:writer$/],
      [{ kind: "owner.approve" }, /kind owner\.approve is not one step create \(create-candidates\) produces \(slot\.submit\)$/],
      [{ kind: "slot.pin" }, /kind slot\.pin is not one step create \(create-candidates\) produces \(slot\.submit\)$/],
      [{ subject: "designer/x" }, /names subject designer\/x, not one of agent writer's$/],
      [{ sha256: fake }, new RegExp(`its sha256 of ${key(2).replace(/\./g, "\\.")} is not the file's bytes after the step$`)],
      [{ sha256: null }, /is not the file's bytes after the step$/],
    ];
    for (const [change, refusal] of cases) {
      rmSync(join(root, EVENTS_FILE));
      rmSync(join(root, INDEX_FILE), { force: true });
      rmSync(pin(2));
      write(1, "a");
      const at = treeSnapshot(root, "r1");
      writeFileSync(pin(2), "b");
      const { sha256: sha = sha256("b"), ...draft } = change;
      appendEvent(root, { actor: "agent:writer", kind: "slot.submit", subject: "writer/copy.slot-2", ...draft, inputs: [{ path: key(2), sha256: sha as string | null }] });
      expect(logIssues(at, [key(2)]), JSON.stringify(change)).toEqual([expect.stringMatching(refusal)]);
    }
    // A pick step's pin document may name the Producer code its verb runs, never an owner.
    const pick = { id: "pick", cli: "clossys pick", decider: { by: "agent", agent: "writer", verb: "pick", tier: "mid" } } as unknown as Pick<LoopStep, "id" | "decider" | "cli">;
    for (const [actor, refused] of [["code:clossys pin", false], ["agent:writer", false], ["owner:approved-by-owner", true], ["planner:p", true]] as const) {
      rmSync(join(root, EVENTS_FILE));
      rmSync(join(root, INDEX_FILE), { force: true });
      rmSync(pin(2));
      write(1, "a");
      const at = treeSnapshot(root, "r1");
      writeFileSync(pin(2), "b");
      appendEvent(root, { actor, kind: "pin.write", subject: "writer/copy.slot-2", inputs: [{ path: key(2), sha256: sha256("b") }] });
      const issues = judgeSnapshot(root, at, treeSnapshot(root, "r1"), new Set([key(2)]), pick, "writer", undefined).issues.filter(issue => issue.startsWith(`changed ${EVENTS_FILE}`));
      expect(issues, actor).toEqual(refused ? [expect.stringMatching(new RegExp(`is by ${actor}, not the step's agent agent:writer or the Producer code its verb runs$`))] : []);
    }
  });

  it("checks every event's hash: the last naming a file carries its bytes after the step, an earlier ledger one a prefix of it", () => {
    const ledger = join(slot(3), "ledger.json"), ledgerKey = "clossys/agents/writer/copy.slot-3/ledger.json";
    const doc = (events: readonly unknown[]) => `${JSON.stringify({ schema: "ledger/1", events }, null, 2)}\n`;
    write(1, "a");
    const before = treeSnapshot(root, "r1");
    agentWrite(3, doc([{ op: "submit" }]), ledger);
    agentWrite(3, doc([{ op: "submit" }, { op: "submit", n: 2 }]), ledger);
    expect(judge(before, [ledgerKey])).toEqual([]);
    rmSync(join(root, EVENTS_FILE));
    rmSync(join(root, INDEX_FILE), { force: true });
    rmSync(slot(3), { recursive: true });
    write(1, "a");
    const at = treeSnapshot(root, "r1");
    agentWrite(3, "not a prefix", ledger);
    agentWrite(3, doc([{ op: "submit" }]), ledger);
    expect(logIssues(at, [ledgerKey])).toEqual([expect.stringMatching(/event seq 1 \(slot\.submit writer\/copy\.slot-3\): its sha256 of .*ledger\.json is not the file's bytes when it was written$/)]);
  });

  it("lets a run event name the run's own state file only for that run", () => {
    write(1, "a");
    const before = treeSnapshot(root, "r1");
    mkdirSync(join(root, ".clossys", "runs", "loops"), { recursive: true });
    writeFileSync(join(root, ".clossys", "runs", "loops", "r1.json"), "{}");
    appendEvent(root, { actor: "code:clossys run", kind: "run.state", subject: "loop:loop.create/r1", inputs: [{ path: ".clossys/runs/loops/r1.json", sha256: sha256("{}") }] });
    expect(judge(before, [], "r1")).toEqual([]);
    expect(judge(before, [])).toEqual([expect.stringMatching(/names \.clossys\/runs\/loops\/r1\.json, which step create did not change$/)]);
    writeFileSync(join(root, ".clossys", "runs", "loops", "r1.json"), "{\"later\":1}");
    expect(logIssues(before, [], "r1")).toEqual([expect.stringMatching(/its sha256 of \.clossys\/runs\/loops\/r1\.json is not the state file's bytes$/)]);
    writeFileSync(join(root, ".clossys", "runs", "loops", "r1.json"), "{}");
    appendEvent(root, { actor: "agent:writer", kind: "run.state", subject: "loop:loop.create/r1", inputs: [{ path: ".clossys/runs/loops/r1.json", sha256: sha256("{}") }] });
    expect(logIssues(before, [], "r1")).toEqual([expect.stringMatching(/names the run's own state file but is agent:writer run\.state, not the runner's code:clossys run run\.state$/)]);
  });

  it("refuses a log whose earlier lines changed, a log rewritten from scratch, an index off its rebuild, and a removed log", () => {
    write(1, "a");
    write(2, "b");
    const before = treeSnapshot(root, "r1");
    const text = readFileSync(join(root, EVENTS_FILE), "utf8");
    writeFileSync(join(root, EVENTS_FILE), text.replace("copy.slot-1\"", "copy.slot-9\""));
    expect(judge(before, [])).toEqual(expect.arrayContaining([expect.stringMatching(/^changed \.clossys\/events\.jsonl: does not verify/)]));
    rmSync(join(root, EVENTS_FILE));
    write(2, "c");
    expect(judge(before, [key(2)])).toContain(`changed ${EVENTS_FILE}: the log before step create is not a prefix of it (an event was changed or removed)`);
    writeFileSync(join(root, EVENTS_FILE), text);
    writeFileSync(join(root, INDEX_FILE), "{}\n");
    expect(judge(before, [key(2)])).toEqual([expect.stringMatching(/^changed \.clossys\/index\.json: is not the rebuild of the log/)]);
    rmSync(join(root, EVENTS_FILE));
    expect(judge(before, [key(2)])).toContain(`removed ${EVENTS_FILE}`);
  });
});
