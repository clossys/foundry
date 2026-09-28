export {
  PROTECTED_RESOURCE_METADATA_PATH,
  buildProtectedResourceMetadata,
  createGatedHostGate,
  isNavigationRequest,
  resolveReturnUrl,
} from "./gate.js";

export type {
  GatePrincipalState,
  GatedHostGate,
  GatedHostGateOptions,
  GatedHostNext,
  ProtectedResourceMetadata,
} from "./gate.js";
