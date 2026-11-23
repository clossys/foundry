import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAnswerCli } from "../cli/answer.js";
import type { QueueEntry, QueueName } from "../records/types.js";
import { listQueueEntryFiles, readQueueEntry } from "./entry.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const OPTIONS = { options: [{ id: "a", summary: "option a" }, { id: "b", summary: "option b" }], default: "a" };

/** A throwaway consumer whose entries are stamped `stamp` (each consumer raises its questions at its own time). */
function consumer(stamp: string) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "replay-")));
  roots.push(root);
  const put = (rel: string, text: string): void => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  put("clossys/clossys.config.ts", "export default {};\n");
  put("clossys/agents/writer/sections.hero.copy/slot.json", JSON.stringify({ schema: "clossys.slot/2", id: "writer/sections.hero.copy", agent: "writer", kind: "copy", status: "open" }));
  const created = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:00Z`;
  return {
    root,
    raise(queue: QueueName, slug: string, ask: string, extra: Partial<QueueEntry> = {}): string {
      const id = `${stamp}-${slug}`;
      const entry: QueueEntry = {
        schema: "clossys.queue-entry/1", id, agent: "producer", kind: "queue-entry", status: "open",
        createdBy: { actor: "code", cli: "clossys test", version: "0.0.0" }, createdAt: created, refs: [],
        queue, ask, subject: { to: "writer/sections.hero.copy", rel: "input" },
        decider: "owner", default: null, events: [{ at: created, op: "raised", by: "code:clossys test" }], ...extra,
      };
      put(`clossys/agents/producer/${queue}/entries/${id}.json`, `${JSON.stringify(entry, null, 2)}\n`);
      return id;
    },
    /** Every entry with its ids and times taken out, in a stable order. */
    records(): unknown[] {
      return listQueueEntryFiles(root).map(at => {
        const read = readQueueEntry(at);
        if (!read.ok) throw new Error(read.reason);
        const { id: _id, createdAt: _createdAt, events, ...rest } = read.entry;
        return { ...rest, events: events.map(({ at: _at, ...event }) => event) };
      }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    },
  };
}

/** Raises round one (a pick and an approve) on a consumer. */
const roundOne = (c: ReturnType<typeof consumer>) => ({
  pick: c.raise("queue.pick", "pick", "Pick the hero copy?", OPTIONS),
  approve: c.raise("queue.approve", "approve", "Approve the hero copy?", OPTIONS),
});
const roundTwo = (c: ReturnType<typeof consumer>) => c.raise("queue.clarify", "clarify", "Which heading leads?");

describe("clossys answer --export / --replay", () => {
  it("replays two answered rounds on a fresh consumer to the same records, byte-stable and idempotent", async () => {
    const first = consumer("20261120T0800Z");
    const r1 = roundOne(first);
    expect((await runAnswerCli([r1.pick, "b", "--by", "owner", "--via", "chat", "--quote", "the second one"], first.root, new Date("2026-11-20T09:00:00Z"))).exitCode).toBe(0);
    expect((await runAnswerCli([r1.approve, "a", "--by", "owner", "--via", "app", "--quote", "approved", "--note", "round one"], first.root, new Date("2026-11-20T09:01:00Z"))).exitCode).toBe(0);
    const c1 = roundTwo(first);
    expect((await runAnswerCli([c1, "the pricing heading", "--by", "owner", "--via", "cli", "--quote", "pricing first"], first.root, new Date("2026-11-20T10:00:00Z"))).exitCode).toBe(0);
    const file = join(first.root, "answers.json");
    expect(await runAnswerCli(["--export", file], first.root)).toMatchObject({ exitCode: 0, output: { answers: 3 } });
    const exported = readFileSync(file, "utf8");
    expect(exported).not.toMatch(/2026|replay-/);
    expect((JSON.parse(exported) as { answers: { ask: string }[] }).answers.map(row => row.ask)).toEqual(["Pick the hero copy?", "Approve the hero copy?", "Which heading leads?"]);

    const second = consumer("20261122T1500Z");
    roundOne(second);
    roundTwo(second);
    const replayed = await runAnswerCli(["--replay", file], second.root, new Date("2026-11-22T16:00:00Z"));
    expect(replayed.exitCode).toBe(0);
    expect(second.records()).toEqual(first.records());
    const again = join(second.root, "answers.json");
    await runAnswerCli(["--export", again], second.root);
    expect(readFileSync(again, "utf8")).toBe(exported);

    const before = listQueueEntryFiles(second.root).map(at => readFileSync(at.file, "utf8"));
    expect(await runAnswerCli(["--replay", file], second.root)).toMatchObject({ exitCode: 0, message: expect.stringContaining("already") as unknown as string });
    expect(listQueueEntryFiles(second.root).map(at => readFileSync(at.file, "utf8"))).toEqual(before);
  });

  it("exits 1 naming the first answer that matches no open question, and writes nothing", async () => {
    const first = consumer("20261120T0800Z");
    const r1 = roundOne(first);
    await runAnswerCli([r1.pick, "b", "--by", "owner", "--via", "chat", "--quote", "the second one"], first.root, new Date("2026-11-20T09:00:00Z"));
    await runAnswerCli([r1.approve, "a", "--by", "owner", "--via", "chat", "--quote", "approved"], first.root, new Date("2026-11-20T09:01:00Z"));
    const file = join(first.root, "answers.json");
    await runAnswerCli(["--export", file], first.root);

    const fresh = consumer("20261122T1500Z");
    fresh.raise("queue.approve", "approve", "Approve the hero copy?", OPTIONS);
    const before = fresh.records();
    const refused = await runAnswerCli(["--replay", file], fresh.root);
    expect(refused.exitCode).toBe(1);
    expect(refused.message).toContain("answer 1 (queue.pick writer/sections.hero.copy \"Pick the hero copy?\" = b) no longer matches an open question");
    expect(fresh.records()).toEqual(before);
  });
});
