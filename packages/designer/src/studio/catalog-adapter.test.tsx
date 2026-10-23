import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { loadCatalog } from "../catalog-core/index.js";
import { catalogStudioAdapter } from "./catalog-adapter.js";
import { DEMO_LIBRARY, DEMO_SELECTION } from "./demo-data.js";
import { studioEngine } from "./engine.js";
import { scopeTargets } from "./model.js";
import { SlotTree } from "./SlotTree.js";

afterEach(cleanup);

it("loads the shipped 52-leaf catalog with the unchanged read-only consumer demo library", async () => {
  const loaded = await catalogStudioAdapter.load();
  expect(loaded).toEqual({ library: DEMO_LIBRARY, selection: DEMO_SELECTION });
  expect(catalogStudioAdapter.catalog).toEqual(loadCatalog());
  expect(catalogStudioAdapter.catalog?.slots).toHaveLength(52);
  expect(catalogStudioAdapter.canSave).toBe(false);
  expect(await catalogStudioAdapter.save({ baseHash: "x", changes: [] })).toEqual({ ok: false, reason: "unavailable" });
});

it("measures the existing engine honestly: 145 closed members resolve, open-contract previews remain absent", async () => {
  const catalog = loadCatalog();
  const loaded = await catalogStudioAdapter.load();
  const resolved = studioEngine.resolve({ catalog, ...loaded });
  expect(Object.keys(resolved.members)).toHaveLength(145);
  expect(studioEngine.check({ catalog, ...loaded, resolved }).ok).toBe(true);
  expect(Object.values(resolved.members).some(member => member.slot === "tokens.color-ramp")).toBe(false);
  expect(catalog.slots.reduce((sum, slot) => sum + Object.keys(slot.contract.emit ?? {}).length, 0)).toBe(217);
});

it("shows truthful available-member counts on every shipped leaf, including open contracts and empty leaves", async () => {
  const catalog = loadCatalog();
  const { library } = await catalogStudioAdapter.load();
  const counts = Object.fromEntries(catalog.slots.map(slot => [slot.id, scopeTargets({ catalog, library, slotId: slot.id, scope: "member" }).length]));
  expect(Object.values(counts).reduce((sum, count) => sum + count, 0)).toBe(220);
  render(<SlotTree nodes={catalog.slots.map(slot => ({ id: slot.id, label: slot.id }))} placements={[]} label="Tree" slotId="tokens.accent-color" counts={counts} memberCount={count => `${count} available`} onNavigate={() => undefined} />);
  for (const slot of catalog.slots) expect(screen.getByRole("row", { name: `${slot.id} (${counts[slot.id]} available)` })).toBeInTheDocument();
  expect(counts["tokens.color-ramp"]).toBe(14);
  expect(counts["tokens.font-size"]).toBe(0);
});
