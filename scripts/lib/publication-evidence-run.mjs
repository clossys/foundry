// Build one governance/release-publications/later/<key>-<version>.json record
// automatically, right after publish.yml's trusted-publisher OIDC lane
// uploads a version — issue #1346.
//
// This module is deliberately a thin, testable orchestration layer over
// scripts/record-later-publication.mjs's own exported building blocks
// (createLaterPublicationRecord, and by extension buildLaterPublicationRecord
// and validateLaterPublication). It invents no new evidence shape and no new
// validation: every field this module supplies is either read from the
// public npm registry, the GitHub Actions run that triggered it, or the
// already-retained qualification record, exactly as PR #1348's manual
// backfill did by calling the same exported functions directly. If a field
// cannot be measured, the underlying call throws and this module never
// writes a file.
//
// TWO ATTEMPTS, NEVER A GUESS. `createLaterPublicationRecord` builds a
// schema-2 (`foundry-trusted-publication-v2`) record when the publication
// source commit's root package.json/package-lock.json hashes still equal the
// ones the qualification record retained (`buildLaterPublicationRecord`'s
// `prePublicationSourceValid` check). This repository's merge queue batches
// a package's publish with unrelated root-file churn from other packages, so
// that join often fails — PR #1348 measured 8 of 10 trusted-publisher
// versions needing the schema-3 (`foundry-trusted-publication-replay-v3`)
// path instead, which supplies a fresh, credential-free re-qualification
// replay bound to the exact `qualified-candidate-<key>` artifact this same
// publish run's own `qualify` job already uploaded. `buildPublicationRecordWithFallback`
// tries the plain join first (cheap, no extra GitHub API calls) and only
// reaches for that same run's own qualify artifact when it fails — it never
// pre-guesses which path applies.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { createLaterPublicationRecord, verifiedAnonymousAudit } from "../record-later-publication.mjs";
import { inspectPublicNpmProvenance } from "../check-public-npm-provenance.mjs";
import { decodePayload, SLSA_PROVENANCE } from "./provenance-join.mjs";
import { PUBLIC_NPM_REGISTRY } from "./public-npm-registry.mjs";

const RUN_ROOT = "https://github.com/clossys/foundry/actions/runs";
const PUBLISH_WORKFLOW = ".github/workflows/publish.yml";
const REPLAY_EVIDENCE_KIND = "foundry-trusted-publication-replay-input-v1";

/** The exact attestation URL trustedProvenance() in release-later-publication.mjs requires. */
export function attestationUrl(name, version) {
  return `${PUBLIC_NPM_REGISTRY}/-/npm/v1/attestations/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

/**
 * Build the closed publication-evidence input object record-later-
 * publication.mjs's `validatePublicationInput`/`trustedProvenance` expect —
 * every field measured from the workflow_run event that triggered this
 * follow-up (run id, run attempt, and the exact head SHA GitHub reports for
 * that run) plus the package identity being recorded. Never guesses:
 * `publishedAt` must already be the measured npm registry publish time (see
 * `fetchPublishedAt` below), not a locally generated timestamp.
 */
export function buildPublicationEvidenceInput({ runId, runAttempt, sourceSha, publishedAt, name, version }) {
  if (!Number.isSafeInteger(runId) || runId < 1) throw new Error("runId must be a positive integer");
  if (!Number.isSafeInteger(runAttempt) || runAttempt < 1) throw new Error("runAttempt must be a positive integer");
  if (!/^[a-f0-9]{40}$/.test(sourceSha ?? "")) throw new Error("sourceSha must be a full 40-character commit hash");
  if (typeof publishedAt !== "string" || publishedAt.length === 0) throw new Error("publishedAt must be a measured registry timestamp");
  if (typeof name !== "string" || typeof version !== "string") throw new Error("name and version are required");
  return {
    mode: "trusted-publisher",
    publishedAt,
    reference: `${RUN_ROOT}/${runId}`,
    provenance: {
      repository: "https://github.com/clossys/foundry",
      workflow: PUBLISH_WORKFLOW,
      ref: "refs/heads/main",
      event: "workflow_dispatch",
      sourceSha,
      builder: "https://github.com/actions/runner/github-hosted",
      invocation: `${RUN_ROOT}/${runId}/attempts/${runAttempt}`,
      attestationUrl: attestationUrl(name, version),
    },
  };
}

async function githubJson(fetchImpl, path) {
  const response = await fetchImpl(`https://api.github.com/repos/clossys/foundry/${path}`, { headers: { Accept: "application/vnd.github+json" } });
  if (!response?.ok) throw new Error(`GitHub API request for ${path} failed (${response?.status ?? "no response"})`);
  return response.json();
}

/** Locate the exact `qualified-candidate-<key>` artifact this publish run's own `qualify` job uploaded. */
export async function findQualifiedCandidateArtifact({ fetchImpl, runId, packageKey }) {
  const name = `qualified-candidate-${packageKey}`;
  const body = await githubJson(fetchImpl, `actions/runs/${runId}/artifacts?per_page=100`);
  const artifact = (body?.artifacts ?? []).find((item) => item?.name === name);
  if (!artifact) throw new Error(`no ${name} artifact was found on run ${runId}`);
  return artifact;
}

/** Download one artifact's raw zip bytes (never extracted — buildReplay() in record-later-publication.mjs hashes the whole archive). */
export async function downloadArtifactZip({ fetchImpl, artifactId }) {
  const response = await fetchImpl(`https://api.github.com/repos/clossys/foundry/actions/artifacts/${artifactId}/zip`, { headers: { Accept: "application/vnd.github+json" } });
  if (!response?.ok) throw new Error(`GitHub artifact ${artifactId} download failed (${response?.status ?? "no response"})`);
  return Buffer.from(await response.arrayBuffer());
}

/** The full public npm packument for one package — the raw fetch behind both `fetchPublishedAt` and `verifyPublicationProvenance`. */
export async function fetchPackument({ fetchImpl, name }) {
  const response = await fetchImpl(`${PUBLIC_NPM_REGISTRY}/${encodeURIComponent(name)}`);
  if (!response?.ok) throw new Error(`public npm metadata for ${name} is unavailable (${response?.status ?? "no response"})`);
  return response.json();
}

/** The measured npm registry publish instant for one version — never Date.now(). */
export async function fetchPublishedAt({ fetchImpl, name, version, packument }) {
  const resolved = packument ?? (await fetchPackument({ fetchImpl, name }));
  const publishedAt = resolved?.time?.[version];
  if (typeof publishedAt !== "string") throw new Error(`public npm metadata has no measured publish time for ${name}@${version}`);
  return publishedAt;
}

/** The exact invocation URL the version's verified SLSA statement names, or null if it cannot be located/decoded. `inspectPublicNpmProvenance` only checks this string's SHAPE (issue #1346 correctness review, B2) — it has no expected value to compare against, because it is never told what a caller intends to claim. This decodes the same bundle to read the actual value. */
function attestedInvocationUrl(audit, name, version) {
  const verified = (audit?.verified ?? []).find((entry) => entry?.name === name && entry?.version === version);
  const bundle = (verified?.attestationBundles ?? []).find((item) => item?.predicateType === SLSA_PROVENANCE);
  const statement = bundle ? decodePayload(bundle) : null;
  const invocationId = statement?.predicate?.runDetails?.metadata?.invocationId;
  return typeof invocationId === "string" ? invocationId : null;
}

/**
 * Cross-check EVERY provenance field the record is about to claim — not
 * just the source commit — against the version's own npm SLSA provenance
 * attestation, before writing anything.
 *
 * `inspectPublicNpmProvenance()` (the same join `record-later-
 * publication.mjs`'s `buildReplay()` already runs for the schema-3 replay
 * path) verifies that the attestation is internally well-formed and binds
 * the EXACT `sourceSha` supplied — but it has no notion of "the run and
 * attempt this record is about to claim": it only checks the invocation
 * URL's *shape*, never its value, because it is never given one to compare
 * against. A record naming the correct commit but the wrong run or the
 * wrong attempt (for example after a job was individually re-run — see
 * `publish.yml`'s own "Re-run failed jobs" path) would still pass that
 * check alone. This function closes that gap by additionally decoding the
 * verified statement itself and requiring its `invocationId` to equal
 * exactly `https://github.com/clossys/foundry/actions/runs/<runId>/attempts/<runAttempt>`
 * — the same identity `buildPublicationEvidenceInput` is about to embed as
 * `provenance.invocation` (issue #1346 correctness review, B2). The schema-2
 * direct join previously ran none of this at all; the schema-3 replay path
 * keeps its own equivalent internal check inside `buildReplay()`, so it is
 * not duplicated here. Throws — writing nothing — on any mismatch.
 */
export async function verifyPublicationProvenance({ fetchImpl, name, version, sourceSha, runId, runAttempt, auditRun = execFileSync, env, packument }) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha ?? "")) throw new Error("sourceSha must be a full 40-character commit hash");
  if (!Number.isSafeInteger(runId) || runId < 1) throw new Error("runId must be a positive integer");
  if (!Number.isSafeInteger(runAttempt) || runAttempt < 1) throw new Error("runAttempt must be a positive integer");
  const resolvedPackument = packument ?? (await fetchPackument({ fetchImpl, name }));
  const audit = verifiedAnonymousAudit(name, version, auditRun, env);
  const result = inspectPublicNpmProvenance({ name, version, sourceSha, audit, packument: resolvedPackument });
  if (result.code !== 0) {
    throw new Error(`measured npm SLSA provenance attestation does not corroborate this run (${(result.failures ?? []).join("; ") || "unknown mismatch"})`);
  }
  const expectedInvocation = `https://github.com/clossys/foundry/actions/runs/${runId}/attempts/${runAttempt}`;
  const actualInvocation = attestedInvocationUrl(audit, name, version);
  if (actualInvocation !== expectedInvocation) {
    throw new Error(`measured npm SLSA provenance attestation names a different run/attempt than this record claims (attested ${actualInvocation ?? "<none>"}, claimed ${expectedInvocation})`);
  }
  return { packument: resolvedPackument, audit };
}

/**
 * Build one publication record, trying the plain trusted-publisher join
 * first and falling back to a v3 replay against this exact run's own
 * qualify-job artifact only if that join fails on ROOT-HASH DRIFT — never
 * on a provenance mismatch. Throws with BOTH failure messages if neither
 * path validates — the caller must not write a file or open a pull request
 * on that throw (issue #1346's "fail visibly, open no PR" requirement).
 *
 * `verifyPublicationProvenance` runs exactly ONCE, before either join is
 * even attempted, and its failure is never treated as "try replay instead"
 * (2026-09-23 fresh-final review, B1). An earlier revision ran it only
 * around the direct attempt and fell through to replay on any failure —
 * but `buildReplay()`'s own internal check
 * (`scripts/record-later-publication.mjs`) binds only the source commit; it
 * never checks the run or attempt at all (`invocationRunRoot()` in
 * `scripts/lib/release-later-publication.mjs` discards the attempt number
 * before validation ever sees it). So a record whose run or attempt this
 * function's own provenance check correctly refused could still reach
 * replay and be written anyway — replay is this repository's MORE COMMON
 * path (PR #1348 measured it for 8 of 10 versions), so that was not a
 * narrow gap. Provenance is the record's identity; a join can be retried
 * with different git-derived evidence (root package.json/package-lock.json
 * hashes drifting from the merge queue's own batching is the only reason
 * either join legitimately fails), but there is no join that fixes a
 * record naming the wrong run.
 */
export async function buildPublicationRecordWithFallback({
  root,
  packageKey,
  qualificationPath,
  publicationPath,
  fetchImpl,
  env,
  runId,
  runAttempt,
  name,
  version,
  sourceSha,
  auditRun,
  tempDir,
  findArtifact = findQualifiedCandidateArtifact,
  downloadZip = downloadArtifactZip,
  createRecord = createLaterPublicationRecord,
  writeFile = writeFileSync,
  verifyProvenance = verifyPublicationProvenance,
}) {
  await verifyProvenance({ fetchImpl, name, version, sourceSha, runId, runAttempt, auditRun, env });

  let directError;
  try {
    return await createRecord({ root, packageKey, qualificationPath, publicationPath, fetch: true, env, fetchImpl });
  } catch (error) {
    directError = error instanceof Error ? error : new Error(String(error));
  }

  let artifact;
  try {
    artifact = await findArtifact({ fetchImpl, runId, packageKey });
  } catch (artifactError) {
    throw new Error(`direct publication evidence failed (${directError.message}); replay fallback could not locate the qualified-candidate artifact (${artifactError instanceof Error ? artifactError.message : artifactError})`);
  }

  const archivePath = join(tempDir, "qualified-candidate.zip");
  const replayEvidencePath = join(tempDir, "replay-evidence.json");
  try {
    const archiveBytes = await downloadZip({ fetchImpl, artifactId: artifact.id });
    writeFile(archivePath, archiveBytes);
    writeFile(replayEvidencePath, `${JSON.stringify({ schemaVersion: 1, kind: REPLAY_EVIDENCE_KIND, runId, artifactId: artifact.id })}\n`);
  } catch (downloadError) {
    throw new Error(`direct publication evidence failed (${directError.message}); replay fallback could not retrieve the qualified-candidate artifact (${downloadError instanceof Error ? downloadError.message : downloadError})`);
  }

  try {
    return await createRecord({ root, packageKey, qualificationPath, publicationPath, fetch: true, artifactArchivePath: archivePath, replayEvidencePath, env, fetchImpl });
  } catch (replayError) {
    throw new Error(`direct publication evidence failed (${directError.message}); replay publication evidence also failed (${replayError instanceof Error ? replayError.message : replayError})`);
  }
}
