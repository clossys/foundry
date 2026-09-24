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
export const strategistCli = join(repoRoot, "packages/strategist/dist/cli.js");

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

// docs/changelogs/ holds each package's release notes, moved there from
// packages/<dir>/CHANGELOG.md so they stay correctable without a release
// (scripts/lib/changelog-location.mjs). This gate never scanned them at
// their old location, and moving them under docs/ must not change its
// scope: their historical "the first" / "the only" lines are release
// history, not claims about the current state. The contamination and
// public-safety gates still scan every changelog.
const excludeGlobs = ["contracts/**", "changelogs/**", ...otherRootMarkdown];

// The strategist CLI argv this gate runs, relative to `cwd` (the repository
// root in real use; a fixture root in scripts/check-strategist-subject.test.mjs).
export function strategistSubjectArgs(cli = strategistCli) {
  return [cli, "clossys/strategist", scanRoot, "--extensions", ".md", ...excludeGlobs.flatMap((glob) => ["--exclude", glob])];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = spawnSync(process.execPath, strategistSubjectArgs(), { cwd: repoRoot, encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  process.stdout.write(output);
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
