import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { assertCredentialFree } from "./lib/candidate-runner.mjs";
import { assertPackageAuthorized, loadReleaseCatalog, readCurrentReleaseIdentity, resolveReleaseTarget } from "./check-release-catalog.mjs";
import { retryPostPublishPublicNpmArtifact } from "./lib/public-npm-registry.mjs";

const KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;
const usage = "Usage: --package <package-key> --expected-tarball <path>";

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
  if (result.kind !== "verified") throw new Error(`anonymous public npm visibility did not complete: ${result.kind}${result.detail ? ` (${result.detail})` : ""}`);
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
  const expected = exactTarballBytes(expectedTarball);
  const result = await retryPostPublishPublicNpmArtifact({ registry: target.registry, name: manifest.name, version: manifest.version, fetchImpl, sleep });
  return assertExactPublishedBytes(result, expected);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const args = argsFrom(process.argv);
  verifyPostPublishPublicNpmArtifact({ packageKey: args.package, expectedTarball: args["expected-tarball"] }).catch((error) => {
    console.error(`verify-post-publish-public-npm-artifact: ${error.message}`);
    process.exitCode = 1;
  });
}
