import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REQUESTS_FILED } from "../loop/names.js";
import { ownerFixQuestion, raiseEntry } from "../loop/route.js";
import { verifyCheck } from "../loop/runner.js";
import { OPEN_FIX, requestsWorld, type RequestsWorld } from "../conform/__fixtures__/requests-world.js";
import { answerQueueEntry } from "../queue/answer.js";
import { readLegacyFixes } from "../queue/legacy-fix.js";
import {
  checkRequest, closeRequest, closeWork, decideRequest, placementOverlaps, raiseRequest, readRequest, requestIssues, requestsDir, signedApproval, slotlessNeeds,
  unfiledNeeds, type SlotRequest,
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
function cite(consumer: string, to: string, rel: "input" | "uses" = "input", from = REQUESTER) {
  const file = join(consumer, "agents", from, "slot.json");
  const doc = JSON.parse(readFileSync(file, "utf8")) as { refs: { to: string; rel: string }[] };
  if (doc.refs.some(ref => ref.to === to && ref.rel === rel)) return;
  doc.refs.push({ to, rel });
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
}
/** The requester cites the need first (a request is raised for an edge its slot names), then its agent raises it. */
const raise = (consumer: string, target = "writer/narratives.faq") => {
  cite(consumer, target);
  return raiseRequest(consumer, { target, from: REQUESTER, why: "the article links an FAQ", source: "cli", by: "writer", at: AT }).request;
};
const CONTRACT = { requirements: [{ check: "text.nonempty" }] };
function decidedCreate(consumer: string): SlotRequest {
  const request = raise(consumer);
  checkRequest(consumer, request.id, { by: "writer", at: AT });
  return decideRequest(consumer, request.id, { decision: "create", proposal: { slot: "narratives.faq", under: "prose.reference/help", inputs: ["director/focus.segment.core"], contract: CONTRACT }, by: "writer", at: AT });
}
/** Every file under a folder, as bytes (what a refused or foreign write must leave alone). */
function bytes(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) bytes(path, base, out); else out[path.slice(base.length + 1)] = readFileSync(path, "latin1");
  }
  return out;
}
/** The input refs of a placed slot (bare ids). */
const inputsOf = (consumer: string, ref: string): string[] =>
  (JSON.parse(readFileSync(join(consumer, "agents", ref, "slot.json"), "utf8")) as { refs: { to: string; rel: string }[] }).refs.filter(item => item.rel === "input").map(item => item.to);
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
    cite(consumer, "writer/narratives.faq");
    cite(consumer, "writer/narratives.other");
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

// U5 fix round 1: who may raise for a slot, what a reuse or close may write, the overlap gate, and one raise under a lock.
describe("kind slot entries: requester, assignee and overlap gates", () => {
  it("raises only for a placed requester slot that cites the need, by that slot's own agent (or the owner, the planner or code)", () => {
    const { consumer } = world();
    const at = { why: "w", source: "cli" as const, at: AT };
    expect(() => raiseRequest(consumer, { ...at, target: "writer/narratives.unheld-need", from: "designer/no.such-slot", by: "designer" })).toThrow(/designer\/no\.such-slot is no placed slot/);
    expect(() => raiseRequest(consumer, { ...at, target: "writer/narratives.unheld-need", from: REQUESTER, by: "writer" })).toThrow(/writer\/sections\.article\.copy does not cite writer\/narratives\.unheld-need/);
    cite(consumer, "writer/narratives.unheld-need");
    expect(() => raiseRequest(consumer, { ...at, target: "writer/narratives.unheld-need", from: REQUESTER, by: "designer" })).toThrow(/designer raises for writer\/sections\.article\.copy: a slot's own agent \(writer\) raises its requests/);
    expect(() => raiseRequest(consumer, { ...at, target: "writer/narratives.unheld-need", from: REQUESTER, by: "someone" })).toThrow(/--by must be one of/);
    expect(() => raiseRequest(consumer, { ...at, target: "writer/narratives.unheld-need", from: "owner", by: "writer" })).toThrow(/writer raises as the owner/);
    expect(() => raiseRequest(consumer, { ...at, target: "writer/narratives.unheld-need", from: REQUESTER, rel: "uses", by: "writer" })).toThrow(/does not cite writer\/narratives\.unheld-need as uses/);
    expect(existsSync(requestsDir(consumer))).toBe(false);
    expect(raiseRequest(consumer, { ...at, target: "writer/narratives.unheld-need", from: REQUESTER, by: "writer" }).created).toBe(true);
    expect(raiseRequest(consumer, { ...at, target: "writer/narratives.owner-need", from: "owner", by: "owner" }).created).toBe(true);
  });

  it("refuses a raise for a slot that is already placed, pointing to it", () => {
    const { consumer } = world();
    cite(consumer, "writer/narratives.guide");
    expect(() => raiseRequest(consumer, { target: "writer/narratives.guide", from: REQUESTER, why: "w", source: "cli", by: "writer", at: AT })).toThrow(/writer\/narratives\.guide is placed: cite it/);
    expect(existsSync(requestsDir(consumer))).toBe(false);
  });

  it("records the /1 provenance: createdBy, refs raisedBy the requester and the raising event's via", () => {
    const { consumer } = world();
    const request = raise(consumer);
    expect(request.createdBy).toMatchObject({ actor: "code", cli: "clossys request" });
    expect(request.refs).toEqual([{ to: REQUESTER, rel: "raisedBy" }]);
    expect(request.events[0]).toMatchObject({ op: "raised", by: "writer", via: "cli" });
    const owner = raiseRequest(consumer, { target: "writer/narratives.said", from: "owner", why: "add a said page", source: "feedback", by: "owner", at: AT, createdBy: { actor: "owner", ref: "chat:clossys feedback 2026-11-17T10:00:00Z" }, via: "chat", quote: "add a said page" }).request;
    expect(owner).toMatchObject({ createdBy: { actor: "owner", ref: "chat:clossys feedback 2026-11-17T10:00:00Z" }, refs: [] });
    expect(owner.events[0]).toMatchObject({ by: "owner", via: "chat", quote: "add a said page" });
    expect(requestIssues(readRequest(consumer, owner.id))).toEqual([]);
  });

  it("a reuse names a placed slot of the assignee; closing writes the requester's slot and ledger only, never the reused slot", () => {
    const { consumer } = world();
    const request = raise(consumer, "writer/narratives.how-to");
    expect(() => decideRequest(consumer, request.id, { decision: "reuse", slot: "director/focus.segment.core", by: "writer", at: AT })).toThrow(/a reuse names a placed slot of writer, the assignee/);
    expect(() => decideRequest(consumer, request.id, { decision: "reuse", slot: "writer/narratives.guide", by: "designer", at: AT })).toThrow(/is decided by its assignee writer/);
    decideRequest(consumer, request.id, { decision: "reuse", slot: "writer/narratives.guide", by: "writer", at: AT });
    expect(() => closeRequest(consumer, request.id, { by: "designer", at: AT })).toThrow(/designer cannot write writer\/sections\.article\.copy/);
    const reused = bytes(join(consumer, "agents", "writer", "narratives.guide"));
    const director = bytes(join(consumer, "agents", "director"));
    const closed = closeRequest(consumer, request.id, { by: "producer", at: AT });
    expect(closed.wrote).toEqual([`${REQUESTER}/slot.json`]);
    expect(bytes(join(consumer, "agents", "writer", "narratives.guide"))).toEqual(reused);
    expect(bytes(join(consumer, "agents", "director"))).toEqual(director);
    const ledger = JSON.parse(readFileSync(join(consumer, "agents", REQUESTER, "ledger.json"), "utf8")) as { events: { op: string; request?: string }[] };
    expect(ledger.events.at(-1)).toMatchObject({ request: request.id });
  });

  it("decide create refuses a kind the assignee does not hold and a proposal with no inputs", () => {
    const { consumer } = world();
    const request = raise(consumer);
    const proposal = { slot: "narratives.faq", under: "prose.reference/help", inputs: ["director/focus.segment.core"], contract: CONTRACT };
    expect(() => decideRequest(consumer, request.id, { decision: "create", proposal: { ...proposal, kind: "bogus" }, by: "writer", at: AT })).toThrow(/kind bogus is not a writer slot kind \(strings\)/);
    expect(() => decideRequest(consumer, request.id, { decision: "create", proposal: { ...proposal, kind: "element" }, by: "writer", at: AT })).toThrow(/kind element is not a writer slot kind/);
    expect(() => decideRequest(consumer, request.id, { decision: "create", proposal: { ...proposal, inputs: [] }, by: "writer", at: AT })).toThrow(/a create proposal names the new leaf's inputs/);
    expect(readRequest(consumer, request.id).decision).toBeUndefined();
  });

  it("the placement overlap check: one L1/L2 and kind family with equal, subset, superset or Jaccard >= 0.8 inputs; one side empty is no overlap", () => {
    const { consumer } = world();
    const guide = inputsOf(consumer, "writer/narratives.guide");
    expect(guide).toHaveLength(15);
    const at = (inputs: readonly string[], l2 = "help", l1 = "prose.reference") => placementOverlaps(consumer, "writer", { slot: "narratives.new-leaf", kind: "strings", l1, l2, inputs, contract: CONTRACT }).map(item => `${item.slot}: ${item.why}`);
    expect(at(guide)).toEqual(["writer/narratives.guide: one L2 (prose.reference/help) and kind family, inputs equal"]);
    expect(at(guide.slice(1))).toEqual(["writer/narratives.guide: one L2 (prose.reference/help) and kind family, inputs a subset"]);
    expect(at([...guide, "director/focus.segment.core"])).toEqual(["writer/narratives.guide: one L2 (prose.reference/help) and kind family, inputs a superset"]);
    expect(at([...guide.slice(1), "director/focus.segment.core"])).toEqual(["writer/narratives.guide: one L2 (prose.reference/help) and kind family, inputs Jaccard 0.88"]);
    // Exactly one side empty (a new input-less leaf beside a slot with inputs): no overlap by inputs alone.
    expect(at([])).toEqual([]);
    // Below the threshold, another L2, or another L1 with the same L2 id: no overlap.
    expect(at([...guide.slice(0, 10), "director/focus.segment.core", "director/focus.segment.next"])).toEqual([]);
    expect(at(guide.slice(1), "policies")).toEqual([]);
    expect(at(guide.slice(1), "help", "prose.editorial")).toEqual([]);
  });

  it("two input-less slots of one L2 and kind family overlap only when their contract requirement sets are equal", () => {
    const { consumer } = world();
    const doc = (id: string) => JSON.parse(readFileSync(join(consumer, "agents", "director", id, "slot.json"), "utf8")) as { refs: { rel: string }[]; contract: { requirements: unknown[] } };
    const size = doc("context.market.size"), trend = doc("context.market.trend");
    expect(size.refs.filter(ref => ref.rel === "input")).toEqual([]);
    expect(trend.refs.filter(ref => ref.rel === "input")).toEqual([]);
    expect(size.contract.requirements).not.toEqual(trend.contract.requirements);
    const at = (inputs: readonly string[], requirements: unknown[]) => placementOverlaps(consumer, "director", { slot: "context.market.share", kind: "brief", l1: "context", l2: "context.market", inputs, contract: { ...size.contract, requirements } }).map(item => `${item.slot}: ${item.why}`);
    // Different requirements from every input-less sibling: placed, no owner ask.
    expect(at([], [{ check: "brief.sections" }])).toEqual([]);
    // Equal requirement sets (order aside): the one sibling it duplicates.
    expect(at([], [...size.contract.requirements].reverse())).toEqual(["director/context.market.size: one L2 (context/market) and kind family, inputs empty on both sides, requirements equal"]);
    expect(at([], trend.contract.requirements)).toEqual(["director/context.market.trend: one L2 (context/market) and kind family, inputs empty on both sides, requirements equal"]);
    // One side empty: a leaf with inputs beside input-less siblings, even with equal requirements.
    expect(at(["director/identity.brand.essence"], size.contract.requirements)).toEqual([]);
  });

  it("decide create over a listed overlap refuses without a reason; with one, the overlap ids and reason are on the entry and its event", () => {
    const { consumer } = world();
    const request = raise(consumer, "writer/narratives.how-to");
    const guide = inputsOf(consumer, "writer/narratives.guide");
    const proposal = { slot: "narratives.how-to", under: "prose.reference/help", kind: "strings", inputs: guide.slice(1), contract: CONTRACT };
    expect(() => decideRequest(consumer, request.id, { decision: "create", proposal, by: "writer", at: AT })).toThrow(/create writer\/narratives\.how-to overlaps writer\/narratives\.guide \(one L2 \(prose\.reference\/help\) and kind family, inputs a subset\): cite it instead/);
    expect(readRequest(consumer, request.id).decision).toBeUndefined();
    const decided = decideRequest(consumer, request.id, { decision: "create", proposal, overlapReason: "step-by-step tasks, not one reference guide", by: "writer", at: AT });
    expect(decided).toMatchObject({ decision: "create", overlapReason: "step-by-step tasks, not one reference guide", overlaps: [{ slot: "writer/narratives.guide" }] });
    expect(decided.events.at(-1)!.detail).toBe("create writer/narratives.how-to under prose.reference/help; overlaps writer/narratives.guide: step-by-step tasks, not one reference guide");
    expect(requestIssues(decided)).toEqual([]);
  });

  it("four parallel raises of one need from one requester file exactly one entry, none lost (five rounds)", async () => {
    const { root, consumer } = world();
    const script = join(root, "raise-child.mjs");
    // The built module (the test run builds the package first): each child is a separate `clossys request` process.
    writeFileSync(script, `
const [module, consumer, from, target] = process.argv.slice(2);
const { raiseRequest } = await import(module);
const result = raiseRequest(consumer, { target, from, why: "race", source: "cli", by: "writer", at: "2026-11-17T10:00:00Z" });
console.log(JSON.stringify({ id: result.request.id, created: result.created }));
`);
    const module = fileURLToPath(new URL("../../dist/records/request.js", import.meta.url));
    const run = (target: string) => new Promise<{ code: number | null; out: string; err: string }>(done => {
      const child = spawn(process.execPath, ["--no-warnings", script, module, consumer, REQUESTER, target], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      child.stdout.on("data", chunk => { out += String(chunk); });
      child.stderr.on("data", chunk => { err += String(chunk); });
      child.on("close", code => done({ code, out, err }));
    });
    for (let round = 1; round <= 5; round++) {
      const target = `writer/narratives.race-${round}`;
      cite(consumer, target);
      const results = await Promise.all([run(target), run(target), run(target), run(target)]);
      for (const result of results) expect(result, result.err).toMatchObject({ code: 0 });
      const said = results.map(result => JSON.parse(result.out.trim()) as { id: string; created: boolean });
      const files = readdirSync(requestsDir(consumer)).filter(name => name.includes(`race-${round}`));
      expect(files, `round ${round}`).toHaveLength(1);
      expect(new Set(said.map(item => item.id)), `round ${round}`).toEqual(new Set([files[0]!.slice(0, -".json".length)]));
      expect(said.filter(item => item.created), `round ${round}`).toHaveLength(1);
      expect(requestIssues(readRequest(consumer, said[0]!.id))).toEqual([]);
    }
    expect(readdirSync(requestsDir(consumer)).filter(name => name.startsWith("."))).toEqual([]);
    expect(readdirSync(join(root, ".clossys", "locks", "queue", "queue.slot"))).toEqual([]);
  }, 120_000);

  it("requests.filed (loop.scope's gate) fails while a slotless need is unfiled and passes once it is filed", () => {
    const { root, consumer } = world();
    const check = () => verifyCheck({ root, state: {} as never }, REQUESTS_FILED);
    expect(check()).toEqual({ ok: true });
    cite(consumer, "writer/sections.signup-faq.copy");
    expect(check()).toEqual({ ok: false, why: `requests.filed: 1 slotless need(s) not filed: ${REQUESTER} -> writer/sections.signup-faq.copy` });
    raise(consumer, "writer/sections.signup-faq.copy");
    expect(check()).toEqual({ ok: true });
  });
});

// foundry-build-0048 U7 r3: a fix or change closes by the one closure rule (records/request.ts closerIssues). The
// assignee closes a change, and a fix only as fixed with its check re-run; any other close is the owner's answer
// owner:queue.fix#<id>, a /1 queue.fix entry the owner answered that cites the fix. Bare owner never closes.
describe("the closure rule on change and fix entries (U7 r3)", () => {
  const worlds: RequestsWorld[] = [];
  afterEach(() => { for (const item of worlds.splice(0)) item.dispose(); });
  const open = async () => {
    const made = await requestsWorld();
    worlds.push(made);
    const fix = made.raised.fix.find(item => item.target === OPEN_FIX)!;
    return { made, fix, file: join(made.consumer, "agents/producer/queue.fix/entries", `${fix.id}.json`) };
  };
  /** The owner's answer to the fix: the one /1 queue.fix owner entry citing it, answered (free text: it has no options). */
  const ownerAnswer = (root: string, fix: SlotRequest, words = "decline it: the overflow is by design") => {
    const { entry } = ownerFixQuestion(root, { id: fix.id, target: fix.target, check: String(fix.check) }, "2026-11-20T10:00:00Z");
    const name = `queue.fix#${entry.id}`;
    // The world runs on 2026-11-20 and an answer is stamped now: answer from a clock past the world's.
    vi.useFakeTimers({ now: new Date("2026-11-21T00:00:00Z"), toFake: ["Date"] });
    let result: unknown;
    try { result = answerQueueEntry(root, { entry: name, answer: words, by: "owner", via: "chat", quote: words }); } finally { vi.useRealTimers(); }
    expect((result as { entry?: { status?: string } }).entry?.status, JSON.stringify(result)).toBe("answered");
    return `owner:${name}`;
  };
  const close = (consumer: string, id: string, by: string, outcome: "fixed" | "declined" | "changed") =>
    closeWork(consumer, id, { by, at: "2026-11-20T10:05:00Z", outcome, result: OPEN_FIX });

  it("T5: the assignee closes a fix only as fixed: its declined is refused and nothing is written", { timeout: 60_000 }, async () => {
    const { made, fix, file } = await open();
    const before = readFileSync(file, "utf8");
    expect(() => close(made.consumer, fix.id, "writer", "declined")).toThrow(new RegExp(`writer cannot close ${fix.id}: the assignee closes a fix only as fixed`));
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("T6: bare owner declining a fix is refused; owner:queue.fix#<id>, answered by the owner and citing it, closes it", { timeout: 60_000 }, async () => {
    const { made, fix, file } = await open();
    const before = readFileSync(file, "utf8");
    expect(() => close(made.consumer, fix.id, "owner", "declined")).toThrow(/owner cannot close .*: bare owner is no closer/);
    expect(readFileSync(file, "utf8")).toBe(before);
    const by = ownerAnswer(made.root, fix);
    const closed = close(made.consumer, fix.id, by, "declined");
    expect(closed).toMatchObject({ status: "closed", outcome: "declined" });
    expect(closed.events.at(-1)).toMatchObject({ op: "closed", by });
    expect(closed.refs).toContainEqual({ to: "producer/queue.fix", record: by.split("#")[1], rel: "answers" });
    expect(requestIssues(closed, made.root)).toEqual([]);
    // Stored, the same close without its answers ref, or by bare owner, does not read.
    expect(requestIssues({ ...closed, refs: closed.refs.filter(ref => ref.rel !== "answers") }, made.root).join("; ")).toMatch(/carries no ref answering queue\.fix#/);
    expect(requestIssues({ ...closed, events: closed.events.map(event => event.op === "closed" ? { ...event, by: "owner" } : event) }, made.root).join("; ")).toMatch(/bare owner is no closer/);
  });

  it("T7: a fix closes fixed or declined: changed is refused, by the assignee and by the owner's answer", { timeout: 60_000 }, async () => {
    const { made, fix, file } = await open();
    const before = readFileSync(file, "utf8");
    expect(() => close(made.consumer, fix.id, "writer", "changed")).toThrow(/a fix entry closes fixed or declined, not changed/);
    const by = ownerAnswer(made.root, fix);
    expect(() => close(made.consumer, fix.id, by, "changed")).toThrow(/a fix entry closes fixed or declined, not changed/);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("T8: a fix whose check Producer cannot re-run never closes fixed; it raises one owner queue.fix entry citing it", { timeout: 60_000 }, async () => {
    const { made, fix, file } = await open();
    writeFileSync(file, `${JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), check: "render.overflow" })}\n`);
    const before = readFileSync(file, "utf8");
    const asked = () => readLegacyFixes(made.root).filter(item => {
      const doc = item.doc as { decider?: string; refs?: { to: string; record?: string; rel: string }[] };
      return doc.decider === "owner" && (doc.refs ?? []).some(ref => ref.to === "producer/queue.fix" && ref.record === fix.id && ref.rel === "cites");
    });
    expect(asked()).toEqual([]);
    for (const by of ["writer", "writer"]) expect(() => close(made.consumer, fix.id, by, "fixed")).toThrow(/cannot close fixed: its check render\.overflow is not one Producer can re-run/);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(asked()).toHaveLength(1);
    expect(asked()[0]).toMatchObject({ issues: [], closed: false, subject: OPEN_FIX });
    // The owner's answer closes it, declined only: fixed still needs a check Producer re-runs.
    const by = ownerAnswer(made.root, fix);
    expect(asked()).toHaveLength(1);
    expect(() => close(made.consumer, fix.id, by, "fixed")).toThrow(/cannot close fixed: its check render\.overflow/);
    expect(close(made.consumer, fix.id, by, "declined")).toMatchObject({ status: "closed", outcome: "declined" });
  });
});

describe("closeRequest resolves its ownerRef (U7 r3, T14)", () => {
  it("refuses an ownerRef no registered owner decision backs, and writes nothing", () => {
    const { consumer } = world();
    const request = raise(consumer, "writer/narratives.how-to");
    checkRequest(consumer, request.id, { by: "writer", at: AT });
    decideRequest(consumer, request.id, { decision: "reuse", slot: "writer/narratives.guide", by: "writer", at: AT });
    const before = bytes(join(consumer, "agents"));
    expect(() => closeRequest(consumer, request.id, { by: "producer", at: AT, ownerRef: "6000000001" })).toThrow(new RegExp(`request ${request.id}: --owner-ref 6000000001`));
    expect(bytes(join(consumer, "agents"))).toEqual(before);
    expect(readRequest(consumer, request.id).status).toBe("open");
  });
});
