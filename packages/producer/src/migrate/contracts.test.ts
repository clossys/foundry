/**
 * `clossys migrate contracts` (foundry-build-0048 U3) on a temp copy of `test-fixtures/consumer` (the fixture stays
 * byte-identical): the committed fixture is already seeded, so a run changes nothing; a slot whose requirements were
 * stripped is reseeded from its standard in one ledgered event; the hero and call-to-action copy carry the writer.choice
 * family (3 on tone: plain, bold, warm), and a table that reclasses one reseeds only its family.
 */
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { OPTION_TABLE, type OptionTable } from "../records/slot-model/option-classes.js";
import { checkSlotOptions } from "../records/slot-options.js";
import { applyContracts, planContracts } from "./contracts.js";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const AT = "2026-11-17T00:00:00Z";
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function copy(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "migrate-contracts-")));
  roots.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  return join(root, "clossys");
}
const slotFile = (consumer: string, agent: string, id: string) => join(consumer, "agents", agent, id, "slot.json");
const readDoc = (consumer: string, agent: string, id: string) => JSON.parse(readFileSync(slotFile(consumer, agent, id), "utf8"));
const ledgerOps = (consumer: string, agent: string, id: string) => (JSON.parse(readFileSync(join(consumer, "agents", agent, id, "ledger.json"), "utf8")).events as { op: string; verb?: string; migration?: string }[]);

describe("clossys migrate contracts", () => {
  it("changes nothing on the seeded fixture, and every Writer copy contract carries its fixture", () => {
    const consumer = copy();
    const plan = planContracts(consumer, REPO);
    expect(plan.seeds.length).toBeGreaterThan(100);
    expect(plan.seeds.filter(seed => seed.changes.length)).toEqual([]);
    expect(applyContracts(consumer, plan, AT)).toEqual([]);
    for (const [slot, keys] of [["sections.hero.copy", ["header.heading"]], ["sections.call-to-action.copy", ["header.title", "actions.primary.label"]]] as const) {
      const doc = readDoc(consumer, "writer", slot);
      expect(doc.contract.fixture, slot).toEqual({ keys, locales: ["en"] });
      expect(doc.contract.requirements.length, slot).toBeGreaterThan(0);
    }
    // A fixture the contract does not determine is named, never invented.
    expect(plan.gaps.some(gap => gap.agent === "designer" && gap.field === "fixture")).toBe(true);
    expect(plan.gaps.filter(gap => gap.agent === "writer" && gap.field === "fixture" && /copy fields/.test(gap.reason)).map(gap => gap.slot)).not.toContain("sections.hero.copy");
  });

  it("reseeds a slot whose requirements were stripped (one ledgered slot event), and a second run changes nothing", () => {
    const consumer = copy();
    const before = readDoc(consumer, "writer", "sections.hero.copy");
    writeFileSync(slotFile(consumer, "writer", "sections.hero.copy"), `${JSON.stringify({ ...before, contract: { ...before.contract, requirements: [] } }, null, 2)}\n`);
    const plan = planContracts(consumer, REPO);
    expect(plan.seeds.filter(seed => seed.changes.length).map(seed => [`${seed.agent}/${seed.slot}`, seed.changes])).toEqual([["writer/sections.hero.copy", ["requirements"]]]);
    const events = ledgerOps(consumer, "writer", "sections.hero.copy").length;
    expect(applyContracts(consumer, plan, AT)).toEqual(["writer/sections.hero.copy"]);
    expect(readDoc(consumer, "writer", "sections.hero.copy").contract.requirements).toEqual(before.contract.requirements);
    const ledger = ledgerOps(consumer, "writer", "sections.hero.copy");
    expect(ledger).toHaveLength(events + 1);
    expect(ledger.at(-1)).toMatchObject({ op: "slot", verb: "migrate", migration: "contracts" });
    expect(planContracts(consumer, REPO).seeds.filter(seed => seed.changes.length)).toEqual([]);
  });

  it("carries the writer.choice family (3 tones) on the hero and call-to-action copy, and reseeds it from the option table", () => {
    const consumer = copy();
    const tones = { options: 3, varyOn: "tone", values: ["plain", "bold", "warm"], class: "writer.choice" };
    for (const slot of ["sections.hero.copy", "sections.call-to-action.copy"]) {
      expect(readDoc(consumer, "writer", slot).family, slot).toEqual(tones);
    }
    // The options check reads the family: three tones are owed and the table agrees (no drift).
    const short = checkSlotOptions(consumer).findings.filter(finding => ["sections.hero.copy", "sections.call-to-action.copy"].includes(finding.slot));
    expect(short.map(finding => finding.code)).toEqual(["options-short", "options-short"]);
    expect(short.every(finding => /needs 3/.test(finding.message))).toBe(true);
    // A table that classes the hero copy as one system string reseeds only its family, in one ledgered event.
    const table: OptionTable = { ...OPTION_TABLE, overrides: { ...OPTION_TABLE.overrides, writer: { ...OPTION_TABLE.overrides.writer, "sections.hero.copy": { class: "writer.system", reason: "probe" } } } };
    const plan = planContracts(consumer, REPO, table);
    expect(plan.seeds.filter(seed => seed.changes.length).map(seed => [seed.slot, seed.changes])).toEqual([["sections.hero.copy", ["family"]]]);
    expect(applyContracts(consumer, plan, AT)).toEqual(["writer/sections.hero.copy"]);
    expect(readDoc(consumer, "writer", "sections.hero.copy").family).toEqual({ options: 1, varyOn: null, values: [], class: "writer.system" });
    expect(ledgerOps(consumer, "writer", "sections.hero.copy").at(-1)).toMatchObject({ op: "slot", verb: "migrate", migration: "contracts", class: "writer.system" });
    // Back on the committed table, the family disagrees with it: the options check names the drift.
    expect(checkSlotOptions(consumer).findings.find(finding => finding.slot === "sections.hero.copy")?.code).toBe("options-drift");
  });
});
