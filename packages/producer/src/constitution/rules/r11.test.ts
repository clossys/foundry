import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildContext } from "../context.js";
import { cleanSpec, contextOf, expectCatches, NO_HISTORY } from "../__fixtures__/workspace.js";
import { danglingReferences, judgesCode, MODULE_REPO, R11, singleReaderRows } from "./r11.js";

describe("R11.1 one reader, one writer", () => {
  it("maps single-reader findings: reader-scan and writer-scan findings are R11.1 rows, resolver findings R11.2", () => {
    const { r111, r112 } = singleReaderRows([
      { file: "packages/producer/src/cli/owner.ts", line: 517, call: "rmdirSync", text: "rmdirSync(dir)", kind: "reader" },
      { file: "packages/producer/src/records/slots.ts", line: 9, call: "writeFileSync", text: "writeFileSync(pinFile(dir), text)", kind: "writer" },
      { file: "packages/producer/src/cli/pin.ts", line: 3, call: "versionedCitation", text: "import { versionedCitation } from \"@clossys/director\"", kind: "resolver" },
    ]);
    expect(r111.map(row => [row.check, row.path])).toEqual([["R11.1", "packages/producer/src/cli/owner.ts:517"], ["R11.1", "packages/producer/src/records/slots.ts:9"]]);
    expect(r111[1]!.reason).toMatch(/only records\/slot-write.ts writes it/);
    expect(r112.map(row => [row.check, row.path])).toEqual([["R11.2", "packages/producer/src/cli/pin.ts:3"]]);
    expect(singleReaderRows([])).toEqual({ r111: [], r112: [] });
  });
});

describe("R11.2 every slot reference resolves", () => {
  const registered = new Set(["frames.studio-shell", "sections.module.outline", "assets.icon-package"]);

  it("finds slot ids under reference keys and inputs keys that name no registered slot, one entry per id", () => {
    const doc = {
      frameId: "frames.studio-shell",
      sectionIds: ["sections.module.outline", "sections.module.ghost"],
      inputs: { "sections.module.ghost": "ghost", "sections.module.outline": "outline" },
      manifest: { modules: [
        { icon: "assets.icon-outline", section: "sections.module.outline", source: "page.outline", label: "studio.outline-label" },
        { icon: "publisher:assets.icon-outline#svg", section: "sections.module.outline" },
      ] },
      agents: [{ icon: "assets.icon-package" }],
    };
    expect(danglingReferences(doc, registered)).toEqual([
      { id: "assets.icon-outline", at: "manifest.modules[0].icon", count: 2 },
      { id: "sections.module.ghost", at: "sectionIds[1]", count: 2 },
    ]);
  });

  it("ignores loader ids, copy keys and non-slot strings", () => {
    expect(danglingReferences({ source: "page.outline", label: "studio.outline-label", icon: "Not A Slot", copy: { title: "home.hero#title" } }, registered)).toEqual([]);
  });

  it("failing-first: a pinned Publisher record naming an unregistered icon is a row", () => {
    const spec = cleanSpec();
    spec.publisher!["site.home"]!.candidates = { "home-v1.json": { schema: "clossys.page/1", sections: ["ui.card"], copy: { title: "home.hero#title" }, icon: "assets.icon-ghost" } };
    const rows = expectCatches(R11.checks["R11.2"]!, contextOf(cleanSpec()), contextOf(spec));
    expect(rows).toEqual([expect.objectContaining({ rule: "R11", check: "R11.2", agent: "publisher", slot: "site.home", candidate: "home-v1.json", reason: expect.stringMatching(/icon names assets\.icon-ghost, which is no registered slot/) })]);
  });

  it("a code-free root (the fixture) gives no R11.1 row", () => {
    expect(R11.checks["R11.1"]!(contextOf(cleanSpec()))).toEqual([]);
  });
});

describe.skipIf(!existsSync(`${MODULE_REPO}/packages/producer/package.json`))("R11 on this repository", () => {
  it("runs the single-reader scan and the compiled-map scan to a verdict (no broken-script row)", () => {
    const ctx = buildContext(MODULE_REPO, `${MODULE_REPO}/clossys`, { history: () => NO_HISTORY });
    const rows = [...R11.checks["R11.1"]!(ctx), ...R11.checks["R11.2"]!(ctx)];
    expect(rows.filter(row => /gave no verdict/.test(row.reason))).toEqual([]);
    for (const row of rows) expect(row.path).toMatch(/^(packages|clossys)\//);
  }, 120_000);
});

describe.skipIf(!existsSync(`${MODULE_REPO}/packages/producer/package.json`))("code scripts under a focused run", () => {
  it("are not run when the run is focused: a code row has no slot, so the focus would drop it", () => {
    const whole = buildContext(MODULE_REPO, `${MODULE_REPO}/clossys`, { history: () => NO_HISTORY });
    expect(judgesCode(whole)).toBe(true);
    const focused = buildContext(MODULE_REPO, `${MODULE_REPO}/clossys`, { history: () => NO_HISTORY, focus: [{ agent: "designer", slot: "ui.button" }] });
    expect(judgesCode(focused)).toBe(false);
    expect(judgesCode(buildContext(MODULE_REPO, `${MODULE_REPO}/clossys`, { history: () => NO_HISTORY, focus: [] }))).toBe(false);
    expect(R11.checks["R11.1"]!(focused)).toEqual([]);
  }, 120_000);
});
