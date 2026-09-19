/** Consumer-owned workspace hub scaffolder: create, resume, or appoint a GitHub repository. */
export {
  applyWorkspacePlan,
  isHubDocument,
  observeWorkspace,
  parseGitHubRemote,
  planWorkspace,
  DEFAULT_REPOSITORY_NAME,
  WORKSPACE_MARKER_REL,
} from "./core.js";
export type {
  CommandResult,
  CwdObservation,
  HubDocument,
  WorkspaceDecision,
  WorkspaceHost,
  WorkspaceObservation,
  WorkspacePlan,
  WorkspaceRefusal,
  WorkspaceState,
} from "./types.js";
