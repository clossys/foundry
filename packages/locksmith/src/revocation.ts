import type { SecretKey } from "./types.js";

/**
 * Where and by whom a key CAN be revoked — a value-free pointer to the
 * upstream identity/access-control layer that actually holds revocation
 * authority. Locksmith records this path; it never calls it. Nothing here
 * performs a revocation, the same way the resolution root entry's adapters
 * never call a provider mutation endpoint.
 */
export interface RevocationPath {
  readonly key: SecretKey;
  /** The upstream authority that can revoke this key (e.g. a provider project or an issuer name). */
  readonly authority: string;
  /** A pointer to the runbook or process a plane follows to revoke this key. Never an executable step locksmith performs. */
  readonly procedure?: string;
}

/** A record that a key was revoked. Metadata only: who, when, and why — never a value. */
export interface RevocationRecord {
  readonly key: SecretKey;
  readonly revokedAt: string;
  readonly revokedBy: string | null;
  readonly reason?: string;
}

function assertParsableDate(iso: string, field: string): void {
  if (Number.isNaN(new Date(iso).getTime())) {
    throw new RangeError(`${field} ${JSON.stringify(iso)} is not a parsable ISO 8601 date-time`);
  }
}

/** Builds a frozen revocation path — a pointer to authority, never an action. */
export function defineRevocationPath(path: RevocationPath): Readonly<RevocationPath> {
  return Object.freeze({
    key: path.key,
    authority: path.authority,
    ...(path.procedure === undefined ? {} : { procedure: path.procedure }),
  });
}

/** Builds a frozen revocation record after validating that `revokedAt` is a real date. */
export function recordRevocation(record: RevocationRecord): Readonly<RevocationRecord> {
  assertParsableDate(record.revokedAt, "revokedAt");
  return Object.freeze({
    key: record.key,
    revokedAt: record.revokedAt,
    revokedBy: record.revokedBy,
    ...(record.reason === undefined ? {} : { reason: record.reason }),
  });
}

/** Whether any record in the list revokes the given key. */
export function isRevoked(records: readonly RevocationRecord[], key: SecretKey): boolean {
  return records.some((record) => record.key === key);
}

/** The most recent revocation record for a key, or `undefined` if it was never revoked. */
export function latestRevocation(
  records: readonly RevocationRecord[],
  key: SecretKey,
): RevocationRecord | undefined {
  return records
    .filter((record) => record.key === key)
    .sort((a, b) => new Date(b.revokedAt).getTime() - new Date(a.revokedAt).getTime())[0];
}
