/** Consumer-owned starter contracts and pure result validation. */
export { evaluateStarter, evaluateProcessResult, isNormalizedRelativePath, validateStarterRequest } from "./core.js";
export type {
  StarterEvaluationInput,
  StarterFinding,
  StarterPhase,
  StarterReport,
  StarterRequest,
  StarterState,
  ExactPackage,
  InstallReceipt,
  PackageManager,
  ProcessObservation,
  SnapshotFile,
  SnapshotManifest,
  TargetPackage,
  TrustedEvent,
} from "./types.js";
