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

/** A throwaway workspace holding one minimal entry. */
function withEntry(queue: QueueName, extra: Partial<QueueEntry>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "answer-checks-")));
  roots.push(root);
  const entry = {
    schema: "clossys.queue-entry/1", id: ID, agent: "producer", kind: "queue-entry", status: "answered",
    createdBy: { actor: "code", cli: "clossys test", version: "0.0.0" }, createdAt: AT, refs: [],
    queue, ask: "test ask", subject: { to: "writer/sections.hero.copy", rel: "input" }, decider: "owner", default: null, events: [raised], ...extra,
  };
  const file = join(root, "clossys/agents/producer", queue, "entries", `${ID}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(entry));
  return root;
}

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

  it.each([["queue.fix"], ["queue.clarify"]] as const)("answer.decider-match lets code close a %s", queue => {
    expect(checkAnswerDeciderMatch(withEntry(queue, { decider: "agent:writer", events: [raised, { at: LATER, op: "answered", by: "code:clossys pin", via: "cli", answer: "pinned" }] })).status).toBe("pass");
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
