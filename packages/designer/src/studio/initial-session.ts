import { runtimeHash, runtimeSnapshot } from "../catalog-core/runtime-ports.js";
import type { RuntimeDigest } from "../catalog-core/runtime-ports.js";
import { loadBuildCatalog } from "../catalog-core/index.js";
import type { BuildCatalogData, CompositeCatalogData } from "../catalog-core/index.js";
import type { CompositeStudioSnapshot } from "./types.js";

/** Finite committed facts only. Runtime/preview ports and fileExists are behavior:
 * they stay on the local adapter load and are never serialized as evidence. */
export type WholeStudioInitialSnapshot = Pick<CompositeStudioSnapshot, "library" | "componentOptions" | "surfaceOptions" | "bundles" | "surfaceBundles" | "usageGraph">;
export interface WholeStudioInitialSession {
  readonly kind: "designer.initial-session";
  readonly version: 1;
  readonly id: string;
  readonly snapshot: WholeStudioInitialSnapshot;
  readonly catalogHash: RuntimeDigest;
  readonly contractsHash: RuntimeDigest;
  readonly digest: RuntimeDigest;
}
const fields = ["library", "componentOptions", "surfaceOptions", "bundles", "surfaceBundles", "usageGraph"] as const;
/** Public finite boundary shared by server creation and the original client provider. */
function wholeStudioSnapshotFacts(snapshot: CompositeStudioSnapshot): WholeStudioInitialSnapshot {
  return runtimeSnapshot(Object.fromEntries(fields.filter(key => snapshot[key] !== undefined).map(key => [key, snapshot[key]]))) as unknown as WholeStudioInitialSnapshot;
}
/** Catalog identity is finite descriptors, including each executable surface rule's
 * declared identity and source bytes. Only its local run callback is outside the
 * wire boundary; this digest does not qualify that executable behavior. */
export function wholeStudioCatalogHash(catalog: CompositeCatalogData): RuntimeDigest {
  const finiteRule = <T extends { run: unknown }>(rule: T): Omit<T, "run"> => { const { run: _run, ...facts } = rule; return facts; };
  return runtimeHash({ ...catalog, ...(catalog.surfaces ? { surfaces: { ...catalog.surfaces, transforms: catalog.surfaces.transforms.map(finiteRule), rules: catalog.surfaces.rules.map(finiteRule) } } : {}) });
}
/** Server-safe integrity seal, not server-origin authentication or runtime qualification.
 * The host supplies its real committed snapshot and chosen session id. */
export function createWholeStudioInitialSession(input: { readonly id: string; readonly snapshot: CompositeStudioSnapshot; readonly catalog: CompositeCatalogData; readonly contracts?: BuildCatalogData }): WholeStudioInitialSession {
  if (typeof input.id !== "string" || !input.id.trim()) throw new TypeError("Initial Designer session id required");
  const snapshot = wholeStudioSnapshotFacts(input.snapshot);
  if (!snapshot.library || !snapshot.library.source?.id) throw new TypeError("Initial Designer committed snapshot required");
  const facts = { kind: "designer.initial-session" as const, version: 1 as const, id: input.id, snapshot, catalogHash: wholeStudioCatalogHash(input.catalog), contractsHash: runtimeHash(input.contracts ?? loadBuildCatalog()) };
  return runtimeSnapshot({ ...facts, digest: runtimeHash(facts) });
}
/** Recheck JSON wire data against the actual provider catalog/contracts and,
 * after its load, the current committed snapshot. Never transfers a process seal. */
export function checkWholeStudioInitialSession(value: WholeStudioInitialSession, catalog: CompositeCatalogData, contracts: BuildCatalogData = loadBuildCatalog(), snapshot?: CompositeStudioSnapshot): WholeStudioInitialSession {
  const sealed = runtimeSnapshot(value);
  if (!sealed || Object.keys(sealed).sort().join(",") !== "catalogHash,contractsHash,digest,id,kind,snapshot,version" || sealed.kind !== "designer.initial-session" || sealed.version !== 1 || !sealed.snapshot || Object.keys(sealed.snapshot).some(key => !fields.includes(key as typeof fields[number]))) throw new TypeError("Sealed initial Designer session required");
  const expected = createWholeStudioInitialSession({ id: sealed.id, snapshot: sealed.snapshot, catalog, contracts });
  if (runtimeHash(sealed) !== runtimeHash(expected) || snapshot && runtimeHash(wholeStudioSnapshotFacts(snapshot)) !== runtimeHash(sealed.snapshot)) throw new TypeError("Initial Designer session seal or current snapshot differs");
  return sealed;
}
