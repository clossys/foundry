import { completedTokenLibrary } from "../../importers/__fixtures__/completed-token-library.js";
import { authorImageRatios } from "../../catalog-assets/check.js";
import { createConsumerIdentitySeeds, deriveIdentity } from "../../catalog-assets/identity.js";
import { applyLibraryChange, libraryHash } from "../library.js";
import type { CatalogData, LibraryData, Source } from "../types.js";

/** Signed-default integration fixture only; production creation remains the chooser's responsibility. */
export function completedCatalogLibrary(catalog: CatalogData, source: Source, adoptedAt: string): LibraryData {
  let library = completedTokenLibrary(catalog, source, adoptedAt);
  library = applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: catalog.fills.filter(fill => !!fill.assets && fill.$extensions["com.clossys.fill"].source === "lucide").map(fill => ({ op: "adopt" as const, slot: fill.$extensions["com.clossys.fill"].slot, source: "lucide" })) });
  library = deriveIdentity(catalog, createConsumerIdentitySeeds(catalog, library, { name: "Example", fontLicence: { family: "sans-serif", outlining: "unknown" } }));
  return authorImageRatios(catalog, library, { ratios: { landscape: { width: 3, height: 2 } }, source: "Consumer editorial brief", rationale: "Landscape crop for editorial media" });
}
