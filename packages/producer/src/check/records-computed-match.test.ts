import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TREE_CHECKS, runIaSyncCli } from "../cli/ia-sync.js";
import { serializeSlot } from "../records/slot.js";
import type { Tighten } from "../records/types.js";
import { AT, LATER, baseSlot, slot2Workspace } from "../records/__fixtures__/slot2-workspace.js";
import { RECORDS_COMPUTED_MATCH, runRecordsComputedMatch } from "./records-computed-match.js";

const HERO = "sections.hero.copy", HOME = "page.home";
const HEADING = "contract.copy.fields[heading].maxLength.en";
const tighten = (value: number): Tighten => ({ path: HEADING, op: "max", value, why: "owner asked", by: { actor: "owner", ref: "fb-1" }, at: AT });

/** A package world: a Publisher page placing a Writer slot, both shipped as bases; `ia sync` run once. */
async function syncedWorld() {
  const ws = slot2Workspace();
  ws.base(baseSlot("writer", HERO));
  ws.base(baseSlot("publisher", HOME, { standard: "page.marketing", refs: [{ to: `writer/${HERO}`, rel: "places" }] }));
  ws.publications([HOME]);
  const first = await runIaSyncCli(["sync", "--at", AT], ws.root);
  return { ws, first };
}

describe(RECORDS_COMPUTED_MATCH, () => {
  it("passes what ia sync wrote, and a consumer edit to tighten, status or order", async () => {
    const { ws } = await syncedWorld();
    expect(runRecordsComputedMatch(ws.root)).toEqual({ check: RECORDS_COMPUTED_MATCH, status: "pass", findings: [] });
    const slot = ws.read("writer", HERO);
    ws.consumer("writer", HERO, { ...slot, status: "live", ia: { ...slot.ia, order: 9 }, tighten: [tighten(40)], updatedAt: LATER });
    expect(runRecordsComputedMatch(ws.root).status).toBe("pass");
  });

  it("fails a computed field edited by hand", async () => {
    const { ws } = await syncedWorld();
    const slot = ws.read("writer", HERO);
    ws.consumer("writer", HERO, { ...slot, brief: { ...slot.brief, purpose: "Hand edited purpose." } });
    const result = runRecordsComputedMatch(ws.root);
    expect(result.status).toBe("fail");
    expect(result.findings).toEqual([{ subject: `writer/${HERO}`, detail: expect.stringMatching(/computed field\(s\) brief differ/) }]);
    ws.consumer("writer", HERO, { ...slot, contract: { ...slot.contract, tones: ["plain", "warm", "bold", "loud"] }, ia: { ...slot.ia, l2: "site/home/elsewhere" } });
    expect(runRecordsComputedMatch(ws.root).findings[0]!.detail).toMatch(/ia\.l2, contract/);
  });

  it("fails slot/1, a wrong folder, an uninstalled base and an invalid file", async () => {
    const { ws } = await syncedWorld();
    const slot = ws.read("writer", HERO);
    ws.consumer("writer", "strings.old.label", JSON.stringify({ schema: "clossys.slot/1", id: "strings.old.label", agent: "writer" }));
    ws.consumer("writer", "sections.moved.copy", slot);
    ws.consumer("writer", "sections.gone.copy", { ...slot, id: "sections.gone.copy" });
    ws.consumer("designer", "sections.bad.block", "{");
    const details = Object.fromEntries(runRecordsComputedMatch(ws.root).findings.map(finding => [finding.subject, finding.detail]));
    expect(details["writer/strings.old.label"]).toMatch(/clossys migrate slot-1-to-2/);
    expect(details["writer/sections.moved.copy"]).toMatch(/not its folder/);
    expect(details["writer/sections.gone.copy"]).toMatch(/not installed/);
    expect(details["designer/sections.bad.block"]).toMatch(/schema is missing/);
  });

  it("checks a consumer-added slot (base null) for format only", async () => {
    const { ws } = await syncedWorld();
    ws.consumer("writer", "sections.extra.copy", baseSlot("writer", "sections.extra.copy", { standard: "anything" }));
    expect(runRecordsComputedMatch(ws.root).status).toBe("pass");
  });
});

describe("clossys ia sync", () => {
  it("copies every base, records base, and runs the tree checks", async () => {
    const { ws, first } = await syncedWorld();
    expect(first.exitCode).toBe(0);
    expect(first.message).toMatch(/2 slot\(s\) written/);
    expect(first.message).toContain(`added writer/${HERO}`);
    expect(first.message).toMatch(/records.computed-match: pass/);
    expect(first.message).toMatch(/ia.orphans: pass/);
    const slot = ws.read("writer", HERO);
    expect(slot.base).toMatchObject({ package: "@clossys/writer", version: "1.0.0", path: `src/catalog/slots/${HERO}/slot.json` });
    expect(slot.createdAt).toBe(AT);
    expect(Object.keys(TREE_CHECKS).sort()).toEqual(["brief.tighten-only", "ia.orphans", "records.computed-match"]);
  });

  it("writes no byte on a second run, and --check reports nothing pending", async () => {
    const { ws } = await syncedWorld();
    const before = [ws.text("writer", HERO), ws.text("publisher", HOME)];
    const again = await runIaSyncCli(["sync", "--at", LATER], ws.root);
    expect(again.exitCode).toBe(0);
    expect(again.message).toMatch(/0 slot\(s\) written/);
    expect([ws.text("writer", HERO), ws.text("publisher", HOME)]).toEqual(before);
    expect((await runIaSyncCli(["sync", "--check"], ws.root)).exitCode).toBe(0);
  });

  it("applies a package regroup and a new base, keeping the consumer tighten list and status", async () => {
    const { ws } = await syncedWorld();
    const slot = ws.read("writer", HERO);
    ws.consumer("writer", HERO, { ...slot, status: "live", tighten: [tighten(40)] });
    ws.base(baseSlot("writer", HERO, { ia: { l0: "site", l1: "site/home", l2: "site/home/hero", order: 3 } }), "1.1.0");
    expect((await runIaSyncCli(["sync", "--check"], ws.root)).exitCode).toBe(1);
    const moved = await runIaSyncCli(["sync", "--at", LATER], ws.root);
    expect(moved.exitCode).toBe(0);
    expect(moved.message).toContain(`moved writer/${HERO}`);
    const next = ws.read("writer", HERO);
    expect(next.ia).toEqual({ l0: "site", l1: "site/home", l2: "site/home/hero", order: 3 });
    expect(next.base!.version).toBe("1.1.0");
    expect(next).toMatchObject({ status: "live", tighten: [tighten(40)], createdAt: AT, updatedAt: LATER });
  });

  it("adopts a consumer-added slot the package now ships", async () => {
    const { ws } = await syncedWorld();
    ws.consumer("writer", "sections.extra.copy", baseSlot("writer", "sections.extra.copy", { refs: [{ to: `publisher/${HOME}`, rel: "consumedBy" }] }));
    ws.base(baseSlot("writer", "sections.extra.copy"));
    const result = await runIaSyncCli(["sync", "--at", LATER], ws.root);
    expect(result.message).toContain("adopted writer/sections.extra.copy");
    expect(ws.read("writer", "sections.extra.copy").base).not.toBeNull();
  });

  it("raises queue.clarify when a new base makes a kept tighten entry looser", async () => {
    const { ws } = await syncedWorld();
    const slot = ws.read("writer", HERO);
    ws.consumer("writer", HERO, { ...slot, tighten: [tighten(50)] });
    ws.base(baseSlot("writer", HERO, { contract: { ...baseSlot("writer", HERO).contract, copy: { fields: [{ key: "heading", maxLength: { en: 45 } }, { key: "body", maxLength: { en: 240 } }] } } }), "1.1.0");
    const result = await runIaSyncCli(["sync", "--at", LATER], ws.root);
    expect(result.message).toMatch(/1 looser tighten entr\(ies\), queue.clarify 20261119T1000Z-writer-sections-hero-copy-tighten/);
    expect(ws.read("writer", HERO).tighten).toEqual([tighten(50)]);
    const dir = join(ws.root, "clossys", "agents", "producer", "queue.clarify", "entries");
    const [file] = readdirSync(dir);
    const queued = JSON.parse(readFileSync(join(dir, file!), "utf8"));
    expect(queued).toMatchObject({ schema: "clossys.queue-entry/1", queue: "queue.clarify", decider: "owner", subject: { to: `writer/${HERO}` } });
    await runIaSyncCli(["sync", "--at", LATER], ws.root);
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it("never rewrites a slot/1 file and exits 1 naming the migration", async () => {
    const { ws } = await syncedWorld();
    const old = JSON.stringify({ schema: "clossys.slot/1", id: HERO, agent: "writer" });
    ws.consumer("writer", HERO, old);
    const result = await runIaSyncCli(["sync", "--at", LATER], ws.root);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/run clossys migrate slot-1-to-2 first/);
    expect(ws.text("writer", HERO)).toBe(old);
  });

  it("refuses unknown arguments and a bad --at", async () => {
    const { ws } = await syncedWorld();
    expect((await runIaSyncCli(["sync", "--wat"], ws.root)).exitCode).toBe(2);
    expect((await runIaSyncCli(["sync", "--at", "tomorrow"], ws.root)).exitCode).toBe(2);
    expect(existsSync(ws.file("writer", HERO))).toBe(true);
    expect(serializeSlot(ws.read("writer", HERO))).toBe(ws.text("writer", HERO));
  });
});
