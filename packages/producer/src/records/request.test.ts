import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { raiseEntry } from "../loop/route.js";
import { answerQueueEntry } from "../queue/answer.js";
import {
  checkRequest, closeRequest, decideRequest, raiseRequest, readRequest, requestIssues, requestsDir, signedApproval, slotlessNeeds, unfiledNeeds,
  type SlotRequest,
} from "./request.js";

// SLOT-CREATE (foundry-build-0048 U5): a slotless need is a clossys.queue-entry/2 kind slot entry under
// clossys/agents/producer/queue.slot/entries, decided by the target's agent and closed with a link.
const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const REQUESTER = "writer/sections.article.copy";
const AT = "2026-11-17T10:00:00Z";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "slot-request-")));
  roots.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  return { root, consumer: join(root, "clossys") };
}
function cite(consumer: string, to: string, rel: "input" | "uses" = "input") {
  const file = join(consumer, "agents", REQUESTER, "slot.json");
  const doc = JSON.parse(readFileSync(file, "utf8")) as { refs: { to: string; rel: string }[] };
  doc.refs.push({ to, rel });
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
}
const raise = (consumer: string, target = "writer/narratives.faq") =>
  raiseRequest(consumer, { target, from: REQUESTER, why: "the article links an FAQ", source: "cli", by: "producer", at: AT }).request;
function decidedCreate(consumer: string): SlotRequest {
  const request = raise(consumer);
  checkRequest(consumer, request.id, { by: "writer", at: AT });
  return decideRequest(consumer, request.id, { decision: "create", proposal: { slot: "narratives.faq", under: "prose.reference/help", contract: { requirements: [{ check: "text.nonempty" }] } }, by: "writer", at: AT });
}
/** The loop.slot sign step's entry: a queue.approve about `to`, answered as given (or left open). */
function approval(root: string, to: string, answer?: { answer: string; quote?: string }): string {
  const { entry } = raiseEntry(root, {
    queue: "queue.approve", subject: { to: to as never, rel: "input" }, decider: "owner", ask: `sign ${to}`, slug: to.split("/")[1]!, default: null,
    options: [{ id: "approve", summary: "sign it" }, { id: "reject", summary: "leave it open" }],
  } as never, AT, false);
  const name = `queue.approve#${entry.id}`;
  if (answer) {
    const result = answerQueueEntry(root, { entry: name, answer: answer.answer, by: "owner", via: "chat", ...(answer.quote ? { quote: answer.quote } : {}) });
    expect((result as { entry?: { status?: string } }).entry?.status, JSON.stringify(result)).toBe("answered");
  }
  return name;
}

describe("kind slot entries (clossys.queue-entry/2)", () => {
  it("raises one entry per target and requester under queue.slot, valid against the schema; a second raise finds it open", () => {
    const { consumer } = world();
    const first = raiseRequest(consumer, { target: "writer/narratives.faq", from: REQUESTER, why: "w", source: "cli", by: "producer", at: AT });
    expect(first.created).toBe(true);
    expect(first.request).toMatchObject({ schema: "clossys.queue-entry/2", kind: "slot", from: REQUESTER, assignee: "writer", target: "writer/narratives.faq", status: "open", opened: `${first.request.id}#1` });
    expect(readdirSync(requestsDir(consumer))).toEqual([`${first.request.id}.json`]);
    expect(requestIssues(readRequest(consumer, first.request.id))).toEqual([]);
    expect(raiseRequest(consumer, { target: "writer/narratives.faq", from: REQUESTER, why: "w", source: "cli", by: "producer", at: AT }).created).toBe(false);
    expect(readdirSync(requestsDir(consumer))).toHaveLength(1);
    // A dry raise writes nothing; a target that is no slot ref is refused.
    raiseRequest(consumer, { target: "writer/narratives.other", from: REQUESTER, why: "w", source: "cli", by: "producer", at: AT }, { dry: true });
    expect(readdirSync(requestsDir(consumer))).toHaveLength(1);
    expect(() => raiseRequest(consumer, { target: "narratives.faq", from: REQUESTER, why: "w", source: "cli", by: "producer", at: AT })).toThrow(/<agent>\/<slot id>/);
  });

  it("judges an entry: another kind, a foreign assignee, a closed entry missing its link, an unknown field and foreign event ids are issues", () => {
    const { consumer } = world();
    const request = raise(consumer);
    expect(requestIssues({ ...request, kind: "fix" }).join("; ")).toMatch(/kind/);
    expect(requestIssues({ ...request, assignee: "designer" })).toContain("$.assignee: a slot entry is assigned to the target's agent writer");
    expect(requestIssues({ ...request, status: "closed" })).toEqual(expect.arrayContaining(["a closed request needs decision", "a closed request needs link", "a closed request needs notified"]));
    expect(requestIssues({ ...request, colour: "red" }).length).toBeGreaterThan(0);
    expect(requestIssues({ ...request, events: request.events.map(event => ({ ...event, id: "other#1" })) }).join("; ")).toMatch(/\$\.events\[0\]\.id must match/);
    expect(requestIssues({ ...request, events: request.events.map(event => ({ ...event, id: "20261117T1000Z-elsewhere#1" })) })).toEqual(expect.arrayContaining(["every event id is <request id>#<n>"]));
  });

  it("scan: a ref naming no slot is a need for the ref's agent; a bare id two agents hold has no owner; a filed need is no longer unfiled", () => {
    const { consumer } = world();
    expect(slotlessNeeds(consumer)).toEqual([]);
    // Mutation: the requester cites a Writer slot no agent holds, by its agent-prefixed ref.
    cite(consumer, "writer/sections.signup-faq.copy");
    expect(slotlessNeeds(consumer)).toEqual([{ from: REQUESTER, to: "writer/sections.signup-faq.copy", rel: "input", target: "writer/sections.signup-faq.copy" }]);
    // A bare id whose first segment the Designer and the Writer both hold names no owner; a producer ref is no slot need.
    cite(consumer, "sections.unheld-thing", "uses");
    cite(consumer, "producer/queue.fix");
    const needs = slotlessNeeds(consumer);
    expect(needs).toHaveLength(2);
    expect(needs[1]).toEqual({ from: REQUESTER, to: "sections.unheld-thing", rel: "uses" });
    raise(consumer, "writer/sections.signup-faq.copy");
    expect(unfiledNeeds(consumer).map(need => need.to)).toEqual(["sections.unheld-thing"]);
  });

  it("a create closes only on the owner's signature: an answered approve about the proposed leaf, quoted when via chat", () => {
    const { root, consumer } = world();
    const request = decidedCreate(consumer);
    expect(signedApproval(consumer, "queue.approve#20261117T1000Z-nothing", request)).toMatchObject({ error: expect.stringContaining("--approved queue.approve#20261117T1000Z-nothing") });
    const elsewhere = approval(root, "writer/narratives.guide", { answer: "approve", quote: "yes" });
    expect(signedApproval(consumer, elsewhere, request)).toMatchObject({ error: expect.stringContaining("is about writer/narratives.guide, not writer/narratives.faq") });
    const open = approval(root, "writer/narratives.faq");
    expect(signedApproval(consumer, open, request)).toMatchObject({ error: expect.stringContaining("the owner has not signed it") });
    expect(() => closeRequest(consumer, request.id, { by: "producer", at: AT })).toThrow(/takes the owner's signature/);
    expect(() => closeRequest(consumer, request.id, { by: "owner", at: AT, approved: open })).toThrow(/has not signed it/);
    const rejected = approval(root, "writer/narratives.faq", { answer: "reject", quote: "not yet" });
    expect(signedApproval(consumer, rejected, request)).toMatchObject({ error: expect.stringContaining("not approve") });
    const signed = approval(root, "writer/narratives.faq", { answer: "approve", quote: "place the FAQ leaf" });
    expect(signedApproval(consumer, signed, request)).toEqual({ entry: signed });
    expect(readRequest(consumer, request.id).status).toBe("open");
  });

  it("a reuse closes by linking the requester slot-to-slot and notifying it", () => {
    const { consumer } = world();
    const request = raise(consumer, "writer/narratives.how-to");
    checkRequest(consumer, request.id, { by: "writer", at: AT });
    decideRequest(consumer, request.id, { decision: "reuse", slot: "writer/narratives.guide", by: "writer", at: AT });
    const closed = closeRequest(consumer, request.id, { by: "producer", at: AT });
    expect(closed.request).toMatchObject({ status: "closed", decision: "reuse", link: "writer/narratives.guide", notified: { to: REQUESTER, at: AT } });
    expect(requestIssues(closed.request)).toEqual([]);
    const refs = (JSON.parse(readFileSync(join(consumer, "agents", REQUESTER, "slot.json"), "utf8")) as { refs: unknown[] }).refs;
    expect(refs).toContainEqual({ to: "writer/narratives.guide", rel: "input" });
    expect(existsSync(join(consumer, "agents", "writer", "narratives.how-to"))).toBe(false);
  });
});
