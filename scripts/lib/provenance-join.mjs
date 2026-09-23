// The shared subject/digest/repository/workflow join for verifying a
// published `@clossys` package's SLSA provenance statement against this
// repository's `publish.yml`.
//
// This is a dependency-free, plain-JavaScript mirror of the canonical,
// richly-typed implementation in `packages/integrator/src/provenance.ts`.
// It exists ONLY because `scripts/check-public-npm-provenance.mjs` -- the
// producer-side gate this repository's own `check:gates` suite runs -- must
// stay importable with zero build step on Node 20 (the `safety`/`publish
// safety` job's pin; see `.github/workflows/ci.yml`), and Node 20 has no
// native TypeScript stripping at all (that landed experimentally at 22.6,
// stable/unflagged at 23.6; see https://nodejs.org/api/typescript.html).
// `provenance.ts` cannot be imported directly from that job for exactly that
// reason.
//
// This file and `packages/integrator/src/provenance.ts` are kept in
// lockstep by `packages/integrator/src/provenance-join-parity.test.ts`,
// which runs the same table of statements, audit results, and packuments
// through both and asserts identical outputs. Do not edit one without the
// other, and let that test catch drift, not review alone.
//
// `packages/integrator/src/provenance.ts` cannot import THIS file instead of
// owning its own copy: `@clossys/integrator` is a published, standalone npm
// package built with plain `tsc` (no bundler), and its `files` allowlist
// ships only `dist`, `src`, and a few docs -- never this repository's
// root-level `scripts/` directory. An import reaching outside the package
// would resolve fine in this checkout and then be unresolvable for anyone
// who installs the published package. So the package keeps its own
// implementation, and the parity test is what stands in for "single source
// of truth" here.
export const PUBLIC_REGISTRY = "https://registry.npmjs.org";
export const EXPECTED_REPOSITORY = "https://github.com/clossys/foundry";
export const EXPECTED_WORKFLOW = ".github/workflows/publish.yml";
export const SLSA_PROVENANCE = "https://slsa.dev/provenance/v1";
export const SLSA_WORKFLOW_BUILD = "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1";
export const GITHUB_HOSTED_BUILDER = "https://github.com/actions/runner/github-hosted";
export const EXPECTED_MAIN_REF = "refs/heads/main";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function exactSubjectName(name, version) {
  return `pkg:npm/${name.startsWith("@") ? `%40${name.slice(1)}` : name}@${version}`;
}

export function sha512HexFromIntegrity(integrity) {
  if (typeof integrity !== "string" || !integrity.startsWith("sha512-")) return null;
  try {
    const bytes = Buffer.from(integrity.slice("sha512-".length), "base64");
    return bytes.length === 64 ? bytes.toString("hex") : null;
  } catch {
    return null;
  }
}

/** Decodes a Sigstore bundle's DSSE envelope payload (base64 JSON) into the in-toto statement it carries. */
export function decodePayload(bundle) {
  const encoded = isRecord(bundle) && isRecord(bundle.bundle) && isRecord(bundle.bundle.dsseEnvelope) ? bundle.bundle.dsseEnvelope.payload : undefined;
  if (typeof encoded !== "string" || encoded.length === 0) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export function isExactAttestationUrl(value, name, version) {
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
export function expectedDigestFromPackument(packument, name, version) {
  if (!isRecord(packument)) return null;
  const versions = isRecord(packument.versions) ? packument.versions : undefined;
  const packumentVersion = versions ? versions[version] : packument.name === name && packument.version === version ? packument : undefined;
  if (!isRecord(packumentVersion) || packumentVersion.name !== name || packumentVersion.version !== version) return null;
  const dist = isRecord(packumentVersion.dist) ? packumentVersion.dist : undefined;
  return sha512HexFromIntegrity(dist?.integrity);
}

/**
 * The join both callers share: does this decoded SLSA statement uniquely and
 * exactly bind the named package/version and tarball digest, this
 * repository's `publish.yml` on `refs/heads/main`, a manually dispatched
 * event, a GitHub-hosted builder, and one identifiable Actions run -- and,
 * when `sourceSha` is supplied, that EXACT commit rather than merely some
 * commit on `main`.
 */
export function inspectProvenanceStatement(input) {
  const { name, version, expectedDigest, statement, sourceSha } = input;
  const failures = [];

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

/**
 * Verifies one exact public npm package's provenance from `npm audit
 * signatures --include-attestations` evidence -- the producer-side check
 * `check-public-npm-provenance.mjs` runs anonymously immediately after a
 * publish, with the exact source commit it knows from the workflow run.
 * Exit 0 = exact provenance verified. Exit 1 = a concrete mismatch. Exit 2 =
 * malformed input, never silently treated as a mismatch.
 */
export function inspectPublicNpmProvenance(input) {
  const { name, version, sourceSha, audit, packument } = input;
  const failures = [];
  if (typeof name !== "string" || name.length === 0) failures.push("package name must be a non-empty string");
  if (typeof version !== "string" || version.length === 0) failures.push("package version must be a non-empty string");
  if (!/^[a-f0-9]{40}$/.test(sourceSha ?? "")) failures.push("source SHA must be exactly 40 lowercase hexadecimal characters");
  if (!isRecord(audit)) failures.push("npm audit signatures result must be an object");
  if (!isRecord(packument)) failures.push("public npm packument must be an object");
  if (failures.length > 0) return { code: 2, failures };

  const auditRecord = audit;
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
    ? verified.attestationBundles.filter((bundle) => isRecord(bundle) && bundle.predicateType === SLSA_PROVENANCE)
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

/**
 * Verifies one already-installed `@clossys` package's provenance from the
 * public attestations endpoint directly -- the shape `integrator-provenance-
 * check` reads, because pnpm has no `npm audit signatures` to read instead.
 * Never returns `indeterminate`: a caller that could not reach the registry
 * at all never calls this function in the first place (see
 * `provenance-check.ts`, which is the layer that owns that distinction).
 */
export function inspectInstalledPackageProvenance(input) {
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
