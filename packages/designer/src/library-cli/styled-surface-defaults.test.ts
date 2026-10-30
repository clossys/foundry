// @vitest-environment node
import { expect, it } from "vitest";
import { foundrySurfaceCatalog } from "./surface-catalog.js";
import { planSurfaceDefaults } from "../catalog-core/surface-defaults.js";

it("offers the four real Aria surface candidates through the production catalog and normal preference", () => {
  const catalog = foundrySurfaceCatalog();
  const slots = ["frames.app-shell", "sections.section-header", "sections.content", "sections.empty-state"];
  const plan = planSurfaceDefaults({ catalog, slots });
  expect(plan.findings).toEqual([]);
  expect(plan.rows.map(row => [row.slot, row.source, row.basis])).toEqual(slots.map(slot => [slot, "shadcn@aria", "preference"]));
  expect(plan.rows.every(row => row.status === "default")).toBe(true);
  expect(catalog.transforms).toHaveLength(4);
});

it("keeps explicit selections authoritative and Foundry available where no block candidate exists", () => {
  const catalog = foundrySurfaceCatalog();
  const plan = planSurfaceDefaults({ catalog, slots: ["frames.app-shell", "sections.hero"], choices: { "frames.app-shell": "foundry" } });
  expect(plan.rows.map(row => [row.slot, row.source, row.basis])).toEqual([["frames.app-shell", "foundry", "choose"], ["sections.hero", "foundry", "preference"]]);
});
