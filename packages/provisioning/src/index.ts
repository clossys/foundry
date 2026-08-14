/**
 * @vespeneventures/provisioning
 *
 * An idempotent engine for applying a provisioning manifest to a machine, and
 * for checking afterwards whether the machine still agrees with it.
 *
 * The engine is neutral machinery: it applies manifests and owns none. It has
 * no opinion about what belongs in one, no default manifest, and no knowledge
 * of any particular document set. Pointing it at a manifest is the only way to
 * make it do anything.
 *
 * Two properties make it safe to run repeatedly. Planning is pure -- resolution
 * happens with no filesystem access at all, so a plan can be inspected before
 * anything is mutated. And verification reads the machine rather than the
 * manifest, because a manifest always says the installation is correct; that is
 * what a manifest is.
 */

export type {
  ApplyOptions,
  ApplyResult,
  CopyEntry,
  FileStats,
  FileSystemPort,
  Finding,
  LinkEntry,
  ManagedBlockEntry,
  Manifest,
  OperationKind,
  Plan,
  PlanOperation,
  PrivateDirectoryEntry,
  RuntimeContext,
  Severity,
} from "./types.js";

export { loadManifest } from "./manifest.js";

export { createRuntimeContext, expandTokens, planInstallation } from "./runtime.js";
export type { RuntimeOptions } from "./runtime.js";

export {
  composeManagedBlock,
  hasExactlyOneBlock,
  renderManagedBlock,
  withoutManagedBlock,
} from "./blocks.js";

export { PRIVATE_DIRECTORY_MODE, applyInstallation } from "./apply.js";
export { verifyInstallation } from "./verify.js";

export { createNodeFileSystem } from "./node-fs.js";
