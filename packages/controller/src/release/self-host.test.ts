import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runFoundationCheck } from "../gates/index.js";

// Self-hosting integration test: runs @example/gates's own
// runFoundationCheck against THIS repository's real packages/ directory, the
// same pattern every sibling foundation package's own self-hosting
// integration test uses — applied here to this package's own real
// dependency graph rather than anything a package merely declares about
// itself.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

// Read the scope from package-scope.json rather than hardcoding it: a bare
// scope literal is not rewritten by set-scope.mjs (which rewrites scopes in
// package NAMES, not one passed as a VALUE), and a stale one fails silently.
const SCOPE = JSON.parse(readFileSync(join(repoRoot, "package-scope.json"), "utf8")).scope;

describe("self-hosting: this package's own real dependency graph validates clean in the repository catalog", () => {
  it("resolves repoRoot to a directory that actually contains this package", () => {
    // `release` is a subpath of `@clossys/controller` now (issue
    // #282 merged the standalone `release` package into it with zero
    // consumers left behind), so the on-disk package that must exist is
    // `controller`, not a `release` package directory.
    expect(existsSync(join(repoRoot, "packages", "controller", "package.json"))).toBe(true);
  });

  it("is discovered as a catalog entry", () => {
    const report = runFoundationCheck(repoRoot, { scope: SCOPE });
    const names = report.catalog.entries.map((entry) => entry.name);
    expect(names).toContain("@clossys/controller");
  });

  it("produces zero error-severity findings for @clossys/controller itself", () => {
    const report = runFoundationCheck(repoRoot, { scope: SCOPE });
    const ownFindings = report.findings.filter((f) => f.package === "@clossys/controller");
    const ownErrors = ownFindings.filter((f) => f.severity === "error");

    expect(ownErrors).toEqual([]);
  });
});
