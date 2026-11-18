/**
 * Producer's routing over the one queue (foundry-build-0048 U7): the data table, the route every queue-entry/2 gets,
 * owner classes read from loop `when` selectors, issuing edges, and change/fix entries that close with a link back.
 * Runs on a tmp copy of the consumer fixture; nothing outside it is written.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runRequestCli } from "../cli/request.js";
import { closeWork, legacyFixEntries, listRequests, raiseWork, readRequest, requestIssues } from "../records/request.js";
import { consumerFacts, ownerClassOf, readRoutingTable, rederive, routeEntry, routingIssues, routingText, type RoutingFacts } from "./routing.js";

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const AT = "2026-11-17T10:00:00Z";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "routing-")));
  roots.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  const consumer = join(root, "clossys");
  return { root, consumer, facts: consumerFacts(consumer) };
}
const table = () => JSON.parse(routingText()) as { rows: Record<string, unknown>[] } & Record<string, unknown>;
const route = (facts: RoutingFacts, kind: "fix" | "change" | "slot" | "pick", target: string) => routeEntry(facts, { kind, target, assignee: target.split("/")[0] as never });
const fixOf = (target: string, from = "owner") => ({
  kind: "fix" as const, target, from, why: "the hero overflows at 320px", source: "check" as const, by: "producer", at: AT,
  check: "render.overflow", findings: ["hero heading overflows at 320px"], cause: "the heading has no wrap rule",
});

describe("routing.json", () => {
  it("is valid: closed rows in order, one catch-all and it is last", () => {
    expect(routingIssues(table())).toEqual([]);
    const { table: read } = readRoutingTable();
    expect(read.rows.at(-1)).toMatchObject({ id: "catch-all", kinds: "*", match: "any", to: "owner-clarify" });
  });

  it("refuses a table without its catch-all (an unmatched entry would be dropped)", () => {
    const doc = table();
    doc.rows = doc.rows.filter(row => row.kinds !== "*");
    expect(routingIssues(doc).join("; ")).toMatch(/exactly one catch-all row/);
    expect(() => readRoutingTable(JSON.stringify(doc))).toThrow(/routing.json is refused/);
  });

  it("refuses a catch-all that is not last, and a second catch-all", () => {
    const doc = table();
    doc.rows = [doc.rows.at(-1)!, ...doc.rows.slice(0, -1)];
    expect(routingIssues(doc).join("; ")).toMatch(/catch-all row must be last/);
    const twice = table();
    twice.rows = [...twice.rows.slice(0, -1), { ...twice.rows.at(-1)!, id: "catch-all-2" }, twice.rows.at(-1)!];
    expect(routingIssues(twice).join("; ")).toMatch(/exactly one catch-all row/);
  });

  it("refuses an owner class copied into a row (owner classes are read from the loop versions)", () => {
    const doc = table();
    doc.rows[2] = { ...doc.rows[2]!, when: { ia: ["director"] } };
    expect(routingIssues(doc).join("; ")).toMatch(/unknown key when/);
    const slots = table();
    slots.rows[2] = { ...slots.rows[2]!, slots: ["writer/narratives.legal-document"] };
    expect(routingIssues(slots).join("; ")).toMatch(/unknown key slots/);
  });

  it("refuses an unknown match or destination, and a handler row without handling", () => {
    const doc = table();
    doc.rows[1] = { ...doc.rows[1]!, match: "guess" };
    doc.rows[3] = { id: "change.live", kinds: ["change"], match: "live", to: "handler" };
    const issues = routingIssues(doc).join("; ");
    expect(issues).toMatch(/rows\[1\]\.match must be one of/);
    expect(issues).toMatch(/rows\[3\]: a handler row names handling/);
  });
});

describe("routeEntry", () => {
  it("routes a fix on a live slot to its agent's declared fix handler", () => {
    const { facts } = world();
    expect(route(facts, "fix", "designer/sections.hero")).toMatchObject({ row: "fix.live", assignee: "designer", handler: { loop: "loop.create", skill: "packages/designer/actions/designer.candidates/skill.md" }, table: facts.sha });
  });

  it("routes an owner-class change or slot to the owner as an MC packet on the owning step's queue", () => {
    const { facts } = world();
    expect(ownerClassOf(facts, "director/focus.category.definition")).toMatchObject({ step: "owner-pick", queue: "queue.pick" });
    expect(route(facts, "change", "director/focus.category.definition")).toMatchObject({ row: "owner.class", assignee: "owner", packet: { queue: "queue.pick", step: "loop.choose/choose-v1#owner-pick", skill: "packages/director/actions/director.candidates/skill.md" } });
    expect(route(facts, "slot", "designer/themes.color")).toMatchObject({ row: "owner.class", assignee: "owner", packet: { queue: "queue.approve", step: "loop.choose/choose-v1#confirm" } });
    expect(route(facts, "change", "writer/narratives.legal-document")).toMatchObject({ row: "owner.class", assignee: "owner", packet: { queue: "queue.pick" } });
  });

  it("routes a live change and a homed slot need to the agent, a homeless slot need to its scope skill", () => {
    const { facts } = world();
    expect(route(facts, "change", "writer/narratives.article")).toMatchObject({ row: "change.live", assignee: "writer", handler: { loop: "loop.create" } });
    expect(route(facts, "slot", "writer/narratives.faq")).toMatchObject({ row: "slot.home", assignee: "writer", handler: { loop: "loop.slot", skill: "packages/writer/actions/writer.slot/skill.md" } });
    expect(route(facts, "slot", "publisher/page.home")).toMatchObject({ row: "slot.scope", assignee: "publisher", handler: { loop: "loop.scope" } });
  });

  it("keeps a decision kind with its decider", () => {
    const { facts } = world();
    expect(routeEntry(facts, { kind: "pick", target: "writer/narratives.article", assignee: "owner" })).toMatchObject({ row: "decision", assignee: "owner" });
  });

  it("sends what no row matches to the owner's queue.clarify, escalating package code", () => {
    const { facts } = world();
    expect(route(facts, "fix", "writer/narratives.faq")).toEqual({ row: "catch-all", table: facts.sha, assignee: "owner", packet: { queue: "queue.clarify" } });
    expect(route(facts, "fix", "producer/queue.fix")).toMatchObject({ row: "catch-all", assignee: "owner", escalate: "package" });
  });

  it("does not guess a handler an agent does not declare: the entry falls to the catch-all", () => {
    const { facts } = world();
    const bare: RoutingFacts = { ...facts, declarations: () => ({}) };
    expect(route(bare, "fix", "designer/sections.hero")).toMatchObject({ row: "catch-all", assignee: "owner" });
  });

  it("re-derives the recorded route: a moved route or another table is a mismatch", () => {
    const { facts } = world();
    const entry = { kind: "fix" as const, target: "designer/sections.hero", assignee: "designer" as const };
    const recorded = routeEntry(facts, entry);
    expect(rederive(facts, { ...entry, route: recorded })).toBeUndefined();
    expect(rederive(facts, { ...entry, route: { ...recorded, assignee: "writer" } })).toMatch(/differs from the table now/);
    expect(rederive(facts, { ...entry, route: { ...recorded, table: "0".repeat(64) } })).toMatch(/another routing.json/);
    expect(rederive(facts, entry)).toMatch(/has no route/);
  });
});

describe("kind change and fix entries", () => {
  it("raises a fix routed by the table into queue.fix, and closes it with its result and a notify back to from", () => {
    const { consumer, facts } = world();
    const { request, created } = raiseWork(consumer, fixOf("designer/sections.hero"), { facts });
    expect(created).toBe(true);
    expect(request).toMatchObject({ schema: "clossys.queue-entry/2", kind: "fix", from: "owner", assignee: "designer", status: "open", check: "render.overflow", cause: "the heading has no wrap rule" });
    expect(request.route).toMatchObject({ row: "fix.live", assignee: "designer" });
    expect(request.events.map(event => event.op)).toEqual(["raised", "routed"]);
    expect(existsSync(join(consumer, "agents/producer/queue.fix/entries", `${request.id}.json`))).toBe(true);
    expect(listRequests(consumer, "fix").map(read => read.request?.id)).toEqual([request.id]);
    expect(raiseWork(consumer, fixOf("designer/sections.hero"), { facts }).created).toBe(false);

    expect(() => closeWork(consumer, request.id, { by: "writer", at: AT, outcome: "fixed", result: "designer/sections.hero" })).toThrow(/assigned to designer/);
    expect(() => closeWork(consumer, request.id, { by: "designer", at: AT, outcome: "fixed", result: "designer/sections.nope" })).toThrow(/no placed slot/);
    const closed = closeWork(consumer, request.id, { by: "designer", at: AT, outcome: "fixed", result: "designer/sections.hero" });
    expect(closed).toMatchObject({ status: "closed", outcome: "fixed", result: "designer/sections.hero", notified: { to: "owner" }, closedAt: AT });
    expect(requestIssues(readRequest(consumer, request.id))).toEqual([]);
    const { outcome: _outcome, ...noOutcome } = closed;
    expect(requestIssues(noOutcome)).toEqual(expect.arrayContaining([expect.stringMatching(/needs outcome/)]));
    expect(requestIssues({ ...closed, notified: { to: "writer/narratives.article", at: AT } }).join("; ")).toMatch(/notifies its requester/);
  });

  it("needs a fix's check, findings and cause, and a change's want", () => {
    const { consumer, facts } = world();
    const fix = raiseWork(consumer, fixOf("designer/sections.hero"), { facts }).request;
    const { cause: _cause, ...noCause } = fix;
    expect(requestIssues(noCause).join("; ")).toMatch(/kind fix/);
    const change = raiseWork(consumer, { kind: "change", target: "writer/narratives.article", from: "owner", why: "tighten the intro", want: "candidate", source: "cli", by: "owner", at: AT }, { facts }).request;
    const { want: _want, ...noWant } = change;
    expect(requestIssues(noWant).join("; ")).toMatch(/want/);
  });

  it("refuses a cross-agent request the requester declares no issuing edge for", () => {
    const { consumer, facts } = world();
    // Writer declares change to Designer; Designer declares nothing to Writer, and Writer no fix to Designer.
    expect(raiseWork(consumer, { kind: "change", target: "designer/sections.hero", from: "writer/narratives.article", why: "the copy needs a wider column", want: "contract", source: "cli", by: "writer", at: AT }, { facts }).request).toMatchObject({ assignee: "designer", from: "writer/narratives.article" });
    expect(() => raiseWork(consumer, { kind: "change", target: "writer/narratives.article", from: "designer/sections.hero", why: "shorter copy", want: "candidate", source: "cli", by: "designer", at: AT }, { facts })).toThrow(/designer declares no issuing edge to writer for kind change/);
    expect(() => raiseWork(consumer, { ...fixOf("designer/sections.hero", "writer/narratives.article"), by: "writer" }, { facts })).toThrow(/writer declares no issuing edge to designer for kind fix/);
  });

  it("keeps a queue-entry/1 doc in queue.fix out of the /2 store and reports it as legacy", () => {
    const { consumer, facts } = world();
    const dir = join(consumer, "agents/producer/queue.fix/entries");
    const fix = raiseWork(consumer, fixOf("designer/sections.hero"), { facts }).request;
    writeFileSync(join(dir, "20261117T0900Z-legacy.json"), `${JSON.stringify({ schema: "clossys.queue-entry/1", id: "20261117T0900Z-legacy", queue: "queue.fix" })}\n`);
    expect(listRequests(consumer, "fix").map(read => read.request?.id)).toEqual([fix.id]);
    expect(legacyFixEntries(consumer)).toEqual(["20261117T0900Z-legacy"]);
  });
});

describe("clossys request --kind change|fix", () => {
  it("raises a routed fix and lists it by agent", async () => {
    const { root, consumer } = world();
    const raised = await runRequestCli(["--kind", "fix", "--subject", "designer/sections.hero", "--from", "owner", "--why", "the hero overflows", "--check", "render.overflow", "--findings", "overflows at 320px", "--cause", "no wrap rule", "--at", AT, "--root", root], root);
    expect(raised.exitCode, raised.message).toBe(0);
    expect(raised.message).toContain("route fix.live -> designer");
    const id = (raised.output as { id: string }).id;
    expect(JSON.parse(readFileSync(join(consumer, "agents/producer/queue.fix/entries", `${id}.json`), "utf8"))).toMatchObject({ kind: "fix", assignee: "designer" });
    const listed = await runRequestCli(["--list", "--open", "--agent", "designer", "--root", root], root);
    expect(listed.exitCode, listed.message).toBe(0);
    expect(listed.message).toContain(id);
  });

  it("refuses an undeclared edge and a fix without its cause", async () => {
    const { root } = world();
    const refused = await runRequestCli(["--kind", "change", "--subject", "writer/narratives.article", "--from", "designer/sections.hero", "--why", "shorter copy", "--want", "candidate", "--at", AT, "--root", root], root);
    expect(refused.exitCode).toBe(1);
    expect(refused.message).toMatch(/declares no issuing edge/);
    await expect(runRequestCli(["--kind", "fix", "--subject", "designer/sections.hero", "--from", "owner", "--why", "x", "--check", "render.overflow", "--findings", "a", "--root", root], root)).rejects.toThrow(/--check, --findings and --cause/);
  });
});
