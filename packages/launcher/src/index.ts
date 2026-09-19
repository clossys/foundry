/** Consumer-owned workspace hub scaffolder: create, resume, or appoint a GitHub repository. */
export {
  applyWorkspacePlan,
  formatHubHealth,
  inspectInventory,
  isHubDocument,
  observeWorkspace,
  parseGitHubRemote,
  planWorkspace,
  reportHubHealth,
  DEFAULT_REPOSITORY_NAME,
  WORKSPACE_INVENTORY_REL,
  WORKSPACE_MARKER_REL,
} from "./core.js";
export type {
  CommandResult,
  CwdObservation,
  HubDocument,
  HubHealthReport,
  InventoryObservation,
  WorkspaceApplyResult,
  WorkspaceDecision,
  WorkspaceHost,
  WorkspaceObservation,
  WorkspacePlan,
  WorkspaceRefusal,
  WorkspaceState,
} from "./types.js";
