/** The catalog engine is platform-neutral and needs no server-only initialization. */
export * from "./index.js";
export * from "../catalog-assets/server.js";
export { readLibrary, writeLibrary, writeCompositeLibrary, checkLibrary, emitLibrary, libraryFiles, isLibraryChangeSet, isCompositeChangeSet, LIBRARY_EMIT_TARGETS, LibraryInputError, LibraryConflictError, LibraryCheckError } from "../library-cli/fs-library.js";

export { consumerDogfoodSources, parseConsumerDogfoodContract, runConsumerDogfood } from "../library-cli/consumer-dogfood.js";
export type { ConsumerDogfoodContract } from "../library-cli/consumer-dogfood.js";
