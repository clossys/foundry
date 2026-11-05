// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import report from "../catalog/rules/shadcn-refresh-needs.json" with { type: "json" };
import assetSlots from "../catalog/slots/assets.json" with { type: "json" };
import contract from "../catalog/rules/token-contract.json" with { type: "json" };
import adapter from "../catalog/adapters/shadcn@aria.json" with { type: "json" };

describe("shadcn refresh requirements", () => {
  it("reports the theme-variable diff without extending the frozen contract", () => {
    const names = new Set([...Object.values(contract.leaves).flatMap(leaf => Object.values(leaf.members ?? {}).map(member => member.target)), ...Object.keys(contract.aliases)]);
    expect(report.themeVariables.count).toBe(32);
    expect(report.themeVariables.covered.every(name => names.has(name))).toBe(true);
    expect(report.themeVariables.needs).toEqual([]);
    expect(report.presets).toHaveLength(7);
  });
  it("binds matched icons to actual existing Lucide fills and their exact source pins", () => {
    for (const row of report.icons.filter(row => row.status === "existing-lucide-fill")) {
      expect(row.leaf).toBeDefined();
      const leaf = row.leaf!;
      const slot = assetSlots.find(slot => slot.id === leaf);
      expect(slot?.contract.members).toEqual({ mode: "closed", names: ["default"] });
      const fill = JSON.parse(readFileSync(resolve(import.meta.dirname, "../catalog/fills/lucide", `${leaf}.json`), "utf8"));
      expect(fill.$extensions["com.clossys.fill"].pin).toEqual(row.pin);
      expect(fill.assets[leaf.slice("assets.".length)].default.$value.length).toBeGreaterThan(0);
      expect((adapter.glyphs as Record<string, string>)[row.icon]).toBe(leaf);
    }
  });
  it("retains unavailable glyph identities as needs, including both sidebar panels", () => {
    const needs = report.icons.filter(row => row.status === "NEED");
    expect(needs.map(row => row.icon)).toEqual(expect.arrayContaining(["PanelLeftIcon", "PanelRightIcon"]));
    for (const row of needs) {
      expect("leaf" in row).toBe(false);
      expect(row.uses.length).toBeGreaterThan(0);
    }
  });
});
