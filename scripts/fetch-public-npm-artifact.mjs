import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertCredentialFree } from "./lib/candidate-runner.mjs";
import { assertPackageAuthorized, loadReleaseCatalog, readCurrentReleaseIdentity, resolveReleaseTarget } from "./check-release-catalog.mjs";
import { publicNpmRegistryProof, verifyPublicNpmArtifact } from "./lib/public-npm-registry.mjs";

const KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;
const usage = "Usage: --package <package-key> --output <directory>";

export function argsFrom(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index]?.slice(2), value = argv[index + 1];
    if (!Object.hasOwn({ package: true, output: true }, key) || !value || result[key] !== undefined) throw new Error(usage);
    result[key] = value;
  }
  if (Object.keys(result).length !== 2 || !KEY.test(result.package)) throw new Error(usage);
  return result;
}

export async function fetchPublicNpmArtifact({ root = process.cwd(), packageKey, output, fetchImpl = fetch, env = process.env }) {
  assertCredentialFree(env);
  const identity = readCurrentReleaseIdentity({ path: resolve(root, "package-scope.json") });
  const target = resolveReleaseTarget(loadReleaseCatalog({ path: resolve(root, "governance/release-catalog.json") }), identity, env.PUBLISH_RELEASE_TARGET || undefined);
  assertPackageAuthorized(target, packageKey);
  if (target.registry !== "https://registry.npmjs.org" || target.access !== "public") throw new Error("verify_only requires the exact public npm release target");
  const manifest = JSON.parse(readFileSync(resolve(root, "packages", packageKey, "package.json"), "utf8"));
  const result = await verifyPublicNpmArtifact({ registry: target.registry, name: manifest.name, version: manifest.version, fetchImpl });
  if (result.kind !== "verified") throw new Error(`anonymous public npm artifact verification did not complete: ${result.kind}`);
  const destination = resolve(output); mkdirSync(destination, { recursive: true });
  writeFileSync(resolve(destination, "candidate.tgz"), result.bytes, { flag: "wx" });
  writeFileSync(resolve(destination, "registry-proof.json"), `${JSON.stringify(publicNpmRegistryProof(result.evidence), null, 2)}\n`, { flag: "wx" });
  return result.evidence;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const args = argsFrom(process.argv);
  fetchPublicNpmArtifact({ packageKey: args.package, output: args.output }).catch((error) => { console.error(`fetch-public-npm-artifact: ${error.message}`); process.exitCode = 1; });
}
