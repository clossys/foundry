/**
 * The resolved consent copy the server hands to the client assembly.
 *
 * Plain strings with their provenance: the client receives resolved text,
 * never a resolver or a registry. This module has no runtime import, so the
 * client entry can import its types without reaching the copy resolver.
 */

/** One resolved field: its text and where it came from. */
export interface ResolvedCopyField {
  text: string;
  recordId: string;
  entryId: string;
  revision: string;
  locale: string;
}

/** The status lines the notice can show, one at a time. */
export interface ResolvedConsentStatusCopy {
  memoryOnly: ResolvedCopyField;
  withdrawalFailed: ResolvedCopyField;
  evidenceUnavailable: ResolvedCopyField;
  evidenceConflict: ResolvedCopyField;
  storageUnavailable: ResolvedCopyField;
  gpcInForce: ResolvedCopyField;
}

/** Every field the notice needs. Both leads and every status line are required whatever the regime. */
export interface ResolvedConsentCopy {
  title: ResolvedCopyField;
  promptLead: ResolvedCopyField;
  noticeLead: ResolvedCopyField;
  acceptLabel: ResolvedCopyField;
  rejectLabel: ResolvedCopyField;
  privacyLinkLabel: ResolvedCopyField;
  status: ResolvedConsentStatusCopy;
}
