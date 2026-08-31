import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertCredentialFree } from "./lib/candidate-runner.mjs";
import { parseStrictJson } from "./lib/candidate-qualification.mjs";
import { repositoryIdentityFromPackument, validatePublicNpmRegistryProof } from "./lib/public-npm-registry.mjs";

const KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;
const usage = "Usage: --package <package-key> --tarball <file> --proof <file>";
export function argsFrom(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index]?.slice(2), value = argv[index + 1];
    if (!Object.hasOwn({ package: true, tarball: true, proof: true }, key) || !value || result[key] !== undefined) throw new Error(usage);
    result[key] = value;
  }
  if (Object.keys(result).length !== 3 || !KEY.test(result.package)) throw new Error(usage);
  return result;
}
function regular(path, label) { const resolved = resolve(path), stat = lstatSync(resolved); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file`); return resolved; }
export function validateProof({ root = process.cwd(), args, env = process.env }) {
  assertCredentialFree(env);
  const manifest = parseStrictJson(readFileSync(resolve(root, "packages", args.package, "package.json"), "utf8"));
  const repository = repositoryIdentityFromPackument({ repository: manifest.repository, versions: {} }, manifest.version);
  if (!repository) throw new Error("package manifest must retain one canonical GitHub repository identity");
  const proof = parseStrictJson(readFileSync(regular(args.proof, "proof"), "utf8"));
  return validatePublicNpmRegistryProof(proof, { name: manifest.name, version: manifest.version, repository, bytes: readFileSync(regular(args.tarball, "tarball")) });
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const findings = validateProof({ args: argsFrom(process.argv) });
  for (const item of findings) console.error(`[${item.rule}] ${item.message}`);
  if (findings.length) process.exitCode = 1;
}
