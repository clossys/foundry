/**
 * Structural validation for a governed artifact manifest and for the
 * caller-supplied verification options — shape only, no orchestration and
 * no checksum comparison. `verify.ts` composes these into the deterministic
 * verification order; this file exists so that order can be documented and
 * reasoned about in one place, separate from the pure "is this shape sound"
 * question answered here.
 *
 * Every function here follows this package's established discipline (see
 * `../lifecycle.ts` and `../review/validate.ts`): read each own-data field
 * exactly once via `Object.getOwnPropertyDescriptor`, never through a plain
 * property access that could re-invoke a getter on a later read and
 * disagree with itself (a TOCTOU hazard on a hostile or Proxy-backed
 * `value` — this function's whole job is to not trust `value`'s shape).
 * Never throws: every branch, including an exotic value that throws on
 * `typeof`/`Array.isArray`/`Object.keys`, is caught and turned into a
 * finding instead of an exception.
 *
 * Digest algorithm/length SHAPE checking is deliberately NOT reimplemented
 * here. `checksum.algorithm`/`checksum.digest` are handed to
 * `@clossys/controller/policy`'s own `validateBindingShape` (via a small
 * synthetic `PolicyBinding`) rather than this module re-deriving "which
 * algorithms are known" or "how many hex characters a digest needs for
 * one" — `policy` already owns that, and duplicating it here is exactly
 * the kind of drift the "delegate digest comparison to policy" requirement
 * exists to prevent from creeping in one layer up, at shape-check time.
 */

import { validateBindingShape } from "../policy/index.js";
import type { DigestAlgorithm, Finding } from "../policy/index.js";
import type { GovernedArtifactManifest } from "./types.js";

type UnknownRecord = Record<string, unknown>;

const MANIFEST_KEYS = new Set(["kind", "schemaVersion", "checksum", "provenance"]);
const CHECKSUM_KEYS = new Set(["algorithm", "digest"]);
const PROVENANCE_KEYS = new Set(["source", "revision", "recordedAt"]);
const OPTIONS_KEYS = new Set(["artifactKind", "supportedSchemaVersions"]);
const MAX_SUPPORTED_VERSIONS = 10_000;
const RFC3339_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads one own field of `record` exactly once, distinguishing "absent" from "accessor" from "real data value". */
function ownDataValue(record: UnknownRecord, key: string): { present: boolean; value?: unknown; accessor: boolean } {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) return { present: false, accessor: false };
  if (!("value" in descriptor)) return { present: true, accessor: true };
  return { present: true, value: descriptor.value, accessor: false };
}

function arrayEntry(value: unknown[], index: number): { value?: unknown; accessor: boolean } {
  const descriptor = Object.getOwnPropertyDescriptor(value, index);
  if (!descriptor) return { accessor: false };
  if (!("value" in descriptor)) return { accessor: true };
  return { value: descriptor.value, accessor: false };
}

function isDenseArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || value.length > MAX_SUPPORTED_VERSIONS) return false;
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function finding(rule: string, path: string, message: string): Finding {
  return { rule, severity: "error", path, message };
}

function findUnknownFields(record: UnknownRecord, allowed: ReadonlySet<string>, rule: string, path: string, findings: Finding[]): void {
  for (const key of Object.keys(record).sort()) {
    if (!allowed.has(key)) findings.push(finding(rule, `${path}.${key}`, `Unknown field "${key}".`));
  }
}

function isValidTimestamp(value: string): boolean {
  const match = RFC3339_TIMESTAMP.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const asDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    asDate.getUTCFullYear() === year &&
    asDate.getUTCMonth() === month - 1 &&
    asDate.getUTCDate() === day &&
    asDate.getUTCHours() === hour &&
    asDate.getUTCMinutes() === minute &&
    asDate.getUTCSeconds() === second
  );
}

/**
 * The result of reading and validating a candidate manifest. `manifest` is
 * present ONLY when `findings` contains zero error-severity entries — a
 * plain-object snapshot of exactly the fields `verifyGovernedArtifact`
 * needs, copied out once during validation so later stages never have to
 * read the original (possibly hostile, possibly Proxy-backed) `value`
 * again. This mirrors `@clossys/controller/policy`'s own `verifyBinding`,
 * which snapshots its `binding` argument for the identical reason before
 * ever comparing a digest against it.
 */
export interface GovernedArtifactManifestRead {
  readonly findings: readonly Finding[];
  readonly manifest?: GovernedArtifactManifest;
}

function readChecksum(value: UnknownRecord, findings: Finding[]): GovernedArtifactManifest["checksum"] | undefined {
  const checksumField = ownDataValue(value, "checksum");
  if (checksumField.accessor) {
    findings.push(finding("artifact/field-accessor", "checksum", "Manifest fields must be own data properties, not getters."));
    return undefined;
  }
  if (!isRecord(checksumField.value)) {
    findings.push(finding("artifact/checksum-shape", "checksum", "checksum must be an object."));
    return undefined;
  }
  const checksum = checksumField.value;
  findUnknownFields(checksum, CHECKSUM_KEYS, "artifact/checksum-unknown-field", "checksum", findings);

  const algorithmField = ownDataValue(checksum, "algorithm");
  const digestField = ownDataValue(checksum, "digest");
  if (algorithmField.accessor) findings.push(finding("artifact/field-accessor", "checksum.algorithm", "Manifest fields must be own data properties, not getters."));
  if (digestField.accessor) findings.push(finding("artifact/field-accessor", "checksum.digest", "Manifest fields must be own data properties, not getters."));
  if (algorithmField.accessor || digestField.accessor) return undefined;

  // Delegate shape checking to policy's own validateBindingShape via a
  // synthetic binding — see this file's top-level doc comment. policyId is
  // a fixed non-empty literal this function itself supplies, so
  // "policy-id-shape" and "binding-present" can never fire below; only
  // "digest-algorithm-known" (path "digestAlgorithm") and "digest-shape"
  // (path "digest") ever can, and both are rewritten onto this manifest's
  // own "checksum.*" paths so the finding still points at the field the
  // caller actually supplied.
  const shapeFindings = validateBindingShape({
    policyId: "governed-artifact-checksum",
    digestAlgorithm: algorithmField.value,
    digest: digestField.value,
  });
  let shapeOk = true;
  for (const shapeFinding of shapeFindings) {
    shapeOk = false;
    if (shapeFinding.path === "digestAlgorithm") findings.push({ ...shapeFinding, path: "checksum.algorithm" });
    else if (shapeFinding.path === "digest") findings.push({ ...shapeFinding, path: "checksum.digest" });
    else findings.push(shapeFinding);
  }
  if (!shapeOk) return undefined;

  return { algorithm: algorithmField.value as DigestAlgorithm, digest: digestField.value as string };
}

function readProvenance(value: UnknownRecord, findings: Finding[]): GovernedArtifactManifest["provenance"] | undefined {
  const provenanceField = ownDataValue(value, "provenance");
  if (provenanceField.accessor) {
    findings.push(finding("artifact/field-accessor", "provenance", "Manifest fields must be own data properties, not getters."));
    return undefined;
  }
  if (!isRecord(provenanceField.value)) {
    findings.push(finding("artifact/provenance-shape", "provenance", "provenance must be an object."));
    return undefined;
  }
  const provenance = provenanceField.value;
  findUnknownFields(provenance, PROVENANCE_KEYS, "artifact/provenance-unknown-field", "provenance", findings);

  const sourceField = ownDataValue(provenance, "source");
  const revisionField = ownDataValue(provenance, "revision");
  const recordedAtField = ownDataValue(provenance, "recordedAt");
  if (sourceField.accessor) findings.push(finding("artifact/field-accessor", "provenance.source", "Manifest fields must be own data properties, not getters."));
  if (revisionField.accessor) findings.push(finding("artifact/field-accessor", "provenance.revision", "Manifest fields must be own data properties, not getters."));
  if (recordedAtField.accessor) findings.push(finding("artifact/field-accessor", "provenance.recordedAt", "Manifest fields must be own data properties, not getters."));

  let ok = !sourceField.accessor && !revisionField.accessor && !recordedAtField.accessor;

  if (!sourceField.accessor) {
    if (typeof sourceField.value !== "string" || sourceField.value.trim().length === 0) {
      findings.push(finding("artifact/provenance-source", "provenance.source", "provenance.source must be a non-empty string."));
      ok = false;
    }
  }
  if (!revisionField.accessor) {
    if (typeof revisionField.value !== "string" || revisionField.value.trim().length === 0) {
      findings.push(finding("artifact/provenance-revision", "provenance.revision", "provenance.revision must be a non-empty string."));
      ok = false;
    }
  }
  let recordedAt: string | undefined;
  if (!recordedAtField.accessor && recordedAtField.present) {
    if (typeof recordedAtField.value !== "string" || !isValidTimestamp(recordedAtField.value)) {
      findings.push(finding("artifact/provenance-recorded-at", "provenance.recordedAt", "provenance.recordedAt, when present, must be an RFC 3339 timestamp with Z or an explicit offset."));
      ok = false;
    } else {
      recordedAt = recordedAtField.value;
    }
  }

  if (!ok) return undefined;
  return recordedAt === undefined
    ? { source: sourceField.value as string, revision: revisionField.value as string }
    : { source: sourceField.value as string, revision: revisionField.value as string, recordedAt };
}

/**
 * Reads and validates a candidate governed artifact manifest in one pass,
 * returning every independently checkable structural finding plus (only
 * when there are zero error-severity findings) a snapshot of the validated
 * manifest, safe to read again without re-touching `value`. This is the
 * function `verifyGovernedArtifact` actually calls; `validateGovernedArtifactManifest`
 * below is a thin `Finding[]`-only wrapper for a caller that just wants to
 * check shape.
 */
export function readGovernedArtifactManifest(value: unknown): GovernedArtifactManifestRead {
  try {
    if (!isRecord(value)) return { findings: [finding("artifact/manifest-shape", "$", "A governed artifact manifest must be an object.")] };

    const findings: Finding[] = [];
    findUnknownFields(value, MANIFEST_KEYS, "artifact/manifest-unknown-field", "$", findings);

    const kindField = ownDataValue(value, "kind");
    if (kindField.accessor) findings.push(finding("artifact/field-accessor", "kind", "Manifest fields must be own data properties, not getters."));
    else if (typeof kindField.value !== "string" || kindField.value.trim().length === 0) {
      findings.push(finding("artifact/kind-shape", "kind", "kind must be a non-empty string."));
    }

    const schemaVersionField = ownDataValue(value, "schemaVersion");
    if (schemaVersionField.accessor) findings.push(finding("artifact/field-accessor", "schemaVersion", "Manifest fields must be own data properties, not getters."));
    else if (typeof schemaVersionField.value !== "string" || schemaVersionField.value.trim().length === 0) {
      findings.push(finding("artifact/schema-version-shape", "schemaVersion", "schemaVersion must be a non-empty string."));
    }

    const checksum = readChecksum(value, findings);
    const provenance = readProvenance(value, findings);

    if (findings.some((f) => f.severity === "error")) return { findings };

    // Every field read above is confirmed present, own-data, and correctly
    // shaped at this point — `kindField.value`, `schemaVersionField.value`,
    // `checksum`, and `provenance` are all safe to assert non-undefined.
    return {
      findings,
      manifest: {
        kind: kindField.value as string,
        schemaVersion: schemaVersionField.value as string,
        checksum: checksum as GovernedArtifactManifest["checksum"],
        provenance: provenance as GovernedArtifactManifest["provenance"],
      },
    };
  } catch {
    return { findings: [finding("artifact/manifest-shape", "$", "A governed artifact manifest must be safely readable.")] };
  }
}

/** Validates a candidate governed artifact manifest's structure — shape only, no orchestration. */
export function validateGovernedArtifactManifest(value: unknown): Finding[] {
  return [...readGovernedArtifactManifest(value).findings];
}

/**
 * Validates caller-supplied `GovernedArtifactVerificationOptions`. An empty
 * `supportedSchemaVersions` is reported as `"artifact/options-supported-versions-empty"`
 * — a caller configuration error, never an artifact that trivially passes,
 * per the package's fail-closed contract (see `verify.ts`).
 */
export function validateGovernedArtifactOptions(value: unknown): Finding[] {
  try {
    if (!isRecord(value)) return [finding("artifact/options-shape", "$options", "Verification options must be an object.")];

    const findings: Finding[] = [];
    findUnknownFields(value, OPTIONS_KEYS, "artifact/options-unknown-field", "$options", findings);

    const artifactKindField = ownDataValue(value, "artifactKind");
    if (artifactKindField.accessor) findings.push(finding("artifact/field-accessor", "artifactKind", "Options fields must be own data properties, not getters."));
    else if (typeof artifactKindField.value !== "string" || artifactKindField.value.trim().length === 0) {
      findings.push(finding("artifact/options-kind-blank", "artifactKind", "artifactKind must be a non-empty string."));
    }

    const supportedField = ownDataValue(value, "supportedSchemaVersions");
    if (supportedField.accessor) {
      findings.push(finding("artifact/field-accessor", "supportedSchemaVersions", "Options fields must be own data properties, not getters."));
    } else if (!isDenseArray(supportedField.value)) {
      findings.push(finding("artifact/options-supported-versions-shape", "supportedSchemaVersions", `supportedSchemaVersions must be a plain array of at most ${MAX_SUPPORTED_VERSIONS} entries.`));
    } else if (supportedField.value.length === 0) {
      findings.push(
        finding(
          "artifact/options-supported-versions-empty",
          "supportedSchemaVersions",
          "supportedSchemaVersions must not be empty. An empty list is a caller configuration error — no schema version could ever be reported supported — and must never be treated as an artifact that trivially passes.",
        ),
      );
    } else {
      for (let index = 0; index < supportedField.value.length; index++) {
        const entry = arrayEntry(supportedField.value, index);
        if (entry.accessor) {
          findings.push(finding("artifact/field-accessor", `supportedSchemaVersions[${index}]`, "Options fields must be own data properties, not getters."));
        } else if (typeof entry.value !== "string" || entry.value.trim().length === 0) {
          findings.push(finding("artifact/options-supported-version-blank", `supportedSchemaVersions[${index}]`, "Each supported schema version must be a non-empty string."));
        }
      }
    }

    return findings;
  } catch {
    return [finding("artifact/options-shape", "$options", "Verification options must be safely readable.")];
  }
}
