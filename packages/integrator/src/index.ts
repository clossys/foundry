/**
 * @vespeneventures/integrator
 *
 * The machinery a consuming plane runs against ITSELF to answer whether it
 * holds the catalogue it is entitled to, and whether that holding is current:
 * entitlement and opt-out validation, an installed-inventory reader, a
 * version reconciler, a reachability probe, and an admission contract.
 *
 * It ships no registry of consumers, and never will: this package supplies
 * planes that do not govern each other, so it must never learn who installs
 * it, and every value in its API is caller-supplied. See each module's own
 * doc comment for why.
 */

export { IntegratorValidationError } from "./errors.js";
export type { IntegratorErrorCode } from "./errors.js";

export { isValidPackageName } from "./package-name.js";

export { loadEntitlementDeclaration } from "./entitlement.js";
export type { EntitlementEntry, OptOutEntry, EntitlementDeclaration } from "./entitlement.js";

export { readInstalledInventory } from "./inventory.js";
export type { InventoryFileSystemPort, InventorySourceOptions, InstalledPackage, InstalledInventory } from "./inventory.js";

export { createNodeInventoryFileSystem } from "./node-fs.js";

export { probeReachability, resolveReachability } from "./reachability.js";
export type { Transport, ProbeOutcome, ReachabilityProbeOptions, ReachabilityVerdict } from "./reachability.js";

export { judgeCurrency, upgradeSet, optOutGaps, computeCurrencyMetric } from "./currency.js";
export type { PackageCurrency, JudgeCurrencyInput, UpgradeSetEntry, CurrencyMetric } from "./currency.js";

export { loadAdmissionContract, evaluateAdmission } from "./admission.js";
export type { AdmissionRule, AdmissionContract, AdmissionCandidate, AdmissionContext, AdmissionFinding } from "./admission.js";

export { parseVersion, compareVersions } from "./semver.js";
export type { ParsedVersion } from "./semver.js";
