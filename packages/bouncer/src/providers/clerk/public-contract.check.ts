import type {
  ClerkEventMappingOptions,
  ClerkLifecycleEventName,
  ClerkLocalIdResolution,
  ClerkMembershipEvent,
  ClerkNormalizedEvent,
  ClerkRoleMapper,
  ClerkWebhookHeaders,
  ClerkWebhookSignatureError,
  ClerkWebhookSignatureErrorCode,
  assertClerkWebhookSigningSecret,
  mapClerkEvent,
  resolveClerkMembershipLocalIds,
  verifyAndMapClerkWebhook,
  verifyClerkWebhook,
} from "./index.js";

type IsAssignable<Actual, Expected> = Actual extends Expected ? true : false;

type MapResult = Awaited<ReturnType<typeof mapClerkEvent>>;
type ResolveResult = Awaited<ReturnType<typeof resolveClerkMembershipLocalIds>>;
type VerifyAndMapResult = Awaited<ReturnType<typeof verifyAndMapClerkWebhook>>;
type VerifyResult = ReturnType<typeof verifyClerkWebhook>;

type MapResultContract = IsAssignable<MapResult, { status: "mapped" } | { status: "ignored" } | { status: "invalid" }>;
type ResolverResultContract = IsAssignable<ResolveResult, ClerkLocalIdResolution>;
type VerifyAndMapResultContract = IsAssignable<VerifyAndMapResult, MapResult>;
type MembershipRoleContract = Extract<ClerkMembershipEvent, { type: "created" | "updated" }> extends { role: string } ? true : false;
type NormalizedMembershipContract = Extract<ClerkNormalizedEvent, { kind: "membership" }> extends ClerkMembershipEvent ? true : false;
type RequiredRoleMapperContract = ClerkEventMappingOptions extends { roleMapper: ClerkRoleMapper } ? true : false;
type SignatureErrorContract = ClerkWebhookSignatureError extends Error ? true : false;
type SignatureErrorCodeContract = [ClerkWebhookSignatureErrorCode] extends ["signing-secret-invalid" | "signature-headers-missing" | "signature-invalid" | "payload-invalid"]
  ? (["signing-secret-invalid" | "signature-headers-missing" | "signature-invalid" | "payload-invalid"] extends [ClerkWebhookSignatureErrorCode] ? true : false)
  : false;
type SignatureErrorCodeFieldContract = ClerkWebhookSignatureError extends { code: ClerkWebhookSignatureErrorCode } ? true : false;
type SigningSecretGuardContract = typeof assertClerkWebhookSigningSecret extends (signingSecret: unknown) => string | Uint8Array ? true : false;
type VerifiedEventContract = VerifyResult extends { eventId: string; event: unknown } ? true : false;
type LifecycleAliasContract = IsAssignable<
  | "organization_membership.created"
  | "organization_membership.updated"
  | "organization_membership.deleted",
  ClerkLifecycleEventName
>;

export const mapResultContract: MapResultContract = true;
export const resolverResultContract: ResolverResultContract = true;
export const verifyAndMapResultContract: VerifyAndMapResultContract = true;
export const membershipRoleContract: MembershipRoleContract = true;
export const normalizedMembershipContract: NormalizedMembershipContract = true;
export const requiredRoleMapperContract: RequiredRoleMapperContract = true;
export const signatureErrorContract: SignatureErrorContract = true;
export const signatureErrorCodeContract: SignatureErrorCodeContract = true;
export const signatureErrorCodeFieldContract: SignatureErrorCodeFieldContract = true;
export const signingSecretGuardContract: SigningSecretGuardContract = true;
export const verifiedEventContract: VerifiedEventContract = true;
export const lifecycleAliasContract: LifecycleAliasContract = true;

declare const fetchRequestHeaders: Headers;
export const fetchHeadersContract: ClerkWebhookHeaders = fetchRequestHeaders;
