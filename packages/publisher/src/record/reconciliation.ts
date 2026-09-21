/**
 * Reconciliation-loop contracts for `@clossys/publisher/record`.
 *
 * A gate loop evaluates one subject and returns a verdict. A reconciliation
 * loop compares two records that can disagree — a ledger the publish path
 * emitted, and an independent witness of what actually shipped. This module
 * ships the producer shape and the comparison; it does not read a registry,
 * run a publish workflow, or persist a ledger anywhere.
 */

import { computeDigest, verifyBinding } from "@clossys/controller/policy";
import type { PolicyBinding } from "@clossys/controller/policy";
import { canonicalizeValue } from "./fact.js";
import { validateLedger } from "./schema.js";
import type { Ledger, LedgerFinding, PublicationEntry } from "./types.js";

/** Stable ledger entry id for one scoped package version on a registry. */
export function registryPublicationEntryId(packageName: string, version: string): string {
  const name = packageName.trim();
  const ver = version.trim();
  if (!name || !ver) {
    throw new Error("registryPublicationEntryId: packageName and version must be non-empty.");
  }
  return `${name}@${ver}`;
}

/**
 * What an independent registry read supplies — never derived from the same
 * ledger file the reconciliation compares against.
 */
export interface RegistryPackageWitness {
  readonly packageName: string;
  readonly version: string;
  /** Lowercase hex sha256 of the published tarball bytes, without a `sha256:` prefix. */
  readonly tarballSha256: string;
  readonly publishedAt: string;
}

export interface ProposeRegistryPublicationEntryInput {
  readonly witness: RegistryPackageWitness;
  /**
   * Opaque revision pointer recorded on the entry — typically a source commit
   * or qualification identity supplied by the publish path, not reread from the witness.
   */
  readonly strategyRevision: string;
}

function normalizedTarballDigest(hex: string): string {
  const digest = hex.trim().toLowerCase().replace(/^sha256:/, "");
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error("RegistryPackageWitness.tarballSha256 must be a 64-character lowercase hex sha256 digest.");
  }
  return digest;
}

function contentBindingForWitness(witness: RegistryPackageWitness): PolicyBinding {
  const id = registryPublicationEntryId(witness.packageName, witness.version);
  const digest = normalizedTarballDigest(witness.tarballSha256);
  return {
    policyId: id,
    digestAlgorithm: "sha256",
    digest: computeDigest(canonicalizeValue({ package: witness.packageName, version: witness.version, tarballSha256: digest }), "sha256"),
  };
}

/**
 * The ledger producer a publish workflow should call after a successful
 * registry upload. Pure and deterministic: the same witness always yields the
 * same entry shape. The caller appends via `appendEntry`.
 */
export function proposeRegistryPublicationEntry(input: ProposeRegistryPublicationEntryInput): PublicationEntry {
  const witness = input.witness;
  const strategyRevision = input.strategyRevision.trim();
  if (!strategyRevision) {
    throw new Error("proposeRegistryPublicationEntry: strategyRevision must be non-empty.");
  }
  const publishedAt = witness.publishedAt.trim();
  if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) {
    throw new Error("proposeRegistryPublicationEntry: witness.publishedAt must be an interpretable ISO timestamp.");
  }
  normalizedTarballDigest(witness.tarballSha256);
  return {
    id: registryPublicationEntryId(witness.packageName, witness.version),
    publishedAt,
    channel: "npm-registry",
    strategyRevision,
    factCitations: [],
    contentBinding: contentBindingForWitness(witness),
  };
}

/** Subject `checkLedgerDrift` expects: a ledger plus caller-owned current fact values. */
export interface LedgerDriftSubject {
  readonly ledger: Ledger;
  readonly currentValues: Readonly<Record<string, unknown>>;
}

export function asLedgerDriftSubject(
  ledger: unknown,
  currentValues: unknown,
): { ok: true; subject: LedgerDriftSubject } | { ok: false; findings: readonly LedgerFinding[] } {
  const ledgerFindings = validateLedger(ledger);
  if (ledgerFindings.some((f) => f.severity === "error")) {
    return {
      ok: false,
      findings: [{ rule: "ledger-invalid", severity: "error", message: "ledger failed validation." }],
    };
  }
  if (!currentValues || typeof currentValues !== "object" || Array.isArray(currentValues)) {
    return {
      ok: false,
      findings: [{ rule: "current-values-invalid", severity: "error", message: "currentValues must be a plain object map." }],
    };
  }
  return { ok: true, subject: { ledger: ledger as Ledger, currentValues: currentValues as Readonly<Record<string, unknown>> } };
}

export interface RegistryReconciliationReport {
  readonly ok: boolean;
  readonly entriesChecked: number;
  readonly findings: readonly LedgerFinding[];
}

/**
 * Compares a ledger entry the publish path should have appended against an
 * independent registry witness. This is the record half's reconciliation
 * loop; it is not `checkLedgerDrift`, which only compares cited facts.
 */
export function checkRegistryPublicationReconciliation(
  ledger: unknown,
  witness: RegistryPackageWitness,
): RegistryReconciliationReport {
  const ledgerFindings = validateLedger(ledger);
  if (ledgerFindings.some((f) => f.severity === "error")) {
    return {
      ok: false,
      entriesChecked: 0,
      findings: [{ rule: "ledger-invalid", severity: "error", message: "ledger failed validation." }],
    };
  }
  const entries = ledger as readonly PublicationEntry[];
  if (entries.length === 0) {
    return {
      ok: false,
      entriesChecked: 0,
      findings: [{ rule: "empty-ledger", severity: "error", message: "ledger is empty; nothing to reconcile." }],
    };
  }

  const expectedId = registryPublicationEntryId(witness.packageName, witness.version);
  const entry = entries.find((item) => item.id === expectedId);
  if (!entry) {
    return {
      ok: false,
      entriesChecked: 0,
      findings: [
        {
          rule: "registry-entry-missing",
          severity: "error",
          message: `ledger has no entry with id "${expectedId}" for the registry witness.`,
        },
      ],
    };
  }

  const expectedBinding = contentBindingForWitness(witness);
  const binding = entry.contentBinding;
  if (!binding) {
    return {
      ok: false,
      entriesChecked: 1,
      findings: [
        {
          rule: "registry-content-binding-missing",
          severity: "error",
          message: `entry "${expectedId}" has no contentBinding to reconcile against the registry tarball.`,
        },
      ],
    };
  }

  const digest = normalizedTarballDigest(witness.tarballSha256);
  const witnessValue = { package: witness.packageName, version: witness.version, tarballSha256: digest };
  const policyFindings = verifyBinding(binding, canonicalizeValue(witnessValue));
  if (policyFindings.length > 0 || binding.policyId !== expectedBinding.policyId) {
    return {
      ok: false,
      entriesChecked: 1,
      findings: [
        {
          rule: "registry-tarball-mismatch",
          severity: "error",
          message: `entry "${expectedId}" contentBinding does not match the independent registry tarball witness.`,
        },
      ],
    };
  }

  return { ok: true, entriesChecked: 1, findings: [] };
}
