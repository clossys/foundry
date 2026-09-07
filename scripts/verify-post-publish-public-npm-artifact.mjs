import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { assertCredentialFree } from "./lib/candidate-runner.mjs";
import { assertPackageAuthorized, loadReleaseCatalog, readCurrentReleaseIdentity, resolveReleaseTarget } from "./check-release-catalog.mjs";
import { repositoryIdentityFromPackument, retryPostPublishPublicNpmArtifact } from "./lib/public-npm-registry.mjs";

const KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;
const usage = "Usage: --package <package-key> --expected-tarball <path>";

// This module's own bounded observation window
// (POST_PUBLISH_VISIBILITY_RETRY_DELAYS_MS, capped under three minutes) can
// legitimately run out before the anonymous public npm edge has caught up
// with an upload that already, immutably, happened. That is INDETERMINATE —
// this repository's exit code 2 — never a failure: a failure means the
// bytes we DID observe are wrong, not that we could not yet observe them.
// Collapsing the two would make a slow CDN look identical to a corrupt
// tarball, and would fail the `publish` job on evidence that never actually
// disputed the upload (see issue #790).
export class IndeterminateError extends Error {}

export function argsFrom(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index]?.slice(2), value = argv[index + 1];
    if (!Object.hasOwn({ package: true, "expected-tarball": true }, key) || !value || result[key] !== undefined) throw new Error(usage);
    result[key] = value;
  }
  if (Object.keys(result).length !== 2 || !KEY.test(result.package)) throw new Error(usage);
  return result;
}

function exactTarballBytes(path) {
  const state = lstatSync(path);
  if (!state.isFile() || state.isSymbolicLink()) throw new Error("expected qualification tarball must be a regular non-symlink file");
  const bytes = readFileSync(path);
  if (bytes.length === 0) throw new Error("expected qualification tarball must not be empty");
  return bytes;
}

function digest(algorithm, bytes) {
  return createHash(algorithm).update(bytes).digest("hex");
}

export function assertExactPublishedBytes(result, expected) {
  // A genuine mismatch — registry-served bytes that disagree with their own
  // packument shasum/integrity, or with the packed manifest's identity — is
  // a real finding about bytes we DID observe. It must still fail, never
  // fold into "indeterminate".
  if (result.kind === "mismatch") throw new Error(`published tarball mismatch: ${result.detail ?? "registry-served bytes do not match their own packument digest"}`);
  // Every other non-"verified" outcome (the version absent, the tarball
  // 404ing, denied, or otherwise unreachable) means the bounded observation
  // window ended without confirming — not that anything was disproven. The
  // immutable upload already happened; report indeterminate and let the
  // dedicated post-publish verification job be the authority.
  if (result.kind !== "verified") throw new IndeterminateError(`anonymous public npm visibility did not complete within the observation window: ${result.kind}${result.detail ? ` (${result.detail})` : ""}`);
  for (const algorithm of ["sha1", "sha256", "sha512"]) {
    if (digest(algorithm, result.bytes) !== digest(algorithm, expected)) throw new Error(`published tarball mismatch: registry ${algorithm} differs from the uploaded candidate`);
  }
  return result.evidence;
}

export async function verifyPostPublishPublicNpmArtifact({
  root = process.cwd(),
  packageKey,
  expectedTarball,
  fetchImpl = fetch,
  sleep,
  env = process.env,
}) {
  assertCredentialFree(env);
  const identity = readCurrentReleaseIdentity({ path: resolve(root, "package-scope.json") });
  const target = resolveReleaseTarget(loadReleaseCatalog({ path: resolve(root, "governance/release-catalog.json") }), identity, env.PUBLISH_RELEASE_TARGET || undefined);
  assertPackageAuthorized(target, packageKey);
  if (target.registry !== "https://registry.npmjs.org" || target.access !== "public") throw new Error("post-publish verification requires the exact public npm release target");
  const manifest = JSON.parse(readFileSync(resolve(root, "packages", packageKey, "package.json"), "utf8"));
  const repository = repositoryIdentityFromPackument({ repository: manifest.repository, versions: {} }, manifest.version);
  if (!repository) throw new Error("post-publish package manifest must retain one canonical GitHub repository identity");
  const expected = exactTarballBytes(expectedTarball);
  const result = await retryPostPublishPublicNpmArtifact({ registry: target.registry, name: manifest.name, version: manifest.version, repository, fetchImpl, sleep });
  return assertExactPublishedBytes(result, expected);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const args = argsFrom(process.argv);
  verifyPostPublishPublicNpmArtifact({ packageKey: args.package, expectedTarball: args["expected-tarball"] }).catch((error) => {
    if (error instanceof IndeterminateError) {
      console.error(`verify-post-publish-public-npm-artifact: INDETERMINATE — ${error.message}`);
      process.exitCode = 2;
      return;
    }
    console.error(`verify-post-publish-public-npm-artifact: ${error.message}`);
    process.exitCode = 1;
  });
}
