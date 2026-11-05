import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPageRecords } from "./conformance.js";
import type { PageFinding } from "./conformance.js";
import { measureCopyFit, unmeasuredCopyFitProbe } from "./copy-fit.js";
import { pageRecordsFromPublication } from "./record.js";
import type { PageRecord, PageRecordSection } from "./record.js";
import { runPageCheckCli } from "./cli.js";

const fixturePath = resolve(import.meta.dirname, "__fixtures__/site-publication.json");
const fixture = () => JSON.parse(readFileSync(fixturePath, "utf8"));
const bound = (section: string, extra: Partial<PageRecordSection> = {}): PageRecordSection =>
  ({ section, copy: { keys: { heading: `example.${section}.heading` } }, ...extra });
const page = (extra: Partial<PageRecord> & Pick<PageRecord, "sections">): PageRecord => ({
  id: "page", path: "/page", archetype: "marketing-home", format: "vertical-page", frame: { id: "frames.site-shell" },
  meta: { title: "example.meta-title", description: "example.meta-description" }, nav: { pinned: true, label: "example.nav" }, ...extra,
});
const home = (sections = ["sections.hero", "sections.features", "sections.call-to-action"]) => page({ sections: sections.map(section => bound(section)) });
const errors = (findings: readonly PageFinding[]) => findings.filter(row => row.severity === "error");
const codes = (findings: readonly PageFinding[]) => errors(findings).map(row => row.code);

describe("page conformance", () => {
  it("passes the generic four-page site publication with report-only output", () => {
    const records = pageRecordsFromPublication(fixture());
    expect(records.map(row => [row.id, row.archetype, row.format, row.sections.length])).toEqual([
      ["home", "marketing-home", "vertical-page", 6], ["contact", "contact", "vertical-page", 2],
      ["terms", "legal", "vertical-page", 1], ["privacy", "legal", "vertical-page", 1],
    ]);
    const report = checkPageRecords({ records, directorCells: fixture().directorCells });
    expect(errors(report.findings)).toEqual([]);
    expect(report).toMatchObject({ kind: "publisher.page-conformance", exitCode: 0, strict: false, checks: ["archetype", "format", "copy", "links", "meta", "copy-fit"] });
    expect(report.pages[0]!.roles).toMatchObject({ hero: [0], value: [1], "how-it-works": [2], alternatives: [3], pricing: [4], "closing-action": [5] });
    expect(report.findings.filter(row => row.code === "copy-fit-not-measured")).toHaveLength(4);
    expect(checkPageRecords({ records }, { strict: true }).exitCode).toBe(0);
  });

  it("fails a marketing home that is missing its hero", () => {
    const report = checkPageRecords({ records: [home(["sections.features", "sections.call-to-action"])] });
    expect(report.findings).toContainEqual(expect.objectContaining({ check: "archetype", code: "archetype-role-missing", severity: "error", role: "hero" }));
    expect(report.exitCode).toBe(0);
    expect(checkPageRecords({ records: [home(["sections.features", "sections.call-to-action"])] }, { strict: true }).exitCode).toBe(1);
    expect(codes(checkPageRecords({ records: [home()] }).findings)).toEqual([]);
  });

  it("fails roles out of order, over their bounds or outside the archetype", () => {
    expect(codes(checkPageRecords({ records: [home(["sections.features", "sections.hero", "sections.call-to-action"])] }).findings)).toContain("archetype-order");
    expect(codes(checkPageRecords({ records: [home(["sections.hero", "sections.hero", "sections.features", "sections.call-to-action"])] }).findings)).toContain("archetype-role-count");
    expect(codes(checkPageRecords({ records: [home(["sections.hero", "sections.features", "sections.data-table", "sections.call-to-action"])] }).findings)).toContain("archetype-extra-section");
    expect(codes(checkPageRecords({ records: [page({ archetype: "landing", sections: [] })] }).findings)).toContain("archetype-unknown");
  });

  it("fails a long-form section placed on a slide", () => {
    const deck = (sections: string[]) => page({ archetype: "deck", format: "slide", frame: undefined, nav: { pinned: false }, sections: sections.map(section => bound(section)) });
    expect(codes(checkPageRecords({ records: [deck(["sections.hero", "sections.features", "sections.call-to-action"])] }).findings)).toEqual([]);
    const report = checkPageRecords({ records: [deck(["sections.hero", "sections.features", "sections.article", "sections.call-to-action"])] });
    expect(report.findings).toContainEqual(expect.objectContaining({ check: "format", code: "format-section", severity: "error", section: 2 }));
    expect(codes(checkPageRecords({ records: [page({ archetype: "deck", format: "vertical-page", sections: [] })] }).findings)).toContain("format-archetype");
  });

  it("holds slides to their word budget, frame and sticky rules", () => {
    const long = Array.from({ length: 61 }, (_, index) => `w${index}`).join(" ");
    const slide = (extra: Partial<PageRecord>) => page({ archetype: "deck", format: "slide", frame: undefined, sections: [
      bound("sections.hero", { copy: { keys: { heading: "example.cover" }, text: { heading: long } } }), bound("sections.features"), bound("sections.call-to-action"),
    ], ...extra });
    expect(checkPageRecords({ records: [slide({})] }).findings).toContainEqual(expect.objectContaining({ code: "format-word-budget", section: 0 }));
    expect(codes(checkPageRecords({ records: [slide({ frame: { id: "frames.site-shell", members: ["position.sticky"] } })] }).findings)).toEqual(expect.arrayContaining(["format-frame", "format-sticky"]));
  });

  it("fails a canvas page without zoom actions", () => {
    const canvas = (intents: string[]) => page({ archetype: "app-page", format: "canvas", frame: { id: "frames.app-shell" }, sections: [bound("sections.page-header"), bound("sections.status-list")], actions: intents.map(intent => ({ id: intent, intent })) });
    const report = checkPageRecords({ records: [canvas(["canvas.fit", "canvas.minimap"])] });
    expect(report.findings).toContainEqual(expect.objectContaining({ check: "format", code: "format-action-missing", severity: "error", message: expect.stringContaining("canvas.zoom") }));
    expect(codes(checkPageRecords({ records: [canvas(["canvas.zoom", "canvas.fit", "canvas.minimap"])] }).findings)).toEqual([]);
    expect(codes(checkPageRecords({ records: [canvas([])] }).findings).filter(code => code === "format-action-missing")).toHaveLength(3);
  });

  it("reports unbound copy, unresolved links, missing head and nav metadata", () => {
    const record = page({
      sections: [bound("sections.hero", { links: ["/missing", "/page#top", "https://example.com/x", "javascript:alert(1)"] }), { section: "sections.features" }, bound("sections.call-to-action")],
      meta: {}, nav: { pinned: true }, links: ["/other", "#main"],
    });
    const report = checkPageRecords({ records: [record], routes: ["/other"] });
    expect(errors(report.findings).map(row => [row.code, row.section])).toEqual(expect.arrayContaining([
      ["copy-unbound", 1], ["link-unresolved", 0], ["link-invalid", 0], ["meta-title-missing", undefined], ["meta-description-missing", undefined], ["nav-label-missing", undefined],
    ]));
    expect(errors(report.findings).filter(row => row.code === "link-unresolved")).toHaveLength(1);
    expect(codes(checkPageRecords({ records: [home(), { ...home(), id: "again" }] }).findings)).toContain("route-duplicate");
    expect(codes(checkPageRecords({ records: [{ ...home(), path: "/a//b" }] }).findings)).toContain("route-invalid");
  });

  it("reports Director gates against filled cells", () => {
    const withStats = home(["sections.hero", "sections.features", "sections.stats", "sections.call-to-action"]);
    expect(checkPageRecords({ records: [withStats], directorCells: [] }).findings).toContainEqual(expect.objectContaining({ code: "archetype-gate-off", severity: "warning", role: "metrics" }));
    expect(checkPageRecords({ records: [home()], directorCells: ["advantage.model.pricing"] }).findings).toContainEqual(expect.objectContaining({ code: "archetype-gate-on", severity: "info", role: "pricing" }));
    expect(checkPageRecords({ records: [withStats] }).findings.some(row => row.code.startsWith("archetype-gate"))).toBe(false);
  });

  it("consumes copy-fit measurements and stubs the probe", async () => {
    expect(await measureCopyFit([home()], unmeasuredCopyFitProbe)).toEqual([]);
    const report = checkPageRecords({ records: [home()] }, { copyFit: [{ page: "page", section: 0, width: 375, key: "header.heading", overflow: true, overflowPx: 12 }, { page: "page", section: 0, width: 1280, overflow: false }] });
    expect(report.findings.filter(row => row.check === "copy-fit")).toEqual([expect.objectContaining({ code: "copy-fit-overflow", severity: "warning", section: 0 })]);
  });
});

describe("page check CLI", () => {
  it("prints JSON findings and exits 0 unless strict", () => {
    const dir = mkdtempSync(join(tmpdir(), "page-check-"));
    const broken = fixture();
    broken.routePack.routes[0].slots.shift();
    broken.contentMap.entries[0].source.sectionIds.shift();
    writeFileSync(join(dir, "broken.json"), JSON.stringify(broken));
    expect(runPageCheckCli(["--pages", fixturePath]).exitCode).toBe(0);
    const loose = runPageCheckCli(["--pages", "broken.json", "--report", "report.json"], dir);
    expect(loose.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "report.json"), "utf8")).findings).toContainEqual(expect.objectContaining({ code: "archetype-role-missing", page: "home", role: "hero" }));
    expect(runPageCheckCli(["--pages", "broken.json", "--strict"], dir).exitCode).toBe(1);
    expect(runPageCheckCli([]).exitCode).toBe(2);
    expect(runPageCheckCli(["--pages", "missing.json"], dir).exitCode).toBe(2);
  });
});
