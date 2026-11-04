import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { runCli } from "../cli/main.js";
import { parseArgs } from "../cli/args.js";
import { recordSuitesSummary, refVerbatimSuite, runRecordSuites, slotContractSuite } from "./record-suites.js";

const temps: string[] = [];
afterAll(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });
function consumer(): string {
  const root = mkdtempSync(join(tmpdir(), "producer-record-suites-"));
  temps.push(root);
  mkdirSync(join(root, "clossys"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
  return root;
}

describe("check record-suite arguments", () => {
  it("accepts --suites alone or with the page lint, and keeps the flags on check", () => {
    expect(parseArgs(["check", "--suites"])).toMatchObject({ verb: "check", suites: true, strict: false });
    expect(parseArgs(["check", "--suites", "--strict", "--pages", "p.json", "--report", "r.json"])).toMatchObject({ suites: true, strict: true, pages: "p.json" });
    expect(parseArgs(["check", "--strict"])).toMatchObject({ strict: true });
    expect(() => parseArgs(["publish", "--install", "--page", "home", "--suites"])).toThrow(/require check/);
    expect(() => parseArgs(["check", "--suites", "--records", "lib"])).toThrow(/--records requires publish/);
    expect(parseArgs(["publish", "--install", "--page", "home", "--records", "a", "--records", "b"]).records).toEqual(["a", "b"]);
  });
});

describe("record suites", () => {
  it("validates every Writer and Director contract against clossys.slot-contract/1", async () => {
    const suite = await slotContractSuite();
    expect(suite.checked).toBeGreaterThan(50);
    expect(suite.findings).toEqual([]);
  });

  it("runs Designer's ref-verbatim check over every pin", async () => {
    const root = consumer();
    const dir = join(root, "clossys", "library", "sections.hero", "hero", "v1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "hero.tsx"), "export const Hero = () => null\n");
    const hash = `sha256:${"4".repeat(64)}`;
    writeFileSync(join(dir, "element.json"), JSON.stringify({ schema: "clossys.element/1", id: "hero", slot: "sections.hero", version: 1, hash, lineage: { mode: "original" }, payload: ["hero.tsx"] }));
    writeFileSync(join(root, "clossys", "selection.json"), JSON.stringify({ pins: { "sections.hero": { element: "hero", version: 1, hash, event: "e1" } } }));
    const suite = await refVerbatimSuite(root);
    expect(suite).toMatchObject({ suite: "ref-verbatim", status: "ran", checked: 1, totals: { error: 1 } });
    expect(suite.findings[0]).toMatchObject({ code: "REF-NO-SOURCE", where: "sections.hero/hero@v1" });
  });

  it("reports a suite that cannot run without failing the command unless strict", async () => {
    const root = consumer();
    const loose = await runRecordSuites(root);
    expect(loose.exitCode).toBe(0);
    expect(loose.suites.map(suite => suite.suite)).toEqual(["archetypes", "writer-slots", "director-slots", "slot-contracts", "ref-verbatim"]);
    expect(loose.suites[0]).toMatchObject({ suite: "archetypes", status: "error" });
    expect(recordSuitesSummary(loose)).toMatch(/Archetypes: error: /);
    expect((await runRecordSuites(root, { strict: true })).exitCode).toBe(1);
  });

  it("enforces slot integrity alongside report-only record suites", async () => {
    const root = consumer();
    const result = await runCli(["check", "--suites", "--root", root]);
    expect(result).toMatchObject({ exitCode: 1, verb: "check" });
    expect(result.slots?.findings.length).toBeGreaterThan(0);
    expect(result.message).toContain("Record suites (report only)");
    expect(result.message).toMatch(/Slot contracts: \d+ contracts, errors=0/);
    expect(result.message).toMatch(/Ref verbatim: 0 pins, errors=0/);
    expect(result.suites?.suites).toHaveLength(5);
    expect(await runCli(["check", "--suites", "--strict", "--root", root])).toMatchObject({ exitCode: 1 });
    const outside = mkdtempSync(join(tmpdir(), "producer-record-suites-none-"));
    temps.push(outside);
    expect(await runCli(["check", "--suites", "--root", outside])).toMatchObject({ exitCode: 1 });
  });
});

describe("archetype page copy", () => {
  it("resolves Copy bullets as cell.key, so a bound meta line clears the finding and a missing one keeps it", async () => {
    vi.resetModules();
    const entry = (id: string) => ({ id, kind: "page", archetype: "legal" });
    vi.doMock("../publish/site-source.js", () => ({
      readPublisher: async () => ({
        publicationId: "pub", format: "web", entries: [entry("bound"), entry("missing")],
        cellOfEntry: { bound: "home", missing: "about" },
        copy: { home: [{ cell: "home", key: "meta-title" }, { cell: "home", key: "meta-description" }], about: [{ cell: "about", key: "meta-title" }, { cell: "about", key: "meta-description" }] },
        routes: [{ instanceId: "bound", path: "/" }, { instanceId: "missing", path: "/about" }],
      }),
      readWriter: async () => ({
        sections: [], aliases: { "home.meta-title": "r1", "home.meta-description": "r2" },
        records: [{ id: "r1", text: "Home" }, { id: "r2", text: "Home page." }],
      }),
    }));
    vi.doMock("../records/director-pinned.js", async importOriginal => ({ ...(await importOriginal<object>()), readPinnedDirector: async () => ({ set: { agent: "director", pinned: [], unpinned: [], issues: [] }, cells: [], unreadable: [] }) }));
    const { consumerPageRecords } = await import("./record-suites.js");
    const { records } = await consumerPageRecords(consumer());
    const archetypes = await import("../../../publisher/src/archetypes/index.js");
    const { findings } = archetypes.checkPageRecords({ records, routes: ["/", "/about"], directorCells: [] }, { strict: false });
    const meta = (page: string) => findings.filter((f: any) => f.page === page && f.check === "meta").map((f: any) => f.code);
    expect(meta("bound")).toEqual([]);
    expect(meta("missing")).toEqual(expect.arrayContaining(["meta-title-missing", "meta-description-missing"]));
    vi.doUnmock("../publish/site-source.js");
    vi.doUnmock("../records/director-pinned.js");
  });
});
