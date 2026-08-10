#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const action = process.argv[2] ?? "check";
const root = process.cwd();
const packagePath = join(root, "package.json");
if (!existsSync(packagePath)) throw new Error("Run this command from the repository root.");
const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
const requiredMajor = Number.parseInt(String(pkg.engines?.node ?? "").match(/\d+/)?.[0] ?? "", 10);
const actualMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
if (!existsSync(join(root, "AGENTS.md"))) throw new Error("AGENTS.md is required so cloud sessions load repository policy.");
if (Number.isFinite(requiredMajor) && actualMajor < requiredMajor) throw new Error(`Node ${pkg.engines.node} is required; found Node ${process.versions.node}.`);
const lockfile = "package-lock.json";
const lockfilePath = join(root, lockfile);

if (!existsSync(lockfilePath)) {
  throw new Error(`${lockfile} is required for reproducible cloud setup.`);
}

const verifyDependencies = () => {
  try {
    execFileSync("npm", ["ls", "--all", "--omit=optional", "--json"], { cwd: root, stdio: "pipe" });
  } catch {
    throw new Error("Cloud dependencies are not ready. Run npm run agent:cloud:bootstrap before repository checks.");
  }
};

if (action === "check") {
  verifyDependencies();
  console.log(`Cloud session ready: Node ${process.versions.node}; npm; ${lockfile}; dependencies verified.`);
  process.exit(0);
}
if (action !== "bootstrap") throw new Error("Usage: node scripts/agent-cloud.mjs [check|bootstrap]");
execFileSync("npm", ["ci"], { cwd: root, stdio: "inherit" });
verifyDependencies();
console.log("Cloud bootstrap complete. Run npm run agent:cloud:check before the repository's normal check command.");
