/**
 * Producer's routing over the one queue (foundry-build-0048 U7): the data table, the route every queue-entry/2 gets,
 * owner classes read from loop `when` selectors, issuing edges, and change/fix entries that close with a link back.
 * Runs on a tmp copy of the consumer fixture; nothing outside it is written.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runRequestCli } from "../cli/request.js";
import { answerRequest, closeWork, legacyFixEntries, listRequests, raiseWork, readRequest, requestIssues } from "../records/request.js";
import { CONTENT_AGENTS } from "../records/request.js";
import { loopAnswers } from "../loop/names.js";
import { consumerFacts, ENTRY_KINDS, HandlerMismatchError, handlerMismatch, ownerClasses, ownerClassOf, readDeclarations, readRoutingTable, rederive, routeEntry, RoutingError, routingIssues, routingText, WORK_KINDS, type RoutingFacts } from "./routing.js";

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

  it("refuses a table where a change or slot row is reached before the owner-class row (row order is the rule)", () => {
    const doc = table();
    const at = doc.rows.findIndex(row => row.id === "owner.class");
    const owner = doc.rows[at]!;
    const rows = doc.rows.filter(row => row.id !== "owner.class");
    rows.splice(rows.findIndex(row => row.id === "change.live") + 1, 0, owner);
    doc.rows = rows;
    expect(routingIssues(doc).join("; ")).toMatch(/the first row for kind change must be the owner class row/);
    expect(() => readRoutingTable(JSON.stringify(doc))).toThrow(/routing.json is refused/);
    const slots = table();
    slots.rows = slots.rows.map(row => row.id === "owner.class" ? { ...row, kinds: ["change"] } : row);
    expect(routingIssues(slots).join("; ")).toMatch(/the first row for kind slot must be the owner class row/);
  });

  it("refuses to route when the owner classes cannot be read (missing loops, a loop that does not parse, no owner step)", () => {
    const { consumer } = world();
    const loops = realpathSync(mkdtempSync(join(tmpdir(), "routing-loops-")));
    roots.push(loops);
    expect(() => ownerClasses(join(loops, "missing"))).toThrow(/no loop versions at .*nothing routes/);
    expect(() => consumerFacts(consumer, { loopsDir: join(loops, "missing") })).toThrow(RoutingError);
    mkdirSync(join(loops, "loop.choose"), { recursive: true });
    expect(() => ownerClasses(loops)).toThrow(/hold no owner step scoped by ia or slots/);
    writeFileSync(join(loops, "loop.choose", "choose-v1.json"), "{ not json");
    expect(() => ownerClasses(loops)).toThrow(/choose-v1.json does not parse/);
    // A raise over a router that cannot read its owner classes is refused, never routed to an agent.
    const facts = consumerFacts(consumer);
    const unreadable = Object.defineProperty({ ...facts }, "classes", { get: () => { throw new RoutingError("the loop versions do not read"); } }) as RoutingFacts;
    expect(() => raiseWork(consumer, { kind: "change", target: "director/focus.segment.core", from: "owner", why: "narrow it", want: "repin", source: "cli", by: "owner", at: AT }, { facts: unreadable }))
      .toThrow(/the router refuses change director\/focus\.segment\.core: the loop versions do not read; nothing was written/);
    expect(listRequests(consumer, "change")).toEqual([]);
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

  it("routes a live change and a slot need in an agent's tree, homed or not, to the agent's handler that answers it", () => {
    const { facts } = world();
    expect(route(facts, "change", "writer/narratives.article")).toMatchObject({ row: "change.live", assignee: "writer", handler: { loop: "loop.create" } });
    expect(route(facts, "slot", "writer/narratives.faq")).toMatchObject({ row: "slot.home", assignee: "writer", handler: { loop: "loop.slot", skill: "packages/writer/actions/writer.slot/skill.md" } });
    // LOOP-STEPS (consumer-slot-request-route-handler-mismatch): a homeless slot need goes to loop.slot too, never to
    // loop.scope, which files needs and answers no entry.
    expect(route(facts, "slot", "publisher/page.home")).toMatchObject({ row: "slot.agent", assignee: "publisher", handler: { loop: "loop.slot", skill: "packages/publisher/actions/publisher.slot/skill.md" } });
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
  it("raises a fix routed by the table into queue.fix; a close re-runs the requester check and refuses on a fail", async () => {
    const { root, consumer, facts } = world();
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
    // A fixed close re-runs the fix's own check; render.overflow is not one Producer re-runs, so the claim asks the
    // owner (U7 r4): decline or keep-open, never fixed, and the entry stays open with designer.
    const claimed = closeWork(consumer, request.id, { by: "designer", at: AT, outcome: "fixed", result: "designer/sections.hero" });
    expect(claimed).toMatchObject({ asked: true, status: "open", assignee: "designer", options: [{ id: "decline" }, { id: "keep-open" }] });
    expect(readRequest(consumer, request.id).events.map(event => event.op)).toEqual(["raised", "routed", "asked"]);
    // While the owner is asked, no seat closes it; the owner's typed answer decline runs closeWork by the entry's ref.
    expect(() => closeWork(consumer, request.id, { by: "designer", at: AT, outcome: "fixed", result: "designer/sections.hero" })).toThrow(/awaits the owner's answer \(decline, keep-open\)/);
    const answered = await answerRequest(consumer, request.id, { option: "decline", at: AT, via: "chat", quote: "decline it" });
    // U7 r5 (blind2 s4): decline runs no requester check. The fixture's hero has no pin and no package default, so
    // a requester check would fail here; the decline still closes declined, with no verified event.
    expect(answered).toMatchObject({ ok: true });
    expect(answered.fix).toBeUndefined();
    const after = readRequest(consumer, request.id);
    expect(after).toMatchObject({ status: "closed", outcome: "declined" });
    expect(after.events.map(event => event.op)).toEqual(["raised", "routed", "asked", "answered", "closed"]);
    expect(requestIssues(after, root)).toEqual([]);
  });

  it("refuses a closure the event log does not back (a forged close)", () => {
    const { consumer, facts } = world();
    // A check Producer re-runs (pins.resolve), so the assignee's fixed close is one closeWork could write.
    const open = { ...raiseWork(consumer, fixOf("designer/sections.hero"), { facts }).request, check: "pins.resolve" };
    const at = "2026-11-17T11:00:00Z";
    const closing = { status: "closed" as const, outcome: "fixed" as const, result: "designer/sections.hero", notified: { to: "owner", at }, closedAt: at };
    const verified = { id: `${open.id}#3`, at, op: "verified" as const, by: "producer", detail: "requester check passed on designer/sections.hero; fix check pins.resolve passes on designer/sections.hero", inputsSha256: "0".repeat(64) };
    const close = { id: `${open.id}#4`, at, op: "closed" as const, by: "designer" };
    const honest = { ...open, ...closing, closed: close.id, events: [...open.events, verified, close] };
    expect(requestIssues(honest)).toEqual([]);
    // U7 r3: the verified event carries the inputs' digest, and the closer keeps the closure rule.
    const { inputsSha256: _hash, ...unhashed } = verified;
    expect(requestIssues({ ...honest, events: [...open.events, unhashed, close] }).join("; ")).toMatch(/carries no inputsSha256 \(64 hex\)/);
    expect(requestIssues({ ...honest, events: [...open.events, { ...verified, inputsSha256: "x" }, close] }).join("; ")).toMatch(/inputsSha256 must match/);
    expect(requestIssues({ ...honest, events: [...open.events, verified, { ...close, by: "producer" }] }).join("; ")).toMatch(/the close by producer: it is assigned to designer/);
    expect(requestIssues({ ...honest, outcome: "declined" }).join("; ")).toMatch(/the assignee closes a fix only as fixed/);
    expect(requestIssues({ ...honest, check: "render.overflow" }).join("; ")).toMatch(/not one Producer re-runs: it never closes fixed/);
    // `closed` points at the raise, not at a close event.
    expect(requestIssues({ ...honest, closed: open.opened }).join("; ")).toMatch(/is a raised event, not the closed event/);
    // Status closed with no closed event in the log.
    expect(requestIssues({ ...open, ...closing, closed: open.opened }).join("; ")).toMatch(/the status is closed and the event log has no closed event/);
    // No producer verified event before the close: the requester check never ran.
    expect(requestIssues({ ...honest, events: [...open.events, close] }).join("; ")).toMatch(/no producer verified event \(its requester check passing\) before its close/);
    // Open, yet the log or the fields say closed.
    expect(requestIssues({ ...open, events: [...open.events, verified, close] }).join("; ")).toMatch(/close the entry, but its status is open/);
    expect(requestIssues({ ...open, outcome: "fixed" }).join("; ")).toMatch(/close the entry, but its status is open/);
    // The notify goes back to from, never elsewhere.
    expect(requestIssues({ ...honest, notified: { to: "writer/narratives.article", at } }).join("; ")).toMatch(/notifies its requester/);
    const { outcome: _outcome, ...noOutcome } = honest;
    expect(requestIssues(noOutcome)).toEqual(expect.arrayContaining([expect.stringMatching(/needs outcome/)]));
    // opened names the raised event.
    expect(requestIssues({ ...open, opened: `${open.id}#2` }).join("; ")).toMatch(/is a routed event, not the raised event/);
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

describe("every route answers its entry (foundry-build-0048 LOOP-STEPS)", () => {
  const AGENTS = CONTENT_AGENTS;
  it("gives every row of the table a destination that answers each kind it routes, for every content agent", () => {
    const { table: read } = readRoutingTable();
    for (const row of read.rows) {
      const kinds = row.kinds === "*" ? ENTRY_KINDS : row.kinds;
      for (const kind of kinds) {
        if (row.to === "handler") {
          // A handler row routes only the kind it handles, and every agent's declared handler for it answers it.
          expect(kind, `${row.id} routes ${kind} to a ${row.handling} handler`).toBe(row.handling);
          for (const agent of AGENTS) {
            const handler = readDeclarations(agent)?.requests?.handling?.[row.handling!];
            expect(handler, `${agent} declares requests.handling.${row.handling}`).toBeDefined();
            expect(loopAnswers(handler!.loop, kind), `${row.id}: ${agent}'s ${row.handling} handler ${handler!.loop} answers a kind ${kind} entry`).toBe(true);
          }
        } else {
          // Every other destination is a decider or the owner, never a loop that would answer nothing.
          expect(["owner-packet", "decider", "owner-clarify"], `${row.id} -> ${row.to}`).toContain(row.to);
        }
      }
    }
  });

  it("routes every work kind on every agent's tree to a handler that answers it, or to the owner", () => {
    const { facts } = world();
    const targets: Record<string, string> = { director: "director/identity.brand.essence", designer: "designer/sections.hero", writer: "writer/narratives.article", publisher: "publisher/page.home" };
    for (const agent of AGENTS) for (const kind of WORK_KINDS) for (const target of [targets[agent]!, `${agent}/nohome.new-need`]) {
      const routed = route(facts, kind, target);
      if (routed.handler) expect(loopAnswers(routed.handler.loop, kind), `${kind} ${target} -> ${routed.row} ${routed.handler.loop}`).toBe(true);
      else expect(routed.assignee, `${kind} ${target} -> ${routed.row}`).toBe("owner");
    }
  });

  it("refuses a handler row that routes another kind than it handles, and the scope destination", () => {
    const doc = table();
    doc.rows = doc.rows.map(row => row.id === "slot.agent" ? { ...row, handling: "change" } : row);
    expect(routingIssues(doc).join("; ")).toMatch(/a handler row routes only the kind it handles/);
    const scope = table();
    scope.rows = scope.rows.map(row => row.id === "slot.agent" ? { id: "slot.agent", kinds: ["slot"], match: "agent", to: "scope" } : row);
    expect(routingIssues(scope).join("; ")).toMatch(/rows\[\d+\]\.to must be one of handler, owner-packet, decider, owner-clarify/);
  });

  it("refuses with a HandlerMismatchError a declared handler whose loop does not answer the kind", () => {
    const { facts } = world();
    const scoped: RoutingFacts = { ...facts, declarations: agent => {
      const declared = facts.declarations(agent)!;
      return { ...declared, requests: { ...declared.requests!, handling: { ...declared.requests!.handling, slot: { skill: `packages/${agent}/actions/${agent}.scope/skill.md`, loop: "loop.scope" } } } };
    } };
    expect(() => route(scoped, "slot", "publisher/page.home")).toThrow(HandlerMismatchError);
    expect(() => route(scoped, "slot", "publisher/page.home")).toThrow(/does not answer a kind slot entry/);
  });

  it("names why a loop may not answer a routed entry", () => {
    const { facts } = world();
    const routed = route(facts, "slot", "publisher/page.home");
    expect(handlerMismatch("loop.slot", "slot", routed)).toBeUndefined();
    expect(handlerMismatch("loop.scope", "slot", routed)).toMatch(/loop.scope does not answer a kind slot entry/);
    expect(handlerMismatch("loop.slot", "slot", { ...routed, handler: { skill: "packages/publisher/actions/publisher.scope/skill.md", loop: "loop.scope" } })).toMatch(/to loop.scope .*not loop.slot/);
    expect(handlerMismatch("loop.slot", "slot", { row: "owner.class", assignee: "owner" })).toMatch(/to no handler/);
    expect(handlerMismatch("loop.slot", "change", routed)).toMatch(/does not answer a kind change entry/);
  });
});
