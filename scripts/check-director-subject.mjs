#!/usr/bin/env node
/**
 * Foundry's real director facts subject: clossys/evidence/director/findings/
 * checked against docs/PUBLISHING.md only. Invokes the compiled director
 * CLI by dist path so package-evidence can count a packages/director/dist
 * site.
 */

import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const directorCli = join(repoRoot, "packages/director/dist/cli.js");

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

// The director CLI argv this gate runs, relative to `cwd` (the repository
// root in real use; a fixture root in scripts/check-director-subject.test.mjs).
export function directorSubjectArgs(cli = directorCli) {
  return [cli, "clossys/evidence/director", scanRoot, "--extensions", ".md", ...excludeGlobs.flatMap((glob) => ["--exclude", glob])];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = spawnSync(process.execPath, directorSubjectArgs(), { cwd: repoRoot, encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  process.stdout.write(output);
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
