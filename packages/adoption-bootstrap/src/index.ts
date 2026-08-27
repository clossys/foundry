/** Consumer-owned adoption-bootstrap contracts and pure result validation. */
export { evaluateBootstrap, evaluateProcessResult, isNormalizedRelativePath, validateBootstrapRequest } from "./core.js";
export type {
  BootstrapEvaluationInput,
  BootstrapFinding,
  BootstrapPhase,
  BootstrapReport,
  BootstrapRequest,
  BootstrapState,
  ExactPackage,
  InstallReceipt,
  PackageManager,
  ProcessObservation,
  SnapshotFile,
  SnapshotManifest,
  TargetPackage,
  TrustedEvent,
} from "./types.js";
