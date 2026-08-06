import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runFoundationCheck } from "@vespeneventures/gates";

// Self-hosting integration test: runs @vespeneventures/gates's own
// runFoundationCheck against THIS repository's real packages/ directory, the
// same pattern every sibling foundation package's own self-hosting
// integration test uses — applied here to this package's own real
// dependency graph rather than anything a package merely declares about
// itself.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// Read the scope from package-scope.json rather than hardcoding it: a bare
// scope literal is not rewritten by set-scope.mjs (which rewrites scopes in
// package NAMES, not one passed as a VALUE), and a stale one fails silently.
const SCOPE = JSON.parse(readFileSync(join(repoRoot, "package-scope.json"), "utf8")).scope;

describe("self-hosting: this package's own real dependency graph validates clean in the repository catalog", () => {
  it("resolves repoRoot to a directory that actually contains this package", () => {
    expect(existsSync(join(repoRoot, "packages", "release", "package.json"))).toBe(true);
  });

  it("is discovered as a catalog entry", () => {
    const report = runFoundationCheck(repoRoot, { scope: SCOPE });
    const names = report.catalog.entries.map((entry) => entry.name);
    expect(names).toContain("@vespeneventures/release");
  });

  it("produces zero error-severity findings for @vespeneventures/release itself", () => {
    const report = runFoundationCheck(repoRoot, { scope: SCOPE });
    const ownFindings = report.findings.filter((f) => f.package === "@vespeneventures/release");
    const ownErrors = ownFindings.filter((f) => f.severity === "error");

    expect(ownErrors).toEqual([]);
  });
});
