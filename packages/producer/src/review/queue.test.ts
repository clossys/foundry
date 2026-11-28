import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { scratch } from "./exec.js";
import { admissible, queueFindings, queueOrder, RunQueue, type QueueEntry, type QueueFile, type QueueOptions } from "./queue.js";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

/** A queue in a fresh folder whose sleeps are counted, never slept, and whose kills are recorded, never sent. */
function queue(capacity: number, extra: Partial<QueueOptions> = {}) {
  const dir = scratch("review-queue-");
  roots.push(dir);
  const killed: number[] = [];
  let sleeps = 0;
  const made = new RunQueue({ dir, capacity, pollMs: 1, pid: 4242, sleep: () => { sleeps++; }, kill: pid => { killed.push(pid); }, alive: () => true, ...extra });
  return { dir, queue: made, killed, sleeps: () => sleeps };
}
const states = (q: RunQueue) => Object.fromEntries(q.read().entries.map(entry => [entry.id, entry.state]));

describe("the run queue", () => {
  it("queue cancels runs for a superseded head", () => {
    const { queue: q, killed } = queue(1);
    const running = q.enqueue({ unit: "U1", head: "a".repeat(40), kind: "review" });
    expect(q.poll(running.id).state).toBe("running");
    const waiting = q.enqueue({ unit: "U1", head: "a".repeat(40), kind: "rerun" });
    const other = q.enqueue({ unit: "U2", head: "c".repeat(40), kind: "review" });
    // A newer head of U1: both U1 runs at the old head are cancelled, the running one is signalled; U2 is untouched.
    const newer = q.enqueue({ unit: "U1", head: "b".repeat(40), kind: "review" });
    expect(states(q)).toEqual({ [running.id]: "cancelled", [waiting.id]: "cancelled", [other.id]: "queued", [newer.id]: "queued" });
    expect(q.read().entries.filter(entry => entry.state === "cancelled").map(entry => entry.supersededBy)).toEqual([newer.id, newer.id]);
    expect(killed).toEqual([4242]);
    // A cancelled run never starts, and its wait returns cancelled at once instead of waiting for a slot.
    expect(q.wait(waiting.id)).toMatchObject({ status: "cancelled" });
    expect(q.poll(waiting.id).state).toBe("cancelled");
    // The cancelled run's slot is free: the next in order is admitted.
    expect(q.wait(other.id)).toMatchObject({ status: "admitted" });
    expect(queueFindings(q.read(), 1)).toEqual([]);
  });

  it("queue never gives up a wait", () => {
    let looks = 0;
    const holder = { id: "" };
    // The slot is held for 500 looks (far past any try count), then freed; the wait keeps its place and is admitted.
    const { queue: q, sleeps } = queue(1, { sleep: () => { if (++looks === 500) q.finish(holder.id); } });
    holder.id = q.enqueue({ unit: "U1", head: "a".repeat(40), kind: "review" }).id;
    expect(q.poll(holder.id).state).toBe("running");
    const waiter = q.enqueue({ unit: "U2", head: "b".repeat(40), kind: "review" });
    const seen: number[] = [];
    const result = q.wait(waiter.id, (_entry, count) => seen.push(count));
    expect(result).toMatchObject({ status: "admitted" });
    expect(result.entry.state).toBe("running");
    expect(seen.length).toBe(500);
    expect(sleeps()).toBe(0);
    expect(states(q)).toEqual({ [holder.id]: "done", [waiter.id]: "running" });
  });

  it("orders installs for active executors first, then reviews, then re-runs, the longer critical path first", () => {
    const { queue: q } = queue(1);
    const rerun = q.enqueue({ unit: "A", head: "1", kind: "rerun", criticalPath: 9 });
    const short = q.enqueue({ unit: "B", head: "1", kind: "review", criticalPath: 1 });
    const long = q.enqueue({ unit: "C", head: "1", kind: "review", criticalPath: 5 });
    const idle = q.enqueue({ unit: "D", head: "1", kind: "install", activeExecutor: false });
    const install = q.enqueue({ unit: "E", head: "1", kind: "install", activeExecutor: true });
    expect(queueOrder(q.read().entries).map(entry => entry.id)).toEqual([install.id, long.id, short.id, idle.id, rerun.id]);
    // One slot: only the head of the line is admitted, even when a later run looks first.
    expect(q.poll(rerun.id).state).toBe("queued");
    expect(q.poll(install.id).state).toBe("running");
    expect(admissible(q.read().entries, 1)).toEqual([]);
    expect(admissible(q.read().entries, 3).map(entry => entry.id)).toEqual([long.id, short.id]);
    // A light run takes no slot and is admitted at once.
    const light = q.enqueue({ unit: "F", head: "1", kind: "rerun", heavy: false });
    expect(q.poll(light.id).state).toBe("running");
  });

  it("refuses a capacity that is not a whole number of slots, and takes over a dead holder's lock", () => {
    for (const capacity of [0, -1, 1.5, Number.NaN]) expect(() => queue(capacity)).toThrow(/capacity/);
    const { dir, queue: q } = queue(1, { alive: pid => pid !== 99 });
    rmSync(join(dir, "queue.lock"), { recursive: true, force: true });
    // A lock left by a process that is gone (pid 99) does not hold the queue up.
    const lock = join(dir, "queue.lock");
    mkdirSync(lock);
    writeFileSync(join(lock, "pid"), "99");
    expect(q.enqueue({ unit: "U", head: "1", kind: "review" }).state).toBe("queued");
    expect(JSON.parse(readFileSync(join(dir, "queue.json"), "utf8")).entries).toHaveLength(1);
  });

  it("finds live runs of one unit at two heads, more running than capacity, and a give-up state", () => {
    const entry = (id: string, unit: string, head: string, state: string): QueueEntry => ({ id, seq: Number(id.slice(4)), unit, head, kind: "review", activeExecutor: false, criticalPath: 0, heavy: true, state: state as QueueEntry["state"], enqueuedAt: "2026-11-28T00:00:00.000Z" });
    const file: QueueFile = { schema: "clossys.run-queue/1", seq: 4, entries: [entry("run-1", "U", "a", "running"), entry("run-2", "U", "b", "queued"), entry("run-3", "V", "c", "running"), entry("run-4", "W", "d", "gave-up")] };
    expect(queueFindings(file, 1).map(finding => finding.rule)).toEqual(["superseded-live", "over-capacity", "gave-up"]);
  });
});
