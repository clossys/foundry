#!/usr/bin/env node
/**
 * Foundry's real strategist facts subject: clossys/strategist/facts.json
 * checked against docs/PUBLISHING.md only. Invokes the compiled strategist
 * CLI by dist path so package-evidence can count a packages/strategist/dist
 * site.
 */

import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const strategistCli = join(repoRoot, "packages/strategist/dist/cli.js");

const scanRoot = "docs";
const otherRootMarkdown = [
  "ADOPTION.md",
  "ATTESTATION-FRESHNESS.md",
  "COMMUNICATIONS.md",
  "DECISIONS.md",
  "DEVELOPMENT-INFRASTRUCTURE.md",
  "FIRST-WAVE.md",
  "LIFECYCLE.md",
  "LOOPS.md",
  "OPERATING.md",
  "PIPELINE.md",
  "REPOSITORY-REVIEW-FIRST-RUN.md",
  "SECRETS-ARCHITECTURE.md",
];

const args = [
  strategistCli,
  "clossys/strategist",
  scanRoot,
  "--extensions",
  ".md",
  "--exclude",
  "contracts/**",
  ...otherRootMarkdown.flatMap((name) => ["--exclude", name]),
];

const result = spawnSync(process.execPath, args, { cwd: repoRoot, encoding: "utf8" });
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
process.stdout.write(output);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
