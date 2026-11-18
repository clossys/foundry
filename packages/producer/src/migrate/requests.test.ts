/**
 * `clossys migrate requests` (foundry-build-0048 U8, Q1) on a temp copy of `test-fixtures/consumer`: Director REQ and
 * Designer NEED records become clossys.queue-entry/2 entries in Producer's queue (fix, change or slot by placement and
 * kind), closed records are removed, a finding refuses the whole apply, and a second run plans nothing. Round 1
 * (B1): a record that dedupes onto open work is a planned merge whose whole content lands in that entry as a raised
 * event, so no record is ever lost; agent records are the agent's, not the owner's; links are never followed.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrateCli } from "../cli/migrate.js";
import { raiseFeedback } from "../queue/feedback.js";
import { listWorkEntries, RequestError } from "../records/request.js";
import type { SlotRequest } from "../records/types.js";
import { applyRequestMigration, MERGED_NOTE, planRequestMigration } from "./requests.js";

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
  return { root, consumer, put };
}
const req = (id: string, fields: Record<string, unknown> = {}) => ({ id, raisedBy: "owner", kind: "missing", cells: [PLACED_CELL], detail: "the pricing cell names no tier", status: "open", opened: "2026-10-01", resolvedBy: null, ...fields });
const need = (id: string, fields: Record<string, unknown> = {}) => ({
  id, raisedBy: "src/Page.tsx#Page", missing: "Widget capability", kind: "slot", status: "proposed", candidate: { library: "shadcn@aria", slotId: "components.widget", reason: "React Aria candidate" },
  evidence: [{ file: "src/Page.tsx", line: 1, code: "DF5" }], createdBy: "dogfood-check", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", closedBy: null, ...fields,
});
const DIRECTOR = "agents/director/requests";
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

  it("maps Director and Designer records to queue-entry/2 entries by kind and placement, removes closed ones, and is idempotent", async () => {
    const { root, consumer, put } = world();
    put(`${DIRECTOR}/REQ-0001.json`, req("REQ-0001", { kind: "contradiction", detail: "pricing contradicts the promise" }));
    put(`${DIRECTOR}/REQ-0002.json`, req("REQ-0002", { cells: [PLACED_CELL, OPEN_CELL], status: "drafted" }));
    put(`${DIRECTOR}/REQ-0003.json`, req("REQ-0003", { status: "resolved", resolvedBy: "cell:advantage.model.pricing" }));
    put(`${DESIGNER}/NEED-001.json`, need("NEED-001"));
    put(`${DESIGNER}/NEED-002.json`, need("NEED-002", { raisedBy: PLACED_DESIGNER, missing: "a dark variant", candidate: { library: "starter", slotId: PLACED_DESIGNER, reason: "repaint" } }));
    put(`${DESIGNER}/NEED-003.json`, need("NEED-003", { status: "closed", closedBy: "abc123" }));
    const before = entries(consumer).length;

    const plan = planRequestMigration(consumer, AT);
    expect(plan.findings).toEqual([]);
    expect(plan.records.map(record => [record.file, record.raises.map(raise => `${raise.kind} ${raise.target} from ${raise.from}`)])).toEqual([
      ["agents/designer/library/needs/NEED-001.json", ["slot designer/components.widget from owner"]],
      ["agents/designer/library/needs/NEED-002.json", [`change designer/${PLACED_DESIGNER} from designer/${PLACED_DESIGNER}`]],
      ["agents/designer/library/needs/NEED-003.json", []],
      ["agents/director/requests/REQ-0001.json", [`fix director/${PLACED_CELL} from owner`]],
      ["agents/director/requests/REQ-0002.json", [`change director/${PLACED_CELL} from owner`, `slot director/${OPEN_CELL} from owner`]],
      ["agents/director/requests/REQ-0003.json", []],
    ]);
    expect(entries(consumer)).toHaveLength(before); // a plan writes nothing

    const applied = applyRequestMigration(consumer, plan, AT);
    expect(applied.removed).toHaveLength(6);
    expect(existsSync(join(consumer, DIRECTOR))).toBe(false);
    expect(existsSync(join(consumer, DESIGNER))).toBe(false);
    const raised = entries(consumer).filter(entry => entry.createdAt === AT);
    expect(raised).toHaveLength(5);
    expect(raised.every(entry => entry.schema === "clossys.queue-entry/2" && entry.status === "open" && entry.source === "cli")).toBe(true);
    expect(raised.every(entry => entry.createdBy && "cli" in entry.createdBy && entry.createdBy.cli === "clossys migrate requests")).toBe(true);
    const fix = raised.find(entry => entry.kind === "fix")!;
    expect(fix).toMatchObject({ target: `director/${PLACED_CELL}`, check: "director.contradiction", findings: ["pricing contradicts the promise"], cause: "REQ-0001 (raised by owner, opened 2026-10-01)" });
    expect(raised.find(entry => entry.target === "designer/components.widget")).toMatchObject({ kind: "slot", why: "src/Page.tsx#Page needs Widget capability" });
    expect(raised.find(entry => entry.target === `designer/${PLACED_DESIGNER}`)).toMatchObject({ kind: "change", want: "candidate", from: `designer/${PLACED_DESIGNER}` });
    expect(raised.find(entry => entry.target === `director/${PLACED_CELL}` && entry.kind === "change")).toMatchObject({ want: "candidate", why: "missing: the pricing cell names no tier (migrated from REQ-0002)" });

    // A second run: nothing left to migrate, nothing raised again.
    const again = await runMigrateCli(["requests", "--apply", "--at", AT, "--root", root], root);
    expect(again.exitCode).toBe(0);
    expect(again.message).toContain("0 legacy record(s) migrated");
    expect(entries(consumer).filter(entry => entry.createdAt === AT)).toHaveLength(5);
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
    put(`${DIRECTOR}/REQ-0003.json`, req("REQ-0003", { kind: "tripwire", raisedBy: "agent:writer", detail: "the copy promises a free tier" }));
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
    expect(merged.events[2]).toMatchObject({ op: "raised", by: "producer", via: "cli", detail: `tripwire: the copy promises a free tier (migrated from REQ-0003, raised by agent:writer)${MERGED_NOTE}REQ-0003, ${DIRECTOR}/REQ-0003.json)` });
    expectNothingLost(consumer, [
      { id: "REQ-0001", texts: ["the pricing cell names no tier"] }, { id: "REQ-0002", texts: ["pricing drifted from the interview"] }, { id: "REQ-0003", texts: ["the copy promises a free tier"] },
    ]);
    expect(planRequestMigration(consumer, AT)).toEqual({ records: [], merges: [], kept: [], findings: [] });
  });

  it("repro B: two contradictions on a placed cell keep both findings (the second merged into the fix with its check, findings and cause)", () => {
    const { consumer, put } = world();
    put(`${DIRECTOR}/REQ-0001.json`, req("REQ-0001", { kind: "contradiction", raisedBy: "critic", detail: "first contradiction" }));
    put(`${DIRECTOR}/REQ-0002.json`, req("REQ-0002", { kind: "contradiction", raisedBy: "critic", detail: "second contradiction", opened: "2026-10-02" }));
    const plan = planRequestMigration(consumer, AT);
    expect(plan.findings).toEqual([]);
    expect(plan.merges.map(merge => `${merge.file} ${merge.kind} into ${merge.into}`)).toEqual([`${DIRECTOR}/REQ-0002.json fix into new entry from ${DIRECTOR}/REQ-0001.json`]);
    applyRequestMigration(consumer, plan, AT);
    const fixes = entries(consumer).filter(entry => entry.kind === "fix" && entry.createdAt === AT);
    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toMatchObject({ from: `director/${PLACED_CELL}`, findings: ["first contradiction"], cause: "REQ-0001 (raised by critic, opened 2026-10-01)" });
    expect(fixes[0]!.events.at(-1)!.detail).toBe(`contradiction: second contradiction (migrated from REQ-0002, raised by critic)${MERGED_NOTE}REQ-0002, ${DIRECTOR}/REQ-0002.json; check director.contradiction; findings: second contradiction; cause: REQ-0002 (raised by critic, opened 2026-10-02))`);
    expectNothingLost(consumer, [{ id: "REQ-0001", texts: ["first contradiction"] }, { id: "REQ-0002", texts: ["second contradiction", "REQ-0002 (raised by critic, opened 2026-10-02)"] }]);
    expect(existsSync(join(consumer, DIRECTOR))).toBe(false);
  });

  it("repro C: two Designer needs on one unplaced slot keep both whys, each linkable as dogfood's needWhy", () => {
    const { consumer, put } = world();
    put(`${DESIGNER}/NEED-001.json`, need("NEED-001", { raisedBy: "src/A.tsx#A" }));
    put(`${DESIGNER}/NEED-002.json`, need("NEED-002", { raisedBy: "src/B.tsx#B" }));
    const plan = planRequestMigration(consumer, AT);
    expect(plan.findings).toEqual([]);
    expect(plan.merges).toEqual([{ file: `${DESIGNER}/NEED-002.json`, kind: "slot", target: "designer/components.widget", from: "owner", into: `new entry from ${DESIGNER}/NEED-001.json` }]);
    applyRequestMigration(consumer, plan, AT);
    const slots = entries(consumer).filter(entry => entry.target === "designer/components.widget");
    expect(slots).toHaveLength(1);
    expect(slots[0]!.why).toBe("src/A.tsx#A needs Widget capability");
    const merged = slots[0]!.events.filter(event => event.op === "raised").slice(1).map(event => event.detail!.slice(0, event.detail!.lastIndexOf(MERGED_NOTE)));
    expect(merged).toEqual(["src/B.tsx#B needs Widget capability"]);
    expectNothingLost(consumer, [{ texts: ["src/A.tsx#A needs Widget capability"] }, { id: "NEED-002", texts: ["src/B.tsx#B needs Widget capability"] }]);
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
    expect(dry.message).toContain(`${DIRECTOR}/REQ-0001.json -> change director/${PLACED_CELL} from owner (merge into queue.change#${feedback.request.id})`);
    expect(dry.message).toContain("1 merge(s)");
    const cli = await runMigrateCli(["requests", "--apply", "--at", AT, "--root", root], root);
    expect(cli.exitCode).toBe(0);
    expect(cli.message).toContain(`${DIRECTOR}/REQ-0001.json -> queue.change#${feedback.request.id} (merged: its content is raised event ${feedback.request.id}#3)`);
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
