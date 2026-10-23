import { loadCatalog } from "../catalog-core/index.js";
import { demoStudioAdapter } from "./demo-adapter.js";
import type { StudioAdapter } from "./types.js";

/** The shipped catalog with the read-only demo consumer library. Open-contract member previews await the real engine. */
export const catalogStudioAdapter: StudioAdapter = { ...demoStudioAdapter, catalog: loadCatalog() };
