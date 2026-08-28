#!/usr/bin/env node
// Release-target catalogue control for publish selection.
//
// `package-scope.json` remains the single source of truth for the CURRENT
// scope and registry. This separate document is an allowlist for a named
// release target. Its default target preserves the current GitHub Packages
// lane; a future target must be selected explicitly and must match the scope
// and registry already declared by package-scope.json. That makes a scope
// switch fail closed instead of discovering and publishing every workspace
// package under the new identity.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TARGET_ID = /^[a-z0-9][a-z0-9-]*$/;
const PACKAGE_DIRECTORY = /^[a-z0-9][a-z0-9-]*$/;
const SCOPE = /^@[a-z0-9][a-z0-9-]*$/;
const PRECUTOVER_TARGET = Object.freeze({
  id: "clossys-npmjs-precutover",
  scope: "@clossys",
  registry: "https://registry.npmjs.org",
  packages: Object.freeze(["advisor", "starter", "controller"]),
});
const CURRENT_TARGET = Object.freeze({
  id: "current-github-packages",
  status: "active",
  scope: "@vespeneventures",
  registry: "https://npm.pkg.github.com",
  packages: "all",
});

class CatalogInputError extends Error {
  constructor(message) {
    super(message);
    this.exitCode = 2;
  }
}

function fail(message) {
  throw new Error(`release catalog: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJson(path, readFile, { indeterminateInput = false } = {}) {
  let raw;
  try {
    raw = readFile(path, "utf8");
  } catch (error) {
    const message = `cannot read ${path}: ${error.code ?? error.message}`;
    if (indeterminateInput) throw new CatalogInputError(message);
    fail(message);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = `${path} does not parse as JSON: ${error.message}`;
    if (indeterminateInput) throw new CatalogInputError(message);
    fail(message);
  }
}

function validRegistry(value) {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === "" && parsed.pathname === "/" && parsed.search === "" && parsed.hash === "";
  } catch {
    return false;
  }
}

function matchesExactArray(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

/**
 * Parse and validate the durable target catalogue. This is deliberately
 * strict: an omitted or malformed catalogue is a release-control failure,
 * not a reason to fall back to scanning every package.
 */
export function loadReleaseCatalog({ path = "governance/release-catalog.json", readFile = readFileSync } = {}) {
  const catalog = readJson(path, readFile, { indeterminateInput: true });
  if (!isRecord(catalog) || catalog.schemaVersion !== 1 || !TARGET_ID.test(catalog.defaultTarget ?? "") || !Array.isArray(catalog.targets) || catalog.targets.length === 0) {
    fail(`${path} must be a schemaVersion 1 catalogue with defaultTarget and a non-empty targets array`);
  }

  const ids = new Set();
  for (const target of catalog.targets) {
    if (!isRecord(target) || !TARGET_ID.test(target.id ?? "") || ids.has(target.id)) {
      fail(`${path} has a target with a missing, invalid, or duplicate id`);
    }
    ids.add(target.id);
    if (!["active", "planned"].includes(target.status) || !SCOPE.test(target.scope ?? "") || !validRegistry(target.registry)) {
      fail(`${path} target "${target.id}" must declare status, an npm scope, and a canonical HTTPS registry URL`);
    }
    if (target.packages !== "all") {
      if (!Array.isArray(target.packages) || target.packages.length === 0 || target.packages.some((item) => !PACKAGE_DIRECTORY.test(item)) || new Set(target.packages).size !== target.packages.length) {
        fail(`${path} target "${target.id}" must authorize "all" or a non-empty unique package-directory list`);
      }
    }
    if (target.status === "planned") {
      if (
        target.id !== PRECUTOVER_TARGET.id ||
        target.scope !== PRECUTOVER_TARGET.scope ||
        target.registry !== PRECUTOVER_TARGET.registry ||
        !matchesExactArray(target.packages, PRECUTOVER_TARGET.packages)
      ) {
        fail(
          `${path} planned targets must exactly declare the bounded ${PRECUTOVER_TARGET.id} Advisor, Starter, Controller npmjs precutover tuple`,
        );
      }
    }
  }
  if (catalog.targets.length !== 2 || ids.size !== 2 || !ids.has(CURRENT_TARGET.id) || !ids.has(PRECUTOVER_TARGET.id)) {
    fail(`${path} must declare exactly the current release target and the bounded ${PRECUTOVER_TARGET.id} target`);
  }
  const current = catalog.targets.find((target) => target.id === CURRENT_TARGET.id);
  const precutover = catalog.targets.find((target) => target.id === PRECUTOVER_TARGET.id);
  if (
    current.status !== CURRENT_TARGET.status ||
    current.scope !== CURRENT_TARGET.scope ||
    current.registry !== CURRENT_TARGET.registry ||
    current.packages !== CURRENT_TARGET.packages ||
    catalog.defaultTarget !== CURRENT_TARGET.id
  ) {
    fail(`${path} must retain ${CURRENT_TARGET.id} as the active all-package default target`);
  }
  if (
    precutover.status !== "planned" ||
    precutover.scope !== PRECUTOVER_TARGET.scope ||
    precutover.registry !== PRECUTOVER_TARGET.registry ||
    !matchesExactArray(precutover.packages, PRECUTOVER_TARGET.packages)
  ) {
    fail(`${path} must retain the exact planned ${PRECUTOVER_TARGET.id} Advisor, Starter, Controller npmjs precutover target`);
  }
  if (!ids.has(catalog.defaultTarget)) fail(`${path} defaultTarget "${catalog.defaultTarget}" is not declared in targets`);
  return catalog;
}

export function readCurrentReleaseIdentity({ path = "package-scope.json", readFile = readFileSync } = {}) {
  const identity = readJson(path, readFile, { indeterminateInput: true });
  if (!isRecord(identity) || !SCOPE.test(identity.scope ?? "") || !validRegistry(identity.registry)) {
    fail(`${path} must declare a valid npm scope and canonical HTTPS registry URL`);
  }
  return { scope: identity.scope, registry: identity.registry };
}

/** Resolve a target only when it is compatible with the declared live lane. */
export function resolveReleaseTarget(catalog, identity, targetId = undefined) {
  const selectedId = targetId || catalog.defaultTarget;
  if (typeof selectedId !== "string" || !TARGET_ID.test(selectedId)) fail("target must be a non-empty lowercase release-target id");
  const target = catalog.targets.find((candidate) => candidate.id === selectedId);
  if (!target) fail(`target "${selectedId}" is not authorized by the release catalogue`);
  if (target.scope !== identity.scope || target.registry !== identity.registry) {
    fail(
      `target "${selectedId}" expects ${target.scope} at ${target.registry}, but package-scope.json declares ${identity.scope} at ${identity.registry}. ` +
        "Select a matching explicit target only in its separately reviewed cutover change.",
    );
  }
  return target;
}

export function assertPackageAuthorized(target, packageDirectory) {
  if (typeof packageDirectory !== "string" || !PACKAGE_DIRECTORY.test(packageDirectory)) {
    fail("package must be a simple packages/<directory> name");
  }
  if (target.packages !== "all" && !target.packages.includes(packageDirectory)) {
    fail(`package "${packageDirectory}" is not authorized for target "${target.id}"`);
  }
}

export function filterPackagesForTarget(entries, target) {
  if (target.packages === "all") return entries;
  const available = new Set(entries.map((entry) => entry.directory));
  for (const directory of target.packages) {
    if (!available.has(directory)) fail(`target "${target.id}" authorizes missing packages/${directory}/package.json`);
  }
  return entries.filter((entry) => target.packages.includes(entry.directory));
}

function parseArgs(argv) {
  const options = { catalog: "governance/release-catalog.json", scopeFile: "package-scope.json", packageDirectory: undefined, target: process.env.PUBLISH_RELEASE_TARGET || undefined };
  for (let index = 2; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!["--catalog", "--scope-file", "--package", "--target"].includes(flag) || value === undefined) fail(`usage: check-release-catalog.mjs [--catalog path] [--scope-file path] [--target id] [--package directory]`);
    if (flag === "--catalog") options.catalog = value;
    if (flag === "--scope-file") options.scopeFile = value;
    if (flag === "--package") options.packageDirectory = value;
    if (flag === "--target") options.target = value;
    index += 1;
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv);
  const catalog = loadReleaseCatalog({ path: options.catalog });
  const identity = readCurrentReleaseIdentity({ path: options.scopeFile });
  const target = resolveReleaseTarget(catalog, identity, options.target);
  if (options.packageDirectory !== undefined) assertPackageAuthorized(target, options.packageDirectory);
  process.stdout.write(`release catalog: target "${target.id}" authorizes ${target.packages === "all" ? "all current packages" : target.packages.join(", ")} at ${target.scope} (${target.registry})\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`check-release-catalog: ${error.message}`);
    process.exitCode = error.exitCode ?? 1;
  }
}
