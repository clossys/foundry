/**
 * `clossys ia sync --check` (foundry-feedback-0022): the package IA is the source of truth, so a
 * consumer generated from it has no drift, and every hand edit to its structure is reported.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FIXTURE_CONSUMER_ROOT } from "./fixture-consumer.test.js";
import { driftCounts, SYNC_AGENTS, syncDrift } from "./ia-sync.js";
import type { IaDoc } from "./types.js";

const fixture = join(FIXTURE_CONSUMER_ROOT, "clossys");
const temps: string[] = [];
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function copy(): string {
  const dir = mkdtempSync(join(tmpdir(), "ia-sync-"));
  temps.push(dir);
  cpSync(fixture, join(dir, "clossys"), { recursive: true });
  return join(dir, "clossys");
}
const iaFile = (consumer: string, agent: string) => join(consumer, "agents", agent, "ia.json");
const readIa = (consumer: string, agent: string) => JSON.parse(readFileSync(iaFile(consumer, agent), "utf8")) as { -readonly [K in keyof IaDoc]: any };
const writeIa = (consumer: string, agent: string, doc: unknown) => writeFileSync(iaFile(consumer, agent), `${JSON.stringify(doc, null, 2)}\n`);

describe("ia sync --check", () => {
  it("finds no drift in a consumer generated from the package IA", () => {
    for (const agent of SYNC_AGENTS) expect(syncDrift(fixture, agent), agent).toEqual([]);
  });

  it("reports an unadopted package leaf and a placed leaf that is neither packaged nor declared", () => {
    const consumer = copy();
    const ia = readIa(consumer, "writer");
    const group = ia.nodes[0].children[0];
    const dropped: string = group.slots[0];
    group.slots = [...group.slots.slice(1), "lexicon.not-a-package-leaf"];
    writeIa(consumer, "writer", ia);
    const counts = driftCounts(syncDrift(consumer, "writer"));
    expect(counts["unadopted-leaf"]).toBe(1);
    expect(counts["undeclared-leaf"]).toBe(1);
    expect(syncDrift(consumer, "writer").find(finding => finding.kind === "unadopted-leaf")?.slot).toBe(dropped);
  });

  it("reports a contract or layer edit", () => {
    const consumer = copy();
    const ia = readIa(consumer, "designer");
    const group = ia.nodes[0].children[0];
    const leaf: string = group.slots[0];
    ia.layers = [{ id: "hand", label: "Hand", nodes: [ia.nodes[0].id] }];
    writeIa(consumer, "designer", ia);
    const slotFile = join(consumer, "agents", "designer", leaf, "slot.json");
    const slot = JSON.parse(readFileSync(slotFile, "utf8"));
    writeFileSync(slotFile, `${JSON.stringify({ ...slot, contract: { ...slot.contract, purpose: "edited in the consumer" } }, null, 2)}\n`);
    const kinds = syncDrift(consumer, "designer").map(finding => finding.kind);
    expect(kinds).toContain("layers");
    expect(kinds).toContain("contract");
    expect(kinds).not.toContain("undeclared-leaf");
  });
});
