/**
 * Server-only consent copy resolution. The export map refuses this subpath
 * under the `browser` condition, so a resolver or a registry never reaches a
 * client bundle; the client receives the resolved strings.
 */
export { resolveConsentCopy } from "./resolve.js";
export type { ConsentCopyRefs, ConsentCopyTarget, ResolveConsentCopyInput } from "./resolve.js";
export type { ResolvedConsentCopy, ResolvedConsentStatusCopy, ResolvedCopyField } from "./types.js";
