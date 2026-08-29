#!/usr/bin/env node
// Fail-closed structural judge for the two complete package identity states.
// The current state keeps GitHub Packages live. The candidate state is W1D
// source preparation only and must keep publishing inert while preserving old
// evidence through exact line-digest records, never path-wide exemptions.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { identityState, isIdentityTransitionControlSurface, lineDigest, loadTransitionPolicy, validateHistoryInventory } from "./lib/package-identity-transition.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const policyPath = join(root, "governance", "package-identity-transition.json");
const scopePath = join(root, "package-scope.json");

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { throw new Error(`cannot read ${relative(root, path)}: ${error.message}`); }
}

function dependencyNames(manifest) {
  return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]
    .flatMap((field) => Object.keys(manifest[field] ?? {}));
}

function repositoryTuple(identity, directory) {
  return {
    repository: `git+https://github.com/${identity.repository}.git`,
    bugs: `https://github.com/${identity.repository}/issues`,
    homepage: `https://github.com/${identity.repository}/tree/main/packages/${directory}#readme`,
  };
}

function checkManifests(state, policy) {
  const findings = [];
  const identity = policy[state];
  const other = policy[state === "current" ? "candidate" : "current"];
  const packagesRoot = join(root, "packages");
  if (!existsSync(packagesRoot)) return ["packages/ is missing"];
  const directories = readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(packagesRoot, entry.name, "package.json")))
    .map((entry) => entry.name).sort();
  if (directories.length === 0) return ["packages/ contains no package manifests"];
  const currentNames = new Set(directories.map((directory) => `${identity.scope}/${directory}`));
  for (const directory of directories) {
    const path = join(packagesRoot, directory, "package.json");
    const manifest = readJson(path);
    const rel = relative(root, path);
    if (manifest.private === true || manifest.name !== `${identity.scope}/${directory}`) findings.push(`${rel}: exact ${identity.scope}/${directory} public name required`);
    if (manifest.publishConfig?.registry !== identity.registry || (manifest.publishConfig?.access ?? null) !== identity.access) {
      findings.push(`${rel}: exact registry/access tuple required (${identity.registry}, ${JSON.stringify(identity.access)})`);
    }
    const expected = repositoryTuple(identity, directory);
    const repository = typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
    if (repository !== expected.repository || manifest.bugs?.url !== expected.bugs || manifest.homepage !== expected.homepage) {
      findings.push(`${rel}: exact repository/bugs/homepage tuple for ${identity.repository} required`);
    }
    for (const name of dependencyNames(manifest)) {
      if (name.startsWith(`${other.scope}/`)) findings.push(`${rel}: mixed first-party dependency ${name}`);
      if (name.startsWith(`${identity.scope}/`) && !currentNames.has(name)) findings.push(`${rel}: undeclared first-party dependency ${name}`);
    }
  }
  return findings;
}

function checkLock(state, policy) {
  const findings = [];
  const identity = policy[state];
  const other = policy[state === "current" ? "candidate" : "current"];
  const lock = readJson(join(root, "package-lock.json"));
  if (!lock.packages || typeof lock.packages !== "object") return ["package-lock.json has no packages object"];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path.startsWith(`node_modules/${other.scope}/`)) findings.push(`package-lock.json: mixed node_modules identity ${path}`);
    if (typeof entry?.name === "string" && entry.name.startsWith(`${other.scope}/`)) findings.push(`package-lock.json: mixed package identity ${entry.name}`);
    for (const name of dependencyNames(entry ?? {})) if (name.startsWith(`${other.scope}/`)) findings.push(`package-lock.json: mixed dependency ${name}`);
  }
  for (const entry of readdirSync(join(root, "packages"), { withFileTypes: true }).filter((item) => item.isDirectory())) {
    const manifestPath = join(root, "packages", entry.name, "package.json");
    if (!existsSync(manifestPath)) continue;
    if (lock.packages[`packages/${entry.name}`]?.name !== `${identity.scope}/${entry.name}`) findings.push(`package-lock.json: packages/${entry.name} workspace identity mismatch`);
    if (lock.packages[`node_modules/${identity.scope}/${entry.name}`]?.link !== true) findings.push(`package-lock.json: missing exact local link for ${identity.scope}/${entry.name}`);
  }
  return findings;
}

function trackedFiles() {
  try {
    return execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  } catch (error) {
    throw new Error(`cannot enumerate tracked files: ${error.message}`);
  }
}

function checkCandidateHistory(policy) {
  const inventory = readJson(join(root, policy.historyInventory));
  const findings = validateHistoryInventory(inventory, policy);
  const expected = new Set(inventory.references.map((item) => `${item.path}\0${item.lineSha256}`));
  const observed = new Set();
  const needles = [policy.current.scope, policy.current.registry, policy.current.repository];
  for (const path of trackedFiles()) {
    if (isIdentityTransitionControlSurface(path)) continue;
    let bytes;
    try { bytes = readFileSync(join(root, path)); } catch { continue; }
    const text = bytes.toString("utf8").replace(/[\u0000\u200B\u200C\u200D\u2060\u180E\u00AD\uFEFF]/g, "");
    for (const line of text.split(/\r?\n/)) {
      if (!needles.some((needle) => line.includes(needle))) continue;
      const key = `${path}\0${lineDigest(line)}`;
      observed.add(key);
      if (!expected.has(key)) findings.push(`${path}: unclassified historical identity line ${lineDigest(line)}`);
    }
  }
  for (const key of expected) if (!observed.has(key)) findings.push(`unused historical identity record: ${key.replace("\0", " ")}`);
  return findings;
}

function checkCandidatePublishInert() {
  const path = join(root, ".github", "workflows", "publish.yml");
  const source = readFileSync(path, "utf8");
  const findings = [];
  if (/^\s{2}push:\s*$/m.test(source)) findings.push("publish.yml: push publication trigger is forbidden during W1D");
  const livePublishes = source.split(/\r?\n/).filter((line) => /\bnpm publish\b/.test(line) && !/--dry-run/.test(line) && !/^\s*#/.test(line));
  if (livePublishes.length) findings.push("publish.yml: real npm publish command is forbidden during W1D");
  if (/\bid-token:\s*write\b/.test(source)) findings.push("publish.yml: provider trust must remain inactive during W1D");
  return findings;
}

export function evaluatePackageIdentity(rootOverride = root) {
  if (rootOverride !== root) throw new Error("root override is not supported by this CLI; import pure helpers for fixtures");
  const policy = loadTransitionPolicy(policyPath);
  const state = identityState(readJson(scopePath), policy);
  if (!state) return { state: null, findings: ["package-scope.json is neither the complete current nor complete candidate tuple"] };
  const findings = [...checkManifests(state, policy), ...checkLock(state, policy)];
  const inventory = readJson(join(root, policy.historyInventory));
  findings.push(...validateHistoryInventory(inventory, policy));
  if (state === "current" && inventory.references.length !== 0) findings.push("current state must not pre-authorize candidate historical references");
  if (state === "candidate") findings.push(...checkCandidateHistory(policy), ...checkCandidatePublishInert());
  return { state, findings: [...new Set(findings)] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = evaluatePackageIdentity();
    if (result.findings.length) {
      for (const finding of result.findings) console.error(`PACKAGE IDENTITY FINDING — ${finding}`);
      process.exit(1);
    }
    console.log(`PACKAGE IDENTITY OK — complete ${result.state} state; no mixed namespace, registry, access, repository, or lock tuple.`);
  } catch (error) {
    console.error(`PACKAGE IDENTITY INDETERMINATE — ${error.message}`);
    process.exit(2);
  }
}
