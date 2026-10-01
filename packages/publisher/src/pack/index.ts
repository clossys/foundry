/**
 * The v0 Launch pack (issue #1204): Publisher plans first and seals last.
 * `clossys/publisher/pack.json` is the manifest this module's types and
 * functions describe. See this package's README, "The pack" section, for
 * the full MECE layer table and the pack/loop lifecycle mapping.
 *
 * Pack item statuses and the lifecycle they specialize (issue #1228) are
 * NOT declared here: this package imports them from `@clossys/controller`
 * (this repository's own `docs/contracts/lifecycle.json` — not shipped in
 * any published package, repository tooling only — states the governance
 * rule: "No package other than @clossys/controller declares its own copy
 * of `states` or `conditions`") and forwards them below for convenience,
 * rather than restating them.
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

export { importLegacyV0Pack, LEGACY_V0_PACK_ITEMS, LEGACY_V0_PACK_OUTPUT_PATH, writeLegacyV0PackImport } from "./legacy-v0.js";
export type {
  LegacyV0Pack,
  LegacyV0PackImportResult,
  LegacyV0PackIssue,
  LegacyV0PackItem,
  LegacyV0PackItemSpec,
  LegacyV0PackKey,
  LegacyV0PackStatus,
  LegacyV0PackWriteResult,
} from "./legacy-v0.js";

export { checkSealEvidence, sealWebsite } from "./seal.js";
export type {
  CheckSealEvidenceOptions,
  SealFinding,
  SealWebsiteInput,
  SealWebsiteResult,
  WebsiteSealContactIntake,
  WebsiteSealEvidence,
  WebsiteSealPage,
} from "./seal.js";

export { lintRenderedHead } from "./head-lint.js";
export type { LintRenderedHeadInput, RenderedHeadPage } from "./head-lint.js";
