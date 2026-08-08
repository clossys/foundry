/**
 * @vespeneventures/assets — public entry point. See README.md for the full
 * picture: what this package is (the visual-registry twin of
 * `@vespeneventures/copy`'s verbal registry), the frozen `AssetEntry`/
 * `AssetRecord` contract, and why generation is explicitly out of scope.
 *
 * Everything here is pure except `registry.ts`'s one deliberate I/O
 * surface — no network, no image API, no model calls, and zero runtime
 * dependencies (see the README, "Requirements"). Four things ship:
 *
 *   1. THE CONTRACT (`types.ts`) — `AssetEntry`/`AssetRecord` and every
 *      shape they're built from.
 *   2. VALIDATION (`schema.ts`) — `validateAssetRecordShape`/
 *      `parseAssetRecord`, hand-rolled shape validation in the style of
 *      `@vespeneventures/copy`'s own `schema.ts`.
 *   3. THE READER (`registry.ts`) — `readAssetRecord`, the one place this
 *      package touches a filesystem.
 *   4. THE COVERAGE CHECK (`coverage.ts`) — `checkAssetCoverage`, comparing
 *      a list of referenced asset ids against a real `AssetRecord`.
 */

export type { AssetEntry, AssetEntryId, AssetFinding, AssetRecord } from "./types.js";

export { parseAssetRecord, validateAssetRecordShape } from "./schema.js";

export { readAssetRecord } from "./registry.js";
export type { AssetRegistryReadIssue, AssetRegistryReadIssueReason, AssetRegistryReadResult } from "./registry.js";

export { checkAssetCoverage } from "./coverage.js";
export type { AssetCoverageReport } from "./coverage.js";
