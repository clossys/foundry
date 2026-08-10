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
if (action === "check") { console.log(`Cloud session ready: Node ${process.versions.node}; npm; ${existsSync(join(root, lockfile)) ? lockfile : "no dependency lockfile required"}.`); process.exit(0); }
if (action !== "bootstrap") throw new Error("Usage: node scripts/agent-cloud.mjs [check|bootstrap]");
if (existsSync(join(root, lockfile))) execFileSync("npm", ["ci"], { stdio: "inherit" });
console.log("Cloud bootstrap complete. Run npm run agent:cloud:check before the repository's normal check command.");
