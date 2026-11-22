import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TREE_CHECKS, runIaSyncCli } from "../cli/ia-sync.js";
import { serializeSlot } from "../records/slot.js";
import type { Tighten } from "../records/types.js";
import { AT, CONSUMER, LATER, packageBaseOf, slot2Ids, tallyhouseWorld } from "../records/__fixtures__/slot2-workspace.js";
import { RECORDS_COMPUTED_MATCH, runRecordsComputedMatch } from "./records-computed-match.js";

const HERO = "sections.hero.copy", LEXICON = "lexicon.sentence-length";
const HEADING = "contract.copy.fields[header.heading].maxLength.en";
const SLOT_V1 = join(CONSUMER, "clossys/agents/writer", LEXICON, "slot.json");

/**
 * A Tallyhouse copy. `designer/assets.lockup` is the one frozen-fixture folder no pinned candidate reaches
 * (only the unpinned `page.home` candidate names it; see ia-orphans.test.ts), so sync worlds drop it.
 */
function world() {
  const ws = tallyhouseWorld();
  rmSync(join(ws.root, "clossys/agents/designer/assets.lockup"), { recursive: true });
  return ws;
}
async function syncedWorld() {
  const ws = world();
  const first = await runIaSyncCli(["--at", AT], ws.root);
  return { ws, first };
}
const maxHeading = (by: Tighten, value: number): Tighten => ({ ...by, path: HEADING, op: "max", value });
const withHeading = (slot: ReturnType<typeof packageBaseOf>, en: number) => {
  const base = structuredClone(slot);
  const fields = (base.contract.copy as { fields: { key: string; maxLength: { en: number } }[] }).fields;
  fields.find(field => field.key === "header.heading")!.maxLength.en = en;
  return base;
};

describe(RECORDS_COMPUTED_MATCH, () => {
  it("passes what ia sync wrote, and consumer edits to tighten, status and order", async () => {
    const { ws } = await syncedWorld();
    expect(runRecordsComputedMatch(ws.root)).toEqual({ check: RECORDS_COMPUTED_MATCH, status: "pass", findings: [] });
    const slot = ws.read("writer", HERO);
    ws.write("writer", HERO, { ...slot, status: "parked", ia: { ...slot.ia, order: 2 }, tighten: [...slot.tighten, maxHeading(slot.tighten[0]!, 48)], updatedAt: LATER });
    expect(runRecordsComputedMatch(ws.root).status).toBe("pass");
  });

  it("fails a computed field edited by hand", async () => {
    const { ws } = await syncedWorld();
    const slot = ws.read("writer", HERO);
    const other = ws.read("writer", LEXICON);
    ws.write("writer", HERO, { ...slot, brief: { ...slot.brief, purpose: other.brief.purpose } });
    const result = runRecordsComputedMatch(ws.root);
    expect(result.status).toBe("fail");
    expect(result.findings).toEqual([{ subject: `writer/${HERO}`, detail: expect.stringMatching(/computed field\(s\) brief differ/) }]);
    ws.write("writer", HERO, { ...slot, contract: { ...slot.contract, claimsFrom: [] }, ia: { ...slot.ia, l2: other.ia.l2 } });
    expect(runRecordsComputedMatch(ws.root).findings[0]!.detail).toMatch(/ia\.l2, contract/);
  });

  it("fails slot/1, a wrong folder, an uninstalled base and an unreadable file", async () => {
    const { ws } = await syncedWorld();
    cpSync(SLOT_V1, ws.file("writer", LEXICON));
    cpSync(ws.file("writer", HERO), ws.file("writer", "narratives.legal-document"));
    rmSync(ws.baseFile("designer", "themes.primary"));
    const hero = ws.file("designer", "sections.hero");
    writeFileSync(hero, readFileSync(hero, "utf8").slice(0, 40));
    const details = Object.fromEntries(runRecordsComputedMatch(ws.root).findings.map(finding => [finding.subject, finding.detail]));
    expect(details[`writer/${LEXICON}`]).toBe("clossys.slot/1: run clossys migrate slots --apply");
    expect(details["writer/narratives.legal-document"]).toMatch(/not its folder/);
    expect(details["designer/themes.primary"]).toMatch(/not installed/);
    expect(details["designer/sections.hero"]).toMatch(/schema is missing/);
  });

  it("checks a consumer-added slot (base null) for format only", async () => {
    const { ws } = await syncedWorld();
    const slot = ws.read("writer", LEXICON);
    ws.write("writer", LEXICON, { ...slot, base: null, standard: ws.read("writer", HERO).standard });
    expect(runRecordsComputedMatch(ws.root).status).toBe("pass");
  });
});

describe("clossys ia sync", () => {
  it("records the installed base for every Tallyhouse slot and runs the tree checks", async () => {
    const { ws, first } = await syncedWorld();
    const ids = slot2Ids(ws.root);
    expect(first.exitCode).toBe(0);
    expect(first.message).toMatch(new RegExp(`^ia sync: ${ids.length} slot\\(s\\) written`));
    expect(first.message).toContain(`updated writer/${HERO}`);
    expect(first.message).toMatch(/records.computed-match: pass/);
    expect(first.message).toMatch(/ia.orphans: pass/);
    const slot = ws.read("writer", HERO);
    expect(slot.base).toMatchObject({ package: "@clossys/writer", version: "1.0.0", path: `src/catalog/slots/${HERO}/slot.json` });
    expect(slot).toMatchObject({ status: "live", createdAt: "2026-11-16T08:00:00Z", updatedAt: AT });
    expect(Object.keys(TREE_CHECKS).sort()).toEqual(["brief.tighten-only", "ia.orphans", "records.computed-match"]);
  });

  it("adds a slot the consumer lacks", async () => {
    const ws = world();
    rmSync(ws.file("designer", "themes.primary"));
    const result = await runIaSyncCli(["--at", AT], ws.root);
    expect(result.message).toContain("added designer/themes.primary");
    expect(ws.read("designer", "themes.primary")).toMatchObject({ status: "starter", createdAt: AT });
  });

  it("writes no byte on a second run, and --check reports nothing pending", async () => {
    const { ws } = await syncedWorld();
    const before = slot2Ids(ws.root).map(([agent, id]) => ws.text(agent, id));
    const again = await runIaSyncCli(["--at", LATER], ws.root);
    expect(again.exitCode).toBe(0);
    expect(again.message).toMatch(/^ia sync: 0 slot\(s\) written/);
    expect(slot2Ids(ws.root).map(([agent, id]) => ws.text(agent, id))).toEqual(before);
    expect((await runIaSyncCli(["--check"], ws.root)).exitCode).toBe(0);
  });

  it("applies a package regroup and a new base version, keeping the consumer tighten list and status", async () => {
    const { ws } = await syncedWorld();
    const slot = ws.read("writer", HERO);
    const elsewhere = ws.read("writer", LEXICON).ia;
    ws.writeBase({ ...packageBaseOf(slot), ia: elsewhere }, "1.1.0");
    expect((await runIaSyncCli(["--check"], ws.root)).exitCode).toBe(1);
    const moved = await runIaSyncCli(["--at", LATER], ws.root);
    expect(moved.exitCode).toBe(0);
    expect(moved.message).toContain(`moved writer/${HERO}`);
    const next = ws.read("writer", HERO);
    expect(next.ia).toEqual(elsewhere);
    expect(next.base!.version).toBe("1.1.0");
    expect(next).toMatchObject({ status: "live", tighten: slot.tighten, createdAt: slot.createdAt, updatedAt: LATER });
  });

  it("adopts a consumer-added slot the package now ships", async () => {
    const { ws } = await syncedWorld();
    ws.write("writer", LEXICON, { ...ws.read("writer", LEXICON), base: null });
    const result = await runIaSyncCli(["--at", LATER], ws.root);
    expect(result.message).toContain(`adopted writer/${LEXICON}`);
    expect(ws.read("writer", LEXICON).base).not.toBeNull();
  });

  it("raises queue.clarify when a new base makes a kept tighten entry looser", async () => {
    const { ws } = await syncedWorld();
    const slot = ws.read("writer", HERO);
    const kept = maxHeading(slot.tighten[0]!, 48);
    ws.write("writer", HERO, { ...slot, tighten: [...slot.tighten, kept] });
    ws.writeBase(withHeading(packageBaseOf(slot), 24), "1.1.0");
    const result = await runIaSyncCli(["--at", LATER], ws.root);
    expect(result.message).toMatch(/1 looser tighten entr\(ies\), queue.clarify 20261118T1140Z-writer-sections-hero-copy-tighten/);
    expect(ws.read("writer", HERO).tighten).toEqual([...slot.tighten, kept]);
    const dir = join(ws.root, "clossys/agents/producer/queue.clarify/entries");
    const [file] = readdirSync(dir);
    expect(JSON.parse(readFileSync(join(dir, file!), "utf8"))).toMatchObject({ schema: "clossys.queue-entry/1", queue: "queue.clarify", decider: "owner", subject: { to: `writer/${HERO}` } });
    await runIaSyncCli(["--at", LATER], ws.root);
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it("never rewrites a slot/1 file and exits 1 naming the migration", async () => {
    const { ws } = await syncedWorld();
    cpSync(SLOT_V1, ws.file("writer", LEXICON));
    const old = ws.text("writer", LEXICON);
    const result = await runIaSyncCli(["--at", LATER], ws.root);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/run clossys migrate slot-1-to-2 first/);
    expect(ws.text("writer", LEXICON)).toBe(old);
  });

  it("refuses unknown arguments and a bad --at", async () => {
    const { ws } = await syncedWorld();
    expect((await runIaSyncCli(["--wat"], ws.root)).exitCode).toBe(2);
    expect((await runIaSyncCli(["--at", "tomorrow"], ws.root)).exitCode).toBe(2);
    expect(serializeSlot(ws.read("writer", HERO))).toBe(ws.text("writer", HERO));
  });
});
