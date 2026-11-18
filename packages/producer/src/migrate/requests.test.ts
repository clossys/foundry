/**
 * `clossys migrate requests` (foundry-build-0048 U8, Q1) on a temp copy of `test-fixtures/consumer`: Director REQ and
 * Designer NEED records become clossys.queue-entry/2 entries in Producer's queue (fix, change or slot by placement and
 * kind), closed records are removed, a finding refuses the whole apply, and a second run plans nothing.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrateCli } from "../cli/migrate.js";
import { listWorkEntries, RequestError } from "../records/request.js";
import { applyRequestMigration, planRequestMigration } from "./requests.js";

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

describe("clossys migrate requests", () => {
  it("plans nothing on a consumer with no legacy store", () => {
    const { consumer } = world();
    expect(planRequestMigration(consumer, AT)).toEqual({ records: [], kept: [], findings: [] });
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
});
