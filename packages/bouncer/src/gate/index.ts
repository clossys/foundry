export { PROTECTED_RESOURCE_METADATA_PATH, createGatedHostGate, createReturnUrlResolver, isNavigationRequest } from "./gate.js";
export { SIGN_OUT_CLEAR_SITE_DATA, SIGN_OUT_DEADLINE_MS, createSignOutHandler } from "./signout.js";

export type {
  GatePermissionAnswer,
  GatePrincipalState,
  GatedHostGate,
  GatedHostGateOptions,
  GatedHostNext,
  HardenedGatedHostGateOptions,
  HardenedReturnUrlResolverOptions,
  ProtectedResourceMetadata,
  ReturnUrlResolverOptions,
} from "./gate.js";
export type {
  SignOutContext,
  SignOutCookieRule,
  SignOutCookieScope,
  SignOutHandler,
  SignOutHandlerOptions,
} from "./signout.js";
