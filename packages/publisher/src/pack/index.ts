/**
 * The v0 Launch pack (issue #1204): Publisher plans first and seals last.
 * `clossys/publisher/pack.json` is the manifest this module's types and
 * functions describe. See this package's README, "The pack" section, for
 * the full MECE layer table and the pack/loop lifecycle mapping.
 *
 * Pack item statuses and the lifecycle they specialize (issue #1228) are
 * NOT declared here: this package imports them from `@clossys/controller`
 * (`docs/contracts/lifecycle.json`'s own governance rule — "No package
 * other than @clossys/controller declares its own copy of `states` or
 * `conditions`") and forwards them below for convenience, rather than
 * restating them.
 */
export { LIFECYCLE_CONDITIONS, LIFECYCLE_STATES, PACK_STATUSES, packStatusToLifecycle } from "@clossys/controller";
export type { LifecycleCondition, LifecycleState, PackStatus, PackStatusLifecyclePosition } from "@clossys/controller";

export { isPackLayer, isPackVersionString, isPackVisibility, PACK_LAYERS, PACK_VISIBILITIES } from "./types.js";
export type { PackItem, PackLayer, PackManifest, PackSourcePin, PackVisibility } from "./types.js";

export { validatePackManifest } from "./validate.js";
export type { PackFinding, PackValidationResult } from "./validate.js";

export { computePackReadiness, planPackOrder, sealableItemIds } from "./readiness.js";
export type { PackItemReadiness, PackReadiness } from "./readiness.js";

export { detectExistingPackItems, foundPackItem } from "./adopt.js";
export type { PackAdoptionCandidate, PackAdoptionResult } from "./adopt.js";
