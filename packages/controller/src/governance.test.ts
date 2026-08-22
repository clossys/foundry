import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
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

// `evaluateDependencyInstallability` is safe to hand a possibly-empty edge list
// ONLY because of who calls it: `dependencyEdges` reads `entry.packageJson`,
// and the catalog has already refused to produce an entry for any manifest it
// could not read or parse (`skipped` -> `foundation.complete: false` ->
// `report.ok: false`). So "read everything, found no first-party edges" and
// "could not read a manifest" are genuinely distinguished — upstream, not here.
//
// That guarantee is an ARRANGEMENT, not a type. It holds because there is
// exactly one caller. A second caller assembling edges somewhere that does not
// fail closed would inherit a property nobody told them about, which is the
// same invisible-but-load-bearing shape as this rule having had NO caller for a
// release: safe-looking right up until it wasn't.
//
// So the arrangement is pinned here rather than left in a commit message. When
// this fails, the answer is not to update the count — it is to decide whether
// the new caller can hand over an empty list that means "could not look", and
// if it can, to give the function a discriminated result instead of an array.
describe("evaluateDependencyInstallability's caller contract", () => {
  const productionSources = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) out.push(...productionSources(full));
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".check.ts")) out.push(full);
    }
    return out;
  };

  it("has exactly one production call site, and it is runGovernanceCheck", () => {
    const callSites: string[] = [];
    for (const file of productionSources(new URL(".", import.meta.url).pathname.replace(/\/$/, ""))) {
      const text = readFileSync(file, "utf8");
      for (const [index, line] of text.split("\n").entries()) {
        // A call, not the definition, not the re-export, not a comment.
        if (!/evaluateDependencyInstallability\s*\(/.test(line)) continue;
        if (/^\s*(\/\/|\*)/.test(line)) continue;
        if (/export function evaluateDependencyInstallability/.test(line)) continue;
        // File, deliberately NOT file:line. A line number would make this
        // fail on any edit above the call — noise, not signal — and the
        // fact being pinned is "who calls this", not "where in the file".
        callSites.push(file.split("/src/")[1]);
      }
    }
    expect([...new Set(callSites)]).toEqual(["governance.ts"]);
  });
});
