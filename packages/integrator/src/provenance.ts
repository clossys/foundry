/**
 * The shared subject/digest/repository/workflow join for verifying a
 * published `@clossys` package's SLSA provenance statement against this
 * repository's `publish.yml`. Two very different callers need EXACTLY this
 * join and nothing else:
 *
 *   - `check-public-npm-provenance.mjs`, a producer-side, repository-internal
 *     gate that verifies ONE package immediately after publishing
 *     it, from `npm audit signatures --json --include-attestations` evidence
 *     and the exact source commit that produced the release (it knows that
 *     commit -- it is running in the same workflow run that made it).
 *   - `integrator-provenance-check`, this package's consumer-facing bin,
 *     which verifies any already-installed `@clossys` package from a public,
 *     anonymous registry fetch. It runs under pnpm, which does not implement
 *     `npm audit signatures` at all, so it reads the same evidence straight
 *     from `GET /-/npm/v1/attestations/<name>@<version>` instead of an
 *     npm-shaped audit result. It also was not present for the publish, so
 *     it has no exact source commit to pin against -- it can only confirm
 *     the statement names A commit on this repository's protected `main`,
 *     not a SPECIFIC one.
 *
 * Both callers are asking the same question -- "does this exact
 * package/version's SLSA statement name this repository's publish workflow,
 * a GitHub-hosted builder, and a manually dispatched run?" -- so this module
 * is the one hand-maintained implementation of that join.
 *
 * `check-public-npm-provenance.mjs` does NOT import this file. It used to,
 * directly by relative path, unbuilt -- which broke `check:gates`'s
 * `safety`/`publish safety` CI job the moment this module gained even
 * type-only TypeScript syntax, because that job pins Node 20
 * (`.github/workflows/ci.yml`) and Node 20 has no native TypeScript
 * stripping at all (stable/unflagged only since Node 23.6; see
 * https://nodejs.org/api/typescript.html). `scripts/lib/provenance-join.mjs`
 * is now a dependency-free, plain-JavaScript mirror of this module that
 * script imports instead -- it needs no stripping because it is not
 * TypeScript. This module cannot import that one either: `@clossys/
 * integrator` is a published, standalone npm package built with plain `tsc`
 * (no bundler), and its `files` allowlist never ships this repository's
 * root-level `scripts/` directory, so a relative import reaching outside the
 * package would resolve in this checkout and then be unresolvable for
 * anyone who installs the published package.
 *
 * The two files are kept in lockstep by `provenance-join-parity.test.ts`
 * (in this directory), which runs the same table of statements, audit
 * results, and packuments through both and asserts identical outputs. Treat
 * that test, not code review alone, as what keeps this a single source of
 * truth despite being two files on disk. Do not edit one without the other.
 */

export const PUBLIC_REGISTRY = "https://registry.npmjs.org";
export const EXPECTED_REPOSITORY = "https://github.com/clossys/foundry";
export const EXPECTED_WORKFLOW = ".github/workflows/publish.yml";
export const SLSA_PROVENANCE = "https://slsa.dev/provenance/v1";
export const SLSA_WORKFLOW_BUILD = "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1";
export const GITHUB_HOSTED_BUILDER = "https://github.com/actions/runner/github-hosted";
export const EXPECTED_MAIN_REF = "refs/heads/main";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function exactSubjectName(name: string, version: string): string {
  return `pkg:npm/${name.startsWith("@") ? `%40${name.slice(1)}` : name}@${version}`;
}

export function sha512HexFromIntegrity(integrity: unknown): string | null {
  if (typeof integrity !== "string" || !integrity.startsWith("sha512-")) return null;
  try {
    const bytes = Buffer.from(integrity.slice("sha512-".length), "base64");
    return bytes.length === 64 ? bytes.toString("hex") : null;
  } catch {
    return null;
  }
}

/** Decodes a Sigstore bundle's DSSE envelope payload (base64 JSON) into the in-toto statement it carries. */
export function decodePayload(bundle: unknown): unknown {
  const encoded = isRecord(bundle) && isRecord(bundle.bundle) && isRecord(bundle.bundle.dsseEnvelope) ? bundle.bundle.dsseEnvelope.payload : undefined;
  if (typeof encoded !== "string" || encoded.length === 0) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export function isExactAttestationUrl(value: unknown, name: string, version: string): boolean {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.origin === PUBLIC_REGISTRY &&
      parsed.search === "" &&
      parsed.hash === "" &&
      decodeURIComponent(parsed.pathname) === `/-/npm/v1/attestations/${name}@${version}`
    );
  } catch {
    return false;
  }
}

/**
 * From a packument (either the full multi-version document, or the exact
 * one-version response the attestations flow also accepts), the tarball
 * SHA-512 digest the SLSA subject must exactly bind, in hex.
 */
export function expectedDigestFromPackument(packument: unknown, name: string, version: string): string | null {
  if (!isRecord(packument)) return null;
  const versions = isRecord(packument.versions) ? packument.versions : undefined;
  const packumentVersion = versions ? versions[version] : packument.name === name && packument.version === version ? packument : undefined;
  if (!isRecord(packumentVersion) || packumentVersion.name !== name || packumentVersion.version !== version) return null;
  const dist = isRecord(packumentVersion.dist) ? packumentVersion.dist : undefined;
  return sha512HexFromIntegrity(dist?.integrity);
}

export interface ProvenanceStatementJoinInput {
  readonly name: string;
  readonly version: string;
  /** The tarball's SHA-512 digest in hex, from the public packument -- see `expectedDigestFromPackument`. */
  readonly expectedDigest: string;
  /** The decoded in-toto statement -- see `decodePayload`. */
  readonly statement: unknown;
  /**
   * The exact source commit the release must have been built from, 40 lowercase
   * hex characters. Supplied by a caller who was present for the publish (the
   * producer gate, from `github.sha`). OMITTED by a caller who was not (a
   * consumer verifying an already-installed package): in that case the join
   * only confirms the statement names ONE commit on this repository's
   * protected `main`, structurally, never a specific one it cannot know.
   */
  readonly sourceSha?: string;
}

export interface ProvenanceJoinResult {
  readonly code: 0 | 1;
  readonly failures: readonly string[];
}

/**
 * The join both callers share: does this decoded SLSA statement uniquely and
 * exactly bind the named package/version and tarball digest, this
 * repository's `publish.yml` on `refs/heads/main`, a manually dispatched
 * event, a GitHub-hosted builder, and one identifiable Actions run -- and,
 * when `sourceSha` is supplied, that EXACT commit rather than merely some
 * commit on `main`.
 */
export function inspectProvenanceStatement(input: ProvenanceStatementJoinInput): ProvenanceJoinResult {
  const { name, version, expectedDigest, statement, sourceSha } = input;
  const failures: string[] = [];

  if (!isRecord(statement)) {
    return { code: 1, failures: ["verified SLSA provenance payload is not decodable JSON"] };
  }

  if (statement._type !== "https://in-toto.io/Statement/v1" || statement.predicateType !== SLSA_PROVENANCE) {
    failures.push("verified payload is not the required in-toto SLSA provenance statement");
  }

  const subjects = Array.isArray(statement.subject) ? statement.subject : [];
  const exactSubjects = subjects.filter(
    (subject) => isRecord(subject) && subject.name === exactSubjectName(name, version) && isRecord(subject.digest) && subject.digest.sha512 === expectedDigest,
  );
  if (subjects.length !== 1 || exactSubjects.length !== 1) {
    failures.push("SLSA subject must uniquely bind the exact package/version and public tarball SHA-512");
  }

  const predicate = isRecord(statement.predicate) ? statement.predicate : undefined;
  const build = predicate && isRecord(predicate.buildDefinition) ? predicate.buildDefinition : undefined;
  const externalParameters = build && isRecord(build.externalParameters) ? build.externalParameters : undefined;
  const workflow = externalParameters && isRecord(externalParameters.workflow) ? externalParameters.workflow : undefined;
  if (
    build?.buildType !== SLSA_WORKFLOW_BUILD ||
    workflow?.repository !== EXPECTED_REPOSITORY ||
    workflow?.path !== EXPECTED_WORKFLOW ||
    workflow?.ref !== EXPECTED_MAIN_REF
  ) {
    failures.push("SLSA build definition must bind clossys/foundry main and the exact publish workflow");
  }

  const internalParameters = build && isRecord(build.internalParameters) ? build.internalParameters : undefined;
  const githubInternal = internalParameters && isRecord(internalParameters.github) ? internalParameters.github : undefined;
  if (githubInternal?.event_name !== "workflow_dispatch") {
    failures.push("SLSA build definition must bind a manually dispatched release");
  }

  const dependencies = build && Array.isArray(build.resolvedDependencies) ? build.resolvedDependencies : [];
  const expectedUri = `git+${EXPECTED_REPOSITORY}@${EXPECTED_MAIN_REF}`;
  if (sourceSha !== undefined) {
    const exactDependencies = dependencies.filter(
      (dependency) => isRecord(dependency) && dependency.uri === expectedUri && isRecord(dependency.digest) && dependency.digest.gitCommit === sourceSha,
    );
    if (dependencies.length !== 1 || exactDependencies.length !== 1) {
      failures.push("SLSA resolved dependencies must contain only the exact protected main source commit");
    }
  } else {
    const mainDependencies = dependencies.filter(
      (dependency) =>
        isRecord(dependency) &&
        dependency.uri === expectedUri &&
        isRecord(dependency.digest) &&
        typeof dependency.digest.gitCommit === "string" &&
        /^[a-f0-9]{40}$/.test(dependency.digest.gitCommit),
    );
    if (dependencies.length !== 1 || mainDependencies.length !== 1) {
      failures.push("SLSA resolved dependencies must contain exactly one protected main source commit");
    }
  }

  const runDetails = predicate && isRecord(predicate.runDetails) ? predicate.runDetails : undefined;
  const builder = runDetails && isRecord(runDetails.builder) ? runDetails.builder : undefined;
  if (builder?.id !== GITHUB_HOSTED_BUILDER) {
    failures.push("SLSA builder must be the GitHub-hosted Actions runner");
  }

  const metadata = runDetails && isRecord(runDetails.metadata) ? runDetails.metadata : undefined;
  const invocation = metadata?.invocationId;
  if (typeof invocation !== "string" || !/^https:\/\/github\.com\/clossys\/foundry\/actions\/runs\/\d+\/attempts\/\d+$/.test(invocation)) {
    failures.push("SLSA invocation must identify one clossys/foundry Actions run attempt");
  }

  return { code: failures.length === 0 ? 0 : 1, failures };
}

// ---------------------------------------------------------------------------
// Producer path: `npm audit signatures --include-attestations`-shaped input.
// ---------------------------------------------------------------------------

export interface PublicNpmProvenanceInput {
  readonly name: string;
  readonly version: string;
  readonly sourceSha: string;
  /** The parsed `npm audit signatures --json --include-attestations` result. */
  readonly audit: unknown;
  /** The public packument (`GET https://registry.npmjs.org/<name>`). */
  readonly packument: unknown;
}

export interface PublicNpmProvenanceResult {
  readonly code: 0 | 1 | 2;
  readonly failures: readonly string[];
}

/**
 * Verifies one exact public npm package's provenance from `npm audit
 * signatures --include-attestations` evidence -- the producer-side check
 * `check-public-npm-provenance.mjs` runs anonymously immediately after a
 * publish, with the exact source commit it knows from the workflow run.
 * Exit 0 = exact provenance verified. Exit 1 = a concrete mismatch. Exit 2 =
 * malformed input, never silently treated as a mismatch.
 */
export function inspectPublicNpmProvenance(input: PublicNpmProvenanceInput): PublicNpmProvenanceResult {
  const { name, version, sourceSha, audit, packument } = input;
  const failures: string[] = [];
  if (typeof name !== "string" || name.length === 0) failures.push("package name must be a non-empty string");
  if (typeof version !== "string" || version.length === 0) failures.push("package version must be a non-empty string");
  if (!/^[a-f0-9]{40}$/.test(sourceSha ?? "")) failures.push("source SHA must be exactly 40 lowercase hexadecimal characters");
  if (!isRecord(audit)) failures.push("npm audit signatures result must be an object");
  if (!isRecord(packument)) failures.push("public npm packument must be an object");
  if (failures.length > 0) return { code: 2, failures };

  const auditRecord = audit as Record<string, unknown>;
  if (!Array.isArray(auditRecord.invalid) || auditRecord.invalid.length !== 0) failures.push("npm audit signatures reported invalid package signatures or attestations");
  if (!Array.isArray(auditRecord.missing) || auditRecord.missing.length !== 0) failures.push("npm audit signatures reported missing package signatures or attestations");
  if (!Array.isArray(auditRecord.verified)) failures.push("npm audit signatures did not return a verified package array");

  const verifiedList = Array.isArray(auditRecord.verified) ? auditRecord.verified : [];
  const exact = verifiedList.filter(
    (entry) => isRecord(entry) && entry.name === name && entry.version === version && entry.registry === `${PUBLIC_REGISTRY}/`,
  );
  if (exact.length !== 1) failures.push(`npm audit signatures must verify exactly one ${name}@${version} entry from public npm`);

  const expectedDigest = expectedDigestFromPackument(packument, name, version);
  if (expectedDigest === null) {
    failures.push("public npm packument does not expose the exact package/version with a canonical SHA-512 integrity");
  }

  const verified = isRecord(exact[0]) ? exact[0] : undefined;
  const attestations = verified && isRecord(verified.attestations) ? verified.attestations : undefined;
  const provenanceField = attestations && isRecord(attestations.provenance) ? attestations.provenance : undefined;
  if (!isExactAttestationUrl(attestations?.url, name, version) || provenanceField?.predicateType !== SLSA_PROVENANCE) {
    failures.push("verified package metadata does not bind the exact public npm SLSA provenance endpoint");
  }

  const provenanceBundles = Array.isArray(verified?.attestationBundles)
    ? (verified.attestationBundles as unknown[]).filter((bundle) => isRecord(bundle) && bundle.predicateType === SLSA_PROVENANCE)
    : [];
  if (provenanceBundles.length !== 1) failures.push("npm audit signatures must return exactly one verified SLSA provenance bundle for the package");

  if (expectedDigest === null || provenanceBundles.length !== 1) {
    return { code: failures.length === 0 ? 0 : 1, failures };
  }

  const statement = decodePayload(provenanceBundles[0]);
  const joined = inspectProvenanceStatement({ name, version, expectedDigest, statement, sourceSha });
  return { code: failures.length === 0 && joined.code === 0 ? 0 : 1, failures: [...failures, ...joined.failures] };
}

// ---------------------------------------------------------------------------
// Consumer path: `GET /-/npm/v1/attestations/<name>@<version>`-shaped input.
// ---------------------------------------------------------------------------

export interface InstalledPackageProvenanceInput {
  readonly name: string;
  readonly version: string;
  /** The public packument for `name` (`GET https://registry.npmjs.org/<name>`). */
  readonly packument: unknown;
  /** The raw `GET /-/npm/v1/attestations/<name>@<version>` response body. */
  readonly attestationsResponse: unknown;
}

export type InstalledPackageProvenanceState = "verified" | "violated";

export interface InstalledPackageProvenanceResult {
  readonly state: InstalledPackageProvenanceState;
  readonly failures: readonly string[];
}

/**
 * Verifies one already-installed `@clossys` package's provenance from the
 * public attestations endpoint directly -- the shape `integrator-provenance-
 * check` reads, because pnpm has no `npm audit signatures` to read instead.
 * Never returns `indeterminate`: a caller that could not reach the registry
 * at all never calls this function in the first place (see
 * `provenance-check.ts`, which is the layer that owns that distinction).
 */
export function inspectInstalledPackageProvenance(input: InstalledPackageProvenanceInput): InstalledPackageProvenanceResult {
  const { name, version, packument, attestationsResponse } = input;
  const expectedDigest = expectedDigestFromPackument(packument, name, version);
  if (expectedDigest === null) {
    return { state: "violated", failures: ["public npm packument does not expose the exact installed package/version with a canonical SHA-512 integrity"] };
  }

  const attestations = isRecord(attestationsResponse) && Array.isArray(attestationsResponse.attestations) ? attestationsResponse.attestations : undefined;
  if (attestations === undefined) {
    return { state: "violated", failures: ["public npm attestations endpoint did not return an attestations array"] };
  }

  const provenanceEntries = attestations.filter((entry) => isRecord(entry) && entry.predicateType === SLSA_PROVENANCE);
  if (provenanceEntries.length !== 1) {
    return { state: "violated", failures: [`public npm attestations endpoint must return exactly one SLSA provenance attestation for ${name}@${version}`] };
  }

  const statement = decodePayload(provenanceEntries[0]);
  const joined = inspectProvenanceStatement({ name, version, expectedDigest, statement });
  return { state: joined.code === 0 ? "verified" : "violated", failures: joined.failures };
}
