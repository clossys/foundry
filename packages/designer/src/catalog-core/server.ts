/** The catalog engine is platform-neutral and needs no server-only initialization. */
export * from "./index.js";
export * from "../catalog-assets/server.js";
export { readLibrary, writeLibrary, writeCompositeLibrary, checkLibrary, emitLibrary, libraryFiles, isLibraryChangeSet, isCompositeChangeSet, LIBRARY_EMIT_TARGETS, LibraryInputError, LibraryConflictError, LibraryCheckError, checkLibraryReceipt, DESIGNER_RECEIPT_FILE, type DesignerReceipt, type DesignerReceiptFinding, type DesignerReceiptVerdict, type DesignerWriteEntry, type DesignerWriteStamp } from "../library-cli/fs-library.js";

export { consumerDogfoodSources, parseConsumerDogfoodContract, runConsumerDogfood } from "../library-cli/consumer-dogfood.js";
export type { ConsumerDogfoodContract } from "../library-cli/consumer-dogfood.js";

// Host package-export evidence for Section and Frame package pointers (the disk boundary reads it itself when a host passes none).
export { readSurfacePackageEvidence } from "../library-cli/surface-package-evidence.js";
export type { SurfaceAnyDocument } from "./surface-types.js";
