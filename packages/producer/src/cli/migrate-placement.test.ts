/**
 * `clossys migrate placement` on a temp copy of `test-fixtures/consumer` (the fixture stays byte-identical): a placed
 * slot whose ledger records no reuse-or-create decision gets one create event with the overlaps placementOverlaps finds
 * (the slot itself excluded); a slot that already records one is left byte-equal; a second --apply writes nothing;
 * --check exits 1 while any slot is pending.
 */
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { placementOverlaps } from "../records/request.js";
import { readSlot, readSlotEntry } from "../records/slots.js";
import { isPlacementDecision } from "../migrate/placement.js";
import { runMigrateCli } from "./migrate.js";

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const AT = "2026-11-23T00:00:00Z";
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function copy(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "migrate-placement-")));
  roots.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  return root;
}
const ledgerFile = (root: string, agent: string, id: string) => join(root, "clossys", "agents", agent, id, "ledger.json");
const events = (root: string, agent: string, id: string) => JSON.parse(readFileSync(ledgerFile(root, agent, id), "utf8")).events as Record<string, unknown>[];
/** Drops the slot's placement decision events (test setup on the temp copy), so the slot reads as placed before SLOT-CREATE. */
function undecide(root: string, agent: string, id: string): void {
  const doc = JSON.parse(readFileSync(ledgerFile(root, agent, id), "utf8"));
  writeFileSync(ledgerFile(root, agent, id), `${JSON.stringify({ ...doc, events: doc.events.filter((event: unknown) => !isPlacementDecision(event)) }, null, 2)}\n`);
}
const migrate = (root: string, ...args: string[]) => runMigrateCli(["placement", ...args, "--root", root], root);

// Two Director leaves of one L2 with no inputs and equal requirements: each overlaps the other.
const OVERLAPPING = ["context.customer.need", "context.customer.buying"] as const;
// Each --apply and --check reads every placed slot of the fixture (372): a run takes seconds, not the 5 s default.
const SLOW = 180_000;

describe("clossys migrate placement", () => {
  it("records one create decision with its overlaps on a slot that has none, and --check exits 1 while it is pending", async () => {
    const root = copy();
    await migrate(root, "--apply", "--at", AT);
    for (const id of OVERLAPPING) undecide(root, "director", id);
    const check = await migrate(root, "--check");
    expect(check.exitCode).toBe(1);
    expect(check.message).toMatch(/2 without a placement decision pending/);
    const before = events(root, "director", OVERLAPPING[0]).length;
    const applied = await migrate(root, "--apply", "--at", AT);
    expect(applied.exitCode).toBe(0);
    expect((applied.output as { written: string[] }).written).toEqual(OVERLAPPING.map(id => `director/${id}`));
    const ledger = events(root, "director", OVERLAPPING[0]);
    expect(ledger).toHaveLength(before + 1);
    const event = ledger.at(-1)!;
    expect(event).toMatchObject({ op: "slot", verb: "migrate", by: "producer", at: AT, migration: "placement", decision: "create" });
    expect(event).not.toHaveProperty("overlapReason");
    const consumer = join(root, "clossys");
    const entry = readSlotEntry(consumer, "director", OVERLAPPING[0])!;
    const doc = readSlot(consumer, "director", OVERLAPPING[0]);
    const expected = placementOverlaps(consumer, "director", { slot: OVERLAPPING[0], kind: String(doc.kind), l1: entry.position.l1, l2: entry.position.l2, inputs: doc.inputs, contract: doc.contract })
      .filter(item => item.slot !== `director/${OVERLAPPING[0]}`);
    expect(expected.map(item => item.slot)).toContain(`director/${OVERLAPPING[1]}`);
    expect(event.overlaps).toEqual(expected);
    expect((await migrate(root, "--check")).exitCode).toBe(0);
  }, SLOW);

  it("records an empty overlaps list when the placement check finds none", async () => {
    const root = copy();
    await migrate(root, "--apply", "--at", AT);
    undecide(root, "director", "context.market.size");
    await migrate(root, "--apply", "--at", AT);
    expect(events(root, "director", "context.market.size").at(-1)).toMatchObject({ decision: "create", overlaps: [] });
  }, SLOW);

  it("leaves a slot that already records a decision byte-equal, and a second --apply writes nothing", async () => {
    const root = copy();
    expect((await migrate(root, "--apply", "--at", AT)).exitCode).toBe(0);
    undecide(root, "writer", "lexicon.formality");
    const kept = readFileSync(ledgerFile(root, "director", "context.market.size"));
    const second = await migrate(root, "--apply", "--at", AT);
    expect((second.output as { written: string[] }).written).toEqual(["writer/lexicon.formality"]);
    expect(readFileSync(ledgerFile(root, "director", "context.market.size")).equals(kept)).toBe(true);
    const settled = readFileSync(ledgerFile(root, "writer", "lexicon.formality"));
    const third = await migrate(root, "--apply", "--at", AT);
    expect(third.exitCode).toBe(0);
    expect((third.output as { written: string[] }).written).toEqual([]);
    expect(readFileSync(ledgerFile(root, "writer", "lexicon.formality")).equals(settled)).toBe(true);
  }, SLOW);
});
