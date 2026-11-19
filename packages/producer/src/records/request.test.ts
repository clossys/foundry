import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REQUESTS_FILED } from "../loop/names.js";
import { raiseEntry } from "../loop/route.js";
import { runPinCli } from "../cli/pin.js";
import { consumerFacts, rederive } from "../queue/routing.js";
import { candidateCodec } from "./candidate-codec.js";
import { SLOT_LOCK, writeCandidate } from "./slot-write.js";
import { verifyCheck } from "../loop/runner.js";
import { FIX_CHECKS } from "../queue/requester-check.js";
import { OPEN_FIX, requestsWorld, type RequestsWorld } from "../conform/__fixtures__/requests-world.js";
import { answerQueueEntry } from "../queue/answer.js";
import { readLegacyFixes } from "../queue/legacy-fix.js";
import {
  answerRequest, checkRequest, closeRequest, closeWork, raiseWork, decideRequest, placementOverlaps, raiseRequest, readRequest, requestIssues, requestLockPath, requestsDir, signedApproval, slotlessNeeds,
  unfiledNeeds, type SlotRequest,
} from "./request.js";

// U7 r7: a hook run right after the pin verb writes a pin (cli/pin.ts clears the slot's re-verdict next), unset by default.
const pinHook = vi.hoisted(() => ({ after: undefined as undefined | (() => void) }));
vi.mock("../constitution/cascade.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../constitution/cascade.js")>();
  return { ...actual, clearReverdict: (...args: Parameters<typeof actual.clearReverdict>) => { actual.clearReverdict(...args); pinHook.after?.(); } };
});

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

// foundry-build-0048 U7 r4: a fix or change closes by the one closure rule (records/request.ts closerIssues). The
// agent assignee closes a change, and a fix only as fixed with its check re-run; any other close is the owner's typed
// answer: one option id of the entry, whose step Producer runs, closer owner:queue.<kind>#<id>. Bare owner never closes.
describe("the closure rule on change and fix entries (U7 r4, typed answers)", () => {
  const worlds: RequestsWorld[] = [];
  afterEach(() => { for (const item of worlds.splice(0)) item.dispose(); });
  const open = async () => {
    const made = await requestsWorld();
    worlds.push(made);
    const fix = made.raised.fix.find(item => item.target === OPEN_FIX)!;
    return { made, fix, file: join(made.consumer, "agents/producer/queue.fix/entries", `${fix.id}.json`) };
  };
  const close = (consumer: string, id: string, by: string, outcome: "fixed" | "declined" | "changed") =>
    closeWork(consumer, id, { by, at: "2026-11-20T10:05:00Z", outcome, result: OPEN_FIX });

  it("T5: the assignee's declined claim is no close: it asks the owner decline or keep-open, and closes nothing", { timeout: 60_000 }, async () => {
    const { made, fix } = await open();
    const asked = close(made.consumer, fix.id, "writer", "declined");
    expect(asked).toMatchObject({ asked: true, status: "open", options: [{ id: "decline", then: { verb: "close", args: ["declined"] } }, { id: "keep-open", then: { verb: "reject", args: [] } }] });
    const stored = readRequest(made.consumer, fix.id);
    expect(stored).toMatchObject({ status: "open", assignee: "writer" });
    expect(stored.events.at(-1)).toMatchObject({ op: "asked", by: "producer", detail: expect.stringMatching(/^writer claims declined; the owner answers decline or keep-open/) });
    expect(requestIssues(stored, made.root)).toEqual([]);
  });

  it("T6: bare owner is refused; the entry's own ref closes only right after the owner's answered option, and as that option's step", { timeout: 60_000 }, async () => {
    const { made, fix, file } = await open();
    const self = `owner:queue.fix#${fix.id}`;
    const before = readFileSync(file, "utf8");
    expect(() => close(made.consumer, fix.id, "owner", "declined")).toThrow(/owner cannot close .*: bare owner is no closer: the owner answers one of the entry's options/);
    expect(() => close(made.consumer, fix.id, self, "declined")).toThrow(/closes it only right after the owner's answer chose one of its options/);
    expect(readFileSync(file, "utf8")).toBe(before);
    close(made.consumer, fix.id, "writer", "declined");
    const answered = await answerRequest(made.consumer, fix.id, { option: "decline", at: "2026-11-20T10:06:00Z", via: "chat", quote: "decline it" });
    expect(answered).toMatchObject({ ok: true, option: { id: "decline" } });
    const closed = readRequest(made.consumer, fix.id);
    expect(closed).toMatchObject({ status: "closed", outcome: "declined", result: `queue.fix#${fix.id}`, notified: { to: fix.from } });
    expect(closed.events.find(event => event.op === "answered")).toMatchObject({ by: "owner", option: "decline", via: "chat", quote: "decline it" });
    expect(closed.events.at(-1)).toMatchObject({ op: "closed", by: self });
    expect(requestIssues(closed, made.root)).toEqual([]);
    // Stored: by bare owner, with no answer before it, or closing other than the option's step, it does not read.
    const swap = (by: string) => ({ ...closed, events: closed.events.map(event => event.op === "closed" ? { ...event, by } : event) });
    expect(requestIssues(swap("owner"), made.root).join("; ")).toMatch(/bare owner is no closer/);
    expect(requestIssues({ ...closed, events: closed.events.filter(event => event.op !== "answered") }, made.root).join("; ")).toMatch(/closes it only right after the owner's answer chose one of its options/);
    expect(requestIssues({ ...closed, options: closed.options!.map(option => option.id === "decline" ? { ...option, then: { verb: "reject" as const, args: [] } } : option) }, made.root).join("; ")).toMatch(/the owner's answer decline \(reject\) closes nothing, not declined/);
  });

  it("T7: a fix closes fixed or declined: changed is refused by the assignee, and the owner is never offered it", { timeout: 60_000 }, async () => {
    const { made, fix, file } = await open();
    const before = readFileSync(file, "utf8");
    expect(() => close(made.consumer, fix.id, "writer", "changed")).toThrow(/a fix entry closes fixed or declined, not changed/);
    expect(readFileSync(file, "utf8")).toBe(before);
    const { asked: _asked, ...asked } = close(made.consumer, fix.id, "writer", "declined");
    expect(asked.options!.map(option => option.then)).toEqual([{ verb: "close", args: ["declined"] }, { verb: "reject", args: [] }]);
    // A stored close option no fix outcome names does not read.
    expect(requestIssues({ ...asked, options: [{ id: "change-it", label: "x", then: { verb: "close", args: ["changed"] } }, asked.options![1]!] }, made.root).join("; ")).toMatch(/options change-it: close takes one outcome of a fix entry \(fixed, declined\)/);
  });

  it("T8: a fix whose check Producer cannot re-run never closes fixed; the claim asks the owner and raises no other entry", { timeout: 60_000 }, async () => {
    const { made, fix, file } = await open();
    writeFileSync(file, `${JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), check: "render.overflow" })}
`);
    const legacy = () => readLegacyFixes(made.root).length;
    const count = legacy();
    const asked = close(made.consumer, fix.id, "writer", "fixed");
    expect(asked).toMatchObject({ asked: true, status: "open", options: [{ id: "decline" }, { id: "keep-open" }] });
    expect(asked.events.at(-1)!.detail).toMatch(/writer claims fixed on check render\.overflow, which Producer cannot re-run/);
    expect(legacy()).toBe(count);
    // The owner can only decline or keep it open: fixed is no option, and nothing is written.
    const bytesNow = readFileSync(file, "utf8");
    await expect(answerRequest(made.consumer, fix.id, { option: "fixed", at: "2026-11-20T10:06:00Z", via: "cli", quote: "test quote" })).rejects.toThrow(/--answer fixed is none of request .*'s options \(decline, keep-open\); nothing was written/);
    expect(readFileSync(file, "utf8")).toBe(bytesNow);
    expect((await answerRequest(made.consumer, fix.id, { option: "decline", at: "2026-11-20T10:07:00Z", via: "cli", quote: "test quote" })).request).toMatchObject({ status: "closed", outcome: "declined" });
  });

  it("T9: the stored answer is typed: an answered option the entry does not offer, an answer by a seat, or an option on another event does not read", { timeout: 60_000 }, async () => {
    const { made, fix } = await open();
    close(made.consumer, fix.id, "writer", "declined");
    await answerRequest(made.consumer, fix.id, { option: "keep-open", at: "2026-11-20T10:06:00Z", via: "cli", quote: "test quote" });
    const kept = readRequest(made.consumer, fix.id);
    expect(requestIssues(kept, made.root)).toEqual([]);
    const edit = (map: (event: SlotRequest["events"][number]) => SlotRequest["events"][number]) => requestIssues({ ...kept, events: kept.events.map(map) }, made.root).join("; ");
    const { options: _options, ...bare } = kept;
    expect(edit(event => event.op === "answered" ? { ...event, option: "approve" } : event)).toMatch(/an answer is the owner's choice of one of the entry's options \(decline, keep-open\), not owner's approve/);
    expect(edit(event => event.op === "answered" ? { ...event, by: "writer" } : event)).toMatch(/not writer's keep-open/);
    expect(edit(event => { if (event.op !== "answered") return event; const { option: _option, ...rest } = event; return rest; })).toMatch(/not owner's free text/);
    expect(edit(event => event.op === "rejected" ? { ...event, option: "decline" } : event)).toMatch(/only an answered event names an option/);
    expect(edit(event => event.op === "asked" ? { ...event, by: "writer" } : event)).toMatch(/Producer asks the owner, not writer/);
    expect(requestIssues(bare, made.root).join("; ")).toMatch(/options \(none\), not owner's keep-open/);
  });
});

// U7 r4: an owner-assigned change carries its options from the raise; the owner's answer runs the step through the
// normal verbs and gates, and a step that fails leaves the entry open with a fix routed by the table.
describe("owner-assigned change entries (U7 r4, typed answers)", () => {
  const worlds: RequestsWorld[] = [];
  afterEach(() => { for (const item of worlds.splice(0)) item.dispose(); });
  const DIRECTOR = "agents/director/focus.reach.geography";
  /** The world, one more submitted (unpinned) geography candidate (the pinned bytes, edited), and the owner's change. */
  const raised = async (edit?: (bytes: string) => string) => {
    const made = await requestsWorld();
    worlds.push(made);
    if (edit) {
      const pinned = String(JSON.parse(readFileSync(join(made.consumer, DIRECTOR, "pin.json"), "utf8")).candidate);
      // The pinned file carries its own clossys.candidate/1 header; a new submit takes the int2 view (submit heads it).
      const bytes = candidateCodec.parse(pinned, readFileSync(join(made.consumer, DIRECTOR, "candidates", pinned), "utf8")).view;
      writeCandidate(made.consumer, "director", "focus.reach.geography", "geography", edit(bytes), { at: "2026-11-20T10:59:00Z", provenance: { by: "agent:director", model: "none", tier: "none" } });
    }
    const entry = raiseWork(made.consumer, { kind: "change", target: "director/focus.reach.geography", from: "writer/sections.hero.copy", want: "repin", why: "the hero copy needs another geography", source: "cli", by: "writer", at: "2026-11-20T11:00:00Z" }).request;
    return { made, entry, file: join(made.consumer, "agents/producer/queue.change/entries", `${entry.id}.json`) };
  };

  it("T10: a change on an owner class is raised to the owner with its options, each a Producer step; none is free text", { timeout: 60_000 }, async () => {
    const { made, entry } = await raised();
    expect(entry).toMatchObject({ assignee: "owner", status: "open" });
    const steps = entry.options!.map(option => `${option.id}: ${option.then.verb} ${option.then.args.join(" ")}`.trim());
    expect(steps).toContain("handoff: handoff director");
    expect(steps).toContain("decline: close declined");
    for (const option of entry.options!.filter(item => item.then.verb === "pin")) expect(option.then.args[0]).toBe("director/focus.reach.geography");
    expect(requestIssues(entry, made.root)).toEqual([]);
    const { options: _options, ...bare } = entry;
    expect(requestIssues(bare, made.root).join("; ")).toMatch(/an entry assigned to the owner carries the options the owner answers/);
    // The owner's entry is no seat's to close or decide.
    expect(() => closeWork(made.consumer, entry.id, { by: "director", at: "2026-11-20T11:01:00Z", outcome: "changed", result: entry.target })).toThrow(/awaits the owner's answer/);
    expect(() => closeWork(made.consumer, entry.id, { by: "owner", at: "2026-11-20T11:01:00Z", outcome: "declined", result: `queue.change#${entry.id}` })).toThrow(/awaits the owner's answer/);
  });

  it("T11: handoff re-routes to the slot's agent with route.delegated, which rederive keeps; the agent then closes it", { timeout: 60_000 }, async () => {
    const { made, entry } = await raised();
    const result = await answerRequest(made.consumer, entry.id, { option: "handoff", at: "2026-11-20T11:01:00Z", via: "cli", quote: "test quote" });
    expect(result).toMatchObject({ ok: true });
    const handed = readRequest(made.consumer, entry.id);
    expect(handed).toMatchObject({ status: "open", assignee: "director", route: { assignee: "director", delegated: true } });
    expect(handed.events.at(-1)).toMatchObject({ op: "routed", by: "producer", detail: expect.stringMatching(/delegated by the owner's handoff/) });
    expect(requestIssues(handed, made.root)).toEqual([]);
    expect(rederive(consumerFacts(made.consumer), handed)).toBeUndefined();
    const { delegated: _delegated, ...undelegated } = handed.route!;
    expect(rederive(consumerFacts(made.consumer), { ...handed, route: undelegated })).toMatch(/differs from the table now \(owner\.class -> owner\)/);
    // A delegated route with no answered handoff does not read.
    expect(requestIssues({ ...handed, events: handed.events.filter(event => event.op !== "answered") }, made.root).join("; ")).toMatch(/delegated only by the owner's answered handoff option/);
    // No second answer: the question closed with the handoff.
    await expect(answerRequest(made.consumer, entry.id, { option: "decline", at: "2026-11-20T11:02:00Z", via: "cli", quote: "test quote" })).rejects.toThrow(/awaits no owner answer/);
  });

  it("T12: the answer binds the pin: the pin verb refuses the entry's ref pinning any candidate but the answered one", { timeout: 60_000 }, async () => {
    const { made, entry, file } = await raised(bytes => bytes);
    const pin = entry.options!.find(option => option.then.verb === "pin")!;
    expect(pin, JSON.stringify(entry.options)).toBeDefined();
    const pinFile = join(made.consumer, DIRECTOR, "pin.json");
    const pinBefore = readFileSync(pinFile, "utf8");
    const pinned = String(JSON.parse(pinBefore).candidate);
    const by = ["--by", `owner:queue.change#${entry.id}`, "--at", "2026-11-20T11:01:30Z", "--root", made.root];
    // Unanswered, the entry's ref pins nothing.
    expect(await runPinCli(["director/focus.reach.geography", pin.then.args[1]!, ...by], made.root)).toMatchObject({ exitCode: 1, message: expect.stringContaining("has no owner answer as its last event") });
    const forged = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, `${JSON.stringify({ ...forged, events: [...forged.events, { id: `${entry.id}#9`, op: "answered", by: "owner", at: "2026-11-20T11:01:00Z", option: pin.id, via: "chat", quote: "pin it" }] })}\n`);
    expect(await runPinCli(["director/focus.reach.geography", pinned, ...by], made.root)).toMatchObject({ exitCode: 1, message: expect.stringContaining(`was answered ${pin.id} (pin director/focus.reach.geography ${pin.then.args[1]}), not pin director/focus.reach.geography ${pinned}`) });
    expect(readFileSync(pinFile, "utf8")).toBe(pinBefore);
  });

  it("T12b (U7 r5, blind1 s2): the pin verb reads the entry through readRequest: the ref's queue folder, every entry rule, the owner's assignment", { timeout: 60_000 }, async () => {
    const { made, entry, file } = await raised(bytes => bytes);
    const pin = entry.options!.find(option => option.then.verb === "pin")!;
    const pinFile = join(made.consumer, DIRECTOR, "pin.json");
    const pinBefore = readFileSync(pinFile, "utf8");
    const original = JSON.parse(readFileSync(file, "utf8")) as SlotRequest;
    const answered = { id: `${entry.id}#${original.events.length + 1}`, op: "answered" as const, by: "owner", at: "2026-11-20T11:01:00Z", option: pin.id, via: "chat" as const, quote: "pin it" };
    const store = (doc: object) => writeFileSync(file, `${JSON.stringify(doc)}\n`);
    const pinBy = (by: string) => runPinCli(["director/focus.reach.geography", pin.then.args[1]!, "--by", by, "--at", "2026-11-20T11:01:30Z", "--root", made.root], made.root);
    const own = `owner:queue.change#${entry.id}`;
    // A copy under another queue's folder is no answer of that queue.
    store({ ...original, events: [...original.events, answered] });
    const fixDir = join(made.consumer, "agents/producer/queue.fix/entries");
    writeFileSync(join(fixDir, `${entry.id}.json`), readFileSync(file));
    expect(await pinBy(`owner:queue.fix#${entry.id}`)).toMatchObject({ exitCode: 1, message: expect.stringContaining(`is a kind change entry filed under producer/queue.change, not producer/queue.fix`) });
    rmSync(join(fixDir, `${entry.id}.json`));
    // An entry the entry rules refuse (here: an answer with no quote) answers no pin.
    const { quote: _quote, ...unquoted } = answered;
    store({ ...original, events: [...original.events, unquoted] });
    expect(await pinBy(own)).toMatchObject({ exitCode: 1, message: expect.stringMatching(/does not read as a work entry: .*quotes the owner's words verbatim/) });
    // An entry handed to an agent is no owner's entry, whatever its last event says.
    store(original);
    expect(await answerRequest(made.consumer, entry.id, { option: "handoff", at: "2026-11-20T11:01:10Z", via: "cli", quote: "hand it over" })).toMatchObject({ ok: true });
    const handed = readRequest(made.consumer, entry.id);
    store({ ...handed, events: [...handed.events, { ...answered, id: `${entry.id}#${handed.events.length + 1}`, at: "2026-11-20T11:01:20Z" }] });
    expect(await pinBy(own)).toMatchObject({ exitCode: 1, message: expect.stringContaining("is assigned to director, not the owner") });
    expect(readFileSync(pinFile, "utf8")).toBe(pinBefore);
  });

  it("T13: a pin answer runs the pin gate: passing, the slot is pinned by the answer and the entry closes changed", { timeout: 60_000 }, async () => {
    const { made, entry } = await raised(bytes => bytes);
    const pin = entry.options!.find(option => option.then.verb === "pin")!;
    const result = await answerRequest(made.consumer, entry.id, { option: pin.id, at: "2026-11-20T11:02:00Z", via: "cli", quote: "test quote" });
    expect(result, result.message).toMatchObject({ ok: true });
    const closed = readRequest(made.consumer, entry.id);
    expect(closed).toMatchObject({ status: "closed", outcome: "changed", result: entry.target, notified: { to: entry.from } });
    expect(closed.events.at(-1)).toMatchObject({ op: "closed", by: `owner:queue.change#${entry.id}` });
    expect(JSON.parse(readFileSync(join(made.consumer, DIRECTOR, "pin.json"), "utf8"))).toMatchObject({ candidate: pin.then.args[1], decidedBy: `owner:queue.change#${entry.id}` });
    expect(requestIssues(closed, made.root)).toEqual([]);
  });

  it("T14: a pin answer the gate refuses leaves the entry open with a rejected event and a fix on the target, routed by the table", { timeout: 60_000 }, async () => {
    const { made, entry } = await raised(bytes => bytes.replace(/Language/g, "Tongue"));
    const pin = entry.options!.find(option => option.then.verb === "pin")!;
    const pinFile = join(made.consumer, DIRECTOR, "pin.json");
    const pinBefore = readFileSync(pinFile, "utf8");
    const result = await answerRequest(made.consumer, entry.id, { option: pin.id, at: "2026-11-20T11:02:00Z", via: "cli", quote: "test quote" });
    expect(result).toMatchObject({ ok: false });
    const stays = readRequest(made.consumer, entry.id);
    expect(stays).toMatchObject({ status: "open", assignee: "owner" });
    expect(stays.events.at(-1)).toMatchObject({ op: "rejected", by: "producer", detail: expect.stringMatching(/the owner's answer .* failed \(pin\.gate\)/) });
    expect(result.fix).toMatchObject({ kind: "fix", target: entry.target, check: "pin.gate", status: "open", assignee: "director" });
    expect(result.fix!.refs).toContainEqual(expect.objectContaining({ to: "producer/queue.change", record: entry.id }));
    expect(readFileSync(pinFile, "utf8")).toBe(pinBefore);
    expect(requestIssues(stays, made.root)).toEqual([]);
    expect(requestIssues(result.fix!, made.root)).toEqual([]);
  });

  it("T15 (U7 r5, blind1 B2): an owner answer carries via and a verbatim quote; a stored answer lacking either is an issue", { timeout: 60_000 }, async () => {
    const { made, entry, file } = await raised();
    const before = readFileSync(file, "utf8");
    await expect(answerRequest(made.consumer, entry.id, { option: "decline", at: "2026-11-20T11:01:00Z", quote: "decline it" })).rejects.toThrow(/names how it came \(--via cli\|chat\|app\).*nothing was written/);
    await expect(answerRequest(made.consumer, entry.id, { option: "decline", at: "2026-11-20T11:01:00Z", via: "chat", quote: "  " })).rejects.toThrow(/quotes the owner's words verbatim/);
    await expect(answerRequest(made.consumer, entry.id, { option: "decline", at: "2026-11-20T11:01:00Z", via: "chat" })).rejects.toThrow(/quotes the owner's words verbatim/);
    expect(readFileSync(file, "utf8")).toBe(before);
    const result = await answerRequest(made.consumer, entry.id, { option: "decline", at: "2026-11-20T11:01:00Z", via: "chat", quote: "No, leave the geography as it is." });
    expect(result, result.message).toMatchObject({ ok: true });
    const closed = readRequest(made.consumer, entry.id);
    expect(closed.events.find(event => event.op === "answered")).toMatchObject({ via: "chat", quote: "No, leave the geography as it is." });
    expect(requestIssues(closed, made.root)).toEqual([]);
    const edit = (map: (event: SlotRequest["events"][number]) => SlotRequest["events"][number]) => requestIssues({ ...closed, events: closed.events.map(map) }, made.root).join("; ");
    expect(edit(event => { if (event.op !== "answered") return event; const { via: _via, ...rest } = event; return rest; })).toMatch(/an owner answer names how it came \(via cli, chat or app\)/);
    expect(edit(event => { if (event.op !== "answered") return event; const { quote: _quote, ...rest } = event; return rest; })).toMatch(/an owner answer quotes the owner's words verbatim \(a non-empty quote\)/);
    expect(edit(event => event.op === "answered" ? { ...event, quote: " " } : event)).toMatch(/a non-empty quote/);
  });

  it("T16 (U7 r5, blind1 B3): a fix raised on a refused pin re-runs the pin gate, stays open while it refuses and closes fixed once repaired", { timeout: 60_000 }, async () => {
    const { made, entry } = await raised(bytes => bytes);
    expect(FIX_CHECKS).toEqual(expect.arrayContaining(["pin.gate", "requester.check", "route"]));
    const pin = entry.options!.find(option => option.then.verb === "pin")!;
    const candidate = join(made.consumer, DIRECTOR, "candidates", pin.then.args[1]!);
    const good = readFileSync(candidate, "utf8");
    // The candidate's bytes change after its submit: the pin gate refuses it.
    writeFileSync(candidate, `${good}\n`);
    const result = await answerRequest(made.consumer, entry.id, { option: pin.id, at: "2026-11-20T11:02:00Z", via: "cli", quote: "pin that one" });
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toMatch(/failed pin\.gate \(.*changed since its submit/);
    const fix = result.fix!;
    expect(fix).toMatchObject({ kind: "fix", check: "pin.gate", assignee: "director", status: "open" });
    // Unrepaired, the assignee's fixed close re-runs the pin gate and is refused; it is no claim for the owner.
    expect(() => closeWork(made.consumer, fix.id, { by: "director", at: "2026-11-20T11:03:00Z", outcome: "fixed", result: entry.target })).toThrow(/its check pin\.gate still fails .*changed since its submit/);
    expect(readRequest(made.consumer, fix.id)).toMatchObject({ status: "open" });
    writeFileSync(candidate, good);
    const closed = closeWork(made.consumer, fix.id, { by: "director", at: "2026-11-20T11:04:00Z", outcome: "fixed", result: entry.target });
    expect(closed).toMatchObject({ status: "closed", outcome: "fixed" });
    expect(closed.events.find(event => event.op === "verified")?.detail).toMatch(/fix check pin\.gate passes on director\/focus\.reach\.geography/);
    expect(requestIssues(readRequest(made.consumer, fix.id), made.root)).toEqual([]);
  });

  it("T17 (U7 r5, blind2 s3): a pin applied whose requester check fails is no silent half: the rejected event names the applied pin, a requester.check fix is routed, and it closes fixed once repaired", { timeout: 60_000 }, async () => {
    const { made, entry } = await raised(bytes => bytes);
    const pin = entry.options!.find(option => option.then.verb === "pin")!;
    const requester = join(made.consumer, "agents/writer/sections.hero.copy/slot.json");
    const slotBytes = readFileSync(requester, "utf8");
    writeFileSync(requester, slotBytes.replace(/"status": "[a-z-]+"/, '"status": "needs-refresh"'));
    const result = await answerRequest(made.consumer, entry.id, { option: pin.id, at: "2026-11-20T11:02:00Z", via: "cli", quote: "pin that one" });
    expect(result).toMatchObject({ ok: false });
    expect(JSON.parse(readFileSync(join(made.consumer, DIRECTOR, "pin.json"), "utf8"))).toMatchObject({ candidate: pin.then.args[1] });
    const stays = readRequest(made.consumer, entry.id);
    expect(stays).toMatchObject({ status: "open", assignee: "owner" });
    expect(stays.events.at(-1)).toMatchObject({ op: "rejected", detail: expect.stringMatching(new RegExp(`^pin director/focus\\.reach\\.geography ${pin.then.args[1]!.replace(/\./g, "\\.")} is applied \\(the pin gate passed\\); requester check failed .*needs-refresh`)) });
    expect(result.message).toMatch(/failed requester\.check/);
    const fix = result.fix!;
    expect(fix).toMatchObject({ kind: "fix", check: "requester.check", assignee: "director", status: "open" });
    expect(() => closeWork(made.consumer, fix.id, { by: "director", at: "2026-11-20T11:03:00Z", outcome: "fixed", result: entry.target })).toThrow(/its check requester\.check still fails .*needs-refresh/);
    writeFileSync(requester, slotBytes);
    expect(closeWork(made.consumer, fix.id, { by: "director", at: "2026-11-20T11:04:00Z", outcome: "fixed", result: entry.target })).toMatchObject({ status: "closed", outcome: "fixed" });
    expect(requestIssues(stays, made.root)).toEqual([]);
  });

  it("T18 (U7 r5, blind2 s2): one answer runs at a time, and its close is refused once the entry changed since the answer", { timeout: 60_000 }, async () => {
    const { made, entry } = await raised();
    const both = await Promise.allSettled([
      answerRequest(made.consumer, entry.id, { option: "decline", at: "2026-11-20T11:01:00Z", via: "cli", quote: "decline" }),
      answerRequest(made.consumer, entry.id, { option: "decline", at: "2026-11-20T11:01:00Z", via: "cli", quote: "decline" }),
    ]);
    expect(both.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(String((both.find(item => item.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/another answer to request .* is running .*nothing was written/);
    const second = await raised();
    // handoff writes its answered event, then a routed one: that answer is no longer the entry's last event, so a
    // close bound to it (the step closeWork runs under the entry's lock) is refused and writes nothing.
    expect((await answerRequest(second.made.consumer, second.entry.id, { option: "handoff", at: "2026-11-20T11:01:00Z", via: "cli", quote: "hand it over" })).request).toMatchObject({ status: "open", assignee: "director" });
    const file = second.file;
    const bytesNow = readFileSync(file, "utf8");
    const stale = readRequest(second.made.consumer, second.entry.id).events.find(event => event.op === "answered")!.id;
    expect(() => closeWork(second.made.consumer, second.entry.id, { by: `owner:queue.change#${second.entry.id}`, at: "2026-11-20T11:02:00Z", outcome: "declined", result: `queue.change#${second.entry.id}`, answered: stale })).toThrow(/changed since the answer/);
    expect(readFileSync(file, "utf8")).toBe(bytesNow);
  });

  it("T19 (U7 r5, blind1 s1): an unexpected error in the step is a failed step: a rejected event, never a bare throw", { timeout: 60_000 }, async () => {
    const { made, entry } = await raised();
    const ia = join(made.consumer, "agents/director/ia.json");
    writeFileSync(ia, "{ not json");
    const result = await answerRequest(made.consumer, entry.id, { option: "handoff", at: "2026-11-20T11:01:00Z", via: "cli", quote: "hand it over" });
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toMatch(/failed closure \(/);
    expect(readRequest(made.consumer, entry.id).events.at(-1)).toMatchObject({ op: "rejected", by: "producer", detail: expect.stringMatching(/failed \(closure\)/) });
  });
  it("T20 (U7 r7, B3): a fix raised on a refused pin verb (no gate verdict) re-runs the pin's rules and gate, stays open while they refuse and closes fixed once repaired", { timeout: 60_000 }, async () => {
    const { made, entry } = await raised(bytes => bytes);
    const pin = entry.options!.find(option => option.then.verb === "pin")!;
    // Another decision write holds the slot's write lock (a live owner, so never broken as stale): the pin verb refuses.
    const lock = join(made.consumer, DIRECTOR, SLOT_LOCK);
    mkdirSync(lock);
    writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, host: hostname(), at: Date.now() }));
    const result = await answerRequest(made.consumer, entry.id, { option: pin.id, at: "2026-11-20T11:02:00Z", via: "cli", quote: "pin that one" });
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toMatch(/failed pin \(pin refused: Slot is unavailable/);
    const fix = result.fix!;
    expect(fix).toMatchObject({ kind: "fix", check: "pin", assignee: "director", status: "open" });
    // Unrepaired, the assignee's fixed close re-runs the pin's rules and is refused; it is no claim for the owner.
    expect(() => closeWork(made.consumer, fix.id, { by: "director", at: "2026-11-20T11:03:00Z", outcome: "fixed", result: entry.target })).toThrow(/its check pin still fails .*write lock .* is held/);
    expect(readRequest(made.consumer, fix.id)).toMatchObject({ status: "open" });
    expect(readRequest(made.consumer, fix.id).events.some(event => event.op === "asked")).toBe(false);
    rmSync(lock, { recursive: true, force: true });
    const closed = closeWork(made.consumer, fix.id, { by: "director", at: "2026-11-20T11:04:00Z", outcome: "fixed", result: entry.target });
    expect(closed).toMatchObject({ status: "closed", outcome: "fixed" });
    expect(closed.events.find(event => event.op === "verified")?.detail).toMatch(/fix check pin passes on director\/focus\.reach\.geography/);
    expect(requestIssues(readRequest(made.consumer, fix.id), made.root)).toEqual([]);
    expect(FIX_CHECKS).toEqual(expect.arrayContaining(["pin", "closure"]));
  });

  it("T21 (U7 r7, final note and B3): after a pin applies, a held entry lock times out the close and the rejected event: the fix still records the failed step, and that closure fix closes fixed once the lock is gone", { timeout: 60_000 }, async () => {
    const { made, entry } = await raised(bytes => bytes);
    const pin = entry.options!.find(option => option.then.verb === "pin")!;
    const entryLock = requestLockPath(made.consumer, entry.id);
    // Another writer takes the entry's lock right after the pin is written, and keeps it.
    pinHook.after = () => writeFileSync(entryLock, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`);
    let result: Awaited<ReturnType<typeof answerRequest>>;
    try { result = await answerRequest(made.consumer, entry.id, { option: pin.id, at: "2026-11-20T11:02:00Z", via: "cli", quote: "pin that one" }); } finally { pinHook.after = undefined; }
    expect(result).toMatchObject({ ok: false });
    expect(JSON.parse(readFileSync(join(made.consumer, DIRECTOR, "pin.json"), "utf8"))).toMatchObject({ candidate: pin.then.args[1] });
    expect(result.message).toMatch(/failed closure \(pin director\/focus\.reach\.geography .* is applied .*locked by another writer.*no rejected event was written on queue\.change#/);
    // The entry could not take its rejected event (the lock is never broken): it stays open on the owner's answer.
    const stays = readRequest(made.consumer, entry.id);
    expect(stays).toMatchObject({ status: "open" });
    expect(stays.events.at(-1)).toMatchObject({ op: "answered", option: pin.id });
    const fix = result.fix!;
    expect(fix).toMatchObject({ kind: "fix", check: "closure", assignee: "director", status: "open" });
    expect(fix.refs).toContainEqual(expect.objectContaining({ to: "producer/queue.change", record: entry.id, rel: "cites" }));
    expect(JSON.stringify(readRequest(made.consumer, fix.id))).toMatch(/no rejected event was written on queue\.change#/);
    // The closure re-runs on the cited change: refused while the entry's lock is held, a pass once it is gone.
    expect(() => closeWork(made.consumer, fix.id, { by: "director", at: "2026-11-20T11:03:00Z", outcome: "fixed", result: entry.target })).toThrow(/its check closure still fails .*locked by another writer/);
    expect(readRequest(made.consumer, fix.id).events.some(event => event.op === "asked")).toBe(false);
    rmSync(entryLock, { force: true });
    const closed = closeWork(made.consumer, fix.id, { by: "director", at: "2026-11-20T11:04:00Z", outcome: "fixed", result: entry.target });
    expect(closed).toMatchObject({ status: "closed", outcome: "fixed" });
    expect(closed.events.find(event => event.op === "verified")?.detail).toMatch(/fix check closure passes on director\/focus\.reach\.geography/);
    expect(requestIssues(readRequest(made.consumer, fix.id), made.root)).toEqual([]);
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
