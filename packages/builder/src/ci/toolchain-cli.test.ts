import { describe, expect, it } from "vitest";
import { TOOLCHAIN_VERIFY_INPUTS_VERSION, verifyToolchain } from "./toolchain-cli.js";
import { MINIMUM_SAFE_VERSION } from "./version.js";
import type { ToolchainVerifyInputs } from "./toolchain-cli.js";

const goodInputs: ToolchainVerifyInputs = {
  schemaVersion: TOOLCHAIN_VERIFY_INPUTS_VERSION,
  declaration: {
    runtime: { name: "node", version: "20.11.1" },
    packageManager: { name: "npm", version: "10.5.0" },
    buildOrder: { packages: ["policy", "governance", "builder"] },
  },
  observation: {
    runtime: { attempted: true, live: "20.11.1" },
    packageManager: { attempted: true, live: "10.5.0" },
    buildOrder: { attempted: true, live: ["policy", "governance", "builder"] },
  },
};

describe("verifyToolchain", () => {
  it("exits 0 when every row verifies and the build is current", () => {
    const report = verifyToolchain(goodInputs, { installedVersion: MINIMUM_SAFE_VERSION });
    expect(report.exitCode).toBe(0);
    expect(report.overall.verdict).toBe("satisfied");
  });

  it("exits 2 when no inputs were supplied -- never a silent pass", () => {
    const report = verifyToolchain(undefined, { installedVersion: MINIMUM_SAFE_VERSION });
    expect(report.exitCode).toBe(2);
  });

  it("exits 2 for an unsupported schema version", () => {
    const report = verifyToolchain(
      { ...goodInputs, schemaVersion: 99 as typeof TOOLCHAIN_VERIFY_INPUTS_VERSION },
      { installedVersion: MINIMUM_SAFE_VERSION },
    );
    expect(report.exitCode).toBe(2);
  });

  it("exits 2 for a malformed declaration rather than crashing", () => {
    const report = verifyToolchain(
      {
        ...goodInputs,
        declaration: { ...goodInputs.declaration, runtime: { name: "node", version: "^20" } },
      },
      { installedVersion: MINIMUM_SAFE_VERSION },
    );
    expect(report.exitCode).toBe(2);
    expect(report.rows.some((row) => row.row === "declaration")).toBe(true);
  });

  it("exits 1 when a subject drifts", () => {
    const report = verifyToolchain(
      {
        ...goodInputs,
        observation: { ...goodInputs.observation, runtime: { attempted: true, live: "18.19.0" } },
      },
      { installedVersion: MINIMUM_SAFE_VERSION },
    );
    expect(report.exitCode).toBe(1);
  });

  it("exits 2 when the running build is below the minimum safe version, even if every subject would verify", () => {
    const report = verifyToolchain(goodInputs, { installedVersion: "0.0.1" });
    expect(report.exitCode).toBe(2);
  });

  it("exits 2 when a subject could not be verified, even when the rest agree", () => {
    const report = verifyToolchain(
      {
        ...goodInputs,
        observation: { ...goodInputs.observation, packageManager: { attempted: false, blocker: "no npm on PATH" } },
      },
      { installedVersion: MINIMUM_SAFE_VERSION },
    );
    expect(report.exitCode).toBe(2);
  });
});
