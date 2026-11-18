/**
 * `clossys migrate requests` (foundry-build-0048 U8, Q1) on a temp copy of `test-fixtures/consumer`: Director REQ and
 * Designer NEED records become clossys.queue-entry/2 entries in Producer's queue (fix, change or slot by placement and
 * kind), closed records are removed, a finding refuses the whole apply, and a second run plans nothing. Round 1
 * (B1): a record that dedupes onto open work is a planned merge whose whole content lands in that entry as a raised
 * event, so no record is ever lost; agent records are the agent's, not the owner's; links are never followed. Round 2:
 * an agent's slot entry is from its citing slot (never the owner's), every raise carries the whole record, status maps
 * to open or a gated close, and apply's realpath guard, verify and sync are each pinned, with a crash and a rerun.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrateCli } from "../cli/migrate.js";
import { MIGRATED_RAISE_NOTE, raiseWhyOf } from "@clossys/director";
import { runFeedbackCli } from "../cli/feedback.js";
import { FeedbackRefused, raiseFeedback, raiseFeedbackOrRequest } from "../queue/feedback.js";
import { listWorkEntries, readRequest, RequestError } from "../records/request.js";
import type { SlotRequest } from "../records/types.js";
import { applyRequestMigration, planRequestMigration, recordDetail } from "./requests.js";

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const AT = "2026-11-18T09:00:00Z";
const PLACED_CELL = "advantage.model.pricing";
const OPEN_CELL = "advantage.model.unit-economics";
const PLACED_DESIGNER = "assets.favicon";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "migrate-requests-")));
  roots.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  const consumer = join(root, "clossys");
  const put = (rel: string, doc: unknown) => { mkdirSync(dirname(join(consumer, rel)), { recursive: true }); writeFileSync(join(consumer, rel), typeof doc === "string" ? doc : `${JSON.stringify(doc, null, 2)}\n`); };
  /** Adds a ref to a fixture slot's own refs (a temp copy): the slot then cites `to` with `rel`. */
  const cite = (from: string, to: string, rel: "input" | "uses" = "input") => {
    const file = join(consumer, "agents", ...from.split("/"), "slot.json");
    const doc = JSON.parse(readFileSync(file, "utf8")) as { refs: { to: string; rel: string }[] };
    doc.refs.push({ to, rel });
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  };
  return { root, consumer, put, cite };
}
const req = (id: string, fields: Record<string, unknown> = {}) => ({ id, raisedBy: "owner", kind: "missing", cells: [PLACED_CELL], detail: "the pricing cell names no tier", status: "open", opened: "2026-10-01", resolvedBy: null, ...fields });
const need = (id: string, fields: Record<string, unknown> = {}) => ({
  id, raisedBy: "src/Page.tsx#Page", missing: "Widget capability", kind: "slot", status: "proposed", candidate: { library: "shadcn@aria", slotId: "components.widget", reason: "React Aria candidate" },
  evidence: [{ file: "src/Page.tsx", line: 1, code: "DF5" }], createdBy: "dogfood-check", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", closedBy: null, ...fields,
});
const DIRECTOR = "agents/director/requests";
/** The Designer slot and the Director cell the tests cite the unplaced needs from. */
const CITING_DESIGNER = "designer/sections.hero";
const CITING_CELL = `director/${PLACED_CELL}`;
const WIDGET = "designer/components.widget";
/** A placed Designer slot whose change routes to Designer itself (the fixture's Director cells and assets.favicon are
 * owner-class) and whose requester check passes (it resolves), so a built need on it closes changed through the gates. */
const BUTTON = "frames.deck";
const DESIGNER = "agents/designer/library/needs";
const entries = (consumer: string) => listWorkEntries(consumer).flatMap(read => read.request ? [read.request] : []);
/** Everything the queue says: each entry's why, findings and cause, and every raised event's detail. */
const queueText = (consumer: string) => entries(consumer).flatMap((entry: SlotRequest) => [entry.why, ...(entry.findings ?? []), entry.cause ?? "", ...entry.events.filter(event => event.op === "raised").map(event => event.detail ?? "")]).join("\n");
/** No record lost: each of its texts is in the queue, and its id where it names one (a Designer need's new entry keeps dogfood's exact why). */
function expectNothingLost(consumer: string, records: readonly { id?: string; texts: readonly string[] }[]) {
  const all = queueText(consumer);
  for (const record of records) {
    if (record.id) expect(all).toContain(record.id);
    for (const each of record.texts) expect(all).toContain(each);
  }
}

describe("clossys migrate requests", () => {
  it("plans nothing on a consumer with no legacy store", () => {
    const { consumer } = world();
    expect(planRequestMigration(consumer, AT)).toEqual({ records: [], merges: [], kept: [], findings: [] });
  });

  it("maps Director and Designer records to queue-entry/2 entries by kind, placement and status, and is idempotent", async () => {
    const { root, consumer, put, cite } = world();
    cite(CITING_DESIGNER, WIDGET, "uses");
    put(`${DIRECTOR}/REQ-0001.json`, req("REQ-0001", { kind: "contradiction", detail: "pricing contradicts the promise" }));
    put(`${DIRECTOR}/REQ-0002.json`, req("REQ-0002", { cells: [PLACED_CELL, OPEN_CELL], status: "drafted" }));
    put(`${DESIGNER}/NEED-003.json`, need("NEED-003", { status: "built", missing: "a pressed state", candidate: { library: "shadcn@aria", slotId: BUTTON, reason: "pressed" } }));
    put(`${DESIGNER}/NEED-001.json`, need("NEED-001"));
    put(`${DESIGNER}/NEED-002.json`, need("NEED-002", { raisedBy: PLACED_DESIGNER, missing: "a dark variant", candidate: { library: "starter", slotId: PLACED_DESIGNER, reason: "repaint" } }));
    const before = entries(consumer).length;

    const plan = planRequestMigration(consumer, AT);
    expect(plan.findings).toEqual([]);
    // The done record (built) comes first; the rest keep their read order.
    expect(plan.records.map(record => [record.file, record.raises.map(raise => `${raise.kind} ${raise.target} from ${raise.from}${raise.close ? ` closes ${raise.close}` : ""}`)])).toEqual([
      ["agents/designer/library/needs/NEED-003.json", [`change designer/${BUTTON} from designer/${BUTTON} closes changed`]],
      ["agents/designer/library/needs/NEED-001.json", [`slot ${WIDGET} from ${CITING_DESIGNER}`]],
      ["agents/designer/library/needs/NEED-002.json", [`change designer/${PLACED_DESIGNER} from designer/${PLACED_DESIGNER}`]],
      ["agents/director/requests/REQ-0001.json", [`fix director/${PLACED_CELL} from owner`]],
      ["agents/director/requests/REQ-0002.json", [`change director/${PLACED_CELL} from owner`, `slot director/${OPEN_CELL} from owner`]],
    ]);
    expect(entries(consumer)).toHaveLength(before); // a plan writes nothing

    const applied = applyRequestMigration(consumer, plan, AT);
    expect(applied.removed).toHaveLength(5);
    expect(existsSync(join(consumer, DIRECTOR))).toBe(false);
    expect(existsSync(join(consumer, DESIGNER))).toBe(false);
    const raised = entries(consumer).filter(entry => entry.createdAt === AT);
    expect(raised).toHaveLength(6);
    expect(raised.every(entry => entry.schema === "clossys.queue-entry/2" && entry.source === "cli")).toBe(true);
    expect(raised.every(entry => entry.createdBy && "cli" in entry.createdBy && entry.createdBy.cli === "clossys migrate requests")).toBe(true);
    expect(raised.filter(entry => entry.status === "closed").map(entry => `${entry.why} ${entry.outcome}`)).toEqual(["src/Page.tsx#Page needs a pressed state changed"]);
    const fix = raised.find(entry => entry.kind === "fix")!;
    expect(fix).toMatchObject({ status: "open", target: `director/${PLACED_CELL}`, check: "director.contradiction", findings: ["pricing contradicts the promise"], cause: "REQ-0001 (raised by owner, opened 2026-10-01)" });
    expect(raised.find(entry => entry.target === WIDGET)).toMatchObject({ kind: "slot", from: CITING_DESIGNER, rel: "uses", why: "src/Page.tsx#Page needs Widget capability" });
    expect(raised.find(entry => entry.target === `designer/${PLACED_DESIGNER}`)).toMatchObject({ kind: "change", want: "candidate", from: `designer/${PLACED_DESIGNER}` });
    expect(raised.find(entry => entry.target === `director/${PLACED_CELL}` && entry.kind === "change" && entry.status === "open")).toMatchObject({ want: "candidate", why: "missing: the pricing cell names no tier (migrated from REQ-0002)" });

    // A second run: nothing left to migrate, nothing raised again.
    const again = await runMigrateCli(["requests", "--apply", "--at", AT, "--root", root], root);
    expect(again.exitCode).toBe(0);
    expect(again.message).toContain("0 legacy record(s) migrated");
    expect(entries(consumer).filter(entry => entry.createdAt === AT)).toHaveLength(6);
  });

  it("a finding refuses the whole apply and writes nothing", async () => {
    const { root, consumer, put } = world();
    put(`${DIRECTOR}/REQ-0001.json`, req("REQ-0001"));
    put(`${DESIGNER}/NEED-001.json`, need("NEED-001", { candidate: null, status: "open" }));
    put(`${DESIGNER}/NEED-002.json`, "{");
    put(`${DIRECTOR}/REQ-0002.json`, req("REQ-0003"));
    put(`${DIRECTOR}/notes.txt`, "kept");
    const before = entries(consumer).length;
    const plan = planRequestMigration(consumer, AT);
    expect(plan.findings.map(finding => finding.file)).toEqual([
      "agents/designer/library/needs/NEED-001.json", "agents/designer/library/needs/NEED-002.json", "agents/director/requests/REQ-0002.json",
    ]);
    expect(plan.findings[0]!.message).toContain("names no candidate slot");
    expect(plan.kept).toEqual(["agents/director/requests/notes.txt"]);
    expect(() => applyRequestMigration(consumer, plan, AT)).toThrow(RequestError);
    const cli = await runMigrateCli(["requests", "--apply", "--at", AT, "--root", root], root);
    expect(cli.exitCode).toBe(1);
    expect(cli.message).toContain("finding: agents/designer/library/needs/NEED-001.json");
    expect(entries(consumer)).toHaveLength(before);
    expect(readdirSync(join(consumer, DIRECTOR)).sort()).toEqual(["REQ-0001.json", "REQ-0002.json", "notes.txt"]);
    expect(readFileSync(join(consumer, `${DESIGNER}/NEED-002.json`), "utf8")).toBe("{");
  });

  it("a raise the queue refuses is a finding", () => {
    const { consumer, put } = world();
    // Writer declares no issuing edge to Director for kind fix: the router refuses the contradiction it raised.
    put(`${DIRECTOR}/REQ-0001.json`, req("REQ-0001", { raisedBy: "writer/sections.article.copy", kind: "contradiction" }));
    const plan = planRequestMigration(consumer, AT);
    expect(plan.records).toEqual([]);
    expect(plan.findings).toEqual([{ file: "agents/director/requests/REQ-0001.json", message: expect.stringContaining(`fix director/${PLACED_CELL}: writer declares no issuing edge to director for kind fix`) }]);
  });

  it("--check exits 1 while a legacy record remains and writes nothing; --apply with --check is a usage error", async () => {
    const { root, consumer, put } = world();
    put(`${DIRECTOR}/REQ-0001.json`, req("REQ-0001"));
    const checked = await runMigrateCli(["requests", "--check", "--at", AT, "--root", root], root);
    expect(checked.exitCode).toBe(1);
    expect(checked.message).toContain(`agents/director/requests/REQ-0001.json -> change director/${PLACED_CELL} from owner`);
    expect(existsSync(join(consumer, `${DIRECTOR}/REQ-0001.json`))).toBe(true);
    expect((await runMigrateCli(["requests", "--check", "--apply", "--root", root], root)).exitCode).toBe(2);
    expect((await runMigrateCli(["requests", "--at", "yesterday", "--root", root], root)).exitCode).toBe(2);
    expect((await runMigrateCli(["requests", "--apply", "--at", AT, "--root", root], root)).exitCode).toBe(0);
    expect((await runMigrateCli(["requests", "--check", "--root", root], root)).exitCode).toBe(0);
  });
  it("repro A: two Director requests on one cell lose nothing (owner and agent raisers apart, two agent raisers merged)", () => {
    const { consumer, put } = world();
    put(`${DIRECTOR}/REQ-0001.json`, req("REQ-0001", { detail: "the pricing cell names no tier" }));
    put(`${DIRECTOR}/REQ-0002.json`, req("REQ-0002", { kind: "drift", raisedBy: "interview", detail: "pricing drifted from the interview" }));
    const third = req("REQ-0003", { kind: "tripwire", raisedBy: "agent:writer", detail: "the copy promises a free tier" });
    put(`${DIRECTOR}/REQ-0003.json`, third);
    const plan = planRequestMigration(consumer, AT);
    expect(plan.findings).toEqual([]);
    expect(plan.records.flatMap(record => record.raises.map(raise => `${record.id} ${raise.kind} ${raise.target} from ${raise.from}${raise.into ? ` into ${raise.into}` : ""}`))).toEqual([
      `REQ-0001 change director/${PLACED_CELL} from owner`,
      `REQ-0002 change director/${PLACED_CELL} from director/${PLACED_CELL}`,
      `REQ-0003 change director/${PLACED_CELL} from director/${PLACED_CELL} into new entry from ${DIRECTOR}/REQ-0002.json`,
    ]);
    expect(plan.merges).toEqual([{ file: `${DIRECTOR}/REQ-0003.json`, kind: "change", target: `director/${PLACED_CELL}`, from: `director/${PLACED_CELL}`, into: `new entry from ${DIRECTOR}/REQ-0002.json` }]);
    const applied = applyRequestMigration(consumer, plan, AT);
    expect(applied.removed).toHaveLength(3);
    const changes = entries(consumer).filter(entry => entry.createdAt === AT);
    expect(changes.map(entry => entry.from).sort()).toEqual([`director/${PLACED_CELL}`, "owner"]);
    const merged = changes.find(entry => entry.from !== "owner")!;
    expect(merged.why).toBe("drift: pricing drifted from the interview (migrated from REQ-0002, raised by interview)");
    expect(applied.raised[2]).toMatchObject({ created: false, entry: `queue.change#${merged.id}`, event: `${merged.id}#3` });
    const why = "tripwire: the copy promises a free tier (migrated from REQ-0003, raised by agent:writer)";
    expect(merged.events[2]).toMatchObject({ op: "raised", by: "producer", via: "cli", detail: `${why}${MIGRATED_RAISE_NOTE}REQ-0003, ${DIRECTOR}/REQ-0003.json; record ${JSON.stringify(third)})` });
    expect(raiseWhyOf(merged.events[2]!.detail!)).toBe(why);
    expectNothingLost(consumer, [
      { id: "REQ-0001", texts: ["the pricing cell names no tier"] }, { id: "REQ-0002", texts: ["pricing drifted from the interview"] }, { id: "REQ-0003", texts: ["the copy promises a free tier"] },
    ]);
    expect(planRequestMigration(consumer, AT)).toEqual({ records: [], merges: [], kept: [], findings: [] });
  });

  it("repro B: two contradictions on a placed cell keep both findings (the second merged into the fix with its check, findings and cause)", () => {
    const { consumer, put } = world();
    put(`${DIRECTOR}/REQ-0001.json`, req("REQ-0001", { kind: "contradiction", raisedBy: "critic", detail: "first contradiction" }));
    const second = req("REQ-0002", { kind: "contradiction", raisedBy: "critic", detail: "second contradiction", opened: "2026-10-02" });
    put(`${DIRECTOR}/REQ-0002.json`, second);
    const plan = planRequestMigration(consumer, AT);
    expect(plan.findings).toEqual([]);
    expect(plan.merges.map(merge => `${merge.file} ${merge.kind} into ${merge.into}`)).toEqual([`${DIRECTOR}/REQ-0002.json fix into new entry from ${DIRECTOR}/REQ-0001.json`]);
    applyRequestMigration(consumer, plan, AT);
    const fixes = entries(consumer).filter(entry => entry.kind === "fix" && entry.createdAt === AT);
    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toMatchObject({ from: `director/${PLACED_CELL}`, findings: ["first contradiction"], cause: "REQ-0001 (raised by critic, opened 2026-10-01)" });
    expect(fixes[0]!.events.at(-1)!.detail).toBe(`contradiction: second contradiction (migrated from REQ-0002, raised by critic)${MIGRATED_RAISE_NOTE}REQ-0002, ${DIRECTOR}/REQ-0002.json; check director.contradiction; findings: second contradiction; cause: REQ-0002 (raised by critic, opened 2026-10-02); record ${JSON.stringify(second)})`);
    expectNothingLost(consumer, [{ id: "REQ-0001", texts: ["first contradiction"] }, { id: "REQ-0002", texts: ["second contradiction", "REQ-0002 (raised by critic, opened 2026-10-02)"] }]);
    expect(existsSync(join(consumer, DIRECTOR))).toBe(false);
  });

  it("repro C: two Designer needs on one unplaced slot keep both whys, each linkable as dogfood's needWhy", () => {
    const { consumer, put, cite } = world();
    cite(CITING_DESIGNER, WIDGET, "uses");
    put(`${DESIGNER}/NEED-001.json`, need("NEED-001", { raisedBy: "src/A.tsx#A" }));
    put(`${DESIGNER}/NEED-002.json`, need("NEED-002", { raisedBy: "src/B.tsx#B" }));
    const plan = planRequestMigration(consumer, AT);
    expect(plan.findings).toEqual([]);
    expect(plan.merges).toEqual([{ file: `${DESIGNER}/NEED-002.json`, kind: "slot", target: WIDGET, from: CITING_DESIGNER, into: `new entry from ${DESIGNER}/NEED-001.json` }]);
    applyRequestMigration(consumer, plan, AT);
    const slots = entries(consumer).filter(entry => entry.target === WIDGET);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.why).toBe("src/A.tsx#A needs Widget capability");
    expect(slots[0]!.events.filter(event => event.op === "raised").map(event => raiseWhyOf(event.detail!))).toEqual(["src/A.tsx#A needs Widget capability", "src/B.tsx#B needs Widget capability"]);
    expectNothingLost(consumer, [{ id: "NEED-001", texts: ["src/A.tsx#A needs Widget capability"] }, { id: "NEED-002", texts: ["src/B.tsx#B needs Widget capability"] }]);
  });

  it("merges a record into an entry already open before the run, and the owner's feedback still files beside an agent's record", async () => {
    const { root, consumer, put } = world();
    const feedback = raiseFeedback(root, { ref: `director/${PLACED_CELL}`, words: "the price reads too high", via: "cli" }, new Date("2026-11-17T08:00:00Z"));
    expect(feedback.created).toBe(true);
    put(`${DIRECTOR}/REQ-0001.json`, req("REQ-0001", { detail: "the pricing cell names no tier" }));
    put(`${DIRECTOR}/REQ-0002.json`, req("REQ-0002", { kind: "reading", raisedBy: "interview", detail: "the founder reads pricing as optional" }));
    const plan = planRequestMigration(consumer, AT);
    expect(plan.merges).toEqual([{ file: `${DIRECTOR}/REQ-0001.json`, kind: "change", target: `director/${PLACED_CELL}`, from: "owner", into: `queue.change#${feedback.request.id}` }]);
    const dry = await runMigrateCli(["requests", "--at", AT, "--root", root], root);
    expect(dry.message).toContain(`${DIRECTOR}/REQ-0001.json -> change director/${PLACED_CELL} from owner (into queue.change#${feedback.request.id})`);
    expect(dry.message).toContain("1 merge(s)");
    const cli = await runMigrateCli(["requests", "--apply", "--at", AT, "--root", root], root);
    expect(cli.exitCode).toBe(0);
    expect(cli.message).toContain(`${DIRECTOR}/REQ-0001.json -> queue.change#${feedback.request.id} (its record is raised event ${feedback.request.id}#3)`);
    const open = entries(consumer).find(entry => entry.id === feedback.request.id)!;
    expect(open.why).toBe("the price reads too high");
    expect(open.events.map(event => event.op)).toEqual(["raised", "routed", "raised"]);
    expectNothingLost(consumer, [{ id: "REQ-0001", texts: ["the pricing cell names no tier"] }, { id: "REQ-0002", texts: ["the founder reads pricing as optional"] }]);
    // The interview's record is Director's (from the cell itself), so the owner's own words are no "open change" of theirs.
    const agents = entries(consumer).find(entry => entry.why.includes("REQ-0002"))!;
    expect(agents.from).toBe(`director/${PLACED_CELL}`);
    expect(raiseFeedback(root, { ref: `director/${PLACED_CELL}`, words: "the price reads too high", via: "cli" }, new Date("2026-11-18T10:00:00Z"))).toMatchObject({ created: false, request: { id: feedback.request.id } });
  });

  it("an agent-raised record never blocks the owner's own feedback on that cell", () => {
    const { root, consumer, put } = world();
    put(`${DIRECTOR}/REQ-0001.json`, req("REQ-0001", { raisedBy: "interview", detail: "pricing drifted" }));
    put(`${DESIGNER}/NEED-001.json`, need("NEED-001", { missing: "a dark variant", candidate: { library: "starter", slotId: PLACED_DESIGNER, reason: "repaint" } }));
    applyRequestMigration(consumer, planRequestMigration(consumer, AT), AT);
    expect(entries(consumer).filter(entry => entry.createdAt === AT).map(entry => `${entry.kind} ${entry.target} from ${entry.from}`).sort()).toEqual([
      `change designer/${PLACED_DESIGNER} from designer/${PLACED_DESIGNER}`, `change director/${PLACED_CELL} from director/${PLACED_CELL}`,
    ]);
    for (const ref of [`director/${PLACED_CELL}`, `designer/${PLACED_DESIGNER}`]) {
      expect(raiseFeedback(root, { ref, words: "make it plainer", via: "cli" }, new Date("2026-11-18T10:00:00Z"))).toMatchObject({ created: true, request: { from: "owner", why: "make it plainer" } });
    }
  });

  // Round 2, final review B1: the final reviewer's two repros (scratchpad u8/repro.test.ts), now pinned the other way.
  it("final repro (Designer): an agent's need on an unplaced slot is filed from its citing Designer slot, and the owner's feedback files its own entry", async () => {
    const { root, consumer, put, cite } = world();
    put(`${DESIGNER}/NEED-001.json`, need("NEED-001"));
    // No Designer slot cites the need: the record is the Designer's, never the owner's, so it is a finding, not an owner entry.
    const uncited = planRequestMigration(consumer, AT);
    expect(uncited.records).toEqual([]);
    expect(uncited.findings).toEqual([{ file: `${DESIGNER}/NEED-001.json`, message: expect.stringContaining(`no placed designer slot cites it; the record is designer's (raised by src/Page.tsx#Page), never the owner's`) }]);
    cite(CITING_DESIGNER, WIDGET, "uses");
    const plan = planRequestMigration(consumer, AT);
    expect(plan.findings).toEqual([]);
    applyRequestMigration(consumer, plan, AT);
    const migrated = entries(consumer).find(entry => entry.target === WIDGET)!;
    expect(migrated).toMatchObject({ kind: "slot", from: CITING_DESIGNER, rel: "uses", refs: [{ to: CITING_DESIGNER, rel: "raisedBy" }] });
    const result = raiseFeedbackOrRequest(root, { ref: WIDGET, words: "OWNER WORDS make it a combobox", via: "cli" }, new Date("2026-11-18T10:00:00Z"));
    expect(result).toMatchObject({ created: true, request: { from: "owner", why: "OWNER WORDS make it a combobox" } });
    expect(queueText(consumer)).toContain("OWNER WORDS");
    expect((await runFeedbackCli([WIDGET, "OWNER WORDS make it a combobox", "--via", "cli", "--root", root], root, new Date("2026-11-18T11:00:00Z"))).exitCode).toBe(0);
  });

  it("final repro (Director): an agent's request on an unplaced cell is filed from its citing Director cell, and the owner's feedback files its own entry", () => {
    const { root, consumer, put, cite } = world();
    put(`${DIRECTOR}/REQ-0001.json`, { id: "REQ-0001", raisedBy: "interview", kind: "missing", cells: [OPEN_CELL], detail: "unit economics unknown", status: "open", opened: "2026-10-01", resolvedBy: null });
    expect(planRequestMigration(consumer, AT).findings).toEqual([{ file: `${DIRECTOR}/REQ-0001.json`, message: expect.stringContaining("no placed director slot cites it") }]);
    cite(CITING_CELL, `director/${OPEN_CELL}`);
    const plan = planRequestMigration(consumer, AT);
    expect(plan.findings).toEqual([]);
    expect(plan.records.flatMap(record => record.raises.map(raise => `${raise.kind} ${raise.target} from ${raise.from}`))).toEqual([`slot director/${OPEN_CELL} from ${CITING_CELL}`]);
    applyRequestMigration(consumer, plan, AT);
    const result = raiseFeedbackOrRequest(root, { ref: `director/${OPEN_CELL}`, words: "OWNER WORDS drop this cell", via: "cli" }, new Date("2026-11-18T10:00:00Z"));
    expect(result).toMatchObject({ created: true, request: { from: "owner", why: "OWNER WORDS drop this cell" } });
    expect(queueText(consumer)).toContain("OWNER WORDS");
  });

  it("the owner's words on an open owner entry someone else raised, or with other words, are refused out loud (exit 1), never 'already open'", async () => {
    const { root, consumer, put } = world();
    // The owner's own legacy request on an unplaced cell: migrated from the owner, but raised by code.
    put(`${DIRECTOR}/REQ-0001.json`, req("REQ-0001", { cells: [OPEN_CELL], detail: "unit economics unknown" }));
    applyRequestMigration(consumer, planRequestMigration(consumer, AT), AT);
    const migrated = entries(consumer).find(entry => entry.target === `director/${OPEN_CELL}`)!;
    expect(migrated).toMatchObject({ kind: "slot", from: "owner", createdBy: { actor: "code", cli: "clossys migrate requests" } });
    const before = JSON.stringify(entries(consumer));
    const words = { ref: `director/${OPEN_CELL}`, words: "OWNER WORDS drop this cell", via: "cli" as const };
    expect(() => raiseFeedbackOrRequest(root, words, new Date("2026-11-18T10:00:00Z"))).toThrow(FeedbackRefused);
    expect(() => raiseFeedbackOrRequest(root, words, new Date("2026-11-18T10:00:00Z"))).toThrow(`queue.slot#${migrated.id} is already open on director/${OPEN_CELL} from the owner, raised by code (clossys migrate requests)`);
    // Even the very words of the migrated why are not the owner's own entry.
    expect(() => raiseFeedbackOrRequest(root, { ...words, words: migrated.why }, new Date("2026-11-18T10:00:00Z"))).toThrow(FeedbackRefused);
    const cli = await runFeedbackCli([words.ref, words.words, "--via", "cli", "--root", root], root, new Date("2026-11-18T10:00:00Z"));
    expect(cli.exitCode).toBe(1);
    expect(cli.message).toContain("feedback refused:");
    expect(JSON.stringify(entries(consumer))).toBe(before);
    // The owner's own slot entry: the same words are returned, other words refused.
    const own = raiseFeedbackOrRequest(root, { ref: "director/advantage.model.payback", words: "add a payback cell", via: "cli" }, new Date("2026-11-18T10:00:00Z"));
    expect(own.created).toBe(true);
    expect(raiseFeedbackOrRequest(root, { ref: "director/advantage.model.payback", words: "add a payback cell", via: "cli" }, new Date("2026-11-18T11:00:00Z"))).toMatchObject({ created: false, request: { id: own.request.id } });
    expect(() => raiseFeedbackOrRequest(root, { ref: "director/advantage.model.payback", words: "other words", via: "cli" }, new Date("2026-11-18T11:00:00Z"))).toThrow(`queue.slot#${own.request.id} already holds the owner's open slot on director/advantage.model.payback`);
  });

  it("loses no field: every new and merged raise carries its whole record, and a second identical need records its id", () => {
    const { consumer, put } = world();
    const first = need("NEED-001", { missing: "a dark variant", candidate: { library: "starter", slotId: PLACED_DESIGNER, reason: "repaint" }, evidence: [{ file: "src/Logo.tsx", line: 7, code: "DF5" }] });
    const twin = need("NEED-002", { missing: "a dark variant", candidate: { library: "shadcn@aria", slotId: PLACED_DESIGNER, reason: "aria twin" }, evidence: [{ file: "src/Footer.tsx", line: 3, code: "DF6" }], kind: "member" });
    const director = req("REQ-0001", { raisedBy: "interview", opened: "2026-09-30", detail: "pricing drifted" });
    put(`${DESIGNER}/NEED-001.json`, first);
    put(`${DESIGNER}/NEED-002.json`, twin);
    put(`${DIRECTOR}/REQ-0001.json`, director);
    const plan = planRequestMigration(consumer, AT);
    expect(plan.findings).toEqual([]);
    expect(plan.merges.map(merge => merge.file)).toEqual([`${DESIGNER}/NEED-002.json`]);
    applyRequestMigration(consumer, plan, AT);
    const change = entries(consumer).find(entry => entry.target === `designer/${PLACED_DESIGNER}`)!;
    const details = change.events.filter(event => event.op === "raised").map(event => event.detail);
    expect(details).toEqual([
      recordDetail({ kind: "change", target: `designer/${PLACED_DESIGNER}`, from: `designer/${PLACED_DESIGNER}`, why: "src/Page.tsx#Page needs a dark variant", legacy: "proposed" }, { id: "NEED-001", file: `${DESIGNER}/NEED-001.json` }, first),
      recordDetail({ kind: "change", target: `designer/${PLACED_DESIGNER}`, from: `designer/${PLACED_DESIGNER}`, why: "src/Page.tsx#Page needs a dark variant", legacy: "proposed" }, { id: "NEED-002", file: `${DESIGNER}/NEED-002.json` }, twin),
    ]);
    const records = details.map(detail => JSON.parse(detail!.slice(detail!.indexOf("; record ") + 9, -1)) as Record<string, unknown>);
    expect(records).toEqual([first, twin]); // evidence, candidate library and reason, need kind and status: all of it
    const cell = entries(consumer).find(entry => entry.target === `director/${PLACED_CELL}`)!;
    expect(cell.events[0]!.detail).toContain(`; record ${JSON.stringify(director)})`);
    expect(cell.events[0]!.detail).toContain('"opened":"2026-09-30","resolvedBy":null');
  });

  it("maps status faithfully: a built need closes changed through the close gates; approved, a closed slot and a done record the owner answers are findings, never open work", () => {
    const { consumer, put, cite } = world();
    cite(CITING_DESIGNER, WIDGET, "uses");
    const built = need("NEED-001", { status: "built", missing: "a pressed state", candidate: { library: "shadcn@aria", slotId: BUTTON, reason: "pressed" } });
    put(`${DESIGNER}/NEED-001.json`, built);
    put(`${DESIGNER}/NEED-002.json`, need("NEED-002", { status: "approved" }));
    put(`${DESIGNER}/NEED-003.json`, need("NEED-003", { status: "closed", closedBy: "abc123" }));
    // A built need on a slot that does not resolve: the requester check the close runs fails, so it never closes changed.
    put(`${DESIGNER}/NEED-004.json`, need("NEED-004", { status: "built", missing: "a pressed state", candidate: { library: "shadcn@aria", slotId: "components.button", reason: "pressed" } }));
    put(`${DIRECTOR}/REQ-0001.json`, req("REQ-0001", { status: "resolved", resolvedBy: "cell:advantage.model.pricing", raisedBy: "interview" }));
    put(`${DIRECTOR}/REQ-0002.json`, req("REQ-0002", { status: "resolved", resolvedBy: "msg:2026-10-29-1#U7", cells: [OPEN_CELL] }));
    put(`${DIRECTOR}/REQ-0003.json`, req("REQ-0003", { status: "declined" }));
    const plan = planRequestMigration(consumer, AT);
    expect(plan.findings).toEqual([
      { file: `${DESIGNER}/NEED-002.json`, message: expect.stringMatching(/^is approved by the owner: an approval never comes back as open work/) },
      { file: `${DESIGNER}/NEED-003.json`, message: expect.stringMatching(new RegExp(`^slot ${WIDGET}: the record is closed, but a slot entry closes only by its signed decision`)) },
      { file: `${DESIGNER}/NEED-004.json`, message: expect.stringMatching(/^change designer\/components\.button: the record is built, but the requester check fails now \(designer\/components\.button: does not resolve/) },
      { file: `${DIRECTOR}/REQ-0001.json`, message: expect.stringMatching(new RegExp(`^change director/${PLACED_CELL}: the record is resolved, but the router assigns it to owner`)) },
      { file: `${DIRECTOR}/REQ-0002.json`, message: expect.stringMatching(new RegExp(`^slot director/${OPEN_CELL}: the record is resolved, but a slot entry closes only`)) },
      { file: `${DIRECTOR}/REQ-0003.json`, message: expect.stringMatching(new RegExp(`^change director/${PLACED_CELL}: the record is declined, but the router assigns it to owner`)) },
    ]);
    expect(plan.findings[3]!.message).toContain("assigns it to owner, so only the owner's own typed answer closes it, and the migration never writes the owner's answer");
    expect(plan.records.map(record => record.raises.map(raise => `${record.id} ${raise.kind} ${raise.target} closes ${raise.close}`))).toEqual([[`NEED-001 change designer/${BUTTON} closes changed`]]);
    expect(() => applyRequestMigration(consumer, plan, AT)).toThrow(RequestError);
    expect(entries(consumer).filter(entry => entry.createdAt === AT)).toEqual([]);
    for (const file of [`${DESIGNER}/NEED-002`, `${DESIGNER}/NEED-003`, `${DESIGNER}/NEED-004`, `${DIRECTOR}/REQ-0001`, `${DIRECTOR}/REQ-0002`, `${DIRECTOR}/REQ-0003`]) rmSync(join(consumer, `${file}.json`));
    applyRequestMigration(consumer, planRequestMigration(consumer, AT), AT);
    const closed = entries(consumer).filter(entry => entry.createdAt === AT);
    expect(closed.map(entry => `${entry.target} ${entry.from} ${entry.assignee} ${entry.status} ${entry.outcome}`)).toEqual([`designer/${BUTTON} designer/${BUTTON} designer closed changed`]);
    expect(closed[0]!.events.map(event => event.op)).toEqual(["raised", "routed", "verified", "closed"]);
    expect(closed[0]!.events[0]!.detail).toContain(`; record ${JSON.stringify(built)})`);
  });

  it("removes a legacy file only at its own real path: a store swapped for a link after the plan is kept, and nothing outside is removed", () => {
    const { root, consumer, put } = world();
    put(`${DIRECTOR}/REQ-0001.json`, req("REQ-0001"));
    const plan = planRequestMigration(consumer, AT);
    expect(plan.findings).toEqual([]);
    // After the plan, the store folder becomes a link to a copy outside the consumer: the record path still reads as a file.
    const outside = join(root, "elsewhere", "requests");
    mkdirSync(dirname(outside), { recursive: true });
    renameSync(join(consumer, DIRECTOR), outside);
    symlinkSync(outside, join(consumer, DIRECTOR));
    expect(() => applyRequestMigration(consumer, plan, AT)).toThrow("outside its own path in the consumer; it is kept");
    expect(existsSync(join(outside, "REQ-0001.json"))).toBe(true);
  });

  it("re-reads every entry from disk before a legacy file goes: a write the queue does not hold keeps the file", () => {
    const { consumer, put } = world();
    put(`${DIRECTOR}/REQ-0001.json`, req("REQ-0001"));
    const plan = planRequestMigration(consumer, AT);
    // A lost write: the re-read finds the entry without the record's raised event.
    const reread = (at: string, id: string) => { const stored = readRequest(at, id); return { ...stored, events: stored.events.filter(event => event.op !== "raised") }; };
    expect(() => applyRequestMigration(consumer, plan, AT, { reread })).toThrow("after the write; it is kept");
    expect(existsSync(join(consumer, `${DIRECTOR}/REQ-0001.json`))).toBe(true);
  });

  it("syncs every entry a record became to disk before that record's file goes", () => {
    const { consumer, put } = world();
    put(`${DIRECTOR}/REQ-0001.json`, req("REQ-0001", { cells: [PLACED_CELL, "advantage.model.margin"] }));
    put(`${DIRECTOR}/REQ-0002.json`, req("REQ-0002", { raisedBy: "interview" }));
    const synced: string[] = [];
    const sync = (file: string) => {
      expect(existsSync(file)).toBe(true);
      const record = synced.length < 2 ? "REQ-0001" : "REQ-0002";
      expect(existsSync(join(consumer, `${DIRECTOR}/${record}.json`))).toBe(true); // the source is still there
      synced.push(file);
    };
    const applied = applyRequestMigration(consumer, planRequestMigration(consumer, AT), AT, { sync });
    expect(synced).toHaveLength(3);
    expect(synced.map(file => file.slice(file.lastIndexOf("/") + 1, -5))).toEqual(applied.raised.map(row => row.entry.split("#")[1]));
  });

  it("a crash mid-apply and a rerun lose and duplicate nothing", { timeout: 60_000 }, () => {
    const { consumer, put, cite } = world();
    cite(CITING_DESIGNER, WIDGET, "uses");
    put(`${DESIGNER}/NEED-002.json`, need("NEED-002", { status: "built", missing: "a pressed state", candidate: { library: "shadcn@aria", slotId: BUTTON, reason: "pressed" } }));
    put(`${DIRECTOR}/REQ-0002.json`, req("REQ-0002", { cells: [PLACED_CELL, "advantage.model.margin"], detail: "two cells" }));
    put(`${DIRECTOR}/REQ-0003.json`, req("REQ-0003", { raisedBy: "interview", detail: "merged later" }));
    put(`${DIRECTOR}/REQ-0004.json`, req("REQ-0004", { raisedBy: "critic", detail: "merged into it" }));
    put(`${DESIGNER}/NEED-001.json`, need("NEED-001"));
    const plan = planRequestMigration(consumer, AT);
    expect(plan.findings).toEqual([]);
    const total = plan.records.reduce((sum, record) => sum + record.raises.length, 0);
    expect(total).toBe(6);
    for (let stop = 1; stop <= total; stop++) {
      const run = world();
      run.cite(CITING_DESIGNER, WIDGET, "uses");
      cpSync(join(consumer, "agents/director/requests"), join(run.consumer, DIRECTOR), { recursive: true });
      cpSync(join(consumer, DESIGNER), join(run.consumer, DESIGNER), { recursive: true });
      // The process dies at the stop-th sync: everything before it is on disk, the record it belongs to is not removed.
      let calls = 0;
      const crash = () => { if (++calls === stop) throw new Error("crash"); };
      expect(() => applyRequestMigration(run.consumer, planRequestMigration(run.consumer, AT), AT, { sync: crash })).toThrow("crash");
      const rerun = planRequestMigration(run.consumer, AT);
      expect(rerun.findings).toEqual([]);
      applyRequestMigration(run.consumer, rerun, AT);
      expect(planRequestMigration(run.consumer, AT)).toEqual({ records: [], merges: [], kept: [], findings: [] });
      const migrated = entries(run.consumer).filter(entry => entry.createdAt === AT);
      const details = migrated.flatMap(entry => entry.events.filter(event => event.op === "raised").map(event => `${entry.target} ${event.detail!}`));
      // A record on two cells is two raises with one detail: each (target, detail) is carried exactly once.
      for (const record of plan.records) for (const raise of record.raises) expect(details.filter(detail => detail === `${raise.target} ${raise.detail}`), `stop ${stop}`).toHaveLength(1);
      expect(details).toHaveLength(total);
      expect(migrated.map(entry => `${entry.kind} ${entry.target} ${entry.from} ${entry.status}`).sort()).toEqual([
        `change designer/${BUTTON} designer/${BUTTON} closed`, "change director/advantage.model.margin owner open",
        `change director/${PLACED_CELL} director/${PLACED_CELL} open`, `change director/${PLACED_CELL} owner open`, `slot ${WIDGET} ${CITING_DESIGNER} open`,
      ]);
    }
  });

  it("validates every entry the plan would write whole: a raise with no free id is a finding, before anything is written", () => {
    const { consumer, put } = world();
    put(`${DIRECTOR}/REQ-0001.json`, req("REQ-0001"));
    const base = "20261118T0900Z-change-advantage-model-pricing";
    for (const id of [base, ...[2, 3, 4, 5, 6, 7, 8, 9].map(n => `${base}-${n}`)]) put(`agents/producer/queue.change/entries/${id}.json`, "{}");
    const plan = planRequestMigration(consumer, AT);
    expect(plan.records).toEqual([]);
    expect(plan.findings).toEqual([{ file: `${DIRECTOR}/REQ-0001.json`, message: expect.stringContaining("the id and its suffixes -2..-9 are all taken") }]);
    expect(() => applyRequestMigration(consumer, plan, AT)).toThrow(RequestError);
    expect(existsSync(join(consumer, `${DIRECTOR}/REQ-0001.json`))).toBe(true);
  });

  it("follows no link: a linked store or record is a finding and nothing outside the consumer is read or removed", async () => {
    const { root, consumer, put } = world();
    const outside = join(root, "elsewhere", "needs");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "NEED-001.json"), JSON.stringify(need("NEED-001")));
    mkdirSync(join(consumer, "agents/designer/library"), { recursive: true });
    symlinkSync(outside, join(consumer, DESIGNER));
    put(`${DIRECTOR}/REQ-0001.json`, req("REQ-0001"));
    symlinkSync(join(outside, "NEED-001.json"), join(consumer, `${DIRECTOR}/REQ-0002.json`));
    const plan = planRequestMigration(consumer, AT);
    expect(plan.findings.map(finding => finding.file)).toEqual([DESIGNER, "../elsewhere/needs", `${DIRECTOR}/REQ-0002.json`]);
    expect(plan.findings[0]!.message).toContain("symbolic link");
    expect(plan.findings[1]!.message).toContain("store outside clossys/");
    expect(plan.findings[2]!.message).toContain("no regular file");
    expect((await runMigrateCli(["requests", "--apply", "--at", AT, "--root", root], root)).exitCode).toBe(1);
    expect(existsSync(join(outside, "NEED-001.json"))).toBe(true);
    expect(existsSync(join(consumer, `${DIRECTOR}/REQ-0001.json`))).toBe(true);
  });

  it("a legacy store outside clossys/ is a finding, so --check does not pass over it", async () => {
    const { root, consumer, put } = world();
    mkdirSync(join(root, "design/library/needs"), { recursive: true });
    writeFileSync(join(root, "design/library/needs/NEED-001.json"), JSON.stringify(need("NEED-001")));
    mkdirSync(join(root, "node_modules/pkg/needs"), { recursive: true });
    writeFileSync(join(root, "node_modules/pkg/needs/NEED-001.json"), "{}");
    const plan = planRequestMigration(consumer, AT);
    expect(plan.findings).toEqual([{ file: "../design/library/needs", message: expect.stringContaining("a designer needs/ store outside clossys/") }]);
    const checked = await runMigrateCli(["requests", "--check", "--root", root], root);
    expect(checked.exitCode).toBe(1);
    expect(checked.message).toContain("finding: ../design/library/needs:");
    expect(existsSync(join(root, "design/library/needs/NEED-001.json"))).toBe(true);
    void put;
  });
});
