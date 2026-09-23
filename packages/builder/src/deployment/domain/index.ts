/**
 * The web deployment surface: domain, DNS records, hosting mapping, and
 * `apps/site` build settings (#1211) -- declared once (`defineWebSurface
 * Declaration`), rendered as a reviewable setup plan
 * (`renderWebSurfaceSetupSteps`), and checked against live DNS resolution,
 * the live TLS certificate, live HTTP status, and (optionally) the right
 * deployment serving (`verifyWebSurfaceLiveState`). Provider-neutral, with
 * Cloudflare DNS and Vercel hosting as the first worked example -- see
 * `vercel-hosting.ts`'s header for exactly where that one adapter sits.
 *
 * Every live check is read-only, needs no provider credential to run DNS,
 * TLS, and HTTP checks, and degrades to `indeterminate` -- never
 * `satisfied` -- when it could not reach what it was checking. See #914 and
 * this package's own README.
 */
export {
  DNS_RECORD_TYPES,
} from "./types.js";
export type {
  DnsRecord,
  DnsRecordDefinition,
  DnsRecordType,
  WebSurfaceBuildSettings,
  WebSurfaceBuildSettingsDefinition,
  WebSurfaceDeclaration,
  WebSurfaceDeclarationDefinition,
  WebSurfaceEnvironment,
  WebSurfaceEnvironmentDefinition,
  WebSurfaceFinding,
} from "./types.js";

export { isValidWebSurfaceDeclaration, validateWebSurfaceDeclaration } from "./validate.js";
export { defineWebSurfaceDeclaration } from "./define.js";
export { normalizeWebSurfaceDeclaration, serializeWebSurfaceDeclaration } from "./normalize.js";
export { renderWebSurfaceSetupSteps } from "./setup-steps.js";

export { DNS_CHECK_REASONS, checkDnsRecords } from "./dns-check.js";
export type { DnsCheckIndeterminateReason, DnsResolver } from "./dns-check.js";
export { createNodeDnsResolver } from "./node-dns.js";
export type { NodeDnsPort } from "./node-dns.js";

export { TLS_CHECK_REASONS, checkTlsCertificate } from "./tls-check.js";
export type { TlsCertificateProbe, TlsCheckIndeterminateReason, TlsProbeObservation } from "./tls-check.js";
export { createNodeTlsProbe } from "./node-tls.js";
export type { CreateNodeTlsProbeOptions, NodeTlsConnect } from "./node-tls.js";

export { HTTP_CHECK_REASONS, checkRoutes } from "./http-check.js";
export type { HttpCheckIndeterminateReason, WebSurfaceFetch } from "./http-check.js";

export { VERCEL_HOSTING_REASONS, observeVercelHosting } from "./vercel-hosting.js";
export type { VercelHostingIndeterminateReason } from "./vercel-hosting.js";

export { verifyWebSurfaceLiveState } from "./verify.js";
export type { WebSurfaceHostingIndeterminateReason, WebSurfaceLiveVerificationReport, WebSurfaceVerificationPorts } from "./verify.js";
