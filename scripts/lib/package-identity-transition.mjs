import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, posix, relative } from "node:path";

const SCOPE = /^@[a-z0-9][a-z0-9._-]*$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const PACKAGE_DIRECTORY = /^[a-z0-9][a-z0-9-]*$/;
// This is the sealed first-publication cohort.  It is intentionally not the
// active catalogue: later packages are reviewed additions, never a rewrite of
// the historical Trio boundary.
export const INITIAL_PUBLICATION_PACKAGES = Object.freeze(["advisor", "starter", "controller"]);
const IDENTITY_TRANSITION_CONTROL_SURFACES = new Set([
  "governance/package-identity-transition.json",
  "governance/package-repository-history.json",
  "governance/release-catalog.json",
  "scripts/check-foreign-references.test.mjs",
  "scripts/check-package-identity-transition.mjs",
  "scripts/check-release-catalog.mjs",
  "scripts/check-release-catalog.test.mjs",
  "scripts/lib/package-identity-transition.mjs",
  "scripts/package-identity-transition.test.mjs",
  "scripts/set-package-identity.mjs",
]);

export function isIdentityTransitionControlSurface(path) {
  return IDENTITY_TRANSITION_CONTROL_SURFACES.has(path);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalRegistry(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return value;
  } catch {
    return null;
  }
}

function exactKeys(value, keys) {
  return object(value) && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function validIdentity(value, { candidate = false } = {}) {
  if (!exactKeys(value, ["scope", "registry", "access", "repository", "releaseTarget"])) return false;
  if (!SCOPE.test(value.scope ?? "") || !canonicalRegistry(value.registry)) return false;
  if (candidate ? value.access !== "public" : value.access !== null) return false;
  return /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/.test(value.repository ?? "") &&
    /^[a-z0-9][a-z0-9-]*$/.test(value.releaseTarget ?? "");
}

export function loadTransitionPolicy(path, readFile = readFileSync) {
  let policy;
  try {
    policy = JSON.parse(readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read transition policy ${path}: ${error.message}`);
  }
  const basePolicy =
    exactKeys(policy, ["$comment", "schemaVersion", "current", "candidate", "historyInventory", "historicalPathRules"]) &&
    policy.schemaVersion === 1 && validIdentity(policy.current) && validIdentity(policy.candidate, { candidate: true }) &&
    policy.current.scope !== policy.candidate.scope && policy.current.registry !== policy.candidate.registry &&
    typeof policy.historyInventory === "string" && Array.isArray(policy.historicalPathRules) && policy.historicalPathRules.length > 0 &&
    policy.historicalPathRules.every((item) => typeof item === "string" && item.length > 0) &&
    new Set(policy.historicalPathRules).size === policy.historicalPathRules.length;
  // Immutable predecessor records remain schema v1. They have no repository
  // alias grant; only the active schema v2 policy can authorize one.
  if (basePolicy) return policy;

  const aliasVersionKeys = new Set();
  const validHistoricalVersions = Array.isArray(policy?.historicalRepositoryVersions) && policy.historicalRepositoryVersions.length > 0 &&
    policy.historicalRepositoryVersions.every((item) => {
      const valid = exactKeys(item, ["name", "version", "repositoryIndex"]) &&
        /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(item.name ?? "") &&
        /^\d+\.\d+\.\d+$/.test(item.version ?? "") &&
        Number.isSafeInteger(item.repositoryIndex) &&
        item.repositoryIndex >= 0 &&
        item.repositoryIndex < (policy.historicalRepositories?.length ?? 0);
      if (valid) aliasVersionKeys.add(`${item.name}\0${item.version}`);
      return valid;
    }) && aliasVersionKeys.size === policy.historicalRepositoryVersions.length;
  if (!exactKeys(policy, ["$comment", "schemaVersion", "current", "candidate", "historyInventory", "historicalRepositories", "historicalRepositoryIds", "historicalRepositoryVersions", "historicalRepositoryInventory", "historicalPathRules"]) ||
      policy.schemaVersion !== 2 || !validIdentity(policy.current) || !validIdentity(policy.candidate, { candidate: true }) ||
      policy.current.scope === policy.candidate.scope || policy.current.registry === policy.candidate.registry ||
      typeof policy.historyInventory !== "string" || typeof policy.historicalRepositoryInventory !== "string" ||
      !Array.isArray(policy.historicalRepositories) || policy.historicalRepositories.length !== 1 ||
      policy.historicalRepositories.some((item) => !/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/.test(item)) ||
      new Set(policy.historicalRepositories).size !== policy.historicalRepositories.length ||
      policy.historicalRepositories.includes(policy.candidate.repository) ||
      !Array.isArray(policy.historicalRepositoryIds) ||
      policy.historicalRepositoryIds.length !== policy.historicalRepositories.length ||
      policy.historicalRepositoryIds.some((item) => !Number.isSafeInteger(item) || item < 1) ||
      !validHistoricalVersions ||
      !Array.isArray(policy.historicalPathRules) || policy.historicalPathRules.length === 0 ||
      policy.historicalPathRules.some((item) => typeof item !== "string" || item.length === 0) ||
      new Set(policy.historicalPathRules).size !== policy.historicalPathRules.length) {
    throw new Error("transition policy must be the closed schemaVersion 2 current/candidate and historical-alias contract");
  }
  return policy;
}

export function identityState(scopeDocument, policy) {
  if (!object(scopeDocument)) return null;
  const access = scopeDocument.access ?? null;
  const matches = (identity) => scopeDocument.scope === identity.scope && scopeDocument.registry === identity.registry && access === identity.access;
  if (matches(policy.current)) return "current";
  if (matches(policy.candidate)) return "candidate";
  return null;
}

function packageDirectories(root) {
  const packages = join(root, "packages");
  if (!existsSync(packages)) throw new Error("packages/ is missing");
  const directories = readdirSync(packages, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && PACKAGE_DIRECTORY.test(entry.name) && existsSync(join(packages, entry.name, "package.json")))
    .map((entry) => entry.name)
    .sort();
  if (directories.length === 0) throw new Error("packages/ contains no package manifests");
  return directories;
}

function repositoryFields(repository) {
  return {
    repository: `git+https://github.com/${repository}.git`,
    bugs: `https://github.com/${repository}/issues`,
    homepageBase: `https://github.com/${repository}/tree/main/packages/`,
  };
}

function renameDependencyMap(value, oldScope, newScope, packageNames) {
  if (!object(value)) return value;
  const result = {};
  for (const [name, range] of Object.entries(value)) {
    const prefix = `${oldScope}/`;
    const directory = name.startsWith(prefix) ? name.slice(prefix.length) : null;
    const nextName = directory && packageNames.has(directory) ? `${newScope}/${directory}` : name;
    if (Object.prototype.hasOwnProperty.call(result, nextName)) throw new Error(`dependency rename collides at ${nextName}`);
    result[nextName] = range;
  }
  return result;
}

function transitionManifest(manifest, directory, from, to, packageNames) {
  if (!object(manifest) || manifest.private === true) throw new Error(`packages/${directory}/package.json must be a public package manifest`);
  if (manifest.name !== `${from.scope}/${directory}`) throw new Error(`packages/${directory}/package.json is not in the complete ${from.scope} source state`);
  if (manifest.publishConfig?.registry !== from.registry || (manifest.publishConfig?.access ?? null) !== from.access) {
    throw new Error(`packages/${directory}/package.json has a mixed registry/access tuple`);
  }
  const repo = repositoryFields(from.repository);
  const url = typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
  if (url !== repo.repository || manifest.bugs?.url !== repo.bugs || manifest.homepage !== `${repo.homepageBase}${directory}#readme`) {
    throw new Error(`packages/${directory}/package.json has a mixed repository metadata tuple`);
  }
  const nextRepo = repositoryFields(to.repository);
  const next = structuredClone(manifest);
  next.name = `${to.scope}/${directory}`;
  next.repository = typeof next.repository === "string" ? nextRepo.repository : { ...next.repository, url: nextRepo.repository };
  next.bugs = { ...next.bugs, url: nextRepo.bugs };
  next.homepage = `${nextRepo.homepageBase}${directory}#readme`;
  next.publishConfig = { ...next.publishConfig, registry: to.registry };
  if (to.access === null) delete next.publishConfig.access;
  else next.publishConfig.access = to.access;
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    if (next[field] !== undefined) next[field] = renameDependencyMap(next[field], from.scope, to.scope, packageNames);
  }
  return next;
}

function transitionLock(lock, directories, from, to) {
  if (!object(lock?.packages)) throw new Error("package-lock.json has no packages object");
  const packageNames = new Set(directories);
  const next = structuredClone(lock);
  const result = {};
  for (const [path, entryValue] of Object.entries(next.packages)) {
    if (/^packages\//.test(path) && path.split("/").length === 2 && !packageNames.has(path.slice("packages/".length))) {
      continue;
    }
    let nextPath = path;
    const oldNodePrefix = `node_modules/${from.scope}/`;
    if (path.startsWith(oldNodePrefix)) {
      const directory = path.slice(oldNodePrefix.length);
      if (!packageNames.has(directory)) continue;
      nextPath = `node_modules/${to.scope}/${directory}`;
    }
    if (Object.prototype.hasOwnProperty.call(result, nextPath)) throw new Error(`package-lock path rename collides at ${nextPath}`);
    const entry = object(entryValue) ? structuredClone(entryValue) : entryValue;
    if (object(entry)) {
      if (typeof entry.name === "string" && entry.name.startsWith(`${from.scope}/`)) {
        const directory = entry.name.slice(from.scope.length + 1);
        if (packageNames.has(directory)) entry.name = `${to.scope}/${directory}`;
      }
      for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        if (entry[field] !== undefined) entry[field] = renameDependencyMap(entry[field], from.scope, to.scope, packageNames);
      }
    }
    result[nextPath] = entry;
  }
  next.packages = result;
  return next;
}

function candidateCatalog(policy) {
  return {
    schemaVersion: 2,
    defaultTarget: policy.candidate.releaseTarget,
    targets: [
      { id: policy.current.releaseTarget, status: "historical", scope: policy.current.scope, registry: policy.current.registry, packages: "all" },
      {
        id: policy.candidate.releaseTarget,
        status: "active",
        scope: policy.candidate.scope,
        registry: policy.candidate.registry,
        access: policy.candidate.access,
        packages: [...INITIAL_PUBLICATION_PACKAGES],
      },
    ],
  };
}

function validCandidateCatalog(catalog, policy, directories) {
  if (!object(catalog) || catalog.schemaVersion !== 2 || catalog.defaultTarget !== policy.candidate.releaseTarget || !Array.isArray(catalog.targets) || catalog.targets.length !== 2) return false;
  const historical = catalog.targets.find((target) => target?.id === policy.current.releaseTarget);
  const active = catalog.targets.find((target) => target?.id === policy.candidate.releaseTarget);
  if (!historical || !active || historical.status !== "historical" || historical.scope !== policy.current.scope || historical.registry !== policy.current.registry || historical.packages !== "all" || historical.access !== undefined) return false;
  if (active.status !== "active" || active.scope !== policy.candidate.scope || active.registry !== policy.candidate.registry || active.access !== policy.candidate.access || !Array.isArray(active.packages) || active.packages.length < INITIAL_PUBLICATION_PACKAGES.length || new Set(active.packages).size !== active.packages.length) return false;
  return INITIAL_PUBLICATION_PACKAGES.every((value, index) => active.packages[index] === value) &&
    active.packages.slice(INITIAL_PUBLICATION_PACKAGES.length).every((value) => typeof value === "string" && directories.includes(value));
}

function jsonBytes(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!object(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function sameJson(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function dependencyNames(value) {
  return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]
    .flatMap((field) => Object.keys(value?.[field] ?? {}));
}

function workspaceDependencyParityFindings(directories, manifests, lock) {
  const findings = [];
  for (const directory of directories) {
    const manifest = manifests.get(directory);
    const workspace = lock?.packages?.[`packages/${directory}`];
    if (!object(workspace)) {
      findings.push(`package-lock.json workspace entry packages/${directory} is missing`);
      continue;
    }
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      const manifestMap = manifest?.[field] ?? {};
      const lockMap = workspace?.[field] ?? {};
      if (!object(manifestMap) || !object(lockMap) || !sameJson(manifestMap, lockMap)) {
        findings.push(`packages/${directory}/package.json ${field} must exactly match package-lock.json workspace ${field}`);
      }
    }
  }
  return findings;
}

function validateCandidateStructuredState(root, policy, readFile) {
  const findings = [];
  const directories = packageDirectories(root);
  const names = new Set(directories);
  const candidateNames = new Set(directories.map((directory) => `${policy.candidate.scope}/${directory}`));
  const manifests = new Map();

  for (const directory of directories) {
    const path = join(root, "packages", directory, "package.json");
    const manifest = JSON.parse(readFile(path, "utf8"));
    manifests.set(directory, manifest);
    try {
      transitionManifest(manifest, directory, policy.candidate, policy.candidate, names);
    } catch (error) {
      findings.push(error.message);
    }
    for (const name of dependencyNames(manifest)) {
      if (name.startsWith(`${policy.current.scope}/`)) findings.push(`packages/${directory}/package.json retains current dependency ${name}`);
      if (name.startsWith(`${policy.candidate.scope}/`) && !candidateNames.has(name)) {
        findings.push(`packages/${directory}/package.json has undeclared candidate dependency ${name}`);
      }
    }
  }

  const lock = JSON.parse(readFile(join(root, "package-lock.json"), "utf8"));
  if (!object(lock.packages)) {
    findings.push("package-lock.json has no packages object");
  } else {
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (path.startsWith(`node_modules/${policy.current.scope}/`)) findings.push(`package-lock.json retains current path ${path}`);
      if (typeof entry?.name === "string" && entry.name.startsWith(`${policy.current.scope}/`)) {
        findings.push(`package-lock.json retains current package identity ${entry.name}`);
      }
      for (const name of dependencyNames(entry)) {
        if (name.startsWith(`${policy.current.scope}/`)) findings.push(`package-lock.json retains current dependency ${name}`);
        if (name.startsWith(`${policy.candidate.scope}/`) && !candidateNames.has(name)) {
          findings.push(`package-lock.json has undeclared candidate dependency ${name}`);
        }
      }
    }
    for (const directory of directories) {
      const workspace = lock.packages[`packages/${directory}`];
      if (workspace?.name !== `${policy.candidate.scope}/${directory}`) {
        findings.push(`package-lock.json workspace identity mismatch for packages/${directory}`);
      }
      if (lock.packages[`node_modules/${policy.candidate.scope}/${directory}`]?.link !== true) {
        findings.push(`package-lock.json is missing the exact candidate local link for ${directory}`);
      }
    }
    findings.push(...workspaceDependencyParityFindings(directories, manifests, lock));
    if (!sameJson(lock, transitionLock(lock, directories, policy.candidate, policy.candidate))) {
      findings.push("package-lock.json retains stale candidate workspace or local-link entries");
    }
  }

  const catalog = JSON.parse(readFile(join(root, "governance", "release-catalog.json"), "utf8"));
  if (!validCandidateCatalog(catalog, policy, directories)) findings.push("governance/release-catalog.json is not an active reviewed append-only candidate catalog with the sealed initial prefix");
  return [...new Set(findings)];
}

/** Plan the structured part of W1D without touching prose or historical evidence. */
export function planIdentityTransition({ root, policy, target = "candidate", readFile = readFileSync }) {
  if (target !== "candidate") throw new Error("only the reviewed candidate transition is supported");
  const scopePath = join(root, "package-scope.json");
  const scopeDocument = JSON.parse(readFile(scopePath, "utf8"));
  const state = identityState(scopeDocument, policy);
  if (state === "candidate") {
    const findings = validateCandidateStructuredState(root, policy, readFile);
    if (findings.length) throw new Error(`candidate declaration is incomplete: ${findings.join("; ")}`);
    return [];
  }
  if (state !== "current") throw new Error("package-scope.json is neither complete current nor complete candidate state");
  const directories = packageDirectories(root);
  const names = new Set(directories);
  const currentManifests = new Map(directories.map((directory) => {
    const path = join(root, "packages", directory, "package.json");
    return [directory, JSON.parse(readFile(path, "utf8"))];
  }));
  const currentLock = JSON.parse(readFile(join(root, "package-lock.json"), "utf8"));
  const currentFindings = workspaceDependencyParityFindings(directories, currentManifests, currentLock);
  if (currentFindings.length) throw new Error(`current declaration is incomplete: ${currentFindings.join("; ")}`);
  const changes = [];
  for (const directory of directories) {
    const path = join(root, "packages", directory, "package.json");
    const before = readFile(path, "utf8");
    const after = jsonBytes(transitionManifest(JSON.parse(before), directory, policy.current, policy.candidate, names));
    if (after !== before) changes.push({ path, before, after });
  }
  const lockPath = join(root, "package-lock.json");
  const lockBefore = readFile(lockPath, "utf8");
  const lockAfter = jsonBytes(transitionLock(JSON.parse(lockBefore), directories, policy.current, policy.candidate));
  if (lockAfter !== lockBefore) changes.push({ path: lockPath, before: lockBefore, after: lockAfter });
  const catalogPath = join(root, "governance", "release-catalog.json");
  const catalogBefore = readFile(catalogPath, "utf8");
  const catalogAfter = jsonBytes(candidateCatalog(policy));
  if (catalogAfter !== catalogBefore) changes.push({ path: catalogPath, before: catalogBefore, after: catalogAfter });
  const nextScope = { ...scopeDocument, scope: policy.candidate.scope, registry: policy.candidate.registry, access: policy.candidate.access };
  if (typeof nextScope.status === "string") nextScope.status = "W1D source recut prepared for public npm; publication and provider trust remain inactive until W1E.";
  const scopeAfter = jsonBytes(nextScope);
  if (scopeAfter !== readFile(scopePath, "utf8")) changes.push({ path: scopePath, before: readFile(scopePath, "utf8"), after: scopeAfter, declaration: true });
  return changes.sort((a, b) => Number(Boolean(a.declaration)) - Number(Boolean(b.declaration)) || a.path.localeCompare(b.path));
}

export function applyPlanAtomically(changes, writeFile) {
  const written = [];
  try {
    for (const change of changes) {
      // A filesystem adapter may truncate or replace bytes and only then
      // report failure. Enrol the current target in rollback before calling
      // it so even that partial-write shape is restored.
      written.push(change);
      writeFile(change.path, change.after);
    }
  } catch (error) {
    const rollbackFailures = [];
    for (const change of written.reverse()) {
      try { writeFile(change.path, change.before); } catch (rollbackError) { rollbackFailures.push(`${change.path}: ${rollbackError.message}`); }
    }
    if (rollbackFailures.length) throw new Error(`transition write failed (${error.message}); rollback also failed: ${rollbackFailures.join("; ")}`);
    throw new Error(`transition write failed and was rolled back: ${error.message}`);
  }
}

function pathRuleMatches(path, rule) {
  if (rule.includes("*")) {
    const escaped = rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]+");
    return new RegExp(`^${escaped}$`).test(path);
  }
  return rule.endsWith("/") ? path.startsWith(rule) : path === rule;
}

export function validateHistoryInventory(inventory, policy) {
  const findings = [];
  if (!exactKeys(inventory, ["$comment", "schemaVersion", "references"]) || inventory.schemaVersion !== 1 || !Array.isArray(inventory.references)) {
    return ["history inventory must be the closed schemaVersion 1 document"];
  }
  const seen = new Set();
  for (const item of inventory.references) {
    if (!exactKeys(item, ["path", "lineSha256"]) || typeof item.path !== "string" || !SHA256.test(item.lineSha256 ?? "") ||
        item.path.startsWith("/") || item.path.split("/").includes("..") ||
        !policy.historicalPathRules.some((rule) => pathRuleMatches(item.path, rule))) {
      findings.push("history inventory entries must bind an admitted relative path and exact line SHA-256");
      continue;
    }
    const key = `${item.path}\0${item.lineSha256}`;
    if (seen.has(key)) findings.push(`duplicate history inventory entry: ${item.path} ${item.lineSha256}`);
    seen.add(key);
  }
  return findings;
}

export function lineDigest(line) {
  return `sha256:${createHash("sha256").update(line).digest("hex")}`;
}

export function validateHistoricalRepositoryInventory(inventory, policy) {
  const findings = [];
  if (
    !exactKeys(inventory, ["$comment", "schemaVersion", "references"]) ||
    inventory.schemaVersion !== 1 ||
    !Array.isArray(inventory.references) ||
    !Array.isArray(policy?.historicalRepositories) ||
    policy.historicalRepositories.length !== 1
  ) {
    return ["historical repository inventory must be the closed schemaVersion 1 single-alias document"];
  }
  const seen = new Set();
  for (const item of inventory.references) {
    if (
      !exactKeys(item, ["path", "lineSha256", "count"]) ||
      typeof item.path !== "string" ||
      item.path.startsWith("/") ||
      item.path.split("/").includes("..") ||
      !SHA256.test(item.lineSha256 ?? "") ||
      !Number.isSafeInteger(item.count) ||
      item.count < 1
    ) {
      findings.push("historical repository inventory entries must bind a contained path, line SHA-256, and positive count");
      continue;
    }
    const key = `${item.path}\0${item.lineSha256}`;
    if (seen.has(key)) findings.push(`duplicate historical repository inventory entry: ${item.path} ${item.lineSha256}`);
    seen.add(key);
  }
  if (inventory.references.length === 0) findings.push("historical repository inventory must retain at least one sealed alias occurrence");
  return findings;
}

export function historicalRepositoryAllowance(inventory, policy) {
  const findings = validateHistoricalRepositoryInventory(inventory, policy);
  if (findings.length) throw new Error(findings.join("; "));
  return new Map(inventory.references.map((item) => [`${item.path}\0${item.lineSha256}`, item.count]));
}

/**
 * A repository rename may retain only the exact immutable records named by
 * the policy-owned content-addressed multiset. Paths do not grant permission:
 * every occurrence consumes one reviewed line digest/count entry.
 */
export function validateHistoricalRepositoryAliases(root, policy, {
  files,
  readFile = readFileSync,
} = {}) {
  const findings = [];
  let inventory;
  try {
    inventory = JSON.parse(readFile(join(root, policy.historicalRepositoryInventory), "utf8"));
  } catch (error) {
    return [`cannot read historical repository inventory: ${error.message}`];
  }
  let expected;
  try {
    expected = historicalRepositoryAllowance(inventory, policy);
  } catch (error) {
    return [`invalid historical repository inventory: ${error.message}`];
  }
  let paths = files;
  if (paths === undefined) {
    try {
      paths = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
    } catch (error) {
      return [`cannot enumerate tracked files for historical repository aliases: ${error.message}`];
    }
  }
  const observed = new Map();
  for (const path of paths) {
    // This declaration is the closed alias authority, not an occurrence it
    // authorizes. The inventory itself names only digests, so it cannot add a
    // second textual alias occurrence.
    if (path === "governance/package-identity-transition.json") continue;
    let text;
    try {
      text = readFile(join(root, path), "utf8").replace(/[\u0000\u200B\u200C\u200D\u2060\u180E\u00AD\uFEFF]/g, "");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      for (const repository of policy.historicalRepositories) {
        let start = 0;
        while (true) {
          const index = line.indexOf(repository, start);
          if (index < 0) break;
          const key = `${path}\0${lineDigest(line)}`;
          observed.set(key, (observed.get(key) ?? 0) + 1);
          start = index + repository.length;
        }
      }
    }
  }
  for (const [key, count] of observed) {
    const allowed = expected.get(key) ?? 0;
    if (count > allowed) findings.push(`unclassified historical repository alias occurrence: ${key.replace("\0", " ")} (observed ${count}, allowed ${allowed})`);
  }
  for (const [key, count] of expected) {
    const actual = observed.get(key) ?? 0;
    if (actual !== count) findings.push(`historical repository alias multiset mismatch: ${key.replace("\0", " ")} (observed ${actual}, required ${count})`);
  }
  return findings;
}

export function relativeChangePaths(changes, root) {
  return changes.map((change) => relative(root, change.path).split(posix.sep).join("/"));
}
