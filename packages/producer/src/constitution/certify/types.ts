/**
 * Certification types (R05, slot-constitution.md). One certifier serves every rung (R03.3): its
 * input is the slot, the candidate and the contract, never a source kind, a rung or a seed.
 */
import type { CandidateRecord, SlotRecord } from "../types.js";

/**
 * Why a candidate is not certified. `no-standard` and `no-fixture` are missing slot records; every other code is a fit
 * failure (`release`: a release manifest fails the release criteria, certify/release.ts; `hook`: a hook or lib item fails
 * the code check, certify/element.ts; `registry-type`: a registry type has no row in certify/registry-types.ts).
 */
export type ReasonCode =
  | "invalid" | "no-standard" | "standard" | "no-fixture" | "fixture" | "requirement"
  | "import" | "render" | "hook" | "registry-type" | "copy" | "citation" | "frame" | "section" | "step" | "limit" | "release";

export const MISSING_RECORD_CODES: ReadonlySet<ReasonCode> = new Set(["no-standard", "no-fixture"]);

export interface Reason { readonly code: ReasonCode; readonly message: string }

export interface Certification {
  readonly certified: boolean;
  readonly reasons: readonly Reason[];
}

/** The fields `certify()` takes (R03.3: no source kind, rung or seed). */
export const CERTIFY_INPUT_FIELDS = Object.freeze(["slot", "candidate", "contract"] as const);
export interface CertifyInput {
  readonly slot: SlotRecord;
  readonly candidate: CandidateRecord;
  /** The contract to certify against; defaults to slot.json `contract` (the dry run passes a proposed one). */
  readonly contract?: Readonly<Record<string, unknown>>;
}

export const reason = (code: ReasonCode, message: string): Reason => ({ code, message });
