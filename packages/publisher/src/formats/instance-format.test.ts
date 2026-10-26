import { describe, expect, it } from "vitest";
import ts from "typescript";
import { checkInstance, checkInstancePack } from "../core/instance-binding.check.js";
import { instanceFixture, splitFixture, tileFixture } from "../core/__fixtures__/instance-binding/fixtures.js";
import type { LayoutCompilerPort } from "../core/layout-source.js";
import type { InstanceCheckResult } from "../core/instance-binding.js";
import { FORMAT_IDS } from "./index.js";

const kinds = new Map(Object.entries(ts.SyntaxKind).filter(([key, value]) => typeof value === "number" && !/^(?:First|Last|Count)/.test(key)).map(([key, value]) => [value, key]));
const compiler: LayoutCompilerPort = {
  parseSourceFile: (file, source) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
  kind: value => kinds.get((value as ts.Node).kind) ?? "Unknown",
  children: value => { const children: ts.Node[] = []; ts.forEachChild(value as ts.Node, child => { children.push(child); }); return children; },
};
type Fixture = ReturnType<typeof instanceFixture>;
const run = (fixture: Fixture) => checkInstance(fixture.binding, fixture.library, fixture.registries, compiler);
const codes = (result: InstanceCheckResult) => result.findings.map(finding => finding.code);
const web = (fixture: Fixture) => fixture.registries.formats.find(format => format.id === "web.page.responsive")!;

describe("LK16 format-bound assemblies", () => {
  it("accepts built web stack, split and bento assemblies while LK12 stays pending", () => {
    for (const fixture of [instanceFixture(), splitFixture(), tileFixture()]) {
      expect(run(fixture)).toEqual({ staticStatus: "valid", findings: [], pendingChecks: ["LK12"] });
    }
  });
  it("accepts the allowed app shell without changing heading ownership", () => {
    const fixture = instanceFixture();
    fixture.binding.surface = "app"; fixture.binding.frame = { leaf: "frames.app-shell", config: "page" };
    fixture.fills.get(JSON.stringify(["sections.hero", "default"]))!.headings = [2];
    expect(run(fixture)).toEqual({ staticStatus: "valid", findings: [], pendingChecks: ["LK12"] });
  });
  it("refuses missing, empty, non-string and unknown formats rather than defaulting to web", () => {
    for (const format of [undefined, "", " web.page.responsive", "web.page.unknown", 1, { id: "web.page.responsive" }]) {
      const fixture = instanceFixture();
      if (format === undefined) delete (fixture.binding as { format?: unknown }).format;
      else Object.assign(fixture.binding, { format });
      const checked = run(fixture);
      expect(codes(checked)).toContain("LK16"); expect(checked.staticStatus).toBe("refused"); expect(checked.pendingChecks).toEqual(["LK12"]);
      expect(checked.findings.filter(finding => finding.code === "LK16").map(finding => finding.path)).toEqual(["format"]);
    }
  });
  it("refuses every concept format even when its status is falsely promoted", () => {
    for (const id of FORMAT_IDS.filter(id => id !== "web.page.responsive")) {
      const fixture = instanceFixture(); fixture.binding.format = id;
      expect(codes(run(fixture))).toContain("LK16");
      const format = fixture.registries.formats.find(format => format.id === id)!;
      format.status = "built"; format.allowedCompositions = ["layouts.stack"]; format.frames = ["frames.site-shell"];
      expect(codes(run(fixture))).toContain("LK16");
    }
  });
  it("uses the supplied format restrictions for layouts and frames", () => {
    const fixture = instanceFixture();
    web(fixture).allowedCompositions = ["layouts.split"];
    expect(codes(run(fixture))).toContain("LK16");
    expect(run(fixture).findings.filter(finding => finding.code === "LK16").map(finding => finding.path)).toEqual(["layout"]);
    web(fixture).allowedCompositions = ["layouts.stack"];
    web(fixture).frames = ["frames.app-shell"];
    expect(codes(run(fixture))).toContain("LK16");
    expect(run(fixture).findings.filter(finding => finding.code === "LK16").map(finding => finding.path)).toEqual(["frame"]);
    web(fixture).frames = ["frames.site-shell"];
    expect(run(fixture).staticStatus).toBe("valid");
  });
  it("never falls back when the supplied registry is missing, empty, malformed or ambiguous", () => {
    for (const formats of [undefined, null, [], {}, [null]]) {
      const fixture = instanceFixture();
      if (formats === undefined) delete (fixture.registries as { formats?: unknown }).formats;
      else Object.assign(fixture.registries, { formats });
      expect(codes(run(fixture))).toContain("LK16");
    }
    const fixture = instanceFixture(); fixture.registries.formats.push(web(fixture));
    expect(codes(run(fixture))).toContain("LK16");
    fixture.registries.formats = fixture.registries.formats.filter(format => format.id !== "web.page.responsive");
    expect(codes(run(fixture))).toContain("LK16");
  });
  it("refuses malformed contracts, held compositions and successful flags", () => {
    for (const change of [
      { allowedCompositions: null }, { allowedCompositions: "layouts.stack" }, { frames: ["frames.site-shell", "frames.site-shell"] },
      { size: null }, { label: 42 }, { status: "pass" }, { pass: true }, { skip: true }, { fallback: "web.page.responsive" },
      { renderer: "Layout.tsx" }, { allowedCompositions: ["layouts.stack", "layouts.staggered-grid"] },
    ]) {
      const fixture = instanceFixture(); Object.assign(web(fixture), change);
      expect(codes(run(fixture))).toContain("LK16");
    }
    const fixture = instanceFixture(); fixture.binding.layout.leaf = "layouts.staggered-grid";
    expect(codes(run(fixture))).toContain("LK16"); expect(codes(run(fixture))).toContain("LK2");
  });
  it("rejects registry and format getters or prototypes without reading them", () => {
    let read = false;
    for (const inherited of [false, true]) {
      const fixture = instanceFixture();
      const getter = { enumerable: true, get() { read = true; return [web(fixture)]; } };
      if (inherited) {
        const prototype = Object.defineProperty({}, "formats", getter);
        delete (fixture.registries as { formats?: unknown }).formats; Object.setPrototypeOf(fixture.registries, prototype);
      } else Object.defineProperty(fixture.registries, "formats", getter);
      expect(codes(run(fixture))).toContain("LK16"); expect(read).toBe(false);
    }
    const fixture = instanceFixture(); Object.defineProperty(web(fixture), "frames", { enumerable: true, get() { read = true; return ["frames.site-shell"]; } });
    expect(codes(run(fixture))).toContain("LK16"); expect(read).toBe(false);
    const exotic = instanceFixture(); Object.setPrototypeOf(web(exotic), { pass: true });
    expect(codes(run(exotic))).toContain("LK16");
  });
  it("fails pack closure on an LK16 member and preserves LK12 as pending", () => {
    const fixture = instanceFixture();
    expect(checkInstancePack([fixture.binding], fixture.library, fixture.registries, compiler).staticStatus).toBe("valid");
    web(fixture).frames = ["frames.app-shell"];
    const checked = checkInstancePack([fixture.binding], fixture.library, fixture.registries, compiler);
    expect(codes(checked)).toContain("LK16"); expect(codes(checked)).toContain("LK15"); expect(checked.pendingChecks).toEqual(["LK12"]);
  });
});
