import { completedTokenLibrary } from "../../importers/__fixtures__/completed-token-library.js";
import { authorImageRatios, authorMediaResources } from "../../catalog-assets/check.js";
import { createConsumerIdentitySeeds, deriveIdentity } from "../../catalog-assets/identity.js";
import { applyLibraryChange, libraryHash } from "../library.js";
import type { CatalogData, LibraryData, Source } from "../types.js";

/** Signed-default integration fixture only; production creation remains the chooser's responsibility. */
export function completedCatalogLibrary(catalog: CatalogData, source: Source, adoptedAt: string): LibraryData {
  let library = completedTokenLibrary(catalog, source, adoptedAt);
  library = applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: catalog.fills.filter(fill => !!fill.assets && fill.$extensions["com.clossys.fill"].source === "lucide").map(fill => ({ op: "adopt" as const, slot: fill.$extensions["com.clossys.fill"].slot, source: "lucide" })) });
  library = deriveIdentity(catalog, createConsumerIdentitySeeds(catalog, library, { name: "Example", fontLicence: { family: "sans-serif", outlining: "unknown" } }));
  library = authorImageRatios(catalog, library, { ratios: { landscape: { width: 3, height: 2 } }, source: "Consumer editorial brief", rationale: "Landscape crop for editorial media" });
  return authorConsumerMedia(catalog, library);
}

/** One authored illustration and video plus the adopted Foundry pattern recipes, through the producer pipeline. */
export function authorConsumerMedia(catalog: CatalogData, prior: LibraryData): LibraryData {
  let library = authorMediaResources(catalog, prior, { slot: "assets.image", source: "Consumer media brief", rationale: "Product illustration", resources: { hero: {
    kind: "illustration", width: 40, height: 30, alt: "A flat slate panel",
    src: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2040%2030%22%3E%3Crect%20width%3D%2240%22%20height%3D%2230%22%20fill%3D%22%23445566%22%2F%3E%3C%2Fsvg%3E",
  } } });
  library = authorMediaResources(catalog, library, { slot: "assets.video", source: "Consumer media brief", rationale: "Product tour", resources: { tour: {
    src: "https://media.example.invalid/tour.mp4", mediaType: "video/mp4", width: 1280, height: 720, reducedMotion: "poster",
    captions: { src: "https://media.example.invalid/tour.en.vtt", srclang: "en", label: "English" },
  } } });
  return applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: [{ op: "adopt", slot: "assets.pattern", source: "foundry" }, { op: "adopt", slot: "assets.backdrop-graphic", source: "foundry" }] });
}
