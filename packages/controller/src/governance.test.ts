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

  // `evaluateDependencyInstallability` shipped exported, documented and tested,
  // and no production caller invoked it — so the gate that exists to catch a
  // broken install never ran the rule that catches one. Reverting the single
  // line that wires it into `runGovernanceCheck` must fail THIS test; the whole
  // suite passed with the rule unreachable, which is why a unit test of the
  // rule itself could not have caught the gap.
  it("runs the dependency-installability rule, not merely export it", () => {
    mkdirSync(join(root, "packages", "consumer"), { recursive: true });
    writeFileSync(
      join(root, "packages", "consumer", "package.json"),
      JSON.stringify({ name: "@example/consumer", version: "0.1.0", dependencies: { "@example/core": "^0.1.0" } }),
    );

    const report = runGovernanceCheck(
      root,
      {
        schemaVersion: 1,
        packages: [
          { name: "@example/core", status: "retired", replacement: { name: "@example/consumer", range: "^0.1.0" }, deprecatedOn: "2026-01-01", retiredOn: "2026-01-02", decision: "d", migration: "m", forwardsToReplacement: false },
          { name: "@example/consumer", status: "active" },
        ],
      },
      { scope: "@example" },
    );

    expect(report.ok).toBe(false);
    const installability = report.lifecycleFindings.filter((finding) => finding.rule === "dependency-not-installable");
    expect(installability).toHaveLength(1);
    expect(installability[0].message).toContain("@example/consumer");
    expect(installability[0].message).toContain("@example/core");
  });

  it("does not report an OPTIONAL peer on a retired package as a broken install", () => {
    // An optional peer that cannot resolve is not a failed install, so widening
    // the edge set to every declared dependency would make this gate wrong in
    // the other direction.
    mkdirSync(join(root, "packages", "consumer"), { recursive: true });
    writeFileSync(
      join(root, "packages", "consumer", "package.json"),
      JSON.stringify({
        name: "@example/consumer",
        version: "0.1.0",
        peerDependencies: { "@example/core": "^0.1.0" },
        peerDependenciesMeta: { "@example/core": { optional: true } },
      }),
    );

    const report = runGovernanceCheck(
      root,
      {
        schemaVersion: 1,
        packages: [
          { name: "@example/core", status: "retired", replacement: { name: "@example/consumer", range: "^0.1.0" }, deprecatedOn: "2026-01-01", retiredOn: "2026-01-02", decision: "d", migration: "m", forwardsToReplacement: false },
          { name: "@example/consumer", status: "active" },
        ],
      },
      { scope: "@example" },
    );

    expect(report.lifecycleFindings.filter((finding) => finding.rule === "dependency-not-installable")).toEqual([]);
  });

  it("fails a complete workspace missing a lifecycle entry", () => {
    const report = runGovernanceCheck(root, { schemaVersion: 1, packages: [{ name: "@example/other", status: "active" }] });
    expect(report.ok).toBe(false);
    expect(report.lifecycleFindings.map((finding) => finding.rule)).toEqual(["lifecycle-entry-missing", "catalog-package-missing"]);
  });
});
