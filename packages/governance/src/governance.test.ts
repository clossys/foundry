import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGovernanceCheck } from "./index.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "governance-"));
  mkdirSync(join(root, "packages", "core"), { recursive: true });
  writeFileSync(join(root, "packages", "core", "package.json"), JSON.stringify({ name: "@example/core", version: "0.1.0" }));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("runGovernanceCheck", () => {
  it("composes foundation, build-order, and lifecycle evidence", () => {
    const report = runGovernanceCheck(root, { schemaVersion: 1, packages: [{ name: "@example/core", status: "active" }] }, { scope: "@example" });
    expect(report.ok).toBe(true);
    expect(report.buildOrder).toEqual({ ok: true, order: ["@example/core"] });
  });

  it("fails a complete workspace missing a lifecycle entry", () => {
    const report = runGovernanceCheck(root, { schemaVersion: 1, packages: [{ name: "@example/other", status: "active" }] });
    expect(report.ok).toBe(false);
    expect(report.lifecycleFindings.map((finding) => finding.rule)).toEqual(["lifecycle-entry-missing", "catalog-package-missing"]);
  });
});
