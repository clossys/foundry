// Real compiler assertions: test files are transpiled without checking types.
// These exact parameter/return equalities are part of the package's tsc input.
import type { writeCompositeLibrary, CompositeCatalogData, CompositeChangeSet, CompositeLibraryData } from "./server.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type Writer = typeof writeCompositeLibrary;
export type WriterCatalogParameter = Expect<Equal<Parameters<Writer>[1], CompositeCatalogData>>;
export type WriterChangesParameter = Expect<Equal<Parameters<Writer>[2], CompositeChangeSet>>;
export type WriterReturn = Expect<Equal<ReturnType<Writer>, Promise<CompositeLibraryData>>>;
