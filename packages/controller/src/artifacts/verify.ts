/**
 * `verifyGovernedArtifact` / `verifyGovernedArtifacts` — deterministic
 * orchestration for the governed artifact contract: a declared kind +
 * schema version, an exact-content checksum, and structural
 * source/revision provenance, combined into ONE fixed verification order
 * so a caller can never observe a "verified" result (an empty findings
 * array) with any component left unchecked. This is the exact gap #195
 * opened over: "a checksum can pass while the schema version is
 * unsupported, or provenance can be attached without being checked at
 * all."
 *
 * ## The verification order, and why it is fixed
 *
 * 1. **Caller options** (`validateGovernedArtifactOptions`).
 *    `options.artifactKind` and `options.supportedSchemaVersions` are
 *    entirely the caller's own input, independent of the manifest under
 *    test. An empty `supportedSchemaVersions` is a CONFIGURATION error —
 *    no schema version could ever be reported supported — never an
 *    artifact that trivially passes. Checked first because nothing below
 *    can be evaluated meaningfully against options that cannot themselves
 *    be trusted, and because a misconfigured caller must never be
 *    disguised as a manifest problem.
 * 2. **Manifest structure**, including provenance shape
 *    (`readGovernedArtifactManifest`). Every later stage reads specific
 *    manifest fields (`kind`, `schemaVersion`, `checksum.algorithm`,
 *    `checksum.digest`); reading them off a value not yet known to be
 *    sound is exactly the precondition mistake `@clossys/controller/policy`'s
 *    own `verifyBinding` refuses to make — see its doc comment — and this
 *    module holds itself to the same discipline. Provenance is validated
 *    HERE, inside the one mandatory structural stage every successful
 *    verification passes through, specifically so it is impossible to
 *    skip: it is not an optional extra step a caller could forget to call.
 * 3. **Artifact kind.** `manifest.kind` must equal `options.artifactKind`.
 *    Kind is the namespace `schemaVersion` is scoped within — comparing a
 *    schema version against a supported-version list that was never even
 *    written for this artifact's actual kind is meaningless. An artifact
 *    of the wrong kind is rejected before spending any further check on it.
 * 4. **Schema version.** `manifest.schemaVersion` must be one of
 *    `options.supportedSchemaVersions`. This is the exact ordering #195
 *    was opened over: an unsupported schema version means the caller's own
 *    semantic decoder cannot be trusted to interpret the payload correctly,
 *    even when the bytes are exactly what was checksummed. Checking this
 *    BEFORE the checksum means an unsupported-version artifact is never
 *    reported "verified" merely because its bytes happen to match.
 * 5. **Exact-content checksum**, delegated entirely to
 *    `@clossys/controller/policy`'s `verifyBinding` — no hashing and no digest
 *    comparison of this module's own (its SHAPE was already delegated to
 *    `policy` one stage earlier, in `readGovernedArtifactManifest`; see
 *    `validate.ts`). Checked last for two reasons: it is the most
 *    expensive of the five checks (hashing the full content), so cheaper
 *    rejections happen first; and checking it last means a caller can
 *    never see a passing checksum for an artifact whose kind or schema
 *    version were never actually accepted.
 *
 * Every stage short-circuits the function on its own first error-severity
 * finding. `verifyGovernedArtifact` returns `[]` (a "clean" result) ONLY
 * after all five stages ran and every one produced zero error findings —
 * there is no code path that returns `[]` without having executed every
 * stage. See `verify.test.ts`'s ordering tests, which use fixtures broken
 * at more than one stage simultaneously and assert that only the earliest
 * stage's findings are ever reported.
 *
 * ## What a clean result proves, and what it does not
 *
 * A clean (`[]`) result proves: the manifest is structurally well-formed,
 * including its provenance fields; its declared kind matches what the
 * caller asked to verify; its declared schema version is one the caller
 * has declared support for; and `content` is byte-for-byte identical to
 * what the manifest's checksum committed to.
 *
 * A clean result NEVER proves: that `content` is semantically valid under
 * `schemaVersion`'s schema (schema-specific validation is entirely
 * caller-owned — see the package README's contract boundary); that
 * `provenance.source` / `provenance.revision` are genuine, reachable, or
 * that the named revision actually produced this content (this package
 * validates their SHAPE only, never their truth — see
 * `GovernedArtifactProvenance`'s own doc comment); or, most importantly,
 * WHO produced the content. MATCHING CONTENT IS NOT ATTRIBUTION: a
 * checksum proves bytes are unchanged from what was committed to, never
 * who committed to them. This package implements no signature or
 * identity-attestation scheme of any kind.
 */

import { verifyBinding } from "../policy/index.js";
import type { Finding, PolicyBinding } from "../policy/index.js";
import { readGovernedArtifactManifest, validateGovernedArtifactOptions } from "./validate.js";
import type { GovernedArtifactBatchEntry, GovernedArtifactVerificationOptions } from "./types.js";

function hasErrorFinding(findings: readonly Finding[]): boolean {
  return findings.some((f) => f.severity === "error");
}

/**
 * Verifies one governed artifact manifest against its declared checksum,
 * the caller's expected kind, and the caller's supported schema versions,
 * in the fixed order documented in this file's top-level comment.
 *
 * `manifest` is `unknown` by design: it is exactly the kind of value that
 * comes from parsing untrusted, consumer-supplied JSON, and this function
 * validates it rather than trusting its shape. `content` is the artifact's
 * exact bytes — a `string` is hashed as UTF-8, a `Uint8Array` byte-for-byte
 * (matching `@clossys/controller/policy`'s own `computeDigest` contract). This
 * function does not parse, reserialize, or canonicalize `content` in any
 * way; a caller that needs canonical JSON must produce those exact bytes
 * itself before calling this function.
 *
 * Returns `[]` when — and only when — every stage above ran and passed.
 * See the module doc comment for what that does and does not prove.
 */
export function verifyGovernedArtifact(
  manifest: unknown,
  content: string | Uint8Array,
  options: GovernedArtifactVerificationOptions,
): Finding[] {
  // Stage 1 — caller options.
  const optionsFindings = validateGovernedArtifactOptions(options);
  if (hasErrorFinding(optionsFindings)) return optionsFindings;

  // Stage 2 — manifest structure, including provenance shape.
  const manifestRead = readGovernedArtifactManifest(manifest);
  if (hasErrorFinding(manifestRead.findings) || manifestRead.manifest === undefined) return [...manifestRead.findings];
  const sound = manifestRead.manifest;

  // Stage 3 — artifact kind.
  if (sound.kind !== options.artifactKind) {
    return [
      {
        rule: "artifact/kind-mismatch",
        severity: "error",
        path: "kind",
        message: "Manifest kind does not match the expected artifact kind for this verification call.",
      },
    ];
  }

  // Stage 4 — schema version.
  if (!options.supportedSchemaVersions.includes(sound.schemaVersion)) {
    return [
      {
        rule: "artifact/schema-version-unsupported",
        severity: "error",
        path: "schemaVersion",
        message: "Manifest schemaVersion is not one of the caller's supported schema versions for this artifact kind.",
      },
    ];
  }

  // Stage 5 — exact-content checksum, delegated to policy's own binding
  // verifier. policyId is synthetic and derived only from the caller's own
  // artifactKind (never from provenance or content), so a digest-mismatch
  // message — which names policyId, per policy's own contract — can never
  // leak anything about this specific artifact.
  const binding: PolicyBinding = {
    policyId: `governed-artifact:${options.artifactKind}`,
    digestAlgorithm: sound.checksum.algorithm,
    digest: sound.checksum.digest,
  };
  return verifyBinding(binding, content);
}

/**
 * Verifies a batch of governed artifacts sharing one `options` trust
 * configuration. Each entry's findings are returned with `path` prefixed
 * by that entry's own `id`, so a caller can attribute every finding back
 * to the artifact that produced it without inspecting order.
 *
 * An EMPTY `entries` array is itself a failure — `"artifact/empty-batch"` —
 * never a clean `[]` result. A batch verifier that silently reports success
 * over zero artifacts is indistinguishable from one that verified nothing
 * at all because discovery upstream was broken (an empty glob, a truncated
 * fetch, a misconfigured filter); this repository has already shipped that
 * exact defect once, in `scripts/check-release-readiness.mjs` (fixed in
 * commit `01bd520`, documented in this repository's own contribution
 * guide), and this function does not reintroduce it.
 */
export function verifyGovernedArtifacts(entries: readonly GovernedArtifactBatchEntry[], options: GovernedArtifactVerificationOptions): Finding[] {
  if (entries.length === 0) {
    return [
      {
        rule: "artifact/empty-batch",
        severity: "error",
        path: "$",
        message:
          "No artifacts were supplied to verify. An empty batch is a caller or discovery error, never a clean verification result.",
      },
    ];
  }

  const findings: Finding[] = [];
  const seenLabels = new Set<string>();
  entries.forEach((entry, index) => {
    const label = entry.id.trim().length > 0 ? entry.id : `entries[${index}]`;
    if (seenLabels.has(label)) {
      findings.push({
        rule: "artifact/duplicate-batch-id",
        severity: "error",
        path: label,
        message: `Duplicate batch entry id ${JSON.stringify(label)}.`,
      });
    } else {
      seenLabels.add(label);
    }
    for (const entryFinding of verifyGovernedArtifact(entry.manifest, entry.content, options)) {
      findings.push({ ...entryFinding, path: entryFinding.path ? `${label}:${entryFinding.path}` : label });
    }
  });
  return findings;
}
