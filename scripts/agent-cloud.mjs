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

// issue #823: check:package-evidence walks `git log --follow --diff-filter=A`
// to find each qualification record's introduction commit, and requires
// exactly one match. A shallow clone (the default right after `git clone` in
// a cloud/agent sandbox) truncates that history, so the walk can return the
// wrong number of matches. readValidatedPublishedPackages's own catch then
// turns that into three confusing, unrelated-looking "state-ahead-of-evidence"
// findings instead of naming the real cause. This repository's own CI
// already avoids the problem by setting `fetch-depth: 0` (see
// .github/workflows/ci.yml, job "package state (declared vs. evidence)");
// a cloud/agent session cloning normally never gets that flag, so the
// dependency has to be enforced here instead.
//
// `git rev-parse --is-shallow-repository` itself failing (no `.git` here at
// all, or no `git` binary) is a different, unrelated condition — not what
// this check exists to catch — so it is treated as "not shallow" rather
// than blocking on it.
const isShallowGitClone = () => {
  try {
    const output = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return output === "true";
  } catch {
    return false;
  }
};

const SHALLOW_CLONE_EXPLANATION =
  "check:package-evidence and other history-dependent gates need full git history " +
  "(this repository's own CI sets fetch-depth: 0 for exactly this reason — see the " +
  '"package state (declared vs. evidence)" job in .github/workflows/ci.yml).';

const failIfShallowGitClone = () => {
  if (!isShallowGitClone()) return;
  throw new Error(
    "This is a shallow git clone (`git rev-parse --is-shallow-repository` reports true). " +
      `${SHALLOW_CLONE_EXPLANATION} Run \`git fetch --unshallow\` — or \`npm run ` +
      "agent:cloud:bootstrap\`, which does this for you — before running repository checks.",
  );
};

const ensureFullGitHistory = () => {
  if (!isShallowGitClone()) return;
  try {
    execFileSync("git", ["fetch", "--unshallow"], { cwd: root, stdio: "inherit" });
  } catch (error) {
    throw new Error(
      `This is a shallow git clone and \`git fetch --unshallow\` did not complete (${error.message}). ` +
        `${SHALLOW_CLONE_EXPLANATION} Fetch the full history yourself before continuing.`,
    );
  }
  if (isShallowGitClone()) {
    throw new Error(
      `\`git fetch --unshallow\` reported success, but this clone is still shallow. ${SHALLOW_CLONE_EXPLANATION} ` +
        "Fetch the full history yourself before continuing.",
    );
  }
};

if (action === "check") {
  failIfShallowGitClone();
  verifyDependencies();
  console.log(`Cloud session ready: Node ${process.versions.node}; npm; ${lockfile}; dependencies verified.`);
  process.exit(0);
}
if (action !== "bootstrap") throw new Error("Usage: node scripts/agent-cloud.mjs [check|bootstrap]");
execFileSync("npm", ["ci"], { cwd: root, stdio: "inherit" });
ensureFullGitHistory();
verifyDependencies();
console.log("Cloud bootstrap complete. Run npm run agent:cloud:check before the repository's normal check command.");
