import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runAnswerCli } from "../cli/answer.js";
import { runFeedbackCli } from "../cli/feedback.js";
import { runCli } from "../cli/main.js";
import { resolveSlot } from "../records/resolve.js";
import type { QueueEntry, QueueName } from "../records/types.js";
import { queueEntryChangeIssues } from "./append-only.js";
import { AnswerRefused, answerQueueEntry } from "./answer.js";
import { createQueueEntry, EntryLockedError, findQueueEntry, queueEntryPath, queueLockPath, readQueueEntry, withQueueEntryLock } from "./entry.js";
import { FeedbackRefused, raiseFeedback } from "./feedback.js";
import { ANSWER_RULES, entrySchemaIssues } from "./rules.js";

const TALLYHOUSE = fileURLToPath(new URL("../../test-fixtures/tallyhouse", import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const NOW = new Date("2026-11-20T08:30:15.123Z");
const CREATED = "2026-11-01T08:00:00Z";

/** A throwaway consumer: `clossys/clossys.config.ts`, one Writer slot folder and the entries a test writes. */
function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "queue-")));
  roots.push(root);
  const put = (rel: string, text: string): void => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  put("clossys/clossys.config.ts", "export default {};\n");
  put("clossys/agents/writer/sections.hero.copy/slot.json", JSON.stringify({ schema: "clossys.slot/2", id: "writer/sections.hero.copy", agent: "writer", kind: "copy", status: "open" }));
  return {
    root,
    /** Writes a minimal open entry; `extra` overrides any key. */
    entry(queue: QueueName, id: string, extra: Partial<QueueEntry> = {}): QueueEntry {
      const entry: QueueEntry = {
        schema: "clossys.queue-entry/1", id, agent: "producer", kind: "queue-entry", status: "open",
        createdBy: { actor: "code", cli: "clossys test", version: "0.0.0" }, createdAt: CREATED, refs: [],
        queue, ask: "test ask", subject: { to: "writer/sections.hero.copy", rel: "input" },
        decider: "owner", default: null, events: [{ at: CREATED, op: "raised", by: "code:clossys test" }], ...extra,
      };
      put(`clossys/agents/producer/${queue}/entries/${id}.json`, `${JSON.stringify(entry, null, 2)}\n`);
      return entry;
    },
    bytes(queue: QueueName, id: string): string { return readFileSync(queueEntryPath(root, queue, id), "utf8"); },
    read(queue: QueueName, id: string): QueueEntry { return JSON.parse(readFileSync(queueEntryPath(root, queue, id), "utf8")) as QueueEntry; },
  };
}

const PICK = "20261120T0800Z-pick";
const APPROVE = "20261120T0800Z-approve";
const FIX = "20261120T0800Z-fix";
const CLARIFY = "20261120T0800Z-clarify";
const OPTIONS = { options: [{ id: "a", summary: "option a" }, { id: "b", summary: "option b" }], default: "a" };

const refusal = (body: () => unknown): AnswerRefused => {
  try { body(); } catch (error) { if (error instanceof AnswerRefused) return error; throw error; }
  throw new Error("expected the answer to be refused");
};

describe("queue entry files", () => {
  it("creates an entry exclusively and never overwrites one: a colliding id takes the next suffix", () => {
    const w = world();
    const first = w.entry("queue.fix", FIX);
    const before = w.bytes("queue.fix", FIX);
    const second = createQueueEntry(w.root, { ...first, ask: "another ask" });
    expect(second.id).toBe(`${FIX}-2`);
    expect(w.bytes("queue.fix", FIX)).toBe(before);
    expect(w.read("queue.fix", `${FIX}-2`).ask).toBe("another ask");
  });

  it("finds an entry by id or queue#id, and refuses an ambiguous or unknown one", () => {
    const w = world();
    w.entry("queue.fix", FIX);
    expect(findQueueEntry(w.root, FIX)).toMatchObject({ ok: true, at: { queue: "queue.fix", id: FIX } });
    expect(findQueueEntry(w.root, `producer/queue.fix#${FIX}`)).toMatchObject({ ok: true });
    expect(findQueueEntry(w.root, `queue.pick#${FIX}`)).toMatchObject({ ok: false });
    expect(findQueueEntry(w.root, "not-an-id")).toMatchObject({ ok: false });
    w.entry("queue.clarify", FIX);
    expect(findQueueEntry(w.root, FIX)).toMatchObject({ ok: false, reason: expect.stringContaining("queue.clarify and queue.fix") as unknown as string });
  });

  it("refuses an entry whose id or queue does not match its path", () => {
    const w = world();
    w.entry("queue.fix", FIX, { id: "20261120T0800Z-other" });
    const found = findQueueEntry(w.root, FIX);
    expect(found.ok && readQueueEntry(found.at)).toMatchObject({ ok: false, reason: expect.stringContaining("does not match its file name") as unknown as string });
  });

  it("holds a lock while writing; a held lock refuses and is never broken", () => {
    const w = world();
    expect(withQueueEntryLock(w.root, "queue.fix", FIX, () => existsSync(queueLockPath(w.root, "queue.fix", FIX)))).toBe(true);
    expect(existsSync(queueLockPath(w.root, "queue.fix", FIX))).toBe(false);
    expect(() => withQueueEntryLock(w.root, "queue.fix", FIX, () => withQueueEntryLock(w.root, "queue.fix", FIX, () => 1))).toThrow(EntryLockedError);
    expect(existsSync(queueLockPath(w.root, "queue.fix", FIX))).toBe(false);
  });
});

describe("append-only comparison", () => {
  const base = { schema: "clossys.queue-entry/1", id: FIX, ask: "x", status: "open", refs: [{ to: "writer/a.b", rel: "input" }], events: [{ at: CREATED, op: "raised", by: "owner" }] };
  const answeredEvent = { at: CREATED, op: "answered", by: "agent:writer", answer: "done" };
  it("allows appending one event, appending a ref and leaving open", () => {
    expect(queueEntryChangeIssues(base, { ...base, status: "answered", events: [...base.events, answeredEvent], refs: [...base.refs, { to: "producer/queue.approve", record: APPROVE, rel: "answers" }] })).toEqual([]);
  });
  it.each([
    ["an edited event", { ...base, events: [{ ...base.events[0], by: "agent:writer" }] }, "events[0] was edited"],
    ["a removed event", { ...base, events: [] }, "events lost 1 item"],
    ["a reordered event list", { ...base, events: [answeredEvent, ...base.events] }, "events[0] was edited"],
    ["a removed ref", { ...base, refs: [] }, "refs lost 1 item"],
    ["an edited ask", { ...base, ask: "y" }, "ask was edited"],
    ["a removed key", (({ ask: _ask, ...rest }) => rest)(base), "ask was removed"],
    ["an added key", { ...base, default: "z" }, "default was added"],
  ])("refuses %s", (_name, after, issue) => {
    expect(queueEntryChangeIssues(base, after).join("; ")).toContain(issue);
  });
  it("refuses reopening an answered entry", () => {
    const answered = { ...base, status: "answered", events: [...base.events, answeredEvent] };
    expect(queueEntryChangeIssues(answered, { ...answered, status: "open" }).join("; ")).toContain("only an open entry changes status");
  });
});

describe("clossys answer", () => {
  it("appends one owner answer with the owner's quote and sets status answered", async () => {
    const w = world();
    const raised = w.entry("queue.approve", APPROVE, OPTIONS);
    const result = await runAnswerCli([APPROVE, "b", "--by", "owner", "--via", "chat", "--quote", "test quote"], w.root, NOW);
    expect(result.exitCode).toBe(0);
    const after = w.read("queue.approve", APPROVE);
    expect(after.status).toBe("answered");
    expect(after.events).toEqual([...raised.events, { at: "2026-11-20T08:30:15Z", op: "answered", by: "owner", via: "chat", answer: "b", quote: "test quote" }]);
    expect(queueEntryChangeIssues(raised, after)).toEqual([]);
    expect(entrySchemaIssues(after)).toEqual([]);
    for (const rule of ANSWER_RULES) expect(rule.issues(after)).toEqual([]);
    expect(existsSync(queueLockPath(w.root, "queue.approve", APPROVE))).toBe(false);
  });

  it("goes through the clossys CLI", async () => {
    const w = world();
    w.entry("queue.approve", APPROVE, OPTIONS);
    const result = await runCli(["answer", `queue.approve#${APPROVE}`, "a", "--by", "owner", "--via", "cli", "--quote", "test quote", "--root", w.root], w.root);
    expect(result).toMatchObject({ exitCode: 0 });
    expect(w.read("queue.approve", APPROVE).status).toBe("answered");
  });

  it("accepts the entry's default as an answer", () => {
    const w = world();
    w.entry("queue.pick", PICK, { ...OPTIONS, default: "keep current" });
    expect(answerQueueEntry(w.root, { entry: PICK, answer: "keep current", by: "owner", via: "chat", quote: "test quote" }, NOW).entry.status).toBe("answered");
  });

  it("names the pin follow-up of an owner pick whose option names a candidate", () => {
    const w = world();
    w.entry("queue.pick", PICK, { options: [{ id: "a", candidate: "hero-v2.json", summary: "option a" }] });
    expect(answerQueueEntry(w.root, { entry: PICK, answer: "a", by: "owner", via: "chat", quote: "test quote" }, NOW).next)
      .toBe(`clossys pin writer/sections.hero.copy hero-v2.json --by owner:queue.pick#${PICK}`);
  });

  // Mutation: an owner answer with no quote.
  it.each([["chat"], ["app"], ["cli"]] as const)("refuses an owner answer via %s with no quote, and writes nothing", async via => {
    const w = world();
    w.entry("queue.approve", APPROVE, OPTIONS);
    const before = w.bytes("queue.approve", APPROVE);
    const result = await runAnswerCli([APPROVE, "a", "--by", "owner", "--via", via], w.root, NOW);
    expect(result).toMatchObject({ exitCode: 1, message: expect.stringContaining("answer.quote-required") as unknown as string });
    expect(refusal(() => answerQueueEntry(w.root, { entry: APPROVE, answer: "a", by: "owner", via, quote: "   " }, NOW)).check).toBe("answer.quote-required");
    expect(w.bytes("queue.approve", APPROVE)).toBe(before);
  });

  it("refuses an owner answer that does not name its channel, and a quote from anyone but the owner", () => {
    const w = world();
    w.entry("queue.approve", APPROVE, OPTIONS);
    w.entry("queue.fix", FIX, { decider: "agent:writer" });
    expect(refusal(() => answerQueueEntry(w.root, { entry: APPROVE, answer: "a", by: "owner", quote: "test quote" }, NOW)).check).toBe("answer.quote-required");
    expect(refusal(() => answerQueueEntry(w.root, { entry: FIX, answer: "done", by: "agent:writer", quote: "test quote" }, NOW)).check).toBe("answer.quote-required");
    expect(refusal(() => answerQueueEntry(w.root, { entry: FIX, answer: "done", by: "agent:writer", via: "chat" }, NOW)).check).toBe("answer.decider-match");
  });

  // Mutation: an option id not in the entry.
  it("refuses an answer that is not one of the entry's options or its default, and writes nothing", async () => {
    const w = world();
    w.entry("queue.approve", APPROVE, OPTIONS);
    const before = w.bytes("queue.approve", APPROVE);
    const result = await runAnswerCli([APPROVE, "c", "--by", "owner", "--via", "chat", "--quote", "test quote"], w.root, NOW);
    expect(result).toMatchObject({ exitCode: 1, message: expect.stringContaining("answer.option-valid") as unknown as string });
    expect(w.bytes("queue.approve", APPROVE)).toBe(before);
  });

  it("refuses to answer a pick that carries no options", () => {
    const w = world();
    w.entry("queue.pick", PICK, { default: null });
    expect(refusal(() => answerQueueEntry(w.root, { entry: PICK, answer: "anything", by: "owner", via: "chat", quote: "test quote" }, NOW)).check).toBe("answer.option-valid");
  });

  it("takes free text for a clarify", () => {
    const w = world();
    w.entry("queue.clarify", CLARIFY);
    expect(answerQueueEntry(w.root, { entry: CLARIFY, answer: "the pricing page heading", by: "owner", via: "chat", quote: "test quote" }, NOW).event.answer).toBe("the pricing page heading");
  });

  // Mutation: `code:` closing a pick or approve.
  it.each([["queue.pick", PICK], ["queue.approve", APPROVE]] as const)("refuses code closing a %s", async (queue, id) => {
    const w = world();
    w.entry(queue, id, OPTIONS);
    w.entry("queue.approve", "20261120T0801Z-done", { ...OPTIONS, status: "answered", events: [{ at: CREATED, op: "raised", by: "code:clossys test" }, { at: CREATED, op: "answered", by: "owner", via: "chat", answer: "a", quote: "test quote" }] });
    const before = w.bytes(queue, id);
    const result = await runAnswerCli([id, "a", "--by", "code:clossys pin", "--answers", "producer/queue.approve#20261120T0801Z-done"], w.root, NOW);
    expect(result).toMatchObject({ exitCode: 1, message: expect.stringContaining("answer.decider-match") as unknown as string });
    expect(w.bytes(queue, id)).toBe(before);
  });

  it("lets code close a fix only via cli with an answers ref to an answered approval, and appends that ref", () => {
    const w = world();
    w.entry("queue.fix", FIX, { decider: "agent:writer" });
    w.entry("queue.approve", APPROVE, OPTIONS);
    expect(refusal(() => answerQueueEntry(w.root, { entry: FIX, answer: "pinned", by: "code:clossys pin" }, NOW)).message).toContain("--answers");
    expect(refusal(() => answerQueueEntry(w.root, { entry: FIX, answer: "pinned", by: "code:clossys pin", answers: `producer/queue.approve#${APPROVE}` }, NOW)).message).toContain("not answered");
    expect(refusal(() => answerQueueEntry(w.root, { entry: FIX, answer: "pinned", by: "code:clossys pin", answers: "writer/no.such-slot" }, NOW)).message).toContain("no such slot");
    answerQueueEntry(w.root, { entry: APPROVE, answer: "a", by: "owner", via: "chat", quote: "test quote" }, NOW);
    const done = answerQueueEntry(w.root, { entry: FIX, answer: "pinned", by: "code:clossys pin", answers: `producer/queue.approve#${APPROVE}` }, NOW);
    expect(done.event).toMatchObject({ by: "code:clossys pin", via: "cli" });
    expect(done.entry.refs).toEqual([{ to: "producer/queue.approve", record: APPROVE, rel: "answers" }]);
  });

  // Mutation: two answers to one entry.
  it("refuses a second answer to one entry, and writes nothing", async () => {
    const w = world();
    w.entry("queue.approve", APPROVE, OPTIONS);
    expect((await runAnswerCli([APPROVE, "a", "--by", "owner", "--via", "chat", "--quote", "test quote"], w.root, NOW)).exitCode).toBe(0);
    const once = w.bytes("queue.approve", APPROVE);
    const again = await runAnswerCli([APPROVE, "b", "--by", "owner", "--via", "chat", "--quote", "test quote"], w.root, NOW);
    expect(again).toMatchObject({ exitCode: 1, message: expect.stringContaining("answer.open-only") as unknown as string });
    expect(w.bytes("queue.approve", APPROVE)).toBe(once);
  });

  it("refuses while another writer holds the entry's lock", async () => {
    const w = world();
    w.entry("queue.approve", APPROVE, OPTIONS);
    const before = w.bytes("queue.approve", APPROVE);
    mkdirSync(dirname(queueLockPath(w.root, "queue.approve", APPROVE)), { recursive: true });
    writeFileSync(queueLockPath(w.root, "queue.approve", APPROVE), "held\n");
    const result = await runAnswerCli([APPROVE, "a", "--by", "owner", "--via", "chat", "--quote", "test quote"], w.root, NOW);
    expect(result).toMatchObject({ exitCode: 1, message: expect.stringContaining("locked") as unknown as string });
    expect(w.bytes("queue.approve", APPROVE)).toBe(before);
    expect(existsSync(queueLockPath(w.root, "queue.approve", APPROVE))).toBe(true);
  });

  // Mutation: an answer by a decider other than the one the entry names.
  it.each([
    ["an agent answering an owner entry", "owner", "agent:writer"],
    ["the owner answering an agent entry", "agent:writer", "owner"],
    ["another agent answering an agent entry", "agent:writer", "agent:designer"],
  ] as const)("refuses %s", async (_name, decider, by) => {
    const w = world();
    w.entry("queue.fix", FIX, { decider });
    const before = w.bytes("queue.fix", FIX);
    const result = await runAnswerCli([FIX, "done", "--by", by, ...(by === "owner" ? ["--via", "chat", "--quote", "test quote"] : [])], w.root, NOW);
    expect(result).toMatchObject({ exitCode: 1, message: expect.stringContaining("answer.decider-match") as unknown as string });
    expect(w.bytes("queue.fix", FIX)).toBe(before);
  });

  it("lets the agent an entry names answer it", () => {
    const w = world();
    w.entry("queue.fix", FIX, { decider: "agent:writer" });
    expect(answerQueueEntry(w.root, { entry: FIX, answer: "done", by: "agent:writer" }, NOW).event).toEqual({ at: "2026-11-20T08:30:15Z", op: "answered", by: "agent:writer", via: "cli", answer: "done" });
  });

  it("has no bypass or backdating flag", async () => {
    const w = world();
    w.entry("queue.approve", APPROVE, OPTIONS);
    for (const flag of ["--force", "--at", "--no-check", "--skip"]) {
      await expect(runAnswerCli([APPROVE, "a", "--by", "owner", "--via", "chat", "--quote", "test quote", flag, "x"], w.root, NOW)).rejects.toThrow("Unknown argument");
    }
  });
});

describe("clossys feedback", () => {
  it("opens a queue.fix with the owner's words verbatim, decided by the agent that owns the ref", async () => {
    const w = world();
    const words = "  test words, kept exactly  ";
    const result = await runFeedbackCli(["writer/sections.hero.copy", words, "--via", "chat"], w.root, NOW);
    expect(result.exitCode).toBe(0);
    const entry = result.output as QueueEntry;
    expect(entry).toEqual({
      schema: "clossys.queue-entry/1", id: "20261120T0830Z-sections-hero-copy", agent: "producer", kind: "queue-entry", status: "open",
      createdBy: { actor: "owner", ref: "chat:clossys feedback 2026-11-20T08:30:15Z" }, createdAt: "2026-11-20T08:30:15Z",
      refs: [{ to: "writer/sections.hero.copy", rel: "input" }], queue: "queue.fix", ask: words,
      subject: { to: "writer/sections.hero.copy", rel: "input" }, decider: "agent:writer", default: null,
      events: [{ at: "2026-11-20T08:30:15Z", op: "raised", by: "owner", via: "chat" }],
    });
    expect(w.read("queue.fix", entry.id)).toEqual(entry);
  });

  it("goes through the clossys CLI and takes the next suffix on an id collision", async () => {
    const w = world();
    const viaCli = await runCli(["feedback", "writer/sections.hero.copy", "test words", "--via", "cli", "--slug", "hero", "--root", w.root], w.root);
    expect(viaCli).toMatchObject({ exitCode: 0 });
    expect(findQueueEntry(w.root, (viaCli.output as QueueEntry).id).ok).toBe(true);
    raiseFeedback(w.root, { ref: "writer/sections.hero.copy", words: "test words", via: "cli", slug: "hero" }, NOW);
    raiseFeedback(w.root, { ref: "writer/sections.hero.copy", words: "test words", via: "cli", slug: "hero" }, NOW);
    expect(existsSync(queueEntryPath(w.root, "queue.fix", "20261120T0830Z-hero"))).toBe(true);
    expect(existsSync(queueEntryPath(w.root, "queue.fix", "20261120T0830Z-hero-2"))).toBe(true);
  });

  it("records the sha256 the ref resolves to now (Tallyhouse, as is)", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "queue-tallyhouse-")));
    roots.push(root);
    cpSync(TALLYHOUSE, root, { recursive: true });
    const entry = raiseFeedback(root, { ref: "writer/sections.hero.copy#home.hero", words: "test words", via: "chat" }, NOW);
    const resolved = resolveSlot(root, "writer", "sections.hero.copy", "home.hero");
    expect(resolved.state === "pinned" || resolved.state === "sample").toBe(true);
    expect(entry.refs).toEqual([{ to: "writer/sections.hero.copy", record: "home.hero", sha256: (resolved as { sha256: string }).sha256, rel: "input" }]);
    expect(entry.subject).toEqual({ to: "writer/sections.hero.copy", record: "home.hero", rel: "input" });
  });

  it("refuses a dangling ref, empty words, and --via app with no quote; nothing is written", async () => {
    const w = world();
    expect(await runFeedbackCli(["writer/no.such-slot", "test words", "--via", "chat"], w.root, NOW)).toMatchObject({ exitCode: 1, message: expect.stringContaining("no such slot") as unknown as string });
    expect(() => raiseFeedback(w.root, { ref: "writer/sections.hero.copy", words: "  ", via: "chat" }, NOW)).toThrow(FeedbackRefused);
    expect(() => raiseFeedback(w.root, { ref: "writer/sections.hero.copy", words: "test words", via: "app" }, NOW)).toThrow("--quote");
    expect(() => raiseFeedback(w.root, { ref: "producer/queue.fix", words: "test words", via: "chat" }, NOW)).toThrow(FeedbackRefused);
    expect(existsSync(join(w.root, "clossys/agents/producer/queue.fix"))).toBe(false);
    await expect(runFeedbackCli(["writer/sections.hero.copy", "test words"], w.root, NOW)).rejects.toThrow("--via");
  });

  it("records an app quote on the raised event", () => {
    const w = world();
    const entry = raiseFeedback(w.root, { ref: "writer/sections.hero.copy", words: "test words", via: "app", quote: "test words" }, NOW);
    expect(entry.events).toEqual([{ at: "2026-11-20T08:30:15Z", op: "raised", by: "owner", via: "app", quote: "test words" }]);
  });

  it("opens an entry that its decider can then close", () => {
    const w = world();
    const entry = raiseFeedback(w.root, { ref: "writer/sections.hero.copy", words: "test words", via: "chat" }, NOW);
    expect(answerQueueEntry(w.root, { entry: entry.id, answer: "done", by: "agent:writer" }, new Date("2026-11-20T09:00:00Z")).entry.status).toBe("answered");
  });
});
