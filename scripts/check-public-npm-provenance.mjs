#!/usr/bin/env node
// Verify one exact public npm package's provenance after publication.
//
// npm itself performs the cryptographic Sigstore verification and writes its
// `npm audit signatures --json --include-attestations` result to a private
// temporary file. This checker then closes the package-specific join that a
// bare successful audit cannot express: the verified SLSA statement must name
// the exact package/version, the public packument's SHA-512 tarball digest,
// this repository, this workflow, and the source commit supplied by the
// protected release job.

// Exit 0 = exact provenance verified. Exit 1 = a concrete mismatch. Exit 2 =
// malformed input or an unreadable registry answer; uncertainty never passes.

import { readFileSync } from "node:fs";

const PUBLIC_REGISTRY = "https://registry.npmjs.org";
const EXPECTED_REPOSITORY = "https://github.com/clossys/foundry";
const EXPECTED_WORKFLOW = ".github/workflows/publish.yml";
const SLSA_PROVENANCE = "https://slsa.dev/provenance/v1";
const SLSA_WORKFLOW_BUILD = "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1";
const GITHUB_HOSTED_BUILDER = "https://github.com/actions/runner/github-hosted";
const EXPECTED_MAIN_REF = "refs/heads/main";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactSubjectName(name, version) {
  return `pkg:npm/${name.startsWith("@") ? `%40${name.slice(1)}` : name}@${version}`;
}

function sha512HexFromIntegrity(integrity) {
  if (typeof integrity !== "string" || !integrity.startsWith("sha512-")) return null;
  try {
    const bytes = Buffer.from(integrity.slice("sha512-".length), "base64");
    return bytes.length === 64 ? bytes.toString("hex") : null;
  } catch {
    return null;
  }
}

function decodePayload(bundle) {
  const encoded = bundle?.bundle?.dsseEnvelope?.payload;
  if (typeof encoded !== "string" || encoded.length === 0) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function isExactAttestationUrl(value, name, version) {
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

export function inspectPublicNpmProvenance({ name, version, sourceSha, audit, packument }) {
  const failures = [];
  if (typeof name !== "string" || name.length === 0) failures.push("package name must be a non-empty string");
  if (typeof version !== "string" || version.length === 0) failures.push("package version must be a non-empty string");
  if (!/^[a-f0-9]{40}$/.test(sourceSha ?? "")) failures.push("source SHA must be exactly 40 lowercase hexadecimal characters");
  if (!isRecord(audit)) failures.push("npm audit signatures result must be an object");
  if (!isRecord(packument)) failures.push("public npm packument must be an object");
  if (failures.length > 0) return { code: 2, failures };

  if (!Array.isArray(audit.invalid) || audit.invalid.length !== 0) failures.push("npm audit signatures reported invalid package signatures or attestations");
  if (!Array.isArray(audit.missing) || audit.missing.length !== 0) failures.push("npm audit signatures reported missing package signatures or attestations");
  if (!Array.isArray(audit.verified)) failures.push("npm audit signatures did not return a verified package array");

  const exact = Array.isArray(audit.verified)
    ? audit.verified.filter((entry) => entry?.name === name && entry?.version === version && entry?.registry === `${PUBLIC_REGISTRY}/`)
    : [];
  if (exact.length !== 1) failures.push(`npm audit signatures must verify exactly one ${name}@${version} entry from public npm`);

  const packumentVersion = packument.versions?.[version] ?? (packument.name === name && packument.version === version ? packument : null);
  const expectedDigest = sha512HexFromIntegrity(packumentVersion?.dist?.integrity);
  if (packumentVersion?.name !== name || packumentVersion?.version !== version || expectedDigest === null) {
    failures.push("public npm packument does not expose the exact package/version with a canonical SHA-512 integrity");
  }

  const verified = exact[0];
  if (!isExactAttestationUrl(verified?.attestations?.url, name, version) || verified?.attestations?.provenance?.predicateType !== SLSA_PROVENANCE) {
    failures.push("verified package metadata does not bind the exact public npm SLSA provenance endpoint");
  }

  const provenanceBundles = Array.isArray(verified?.attestationBundles)
    ? verified.attestationBundles.filter((bundle) => bundle?.predicateType === SLSA_PROVENANCE)
    : [];
  if (provenanceBundles.length !== 1) failures.push("npm audit signatures must return exactly one verified SLSA provenance bundle for the package");

  const statement = decodePayload(provenanceBundles[0]);
  if (!isRecord(statement)) {
    failures.push("verified SLSA provenance payload is not decodable JSON");
  } else {
    if (statement._type !== "https://in-toto.io/Statement/v1" || statement.predicateType !== SLSA_PROVENANCE) {
      failures.push("verified payload is not the required in-toto SLSA provenance statement");
    }
    const subjects = Array.isArray(statement.subject) ? statement.subject : [];
    const exactSubjects = subjects.filter(
      (subject) => subject?.name === exactSubjectName(name, version) && subject?.digest?.sha512 === expectedDigest,
    );
    if (subjects.length !== 1 || exactSubjects.length !== 1) failures.push("SLSA subject must uniquely bind the exact package/version and public tarball SHA-512");

    const build = statement.predicate?.buildDefinition;
    const workflow = build?.externalParameters?.workflow;
    if (
      build?.buildType !== SLSA_WORKFLOW_BUILD ||
      workflow?.repository !== EXPECTED_REPOSITORY ||
      workflow?.path !== EXPECTED_WORKFLOW ||
      workflow?.ref !== EXPECTED_MAIN_REF
    ) {
      failures.push("SLSA build definition must bind clossys/foundry main and the exact publish workflow");
    }
    if (build?.internalParameters?.github?.event_name !== "workflow_dispatch") {
      failures.push("SLSA build definition must bind a manually dispatched release");
    }
    const dependencies = Array.isArray(build?.resolvedDependencies) ? build.resolvedDependencies : [];
    const exactDependencies = dependencies.filter(
      (dependency) =>
        dependency?.uri === `git+${EXPECTED_REPOSITORY}${"@"}${EXPECTED_MAIN_REF}` &&
        dependency?.digest?.gitCommit === sourceSha,
    );
    if (dependencies.length !== 1 || exactDependencies.length !== 1) {
      failures.push("SLSA resolved dependencies must contain only the exact protected main source commit");
    }
    if (statement.predicate?.runDetails?.builder?.id !== GITHUB_HOSTED_BUILDER) {
      failures.push("SLSA builder must be the GitHub-hosted Actions runner");
    }
    const invocation = statement.predicate?.runDetails?.metadata?.invocationId;
    if (typeof invocation !== "string" || !/^https:\/\/github\.com\/clossys\/foundry\/actions\/runs\/\d+\/attempts\/\d+$/.test(invocation)) {
      failures.push("SLSA invocation must identify one clossys/foundry Actions run attempt");
    }
  }

  return { code: failures.length === 0 ? 0 : 1, failures };
}

async function main() {
  const argv = process.argv.slice(2);
  let packageDirectory;
  let auditResultPath;
  let sourceSha;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--package" && index + 1 < argv.length) packageDirectory = argv[++index];
    else if (argv[index] === "--audit-result" && index + 1 < argv.length) auditResultPath = argv[++index];
    else if (argv[index] === "--source-sha" && index + 1 < argv.length) sourceSha = argv[++index];
    else {
      console.error("usage: check-public-npm-provenance.mjs --package <directory> --audit-result <path> --source-sha <40-hex>");
      process.exit(2);
    }
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(packageDirectory ?? "") || typeof auditResultPath !== "string") {
    console.error("check-public-npm-provenance: exact package directory and audit result path are required");
    process.exit(2);
  }

  let manifest;
  let audit;
  try {
    manifest = JSON.parse(readFileSync(`packages/${packageDirectory}/package.json`, "utf8"));
    audit = JSON.parse(readFileSync(auditResultPath, "utf8"));
  } catch (error) {
    console.error(`check-public-npm-provenance: could not read local evidence: ${error.message}`);
    process.exit(2);
  }

  let response;
  let packument;
  try {
    response = await fetch(`${PUBLIC_REGISTRY}/${encodeURIComponent(manifest.name)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    packument = await response.json();
  } catch (error) {
    console.error(`check-public-npm-provenance: public npm packument is unreadable: ${error.message}`);
    process.exit(2);
  }

  const result = inspectPublicNpmProvenance({ name: manifest.name, version: manifest.version, sourceSha, audit, packument });
  if (result.code === 0) {
    console.log(`check-public-npm-provenance: ${manifest.name}@${manifest.version} exact Sigstore/SLSA provenance verified.`);
  } else {
    for (const failure of result.failures) console.error(`check-public-npm-provenance: ${failure}`);
  }
  process.exit(result.code);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
