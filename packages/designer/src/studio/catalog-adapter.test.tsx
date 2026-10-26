import { expect, it } from "vitest";
import { generateSelection, loadCatalog, resolve } from "../catalog-core/index.js";
import { catalogStudioAdapter } from "./catalog-adapter.js";
import { demoStudioAdapter } from "./demo-adapter.js";
import { scopeTargets } from "./model.js";
it("loads the shipped catalog against an empty consumer without a fallback", async () => {
 const {library,selection}=await catalogStudioAdapter.load(); expect(library.fills).toEqual([]); expect(selection).toEqual(generateSelection(library)); expect(catalogStudioAdapter.catalog).toEqual(loadCatalog()); expect(resolve({catalog:loadCatalog(),library}).members).toEqual({}); expect(demoStudioAdapter).toBe(catalogStudioAdapter); expect(await catalogStudioAdapter.save({baseHash:"unused",changes:[]})).toEqual({ok:false,reason:"unavailable"});
});
it("enumerates members for every loaded token and asset contract", async () => {
 const catalog=loadCatalog(); const {library}=await catalogStudioAdapter.load(); expect(catalog.slots.filter(slot=>slot.layer==="tokens"||slot.layer==="assets")).toEqual(catalog.slots); expect(new Set(catalog.slots.map(slot=>slot.id)).size).toBe(catalog.slots.length); expect(catalog.placements.map(p=>p.layer)).toEqual(["tokens","assets"]);
 expect(scopeTargets({catalog,library,slotId:"tokens.color-ramp",scope:"member"}).length).toBeGreaterThan(10); expect(scopeTargets({catalog,library,slotId:"assets.icon-search",scope:"member"}).length).toBeGreaterThan(0);
});
