import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { assertCredentialFree, runCandidateQualification } from "./lib/candidate-runner.mjs";
import { parseStrictJson } from "./lib/candidate-qualification.mjs";
import { selectPolicyPackage, validateReleaseQualificationContract, validateReleaseQualificationPolicy } from "./lib/release-qualification-contract.mjs";
import { assertReleaseRuntime } from "./lib/release-runtime.mjs";

const ROOT = resolve(".");
const PACKAGE_KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FIXTURE_PATH = /^(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;
const usage = "Usage: --package <package-key> --tarball <tgz> --output <path>";

function parseArgs(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 2) {
    const flag = argv[index]; const value = argv[index + 1]; const key = flag?.slice(2);
    if (!Object.hasOwn({ package: true, tarball: true, output: true }, key) || !value || result[key] !== undefined) throw new Error(usage);
    result[key] = value;
  }
  if (Object.keys(result).length !== 3 || !PACKAGE_KEY.test(result.package)) throw new Error(usage);
  return result;
}

function repositoryPath(value) {
  const path = resolve(ROOT, value);
  if (relative(ROOT, path).startsWith("..")) throw new Error("policy path escapes repository root");
  return path;
}

function fixtureObservations(adapter, fixtureRoot) {
  return Object.fromEntries(adapter.fixtures.map((name) => {
    if (!FIXTURE_PATH.test(name)) throw new Error("adapter fixture path is unsafe");
    const path = resolve(fixtureRoot, name);
    if (relative(fixtureRoot, path).startsWith("..")) throw new Error("adapter fixture escapes fixture root");
    const stat = lstatSync(path); let tracked = true;
    try { execFileSync("git", ["ls-files", "--error-unmatch", relative(ROOT, path)], { cwd: ROOT, stdio: "ignore" }); } catch { tracked = false; }
    return [name, { path, type: stat.isFile() ? "file" : "other", symlink: stat.isSymbolicLink(), tracked, size: stat.size }];
  }));
}

function scopedRegistry(scopeConfig, name) {
  const scope = /^(@[a-z0-9][a-z0-9._-]{0,213})\//.exec(name)?.[1];
  if (typeof scopeConfig?.scope !== "string" || typeof scopeConfig?.registry !== "string" || scopeConfig.scope !== scope) throw new Error("package scope configuration does not match candidate package");
  let registry; try { registry = new URL(scopeConfig.registry); } catch { throw new Error("package registry must be HTTPS"); }
  if (registry.protocol !== "https:" || registry.username || registry.password || registry.search || registry.hash) throw new Error("package registry must be HTTPS");
  return { scope, registry: registry.toString() };
}

const args = parseArgs(process.argv);
assertCredentialFree();
assertReleaseRuntime();
const policy = parseStrictJson(readFileSync(repositoryPath("governance/release-qualification-policy.json"), "utf8"));
const policyFindings = validateReleaseQualificationPolicy(policy);
if (policyFindings.length) throw new Error(`invalid qualification policy: ${policyFindings.map((item) => item.rule).join(",")}`);
const selected = selectPolicyPackage(policy, args.package);
if (!selected) throw new Error("package key has no unique policy entry");
if (selected.entry.archetypes?.["current-direct"]?.status !== "required") throw new Error("package current-direct qualification is blocked by policy");
const adapter = parseStrictJson(readFileSync(repositoryPath(selected.entry.adapterPath), "utf8"));
if (adapter.package !== selected.name) throw new Error("adapter package does not match selected policy entry");
const manifest = parseStrictJson(execFileSync("tar", ["-xOf", resolve(args.tarball), "package/package.json"], { encoding: "utf8" }));
if (manifest.name !== selected.name) throw new Error("packed manifest does not match selected policy entry");
const manifestBins = typeof manifest.bin === "string" ? { [manifest.name]: manifest.bin } : manifest.bin ?? {};
const fixtures = fixtureObservations(adapter, repositoryPath(selected.entry.fixturePath));
const findings = validateReleaseQualificationContract({ policy, adapter, fixtures, manifestBins, peerDependencies: manifest.peerDependencies ?? {}, peerDependenciesMeta: manifest.peerDependenciesMeta ?? {} });
if (findings.length) throw new Error(`invalid qualification contract: ${findings.map((item) => item.rule).join(",")}`);
const scopeConfig = parseStrictJson(readFileSync(repositoryPath("package-scope.json"), "utf8"));
const transcript = await runCandidateQualification({ tarball: resolve(args.tarball), policy, adapter, fixtures, manifestBins, registry: scopedRegistry(scopeConfig, manifest.name) });
await writeFile(resolve(args.output), `${JSON.stringify(transcript, null, 2)}\n`);
if (!transcript.ok) process.exitCode = 1;
