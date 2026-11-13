import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeElementVersion } from "./library.js";
import { DesignerNeedError, guardDesignerFlow } from "./owner-approval.js";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
const root = () => { const value = mkdtempSync(join(tmpdir(), "designer-owner-flow-")); roots.push(value); return value; };
const element = { package: "designer", slot: "sections.hero", id: "hero", creator: { agent: "designer", model: "fixture" }, lineage: { mode: "customized" as const } };
const candidates = ["hero-1", "hero-2"].map(item => ({ registry: "fixture", item, version: "1" }));
describe("Designer pick/adopt/create owner decision", () => {
  it("mutation: create without an owner-request reference writes NEED with 2-3 candidates and refuses", () => {
    const dir = root();
    expect(() => guardDesignerFlow(dir, element, { path: "create", candidates })).toThrow(DesignerNeedError);
    const need = JSON.parse(readFileSync(join(dir, "needs/designer.sections.hero.json"), "utf8"));
    expect(need).toMatchObject({ status: "NEED", candidates });
    expect(existsSync(join(dir, "library"))).toBe(false);
    expect(() => guardDesignerFlow(dir, element, { path: "create" })).toThrow(/supply 2-3/);
  });
  it("allows create only with an owner request for this slot and element", () => {
    const dir = root();
    writeFileSync(join(dir, "approvals.json"), JSON.stringify({ schema: "clossys.owner-approvals/1", records: [{ id: "request-1", actor: "owner", owner: "fixture-owner", reference: "owner request evidence", at: "2026-10-30T00:00:00Z", action: "create", slot: element.slot, element: element.id }] }));
    expect(() => guardDesignerFlow(dir, element, { path: "create", ownerRequest: "request-1" })).not.toThrow();
    expect(() => guardDesignerFlow(dir, { ...element, creator: { ...element.creator, agent: "fixture-owner" } }, { path: "create", ownerRequest: "request-1", candidates })).toThrow(DesignerNeedError);
    expect(() => guardDesignerFlow(dir, { ...element, slot: "sections.other" }, { path: "create", ownerRequest: "request-1", candidates })).toThrow(DesignerNeedError);
  });
  it("pick and adopt require provenance without an owner approval", () => {
    for (const path of ["pick", "adopt"] as const) expect(() => guardDesignerFlow(root(), { ...element, lineage: { ...element.lineage, source: candidates[0]! } }, { path })).not.toThrow();
  });
});

it("the real candidate writer refuses ownerless create before publishing a version", () => {
  const dir = root();
  expect(() => writeElementVersion(join(dir, "library"), {
    element: { ...element, schema: "clossys.element/1", layer: "sections", kind: "registry:block", lineage: { mode: "customized", source: candidates[0]! }, license: { spdx: "MIT" }, reason: "fixture option", createdAt: "2026-10-30T00:00:00Z", checks: [], deps: { npm: {}, elements: [] }, reads: { copyKeys: [], themeVars: [] } },
    preview: { schema: "clossys.preview/1", fixtures: {}, copy: {}, container: "canvas", theme: "light", width: 1280 },
    files: { "hero.tsx": "export const Hero = () => null" }, designerFlow: { path: "create", candidates },
  })).toThrow(DesignerNeedError);
  expect(existsSync(join(dir, "library/sections.hero/hero/v1"))).toBe(false);
  expect(JSON.parse(readFileSync(join(dir, "needs/designer.sections.hero.json"), "utf8")).candidates).toHaveLength(2);
});
