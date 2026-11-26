/**
 * foundry-build-0048 CP1-U2: the consumer owns its pages, and verb-written records carry their ladder rung.
 * (a) a default `clossys init` places no admin page, publication or release, seeds and pins nothing for one, and prints
 *     the admin starter as a suggestion (the `clossys ia publisher/...` calls);
 * (c) a `clossys seat` submit records rung adapt and the package-default seat (pipeline/seats.json) as its seed (G10);
 * (d) `clossys conform --consumer <dir>` refuses a directory that holds no agents/ (G18).
 * The opt-in seat (`--starters admin`: `<leaf>-v1.json` names, a ladder rung) is pinned in publish/install-admin.e2e.test.ts.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { jsonBytes } from "../records/slot-model/index.js";
// Load the CLI first, as every caller does: owner.ts sits in an import cycle with the pipeline handlers.
import "./main.js";
import { ADMIN_PUBLICATION_SLOT, adminPlan } from "./admin-plan.js";
import { CliUsageError } from "./args.js";
import { runConformCli } from "./conform.js";
import { runInitCli } from "./init.js";
import { runSeatCli } from "./owner.js";

const AT = "2026-11-25T09:00:00Z";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function workspace(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cp1-u2-")));
  roots.push(root);
  mkdirSync(join(root, "clossys"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
  return root;
}
const load = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

describe("(a) a default clossys init seats no admin starter and suggests it", { timeout: 120_000 }, () => {
  it("leaves no page.admin-* or publication.admin slot, no admin-v1 seed or pin, and prints the ia publisher/... calls", async () => {
    const root = workspace();
    const result = await runInitCli(["--at", AT], root);
    expect(result.exitCode, result.message).toBe(0);
    const publisher = join(root, "clossys", "agents", "publisher");
    // The Publisher IA is started (its loops adopted, as every init does), and holds no admin slot.
    expect(existsSync(join(publisher, "ia.json"))).toBe(true);
    const placed = readdirSync(publisher);
    expect(placed.filter(name => name.startsWith("page.admin-") || name === ADMIN_PUBLICATION_SLOT || name.startsWith("release."))).toEqual([]);
    const ia = JSON.stringify(load(join(publisher, "ia.json")));
    expect(ia).not.toMatch(/page\.admin-|publication\.admin/);
    const output = result.output as { admin: { seated: boolean; suggested: string[] } };
    expect(output.admin.seated).toBe(false);
    const plan = adminPlan(root);
    const slots = [...plan.pages.map(page => page.id), plan.publication];
    expect(output.admin.suggested).toHaveLength(slots.length);
    expect(result.message).toContain("seated no admin page, publication or release: the consumer owns its pages");
    expect(result.message).toContain("clossys init --starters admin seats it whole");
    for (const slot of slots) expect(result.message).toMatch(new RegExp(`clossys ia publisher/${slot.replace(/\./g, "\\.")} --kind (page|publication) `));
    // A second default init stays a no-op for the admin starter.
    const again = await runInitCli(["--at", "2026-11-25T10:00:00Z"], root);
    expect(again.exitCode, again.message).toBe(0);
    expect(readdirSync(publisher).filter(name => name.startsWith("page.admin-") || name === ADMIN_PUBLICATION_SLOT)).toEqual([]);
  });
});

describe("(c) a clossys seat submit records its ladder rung", { timeout: 120_000 }, () => {
  it("records rung adapt and the package-default seat as the seed", async () => {
    const root = workspace();
    const consumer = join(root, "clossys");
    writeFileSync(join(consumer, "owner-decisions.json"), jsonBytes({ schema: "clossys.owner-decisions/1", decisions: [] }));
    const result = await runSeatCli(["owner.decisions", "--by", "owner", "--decided-by", "planner:CP1-U2-fixture", "--no-llm", "--procedure", "Compare each slot's candidates against its contract and pin one.", "--command", "clossys pin", "--at", AT, "--root", root], root);
    expect(result.exitCode, result.message).toBe(0);
    const events = (load(join(consumer, "agents", "producer", "seat.owner.decisions", "ledger.json")) as { events: Record<string, unknown>[] }).events;
    const submits = events.filter(event => event.op === "submit");
    expect(submits).toHaveLength(1);
    expect(submits[0]).toMatchObject({ rung: "adapt", seed: "@clossys/producer:pipeline/seats.json#owner.decisions" });
  });
});

describe("(d) clossys conform --consumer refuses a directory with no agents/", () => {
  it("throws a usage error naming the missing agents/, before any report", async () => {
    const root = workspace();
    await expect(runConformCli(["--consumer", root], root)).rejects.toThrow(CliUsageError);
    await expect(runConformCli(["--consumer", root], root)).rejects.toThrow(/is not a consumer root: it has no agents\/ directory/);
  });
});
