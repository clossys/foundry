import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ANSWER_CHECK_ALIASES } from "../queue/rules.js";
import type { QueueEntry, QueueName } from "../records/types.js";
import { checkAnswerDeciderMatch } from "./answer-decider-match.js";
import { checkAnswerOpenOnly } from "./answer-open-only.js";
import { checkAnswerOptionValid } from "./answer-option-valid.js";
import { checkAnswerQuoteRequired } from "./answer-quote-required.js";

const TALLYHOUSE = fileURLToPath(new URL("../../test-fixtures/tallyhouse", import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const AT = "2026-11-20T08:00:00Z";
const LATER = "2026-11-20T09:00:00Z";
const ID = "20261120T0800Z-entry";
type Event = QueueEntry["events"][number];
const raised: Event = { at: AT, op: "raised", by: "code:clossys test" };
const ownerAnswer = (answer: string, extra: Partial<Event> = {}): Event => ({ at: LATER, op: "answered", by: "owner", via: "chat", answer, quote: "test quote", ...extra });
const OPTIONS = { options: [{ id: "a", summary: "option a" }, { id: "b", summary: "option b" }], default: "a" };

const put = (root: string, rel: string, doc: unknown): void => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), JSON.stringify(doc));
};

/** A throwaway workspace holding one minimal entry, plus any other files (by path under the root) a test needs. */
function withEntry(queue: QueueName, extra: Partial<QueueEntry>, files: Record<string, unknown> = {}): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "answer-checks-")));
  roots.push(root);
  const entry = {
    schema: "clossys.queue-entry/1", id: ID, agent: "producer", kind: "queue-entry", status: "answered",
    createdBy: { actor: "code", cli: "clossys test", version: "0.0.0" }, createdAt: AT, refs: [],
    queue, ask: "test ask", subject: { to: "writer/sections.hero.copy", rel: "input" }, decider: "owner", default: null, events: [raised], ...extra,
  };
  put(root, `clossys/agents/producer/${queue}/entries/${ID}.json`, entry);
  for (const [rel, doc] of Object.entries(files)) put(root, rel, doc);
  return root;
}

/** A Writer slot folder (so a pin ref into it resolves). */
const slotFile = (slotId: string): Record<string, unknown> => ({
  [`clossys/agents/writer/${slotId}/slot.json`]: { schema: "clossys.slot/2", id: `writer/${slotId}`, agent: "writer", kind: "copy", status: "open" },
});
/** A queue.approve entry about `subject` (answered by the owner unless `status` says otherwise). */
const APPROVAL = "20261120T0759Z-approval";
const approvalFile = (subject: string, status: "answered" | "open" = "answered"): Record<string, unknown> => ({
  [`clossys/agents/producer/queue.approve/entries/${APPROVAL}.json`]: {
    schema: "clossys.queue-entry/1", id: APPROVAL, agent: "producer", kind: "queue-entry", status,
    createdBy: { actor: "code", cli: "clossys test", version: "0.0.0" }, createdAt: AT, refs: [],
    queue: "queue.approve", ask: "test ask", subject: { to: subject, rel: "input" }, decider: "owner", ...OPTIONS,
    events: status === "answered" ? [raised, ownerAnswer("a")] : [raised],
  },
});
const codeAnswer = (extra: Partial<Event> = {}): Event => ({ at: LATER, op: "answered", by: "code:clossys pin", via: "cli", answer: "pinned", ...extra });
const answersApproval = { to: "producer/queue.approve", record: APPROVAL, rel: "answers" } as unknown as QueueEntry["refs"][number];
const answersPin = (to: string): QueueEntry["refs"][number] => ({ to, rel: "answers" } as unknown as QueueEntry["refs"][number]);

const details = (run: { findings: readonly { detail: string }[] }): string => run.findings.map(finding => finding.detail).join("; ");

describe("answer.* checks", () => {
  it("pass on the Tallyhouse fixture as it is", () => {
    for (const check of [checkAnswerOpenOnly, checkAnswerDeciderMatch, checkAnswerOptionValid, checkAnswerQuoteRequired]) {
      expect(check(TALLYHOUSE)).toEqual({ check: expect.any(String) as unknown as string, status: "pass", findings: [] });
    }
  });

  it("map the system.md 12.6 names to the checks that enforce them", () => {
    expect(ANSWER_CHECK_ALIASES).toEqual({ "answer.in-options": "answer.option-valid", "answer.owner-quoted": "answer.quote-required" });
  });

  // Mutation: an owner answer with no quote.
  it.each([["chat"], ["app"], ["cli"]] as const)("answer.quote-required fails an owner answer via %s with no quote", via => {
    const root = withEntry("queue.approve", { ...OPTIONS, events: [raised, ownerAnswer("a", { via, quote: undefined })] });
    const run = checkAnswerQuoteRequired(root);
    expect(run.status).toBe("fail");
    expect(run.findings[0]).toMatchObject({ check: "answer.quote-required", subject: `producer/queue.approve#${ID}` });
    expect(checkAnswerQuoteRequired(withEntry("queue.approve", { ...OPTIONS, events: [raised, ownerAnswer("a", { via, quote: " " })] })).status).toBe("fail");
    expect(checkAnswerQuoteRequired(withEntry("queue.approve", { ...OPTIONS, events: [raised, ownerAnswer("a", { via })] })).status).toBe("pass");
  });

  // Mutation: an option id not in the entry.
  it("answer.option-valid fails an answer outside the options and the default", () => {
    expect(details(checkAnswerOptionValid(withEntry("queue.approve", { ...OPTIONS, events: [raised, ownerAnswer("c")] })))).toContain(`answer "c" is not an option`);
    expect(checkAnswerOptionValid(withEntry("queue.approve", { ...OPTIONS, default: "keep", events: [raised, ownerAnswer("keep")] })).status).toBe("pass");
    expect(checkAnswerOptionValid(withEntry("queue.pick", { ...OPTIONS, events: [raised, ownerAnswer("b")] })).status).toBe("pass");
  });

  it("answer.option-valid fails a pick or approve with no options, an answer with no text and a repeated option id", () => {
    expect(details(checkAnswerOptionValid(withEntry("queue.pick", { status: "open", events: [raised] })))).toContain("carries no options");
    expect(details(checkAnswerOptionValid(withEntry("queue.approve", { ...OPTIONS, events: [raised, ownerAnswer("a", { answer: undefined })] })))).toContain("no answer");
    expect(details(checkAnswerOptionValid(withEntry("queue.pick", { options: [{ id: "a", summary: "x" }, { id: "a", summary: "y" }], status: "open", events: [raised] })))).toContain("repeat the id");
  });

  it("answer.option-valid takes free text for a clarify and an option-less fix", () => {
    expect(checkAnswerOptionValid(withEntry("queue.clarify", { events: [raised, ownerAnswer("free text")] })).status).toBe("pass");
    expect(checkAnswerOptionValid(withEntry("queue.fix", { decider: "agent:writer", events: [raised, { at: LATER, op: "answered", by: "agent:writer", answer: "free text" }] })).status).toBe("pass");
  });

  // Mutation: `code:` closing a pick or approve.
  it.each([["queue.pick"], ["queue.approve"]] as const)("answer.decider-match fails code closing a %s", queue => {
    const run = checkAnswerDeciderMatch(withEntry(queue, { ...OPTIONS, events: [raised, { at: LATER, op: "answered", by: "code:clossys pin", via: "cli", answer: "a" }] }));
    expect(run.status).toBe("fail");
    expect(details(run)).toContain("code may close only queue.fix or queue.clarify");
  });

  it.each([["queue.fix"], ["queue.clarify"]] as const)("answer.decider-match lets code close a %s via cli with an answers ref to its own subject", queue => {
    const byApproval = withEntry(queue, { decider: "agent:writer", refs: [answersApproval], events: [raised, codeAnswer()] }, approvalFile("writer/sections.hero.copy"));
    expect(checkAnswerDeciderMatch(byApproval)).toMatchObject({ status: "pass", findings: [] });
    const byPin = withEntry(queue, { decider: "agent:writer", refs: [answersPin("writer/sections.hero.copy")], events: [raised, codeAnswer()] }, slotFile("sections.hero.copy"));
    expect(checkAnswerDeciderMatch(byPin)).toMatchObject({ status: "pass", findings: [] });
  });

  // Mutation: a hand-written code close the CLI would refuse.
  it.each([
    ["an owner-decided fix closed by code", { decider: "owner" as const, refs: [answersApproval] }, approvalFile("writer/sections.hero.copy"), "the owner decides this entry"],
    ["a code close with no via", { refs: [answersApproval], events: [raised, codeAnswer({ via: undefined })] }, approvalFile("writer/sections.hero.copy"), "a code close is via cli"],
    ["a code close via chat", { refs: [answersApproval], events: [raised, codeAnswer({ via: "chat" })] }, approvalFile("writer/sections.hero.copy"), "a code close is via cli"],
    ["a code close with no answers ref", { refs: [] }, approvalFile("writer/sections.hero.copy"), "carries an answers ref"],
    ["a code close answering an approval of another subject", { refs: [answersApproval] }, approvalFile("writer/sections.footer.copy"), "approves writer/sections.footer.copy, not this entry's subject"],
    ["a code close answering an approval that is still open", { refs: [answersApproval] }, approvalFile("writer/sections.hero.copy", "open"), "not answered"],
    ["a code close answering an approval that does not exist", { refs: [answersApproval] }, {}, "no such entry"],
    ["a code close answering a pin in another slot", { refs: [answersPin("writer/sections.footer.copy")] }, slotFile("sections.footer.copy"), "is not this entry's subject"],
    ["a code close answering a pin that dangles", { refs: [answersPin("writer/sections.hero.copy")] }, {}, "no such slot folder"],
  ] as const)("answer.decider-match fails %s", (_name, extra, files, detail) => {
    const run = checkAnswerDeciderMatch(withEntry("queue.fix", { decider: "agent:writer", events: [raised, codeAnswer()], ...extra }, files));
    expect(run.status).toBe("fail");
    expect(run.findings[0]!.check).toBe("answer.decider-match");
    expect(details(run)).toContain(detail);
  });

  it("answer.decider-match fails a code close whose subject names a record the answers ref does not", () => {
    const subject = { to: "writer/sections.hero.copy", record: "home.hero", rel: "input" } as QueueEntry["subject"];
    const run = checkAnswerDeciderMatch(withEntry("queue.fix", { decider: "agent:writer", subject, refs: [answersApproval], events: [raised, codeAnswer()] }, approvalFile("writer/sections.hero.copy")));
    expect(details(run)).toContain("not this entry's subject writer/sections.hero.copy#home.hero");
  });

  // Mutation: an agent answer through a chat or app channel.
  it.each([["chat"], ["app"]] as const)("answer.decider-match fails an agent answer via %s", via => {
    const run = checkAnswerDeciderMatch(withEntry("queue.fix", { decider: "agent:writer", events: [raised, { at: LATER, op: "answered", by: "agent:writer", via, answer: "done" }] }));
    expect(run.status).toBe("fail");
    expect(details(run)).toContain(`an agent answers through the CLI only (via cli), not ${via}`);
    expect(checkAnswerDeciderMatch(withEntry("queue.fix", { decider: "agent:writer", events: [raised, { at: LATER, op: "answered", by: "agent:writer", via: "cli", answer: "done" }] })).status).toBe("pass");
  });

  // Mutation: a quote on an answer that is not the owner's, and an owner answer that names no channel.
  it.each([
    ["an agent answer", { at: LATER, op: "answered", by: "agent:writer", via: "cli", answer: "done", quote: "test quote" }, "carries a quote"],
    ["a code answer", { at: LATER, op: "answered", by: "code:clossys pin", via: "cli", answer: "done", quote: "test quote" }, "carries a quote"],
    ["an owner answer with no via", { at: LATER, op: "answered", by: "owner", answer: "done", quote: "test quote" }, "names no channel"],
  ] as const)("answer.quote-required fails %s", (_name, event, detail) => {
    const run = checkAnswerQuoteRequired(withEntry("queue.fix", { decider: "agent:writer", events: [raised, event as Event] }));
    expect(run.status).toBe("fail");
    expect(run.findings[0]!.check).toBe("answer.quote-required");
    expect(details(run)).toContain(detail);
  });

  // Mutation: an answer by a decider other than the one the entry names.
  it.each([
    ["owner", "agent:writer"],
    ["agent:writer", "owner"],
    ["agent:writer", "agent:designer"],
    ["owner", "planner"],
  ] as const)("answer.decider-match fails an entry decided by %s answered by %s", (decider, by) => {
    const run = checkAnswerDeciderMatch(withEntry("queue.fix", { decider, events: [raised, { at: LATER, op: "answered", by, answer: "done", ...(by === "owner" ? { via: "chat", quote: "test quote" } : {}) }] }));
    expect(run.status).toBe("fail");
    expect(run.findings[0]!.check).toBe("answer.decider-match");
  });

  // Mutation: two answers to one entry.
  it("answer.open-only fails an entry answered twice", () => {
    const run = checkAnswerOpenOnly(withEntry("queue.approve", { ...OPTIONS, events: [raised, ownerAnswer("a"), ownerAnswer("b")] }));
    expect(run.status).toBe("fail");
    expect(details(run)).toContain("closed 2 times");
  });

  it.each([
    ["a first event that is not raised", { events: [ownerAnswer("a")] }, "events[0]"],
    ["a second raise", { status: "open" as const, events: [raised, raised] }, "raises the entry again"],
    ["an event after the answer", { events: [raised, ownerAnswer("a"), { ...raised, at: LATER, op: "withdrawn" as const }] }, "closed 2 times"],
    ["an answered status with no answer", { events: [raised] }, "the events say open"],
    ["an open status after an answer", { status: "open" as const, events: [raised, ownerAnswer("a")] }, "the events say answered"],
    ["time going back", { events: [raised, ownerAnswer("a", { at: "2026-11-19T00:00:00Z" })] }, "is before"],
    ["no events", { events: [] }, "no events"],
  ])("answer.open-only fails %s", (_name, extra, detail) => {
    expect(details(checkAnswerOpenOnly(withEntry("queue.approve", { ...OPTIONS, ...extra })))).toContain(detail);
  });

  it("reports an entry file that is not JSON", () => {
    const root = withEntry("queue.fix", {});
    writeFileSync(join(root, "clossys/agents/producer/queue.fix/entries", `${ID}.json`), "{");
    expect(details(checkAnswerOpenOnly(root))).toContain("not JSON");
  });
});
