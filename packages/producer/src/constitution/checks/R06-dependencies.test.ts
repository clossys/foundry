import { describe, expect, it } from "vitest";
import { cleanSpec, contextOf, expectCatches, slotDoc, type WorkspaceSpec } from "../__fixtures__/workspace.js";
import { R06, candidateRefs, crossSlotCandidateFiles, exactDependencies, foreignCandidateFiles, identicalBytes, installPaths, registryDependencies, vendoring } from "./R06-dependencies.js";

const clean = () => contextOf(cleanSpec());
const broken = (edit: (spec: WorkspaceSpec) => void) => { const spec = cleanSpec(); edit(spec); return contextOf(spec); };
const item = (name: string, extra: Record<string, unknown>, files: Record<string, unknown>[] = []) => ({ name, type: "registry:ui", files, ...extra });

describe("R06 dependencies", () => {
  it("passes the clean workspace on every enforced check", () => {
    const ctx = clean();
    for (const check of [exactDependencies, vendoring, registryDependencies, candidateRefs, installPaths, identicalBytes, crossSlotCandidateFiles]) expect(check(ctx)).toEqual([]);
  });

  it("R06.1 flags a range and a version missing from the lockfile", () => {
    const rows = expectCatches(exactDependencies, clean(), broken(spec => {
      spec.designer!["ui.button"]!.candidates = { "button-v1.json": item("button", { dependencies: ["react@^19.0.0", "react@18.2.0"] }) };
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toMatch(/react@\^19\.0\.0 is not <name>@<x\.y\.z>/);
    expect(rows[0]!.reason).toMatch(/react@18\.2\.0 is not in the root package-lock\.json/);
  });

  it("R06.2 flags CommonJS package source and a lib/<package>/ install path, one row per file", () => {
    const rows = expectCatches(vendoring, clean(), broken(spec => {
      spec.designer!["ui.button"]!.candidates = { "button-v1.json": item("button", {}, [
        { path: "ui/button.tsx", type: "registry:ui", content: "export const Button = 1;\n" },
        { path: "vendor/clsx.js", type: "registry:lib", content: "module.exports = function clsx() {};\n" },
        { path: "typography/scale.ts", type: "registry:lib", target: "lib/typography/scale.ts", content: "export const scale = 1;\n" },
      ]) };
    }));
    expect(rows.map(row => row.path.split("#")[1]).sort()).toEqual(["typography/scale.ts", "vendor/clsx.js"]);
  });

  it("R06.3 flags non-empty registryDependencies", () => {
    const rows = expectCatches(registryDependencies, clean(), broken(spec => {
      spec.designer!["ui.card"]!.candidates = { "card-v1.json": item("card", { registryDependencies: ["button"] }) };
    }));
    expect(rows).toEqual([expect.objectContaining({ check: "R06.3", slot: "ui.card", candidate: "card-v1.json" })]);
  });

  it("R06.4 flags a source.ref naming another candidate or a version", () => {
    const rows = expectCatches(candidateRefs, clean(), broken(spec => {
      spec.designer!["ui.card"]!.candidates = { "card-v1.json": item("card", { meta: { source: { kind: "derived", ref: ["ui.button/button-v1", "designer:ui.button@2"] } } }) };
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toContain("ui.button/button-v1");
    expect(rows[0]!.reason).toContain("designer:ui.button@2");
  });

  it("R06.5 flags two slots installing the same path, over all candidates (pinned or not)", () => {
    const rows = expectCatches(installPaths, clean(), broken(spec => {
      spec.designer!["ui.icon-button"] = { candidates: {
        "icon-button-v1.json": item("icon-button", {}, [{ path: "ui/icon-button.tsx", type: "registry:ui", content: "export const IconButton = 2;\n" }]),
        "icon-button-v2.json": item("icon-button", {}, [{ path: "ui/button.tsx", type: "registry:ui", content: "export const Other = 3;\n" }]),
      } };
    }));
    expect(rows.map(row => row.slot).sort()).toEqual(["ui.button", "ui.icon-button"]);
    expect(rows[0]!.reason).toMatch(/components\/ui\/button\.tsx/);
  });

  it("R06.6 flags identical bytes held by two slots", () => {
    const rows = expectCatches(identicalBytes, clean(), broken(spec => {
      spec.writer!["home.tagline"] = { candidates: { "tagline-v1.md": spec.writer!["home.hero"]!.candidates!["hero-v1.md"] } };
    }));
    expect(rows.map(row => `${row.agent}:${row.slot}`).sort()).toEqual(["writer:home.hero", "writer:home.tagline"]);
  });

  it("R06.7 flags a candidate naming another slot's candidate file, by path or shorthand, anywhere in its bytes", () => {
    const rows = expectCatches(crossSlotCandidateFiles, clean(), broken(spec => {
      // components.logo/logo-v3.json today: a path to assets.mark's candidate in meta.source.ref.
      spec.designer!["ui.card"]!.candidates = { "card-v1.json": item("card", { meta: { source: { kind: "derived", ref: ["clossys/agents/designer/ui.button/candidates/button-v1.json", "clossys/agents/designer/ui.button"] } } }) };
      spec.designer!["ui.badge"] = { candidates: { "badge-v1.json": item("badge", {}, [{ path: "ui/badge.tsx", type: "registry:ui", content: "// from ../ui.button/candidates/button-v1.json\nexport const Badge = 1;\n" }]) } };
      spec.writer!["home.tagline"] = { candidates: { "tagline-v1.md": "---\nsource: {\"kind\":\"derived\",\"ref\":[\"home.hero/hero-v1\"]}\n---\nHi.\n" } };
      spec.publisher!["site.home"]!.slot = slotDoc("publisher", "site.home", { inputs: ["ui.card", "home.hero"], uses: ["ui.button/button-v1.json"] });
    }));
    expect(rows.map(row => `${row.slot}${row.candidate ? `/${row.candidate}` : ""}: ${row.reason}`).sort()).toEqual([
      expect.stringMatching(/^home\.tagline\/tagline-v1\.md: references another slot's candidate file: home\.hero\/hero-v1;/),
      expect.stringMatching(/^site\.home: slot\.json inputs\/uses name a candidate file: ui\.button\/button-v1\.json;/),
      expect.stringMatching(/^ui\.badge\/badge-v1\.json: references another slot's candidate file: \.\.\/ui\.button\/candidates\/button-v1\.json;/),
      expect.stringMatching(/^ui\.card\/card-v1\.json: references another slot's candidate file: clossys\/agents\/designer\/ui\.button\/candidates\/button-v1\.json; name the slot id/),
    ]);
  });

  it("R06.7 allows lineage inside one slot and a cross-slot reference by slot id", () => {
    const ctx = broken(spec => {
      spec.designer!["ui.button"]!.candidates = {
        "button-v1.json": item("button", {}, [{ path: "ui/button.tsx", type: "registry:ui", content: "export const Button = 1;\n" }]),
        "button-v2.json": item("button", { meta: { source: { kind: "derived", ref: ["clossys/agents/designer/ui.button/candidates/button-v1.json", "ui.button/button-v1", "designer:ui.card"] } } }, [{ path: "ui/button.tsx", type: "registry:ui", content: "export const Button = 2;\n" }]),
      };
    });
    expect(crossSlotCandidateFiles(ctx)).toEqual([]);
    expect(foreignCandidateFiles("see ui.unknown/thing-v1 and @scope/pkg-v1 and https://x.dev/ui.button/button-v1", "ui.card", new Set(["ui.button"]))).toEqual([]);
  });

  it("R06.7 mutation proof: the check disabled (() => []) is silent on the broken workspace", () => {
    const brokenCtx = broken(spec => { spec.designer!["ui.card"]!.candidates = { "card-v1.json": item("card", { meta: { source: { kind: "derived", ref: ["clossys/agents/designer/ui.button/candidates/button-v1.json"] } } }) }; });
    expect(R06.checks["R06.7"]).toBe(crossSlotCandidateFiles);
    expect(expectCatches(crossSlotCandidateFiles, clean(), brokenCtx)).toHaveLength(1);
    expect(() => expectCatches(() => [], clean(), brokenCtx)).toThrow(/silent on the broken workspace/);
  });

  it("keeps the installed-bytes half of R06.2 as a pending row, never a pass", () => {
    const rows = R06.checks["R06.2-installed-bytes"]!(clean());
    expect(rows).toEqual([expect.objectContaining({ rule: "R06", pending: true })]);
  });
});
