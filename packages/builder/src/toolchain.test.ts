import { describe, expect, it } from "vitest";
import {
  reconcileToolchain,
  validateBuildOrderPin,
  validatePackageManagerPin,
  validateRuntimePin,
  validateToolchainDeclaration,
} from "./toolchain.js";
import type { ToolchainDeclaration, ToolchainObservation } from "./toolchain.js";

const declaration: ToolchainDeclaration = {
  runtime: { name: "node", version: "20.11.1" },
  packageManager: { name: "npm", version: "10.5.0" },
  buildOrder: { packages: ["policy", "governance", "builder"] },
};

function observation(overrides: Partial<ToolchainObservation> = {}): ToolchainObservation {
  return {
    runtime: { attempted: true, live: "20.11.1" },
    packageManager: { attempted: true, live: "10.5.0" },
    buildOrder: { attempted: true, live: ["policy", "governance", "builder"] },
    ...overrides,
  };
}

describe("validateRuntimePin / validatePackageManagerPin", () => {
  it("accepts an exact version", () => {
    expect(validateRuntimePin({ name: "node", version: "20.11.1" })).toEqual([]);
    expect(validatePackageManagerPin({ name: "npm", version: "10.5.0" })).toEqual([]);
  });

  it("rejects a range", () => {
    const findings = validateRuntimePin({ name: "node", version: "^20.0.0" });
    expect(findings.some((f) => f.rule === "toolchain/runtime-not-exact-version")).toBe(true);
  });

  it("rejects a missing name or version", () => {
    expect(
      validateRuntimePin({ name: "", version: "" }).map((f) => f.rule),
    ).toEqual(["toolchain/runtime-missing-name", "toolchain/runtime-missing-version"]);
  });
});

describe("validateBuildOrderPin", () => {
  it("accepts a well-formed, unique, ordered list", () => {
    expect(validateBuildOrderPin({ packages: ["policy", "governance"] })).toEqual([]);
  });

  it("rejects an empty list", () => {
    expect(validateBuildOrderPin({ packages: [] }).some((f) => f.rule === "toolchain/build-order-empty")).toBe(true);
  });

  it("rejects a duplicate entry", () => {
    const findings = validateBuildOrderPin({ packages: ["policy", "policy"] });
    expect(findings.some((f) => f.rule === "toolchain/build-order-duplicate-entry")).toBe(true);
  });

  it("rejects a malformed entry", () => {
    const findings = validateBuildOrderPin({ packages: ["Policy!"] });
    expect(findings.some((f) => f.rule === "toolchain/build-order-malformed-entry")).toBe(true);
  });
});

describe("validateToolchainDeclaration", () => {
  it("accepts a well-formed declaration", () => {
    expect(validateToolchainDeclaration(declaration)).toEqual([]);
  });
});

describe("reconcileToolchain", () => {
  it("verifies all three subjects when live state agrees", () => {
    const [runtime, packageManager, buildOrder] = reconcileToolchain(declaration, observation());
    expect(runtime.result.verdict).toBe("satisfied");
    expect(packageManager.result.verdict).toBe("satisfied");
    expect(buildOrder.result.verdict).toBe("satisfied");
  });

  it("normalizes a leading 'v' on the observed runtime version, the way process.version reports it", () => {
    const [runtime] = reconcileToolchain(declaration, observation({ runtime: { attempted: true, live: "v20.11.1" } }));
    expect(runtime.result.verdict).toBe("satisfied");
  });

  it("reports live-differs-from-declared for a drifted runtime pin", () => {
    const [runtime] = reconcileToolchain(declaration, observation({ runtime: { attempted: true, live: "18.19.0" } }));
    expect(runtime.result.verdict).toBe("violated");
    if (runtime.result.verdict === "violated") {
      expect(runtime.result.findings[0]?.kind).toBe("live-differs-from-declared");
    }
  });

  it("reports drift for a reordered build order", () => {
    const [, , buildOrder] = reconcileToolchain(
      declaration,
      observation({ buildOrder: { attempted: true, live: ["governance", "policy", "builder"] } }),
    );
    expect(buildOrder.result.verdict).toBe("violated");
  });

  it("reports could-not-verify with a named blocker when a subject's read was never attempted", () => {
    const [runtime] = reconcileToolchain(
      declaration,
      observation({ runtime: { attempted: false, blocker: "no shell access on this runner" } }),
    );
    expect(runtime.result.verdict).toBe("indeterminate");
    if (runtime.result.verdict === "indeterminate") {
      expect(runtime.result.detail).toBe("no shell access on this runner");
    }
  });
});
