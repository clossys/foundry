import { LibraryInputError } from "./fs-library.js";

/** No whole-library starter changeset engine exists in catalog-core, catalog-assets or importers. */
export function selectStarter(): never {
  throw new LibraryInputError("select unavailable until the starter engine ships");
}
