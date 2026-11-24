import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { pinUpstream } from "../cli/__fixtures__/upstream.js";
import { runAnswerCli } from "../cli/answer.js";
import { runPinCli } from "../cli/pin.js";
import { writeCandidate } from "../records/slot-write.js";
import type { QueueEntry, QueueName, Ref } from "../records/types.js";
import { listQueueEntryFiles, readQueueEntry } from "./entry.js";

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const SLOT = "sections.hero.copy";
const SUBMITTED = "2026-11-18T10:00:00Z";
/** A Writer hero copy candidate that passes the CHOOSE gate on the fixture consumer (as in cli/one-format.test.ts). */
const GOOD = `---
slot: "${SLOT}"
locales: ["en"]
reason: "realises director:advantage.proposition.promise for the hero"
source: {"kind":"derived","ref":["director:identity.verbal.voice","director:advantage.proposition.promise","director:identity.naming.name"]}
provenance: {"voice":"director:identity.verbal.voice"}
---

## en
### header.heading
<!-- {"id":"header.heading","bindings":[]} -->
Ship your site this week
### actions.primary.label
<!-- {"id":"actions.primary.label","bindings":[]} -->
Get started
`;

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const OPTIONS = { options: [{ id: "a", summary: "option a" }, { id: "b", summary: "option b" }], default: "a" };

/**
 * A throwaway consumer whose entries are stamped `stamp` (each consumer raises its questions at its own time). With
 * `pins`, it is a copy of the fixture consumer whose hero copy can be pinned: its upstream pinned and one candidate
 * submitted at the same time on every consumer, so the candidate's name and bytes are the same.
 */
function consumer(stamp: string, pins = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "replay-")));
  roots.push(root);
  const put = (rel: string, text: string): void => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  let candidate: string | undefined;
  if (pins) {
    cpSync(FIXTURE, root, { recursive: true });
    pinUpstream(join(root, "clossys"), "writer", SLOT, SUBMITTED);
    candidate = writeCandidate(join(root, "clossys"), "writer", SLOT, "copy", GOOD, { at: SUBMITTED, provenance: { by: "agent:writer", model: "claude-opus-5-5", tier: "high" } }).name;
  } else {
    put("clossys/clossys.config.ts", "export default {};\n");
    put("clossys/agents/writer/sections.hero.copy/slot.json", JSON.stringify({ schema: "clossys.slot/2", id: "writer/sections.hero.copy", agent: "writer", kind: "copy", status: "open" }));
  }
  const created = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:00Z`;
  return {
    root, candidate,
    raise(queue: QueueName, slug: string, ask: string, extra: Partial<QueueEntry> = {}): string {
      const id = `${stamp}-${slug}`;
      const entry: QueueEntry = {
        schema: "clossys.queue-entry/1", id, agent: "producer", kind: "queue-entry", status: "open",
        createdBy: { actor: "code", cli: "clossys test", version: "0.0.0" }, createdAt: created, refs: [],
        queue, ask, subject: { to: "writer/sections.hero.copy", ...(pins ? { record: "copy" } : {}), rel: "input" } as Ref,
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
    /** The hero copy's pin record with this consumer's own entry ids (its stamp) and times taken out. */
    pin(): unknown {
      const doc = JSON.parse(readFileSync(join(root, "clossys", "agents", "writer", SLOT, "pin.json"), "utf8")) as { records: Record<string, Record<string, unknown>>; refs: Ref[] };
      const { at: _at, ...record } = doc.records.copy!;
      return JSON.parse(JSON.stringify({ record, answers: doc.refs.filter(ref => ref.rel === "answers") }).replaceAll(stamp, "<stamp>"));
    },
    /** Every file of the consumer's queue entries and pins, for "a re-run writes nothing". */
    bytes(): string[] {
      return [...listQueueEntryFiles(root).map(at => at.file), join(root, "clossys", "agents", "writer", SLOT, "pin.json")].map(file => readFileSync(file, "utf8"));
    },
    /** Every file under the consumer (ledger.json, pin.json, scorecard and .state included), path -> text. */
    tree(): Record<string, string> {
      const files: Record<string, string> = {};
      for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
        if (entry.isFile()) { const file = join(entry.parentPath, entry.name); files[file.slice(root.length + 1)] = readFileSync(file, "utf8"); }
      }
      return files;
    },
  };
}

/** Raises round one (a pick whose options name candidates, and an approve) on a consumer. */
const roundOne = (c: ReturnType<typeof consumer>) => ({
  pick: c.raise("queue.pick", "pick", "Pick the hero copy?", c.candidate
    ? { options: [{ id: "good", summary: "the submitted copy", candidate: c.candidate }, { id: "keep", summary: "keep the pinned copy" }], default: "keep" }
    : OPTIONS),
  approve: c.raise("queue.approve", "approve", "Approve the hero copy?", OPTIONS),
});
const roundTwo = (c: ReturnType<typeof consumer>) => c.raise("queue.clarify", "clarify", "Which heading leads?");

describe("clossys answer --export / --replay", () => {
  it("replays two rounds in order on a fresh consumer to the same records and pins, byte-stable and idempotent", async () => {
    const first = consumer("20261120T0800Z", true);
    const r1 = roundOne(first);
    const picked = await runAnswerCli([r1.pick, "good", "--by", "owner", "--via", "chat", "--quote", "the submitted one"], first.root, new Date("2026-11-20T09:00:00Z"));
    expect(picked.exitCode, picked.message).toBe(0);
    // The owner's pick prints its pin; it runs as printed.
    const next = (picked.output as { next: string }).next;
    expect(next).toBe(`clossys pin writer/${SLOT}#copy ${first.candidate} --by owner:queue.pick#${r1.pick}`);
    const pinned = await runPinCli([...next.split(" ").slice(2), "--at", "2026-11-20T09:00:30Z", "--root", first.root], first.root);
    expect(pinned.exitCode, pinned.message).toBe(0);
    expect((await runAnswerCli([r1.approve, "a", "--by", "owner", "--via", "app", "--quote", "approved", "--note", "round one"], first.root, new Date("2026-11-20T09:01:00Z"))).exitCode).toBe(0);
    // Round two is raised only once round one is answered.
    const c1 = roundTwo(first);
    expect((await runAnswerCli([c1, "the pricing heading", "--by", "owner", "--via", "cli", "--quote", "pricing first"], first.root, new Date("2026-11-20T10:00:00Z"))).exitCode).toBe(0);
    const file = join(first.root, "answers.json");
    expect(await runAnswerCli(["--export", file], first.root)).toMatchObject({ exitCode: 0, output: { answers: 3 } });
    const exported = readFileSync(file, "utf8");
    expect(exported).not.toMatch(/2026|replay-/);
    expect((JSON.parse(exported) as { answers: { ask: string }[] }).answers.map(row => row.ask)).toEqual(["Pick the hero copy?", "Approve the hero copy?", "Which heading leads?"]);

    // The fresh consumer has round one only: replay applies it, pins the pick, and stops naming the round-two answer.
    const second = consumer("20261122T1500Z", true);
    const s1 = roundOne(second);
    const partial = await runAnswerCli(["--replay", file], second.root, new Date("2026-11-22T16:00:00Z"));
    expect(partial.exitCode, partial.message).toBe(1);
    expect(partial.message).toContain(`pinned    clossys pin writer/${SLOT}#copy ${second.candidate} --by owner:queue.pick#${s1.pick}`);
    expect(partial.message).toContain("replay stopped: answer 3 (queue.clarify writer/sections.hero.copy#copy \"Which heading leads?\" = the pricing heading) matches no open question");
    expect(partial.message).toContain("2 of 3 answer(s) before it are applied, 2 written by this run");
    expect(second.pin()).toEqual(first.pin());

    // Answering round one raised round two; a re-run carries on from the answer it stopped at.
    roundTwo(second);
    const replayed = await runAnswerCli(["--replay", file], second.root, new Date("2026-11-22T17:00:00Z"));
    expect(replayed.exitCode, replayed.message).toBe(0);
    expect(replayed.message).toMatch(/^already {3}queue\.pick .*\nalready {3}clossys pin .*\nalready {3}queue\.approve .*\nanswered {2}queue\.clarify /);
    expect(second.records()).toEqual(first.records());
    expect(second.pin()).toEqual(first.pin());
    const again = join(second.root, "answers.json");
    await runAnswerCli(["--export", again], second.root);
    expect(readFileSync(again, "utf8")).toBe(exported);

    const before = second.bytes();
    expect(await runAnswerCli(["--replay", file], second.root)).toMatchObject({ exitCode: 0, message: expect.not.stringContaining("answered") as unknown as string });
    expect(second.bytes()).toEqual(before);
  }, 120_000);

  it("re-runs write nothing when a later owner pick re-pinned the slot an earlier pick pinned", async () => {
    // Two picks on one slot: the second re-pins it to a newer candidate, submitted at the same time on every consumer.
    const NEWER = GOOD.replace("Ship your site this week", "Ship your site today");
    const twoPicks = (stamp: string) => {
      const c = consumer(stamp, true);
      const newer = writeCandidate(join(c.root, "clossys"), "writer", SLOT, "copy", NEWER, { at: "2026-11-18T10:00:01Z", provenance: { by: "agent:writer", model: "claude-opus-5-5", tier: "high" } }).name;
      const pick = (slug: string, ask: string, candidate: string) => c.raise("queue.pick", slug, ask, { options: [{ id: "good", summary: "the submitted copy", candidate }, { id: "keep", summary: "keep the pinned copy" }], default: "keep" });
      return { c, newer, pick1: pick("pick1", "Pick the hero copy?", c.candidate!), pick2: pick("pick2", "Pick the hero copy again?", newer) };
    };
    const first = twoPicks("20261120T0800Z");
    for (const [id, at] of [[first.pick1, "2026-11-20T09:00:00Z"], [first.pick2, "2026-11-20T10:00:00Z"]] as const) {
      const picked = await runAnswerCli([id, "good", "--by", "owner", "--via", "chat", "--quote", id], first.c.root, new Date(at));
      expect(picked.exitCode, picked.message).toBe(0);
      const pinned = await runPinCli([...(picked.output as { next: string }).next.split(" ").slice(2), "--at", at.replace(":00Z", ":30Z"), "--root", first.c.root], first.c.root);
      expect(pinned.exitCode, pinned.message).toBe(0);
    }
    const file = join(first.c.root, "answers.json");
    expect(await runAnswerCli(["--export", file], first.c.root)).toMatchObject({ exitCode: 0, output: { answers: 2 } });

    const second = twoPicks("20261122T1500Z");
    const replayed = await runAnswerCli(["--replay", file], second.c.root, new Date("2026-11-22T16:00:00Z"));
    expect(replayed.exitCode, replayed.message).toBe(0);
    expect(replayed.message).toContain(`pinned    clossys pin writer/${SLOT}#copy ${second.c.candidate} --by owner:queue.pick#${second.pick1}`);
    expect(replayed.message).toContain(`pinned    clossys pin writer/${SLOT}#copy ${second.newer} --by owner:queue.pick#${second.pick2}`);
    // The first replay ends at the second pick, as on the original.
    expect(second.c.pin()).toEqual(first.c.pin());
    expect((second.c.pin() as { record: { candidate: string } }).record.candidate).toBe(second.newer);

    // A second and a third replay run no pin (no fall-back to the older candidate) and leave every file byte-equal.
    const before = second.c.tree();
    expect(Object.keys(before)).toEqual(expect.arrayContaining([`clossys/agents/writer/${SLOT}/ledger.json`, `clossys/agents/writer/${SLOT}/pin.json`]));
    for (const at of ["2026-11-22T17:00:00Z", "2026-11-22T18:00:00Z"]) {
      const again = await runAnswerCli(["--replay", file], second.c.root, new Date(at));
      expect(again.exitCode, again.message).toBe(0);
      expect(again.message).not.toMatch(/^(answered|pinned) /m);
      expect(again.message.match(/^already {3}clossys pin /gm)).toHaveLength(2);
      expect(second.c.tree()).toEqual(before);
    }
  }, 120_000);

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
    expect(refused.message).toContain("replay stopped: answer 1 (queue.pick writer/sections.hero.copy \"Pick the hero copy?\" = b) matches no open question");
    expect(refused.message).toContain("0 of 2 answer(s) before it are applied, 0 written by this run");
    expect(fresh.records()).toEqual(before);
    // A missing file is refused by name, not a raw read error.
    expect(await runAnswerCli(["--replay", "missing.json"], fresh.root)).toMatchObject({ exitCode: 1, message: "replay refused: missing.json does not exist: write one with clossys answer --export <file>" });
  });
});
