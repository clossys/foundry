/**
 * The option table keys every Director and Writer L2 group of the current trees (option-classes.ts), read from the
 * producer test fixture's placed IA: an L2 the table misses leaves its slots with no family, and conform C1 turns red.
 * foundry-build-0048 (Amendment 2026-11-18b, A1) adds the admin workspace publication's page metadata L2.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classify } from "../slot-options.js";
import { OPTION_CLASSES, OPTION_GROUPS, OPTION_TABLE } from "./option-classes.js";

const FIXTURE = new URL("../../../test-fixtures/consumer/clossys/agents/", import.meta.url);
type Placed = { nodes: { id: string; children: { id: string; slots: string[] }[] }[] };
const placed = (agent: string): Placed => JSON.parse(readFileSync(new URL(`${agent}/ia.json`, FIXTURE), "utf8")) as Placed;
const groupsOf = (tree: Placed): string[] => tree.nodes.flatMap(l1 => l1.children.map(l2 => `${l1.id}/${l2.id}`));
const ADMIN_META = ["publication.admin.meta", "page.admin-home.meta", "page.admin-gallery.meta", "page.admin-slot.meta", "page.admin-requests.meta", "page.admin-questions.meta"];

describe("option table coverage of the placed Director and Writer trees", () => {
  for (const agent of ["director", "writer"] as const) {
    it(`keys every ${agent} L2 group to a known class`, () => {
      const groups = groupsOf(placed(agent));
      expect(groups.length).toBeGreaterThan(0);
      expect(groups.filter(group => !OPTION_GROUPS[agent]?.[group])).toEqual([]);
      for (const group of groups) expect(OPTION_CLASSES[OPTION_GROUPS[agent]![group]!], group).toBeDefined();
    });
  }

  it("classes the admin page metadata as one bulk-pinned system string, and each admin meta slot carries that family", () => {
    const writer = placed("writer");
    const admin = writer.nodes.find(l1 => l1.id === "copy.page-metadata")?.children.find(l2 => l2.id === "admin");
    expect(admin?.slots.slice().sort()).toEqual(ADMIN_META.slice().sort());
    expect(OPTION_GROUPS.writer?.["copy.page-metadata/admin"]).toBe("writer.system");
    for (const slot of ADMIN_META) {
      expect(classify("writer", slot, "copy.page-metadata/admin", OPTION_TABLE)).toEqual({ classId: "writer.system" });
      const doc = JSON.parse(readFileSync(new URL(`writer/${slot}/slot.json`, FIXTURE), "utf8")) as { family?: unknown };
      expect(doc.family, slot).toEqual({ options: 1, varyOn: null, values: [], class: "writer.system" });
    }
  });

  it("mutation: a table without the admin group leaves those slots unclassed", () => {
    const { ["copy.page-metadata/admin"]: _dropped, ...rest } = OPTION_GROUPS.writer!;
    const table = { ...OPTION_TABLE, groups: { ...OPTION_TABLE.groups, writer: rest } };
    expect(classify("writer", "page.admin-home.meta", "copy.page-metadata/admin", table)).toEqual({ classId: undefined });
  });
});
