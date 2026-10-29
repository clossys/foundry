/** Studio owns the synthetic dataset used by package renderer specimens. Type-only: no runtime dependency. */
import type { SurfaceRendererEntry as RuntimeEntry, SurfaceRendererGroup as RuntimeGroup } from "../runtime/contract.js";
import type { SpecimenDataset } from "./specimen-dataset.js";
export type SurfaceRendererEntry = RuntimeEntry<SpecimenDataset>;
export type SurfaceRendererGroup = RuntimeGroup<SpecimenDataset>;
