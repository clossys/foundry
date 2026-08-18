import { IntegratorValidationError } from "./errors.js";
import { isValidPackageName } from "./package-name.js";

/**
 * A plane's own declaration of what catalogue it is entitled to, and which of
 * those entitlements it has deliberately chosen not to install.
 *
 * This is the "plane owns its inventory" half of the blindness rule: nothing
 * here names a plane, an account, or a consumer. It is a schema and a
 * validator for a document a plane writes about ITSELF, and the caller
 * supplies the parsed content -- this module never reads a file.
 */

export interface EntitlementEntry {
  readonly name: string;
}

/**
 * A recorded decision not to install an entitled package. `reason` is
 * required, not optional, because that is the entire point: an opt-out with
 * no reason is indistinguishable from a plane that simply never got around to
 * installing something, and that is the exact drift this package exists to
 * surface. See `absent-with-reason` / `absent-without-reason` in `currency.ts`.
 */
export interface OptOutEntry {
  readonly name: string;
  readonly reason: string;
  /** ISO 8601 date or date-time. Optional -- when it decided is evidence, not a requirement. */
  readonly recordedOn?: string;
}

export interface EntitlementDeclaration {
  readonly version: 1;
  readonly entitlements: readonly EntitlementEntry[];
  readonly optOuts: readonly OptOutEntry[];
}

const ISO_DATE_LIKE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

function fail(message: string): never {
  throw new IntegratorValidationError("INVALID_ENTITLEMENT_DECLARATION", message);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("Entry must be an object");
  }
  return value as Record<string, unknown>;
}

/**
 * Validate a parsed entitlement declaration and return it in normalized form.
 * Offline: takes an already-parsed value and never reads a file, so a caller
 * can validate a declaration that came from a checkout, a request body, or a
 * test fixture, the same way `@vespeneventures/provisioning`'s `loadManifest`
 * does for a provisioning manifest.
 *
 * Throws on the first problem rather than collecting findings: a declaration
 * this repository cannot parse is not a fact this repository can reconcile
 * against, whereas the currency judgment downstream (`judgeCurrency`) always
 * finishes and reports every entitlement, because a drift report is only
 * useful complete.
 */
export function loadEntitlementDeclaration(raw: unknown): EntitlementDeclaration {
  const record = asRecord(raw);
  if (record["version"] !== 1) fail("Declaration must set version: 1");

  const rawEntitlements = record["entitlements"];
  if (!Array.isArray(rawEntitlements)) fail("entitlements must be an array");

  const entitlementNames = new Set<string>();
  const entitlements: EntitlementEntry[] = [];
  for (const item of rawEntitlements) {
    const entry = asRecord(item);
    const name = entry["name"];
    if (!isValidPackageName(name)) fail(`entitlements entry has an invalid name: ${JSON.stringify(name)}`);
    if (entitlementNames.has(name)) fail(`entitlements declares ${name} more than once`);
    entitlementNames.add(name);
    entitlements.push({ name });
  }

  const rawOptOuts = record["optOuts"];
  if (rawOptOuts !== undefined && !Array.isArray(rawOptOuts)) fail("optOuts must be an array");

  const optOutNames = new Set<string>();
  const optOuts: OptOutEntry[] = [];
  for (const item of rawOptOuts ?? []) {
    const entry = asRecord(item);
    const name = entry["name"];
    if (!isValidPackageName(name)) fail(`optOuts entry has an invalid name: ${JSON.stringify(name)}`);
    if (!entitlementNames.has(name)) fail(`optOuts declares ${name}, which is not in entitlements -- an opt-out can only decline something the plane is entitled to`);
    if (optOutNames.has(name)) fail(`optOuts declares ${name} more than once`);
    optOutNames.add(name);

    const reason = entry["reason"];
    if (typeof reason !== "string" || reason.trim().length === 0) {
      fail(`optOuts entry for ${name} must declare a non-empty reason`);
    }

    const recordedOn = entry["recordedOn"];
    if (recordedOn !== undefined && (typeof recordedOn !== "string" || !ISO_DATE_LIKE.test(recordedOn))) {
      fail(`optOuts entry for ${name} has an invalid recordedOn: ${JSON.stringify(recordedOn)}`);
    }

    optOuts.push({
      name,
      reason: reason.trim(),
      ...(recordedOn === undefined ? {} : { recordedOn }),
    });
  }

  return {
    version: 1,
    entitlements: Object.freeze(entitlements),
    optOuts: Object.freeze(optOuts),
  };
}
