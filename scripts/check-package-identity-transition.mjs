#!/usr/bin/env node
// Fail-closed structural judge for the two complete package identity states.
// The current state keeps GitHub Packages live. The candidate state is W1D
// source preparation only until the exact first-publication record closes.
// After that closure, only the reviewed public-npm upload workflow may carry
// a real publish command or OIDC trust; every other workflow remains inert.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { readValidatedPublishedPackages } from "./check-package-evidence.mjs";
import {
  identityState,
  isIdentityTransitionControlSurface,
  lineDigest,
  loadTransitionPolicy,
  validateHistoricalRepositoryAliases,
  validateHistoryInventory,
} from "./lib/package-identity-transition.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const policyPath = join(root, "governance", "package-identity-transition.json");
const scopePath = join(root, "package-scope.json");
const PUBLIC_HISTORY_REPOSITORY = "clossys/foundry";
const PUBLIC_HISTORY_URL = "https://github.com/clossys/foundry.git";
const PUBLIC_HISTORY_ORIGINS = new Set([PUBLIC_HISTORY_URL, PUBLIC_HISTORY_URL.slice(0, -4)]);
const PUBLIC_HISTORY_MAIN_REF = "refs/heads/main";
const GIT_OUTPUT_LIMIT = 64 * 1024;
const GIT_TIMEOUT_MS = 30_000;

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

function anonymousGitEnvironment(repositoryRoot) {
  return {
    PATH: "/usr/bin:/bin",
    HOME: join(repositoryRoot, ".git", "anonymous-history-home"),
    XDG_CONFIG_HOME: join(repositoryRoot, ".git", "anonymous-history-xdg"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/usr/bin/false",
    SSH_ASKPASS: "/usr/bin/false",
    LC_ALL: "C",
  };
}

export function ensureFullGitHistory(repositoryRoot = root, {
  environment = process.env,
  execute = execFileSync,
  anonymousHistoryUrl = PUBLIC_HISTORY_URL,
} = {}) {
  const runGit = (args) => execute("git", ["-C", repositoryRoot, ...args], {
    encoding: "utf8",
    env: anonymousGitEnvironment(repositoryRoot),
    killSignal: "SIGKILL",
    maxBuffer: GIT_OUTPUT_LIMIT,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: GIT_TIMEOUT_MS,
  }).trim();
  let shallow;
  try {
    shallow = runGit(["rev-parse", "--is-shallow-repository"]);
  } catch {
    throw new Error("cannot determine whether package-identity history is complete");
  }
  if (shallow === "false") return false;
  if (shallow !== "true") throw new Error("git returned an invalid shallow-repository state");

  if (
    environment.GITHUB_ACTIONS !== "true" ||
    environment.GITHUB_REPOSITORY !== PUBLIC_HISTORY_REPOSITORY ||
    environment.GITHUB_SERVER_URL !== "https://github.com"
  ) {
    throw new Error("shallow package-identity history may be hydrated only by the exact public GitHub Actions repository");
  }

  let origin;
  let head;
  try {
    origin = runGit(["remote", "get-url", "origin"]);
    head = runGit(["rev-parse", "HEAD"]);
  } catch {
    throw new Error("cannot bind shallow package-identity history to origin and HEAD");
  }
  if (!PUBLIC_HISTORY_ORIGINS.has(origin)) throw new Error("shallow package-identity history has a non-canonical origin");
  if (!/^[a-f0-9]{40}$/.test(environment.GITHUB_SHA ?? "") || environment.GITHUB_SHA !== head) {
    throw new Error("shallow package-identity history does not match the GitHub Actions source SHA");
  }

  let requestedRef;
  let destinationRef;
  if (environment.GITHUB_EVENT_NAME === "push" && environment.GITHUB_REF === PUBLIC_HISTORY_MAIN_REF) {
    requestedRef = PUBLIC_HISTORY_MAIN_REF;
    destinationRef = "refs/remotes/clossys-history/main";
  } else if (
    environment.GITHUB_EVENT_NAME === "pull_request" &&
    environment.GITHUB_BASE_REF === "main" &&
    /^refs\/pull\/[1-9][0-9]*\/merge$/.test(environment.GITHUB_REF ?? "")
  ) {
    requestedRef = environment.GITHUB_REF;
    destinationRef = `refs/remotes/clossys-history/pull-${environment.GITHUB_REF.split("/")[2]}-merge`;
  } else {
    throw new Error("shallow package-identity history has an unsupported GitHub Actions event/ref tuple");
  }

  try {
    // The scope job receives GitHub's depth-1 synthetic merge ref on pull
    // requests and a depth-1 main head on pushes. Hydrate only that exact ref
    // plus protected main, from a literal public URL. Clear checkout's auth
    // header and credential helpers, prohibit prompts, and pass a minimal
    // environment so no workflow or registry credential reaches git.
    const refspecs = [
      `+${PUBLIC_HISTORY_MAIN_REF}:refs/remotes/clossys-history/main`,
      ...(requestedRef === PUBLIC_HISTORY_MAIN_REF ? [] : [`+${requestedRef}:${destinationRef}`]),
    ];
    runGit([
      "-c", "credential.helper=",
      "-c", "http.https://github.com/.extraheader=",
      "fetch", "--unshallow", "--no-tags", "--no-recurse-submodules",
      anonymousHistoryUrl,
      ...refspecs,
    ]);
    const after = runGit(["rev-parse", "--is-shallow-repository"]);
    if (after !== "false") throw new Error("history remains shallow after hydration");
    if (runGit(["rev-parse", destinationRef]) !== head) throw new Error("hydrated event ref does not match the checked-out HEAD");
    if (!/^[a-f0-9]{40}$/.test(runGit(["rev-parse", "refs/remotes/clossys-history/main"]))) {
      throw new Error("hydrated protected-main ref is not an exact commit");
    }
  } catch {
    throw new Error("cannot anonymously hydrate complete package-identity history from the public repository");
  }
  return true;
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

function workflowPaths(workflowsRoot, current = workflowsRoot, paths = []) {
  for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) workflowPaths(workflowsRoot, path, paths);
    else if (entry.isFile() && /\.ya?ml$/.test(entry.name)) paths.push(path);
    else if (entry.isSymbolicLink()) throw new Error(`workflow inventory contains a symbolic link: ${relative(workflowsRoot, path)}`);
  }
  return paths;
}

function hasForbiddenPublish(line) {
  const occurrences = [...line.matchAll(/\bnpm\s+publish\b/g)];
  if (occurrences.length === 0) return false;
  // Multiple publish commands on one line are ambiguous by construction:
  // a dry-run segment must never bless a later real command (or vice versa).
  if (occurrences.length !== 1) return true;
  const tail = line.slice((occurrences[0].index ?? 0) + occurrences[0][0].length);
  const [commandSegment] = tail.split(/&&|\|\||[;|]/, 1);
  return !/(?:^|\s)--dry-run(?:\s|$)/.test(commandSegment);
}

export function checkCandidatePublishInert(repositoryRoot = root, { trustedPublishing = false } = {}) {
  const workflowsRoot = join(repositoryRoot, ".github", "workflows");
  if (!existsSync(workflowsRoot)) return [".github/workflows is missing during W1D"];
  const findings = [];
  const paths = workflowPaths(workflowsRoot);
  if (paths.length === 0) return [".github/workflows contains no workflow documents during W1D"];
  for (const path of paths) {
    const rel = relative(repositoryRoot, path).split("\\").join("/");
    const source = readFileSync(path, "utf8");
    const activeLines = source.split(/\r?\n/).filter((line) => !/^\s*#/.test(line));
    if (rel === ".github/workflows/publish.yml" && activeLines.some((line) => /^\s{2}push:\s*(?:#.*)?$/.test(line))) {
      findings.push(`${rel}: push publication trigger is forbidden during W1D`);
    }
    if (activeLines.some(hasForbiddenPublish) && (!trustedPublishing || rel !== ".github/workflows/publish.yml")) {
      findings.push(`${rel}: real npm publish command is forbidden outside the closed trusted-publishing workflow`);
    }
    if (activeLines.some((line) => /(?:["']?id-token["']?)\s*:\s*["']?write["']?(?:\s|,|}|$)/.test(line)) && (!trustedPublishing || rel !== ".github/workflows/publish.yml")) {
      findings.push(`${rel}: provider trust is forbidden outside the closed trusted-publishing workflow`);
    }
  }
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
  if (state === "candidate") {
    ensureFullGitHistory(root);
    const publishedPackages = readValidatedPublishedPackages(root);
    const trustedPublishing = ["@clossys/advisor", "@clossys/starter", "@clossys/controller"]
      .every((name) => publishedPackages.has(name));
    findings.push(
      ...checkCandidateHistory(policy),
      ...validateHistoricalRepositoryAliases(root, policy, { files: trackedFiles() }),
      ...checkCandidatePublishInert(root, { trustedPublishing }),
    );
  }
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
