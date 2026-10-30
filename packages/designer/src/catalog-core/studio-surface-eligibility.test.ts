/** @vitest-environment node */
import { expect, it } from "vitest";
import { foundrySurfaceCatalog } from "../library-cli/surface-catalog.js";
import { readSurfacePackageEvidence } from "../library-cli/surface-package-evidence.js";
import { loadCatalog } from "./index.js";
import { loadComponentRegistry } from "./component-registry.js";
import { importFoundryComponents } from "../importers/foundry-components.js";
import { planSurfaceDefaults } from "./surface-defaults.js";
import { applyLibraryChange, libraryHash } from "./api.js";
import { resolveComposite } from "./library-components.js";
import { surfaceEntryOf, isSurfacePackageEntry } from "./surface-library.js";
import { selectedPackageClosure } from "./__fixtures__/surface-engine/selected-package-closure.js";
import type { CompositeCatalogData } from "./types.js";

const ids = ["sections.cards", "sections.explorer"];
const native = () => {
  const catalog = foundrySurfaceCatalog();
  return { ...catalog, slots: catalog.slots.filter(slot => ids.includes(slot.id)), fills: catalog.fills.filter(doc => ids.includes(doc.$extensions["com.clossys.fill"].slot)) };
};
it("plans and adopts actual mandatory Cards and Explorer through independently observed package exports", async () => {
  const surfaces = native();
  const plan = planSurfaceDefaults({ catalog: surfaces, slots: ids, preference: ["shadcn@aria", "foundry", "rac-starter"] });
  expect(plan.rows.map(row => ({ slot: row.slot, status: row.status, source: row.source, reasons: row.reasons }))).toEqual(ids.map(slot => ({ slot, status: "default", source: "foundry", reasons: [] })));
  const catalog: CompositeCatalogData = { values: loadCatalog(), components: { slots: loadComponentRegistry().slots, fills: importFoundryComponents().fills }, surfaces };
  const { library: empty, componentOptions } = selectedPackageClosure(catalog);
  const surfaceOptions = { packages: await readSurfacePackageEvidence(surfaces.fills), measurements: [] };
  const library = applyLibraryChange(catalog, empty, { baseHash: libraryHash(empty), changes: plan.decisions.map(row => ({ portion: "surfaces", change: { op: "adopt", slot: row.slot, source: row.source } })) }, { componentOptions, surfaceOptions });
  const profile = resolveComposite({ catalog, library, componentOptions, surfaceOptions });
  expect(profile.surfaces!.check.findings.filter(row => row.severity === "error")).toEqual([]);
  for (const id of ids) {
    const entry = surfaceEntryOf(profile.surfaces!.fills[id as `sections.${string}`]!.document);
    expect(isSurfacePackageEntry(entry)).toBe(true);
    expect(entry.impl).toMatchObject({ kind: "package", module: "@clossys/designer/blocks", export: id === "sections.cards" ? "RecordCards" : "Explorer" });
  }
}, 30_000);

it("continues refusing undeclared token and component reads on these actual candidates", () => {
  for (const [id, field, unsupported] of [["sections.cards", "tokens", "tokens.duration"], ["sections.explorer", "composes", "components.color-picker"]] as const) {
    const current = native(), catalog = { ...current, fills: structuredClone(current.fills) };
    const document = catalog.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === id)!;
    const entry = structuredClone(surfaceEntryOf(document));
    if (!isSurfacePackageEntry(entry)) throw new Error("The actual candidate must be a package surface.");
    if (field === "tokens") entry.reads = { ...entry.reads!, tokens: [...entry.reads!.tokens, unsupported] };
    else entry.composes = [...entry.composes!, unsupported];
    catalog.fills = catalog.fills.map(row => row === document ? { ...row, sections: { [id.slice("sections.".length)]: entry } } as typeof row : row);
    const row = planSurfaceDefaults({ catalog, slots: [id], preference: ["foundry"] }).rows[0]!;
    expect(row.status).toBe("not-chosen");
    expect(row.reasons.join(" ")).toContain(`S5 unsupported ${field}: ${unsupported}`);
  }
});
