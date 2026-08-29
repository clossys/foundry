/**
 * `@clossys/builder/machine`
 *
 * Composing one machine from several account-owned workspace checkouts plus
 * a third-party-scoped skill source — issue #393. See the package README's
 * "Machine composition" section for the two decisions this subpath
 * implements (builder owns the mechanism, not controller; composition is
 * per-skill links into one composed directory), and `./report.ts` for the
 * orchestration `builder-verify-machine` (`./cli.ts` + `./bin.ts`) is built
 * on.
 */

export {
  WORKSPACES_ROOT_ENV_VAR,
  discoverAccountWorkspaces,
  resolveWorkspacesRoot,
} from "./discovery.js";

export {
  THIRD_PARTY_ROOT_ENV_VAR,
  THIRD_PARTY_SCOPE,
  loadThirdPartySkills,
  resolveThirdPartyRoot,
} from "./third-party.js";

export {
  CLASS_ONE_SOURCE,
  CLASS_ONE_SOURCE_ROOT,
  MACHINE_LAYER_DECLARATION_PATH_ENV_VAR,
  buildClassOneManifest,
  loadClassOnePolicy,
  parseMachineLayerDeclaration,
  resolveClassOneDeclarationPath,
  validateMachineLayerDeclarationShape,
  writeMachineLayerDeclaration,
} from "./machine-layer.js";

export { buildSkillsManifest } from "./skills-manifest.js";

export { createNodeDiscoveryPort } from "./node-discovery.js";

export {
  MACHINE_VERIFY_INPUTS_VERSION,
  machineVerifyReasons,
  verifyMachine,
} from "./report.js";
export type {
  MachineVerifyInputs,
  MachineVerifyReason,
  MachineVerifyReport,
  MachineVerifyRow,
  VerifyMachineOptions,
} from "./report.js";

export type {
  AccountWorkspaceDeclaration,
  AccountWorkspaceDiscoveryResult,
  DiscoveryIndeterminateReason,
  DiscoveryPort,
  MachineLayerDeclaration,
  MachineLayerDeclarationFinding,
  MachineLayerDestinationDeclaration,
  MachineLayerIndeterminateReason,
  MachineLayerInstallKind,
  MachineLayerResult,
  ThirdPartyIndeterminateReason,
  ThirdPartySkill,
  ThirdPartySkillsDeclaration,
  ThirdPartySkillsResult,
  WorkspaceCandidate,
  WorkspaceIndeterminateReason,
} from "./types.js";
export {
  MACHINE_DECLARATION_SCHEMA_VERSION,
  THIRD_PARTY_DECLARATION_FILENAME,
  WORKSPACE_MARKER_FILENAME,
} from "./types.js";
