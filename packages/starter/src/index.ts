/** Consumer-owned starter contracts and pure result validation. */
export { evaluateHeadInstall, evaluateStarter, evaluateProcessResult, isNormalizedRelativePath, validateStarterRequest } from "./core.js";
export type {
  HeadInstallEvaluationInput,
  HeadInstallIdentity,
  HeadInstallObservation,
  HeadInstallReport,
  HeadInstallRole,
  StarterEvaluationInput,
  StarterFinding,
  StarterHubEvidence,
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
