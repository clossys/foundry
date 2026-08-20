export type IntegratorErrorCode =
  | "INVALID_ENTITLEMENT_DECLARATION"
  | "INVALID_ADMISSION_CONTRACT"
  | "INVALID_INVENTORY_SOURCE"
  | "INVALID_VERSION"
  | "INVALID_SUPERSESSION_MANIFEST"
  | "INVALID_SUPERSESSION_MAP";

/**
 * Thrown by every offline validator in this package (`loadEntitlementDeclaration`,
 * `loadAdmissionContract`, `readInstalledInventory`, `parseVersion`,
 * `detectSupersession`'s internal manifest and map parsers). All of
 * them validate data that arrived from outside this process -- a plane's own
 * declaration file, its own manifest, its own lockfile -- and all of them
 * throw rather than return findings, for the same reason
 * `@vespeneventures/provisioning`'s `loadManifest` does: a caller about to
 * reconcile or admit against malformed input has no useful "continue with the
 * parts that parsed".
 */
export class IntegratorValidationError extends Error {
  readonly code: IntegratorErrorCode;

  constructor(code: IntegratorErrorCode, message: string) {
    super(message);
    this.name = "IntegratorValidationError";
    this.code = code;
  }
}
