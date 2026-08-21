import { describe, expect, it } from "vitest";
import {
  DestinationCollisionError,
  applyComposedInstallation,
  composeInstallationPlans,
  diffRetiredDestinations,
  verifyComposedInstallation,
} from "./composition.js";
import type { ComposedPlanOperation, RetiredDestination } from "./composition.js";
import { loadManifest } from "./manifest.js";
import { createRuntimeContext, planInstallation } from "./runtime.js";
import { createMemoryFileSystem } from "./memory-fs.test-helper.js";
import type { Plan } from "./types.js";

const home = "/home/op";
const backupRoot = `${home}/.config-backups/run`;

function planFor(sourceRoot: string, raw: Record<string, unknown>): Plan {
  const manifest = loadManifest({
    version: 1,
    defaults: { workspaceRoot: "${HOME}/code" },
    ...raw,
  });
  const runtime = createRuntimeContext(manifest, { home, sourceRoot });
  return planInstallation(manifest, runtime);
}

describe("composeInstallationPlans", () => {
  it("tags every operation with the source that requested it", () => {
    const alpha = planFor("/src/alpha", {
      links: [{ source: "guidance.txt", destination: "${HOME}/.agents/alpha.txt" }],
    });
    const beta = planFor("/src/beta", {
      links: [{ source: "guidance.txt", destination: "${HOME}/.agents/beta.txt" }],
    });

    const composed = composeInstallationPlans([
      { source: "alpha", plan: alpha },
      { source: "beta", plan: beta },
    ]);

    expect(composed.operations).toHaveLength(2);
    expect(composed.operations.map((o) => o.source).sort()).toEqual(["alpha", "beta"]);
    const alphaOp = composed.operations.find((o) => o.source === "alpha");
    expect(alphaOp?.destinationPath).toBe(`${home}/.agents/alpha.txt`);
  });

  it("refuses to compose zero sources", () => {
    expect(() => composeInstallationPlans([])).toThrow(/at least one/);
  });

  it("refuses an empty source identifier", () => {
    const plan = planFor("/src/alpha", {});
    expect(() => composeInstallationPlans([{ source: "", plan }])).toThrow(
      /non-empty source identifier/,
    );
  });

  it("refuses two named plans sharing one source identifier", () => {
    const alpha = planFor("/src/alpha", {});
    const alphaAgain = planFor("/src/alpha2", {});
    expect(() =>
      composeInstallationPlans([
        { source: "alpha", plan: alpha },
        { source: "alpha", plan: alphaAgain },
      ]),
    ).toThrow(/Duplicate source identifier: alpha/);
  });

  it("fails planning — before any mutation — when two sources claim the same destination, naming both", () => {
    const alpha = planFor("/src/alpha", {
      links: [{ source: "guidance.txt", destination: "${HOME}/.agents/shared.txt" }],
    });
    const beta = planFor("/src/beta", {
      links: [{ source: "guidance.txt", destination: "${HOME}/.agents/shared.txt" }],
    });

    let thrown: unknown;
    try {
      composeInstallationPlans([
        { source: "alpha", plan: alpha },
        { source: "beta", plan: beta },
      ]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DestinationCollisionError);
    const error = thrown as DestinationCollisionError;
    expect(error.collisions).toEqual([
      { destinationPath: `${home}/.agents/shared.txt`, sources: ["alpha", "beta"] },
    ]);
    expect(error.message).toMatch(/alpha, beta/);
  });

  it("never merges colliding destinations last-writer-wins — the same destination from a third source is still reported", () => {
    const alpha = planFor("/src/alpha", {
      copies: [{ source: "config.txt", destination: "${HOME}/shared.txt" }],
    });
    const beta = planFor("/src/beta", {
      copies: [{ source: "config.txt", destination: "${HOME}/shared.txt" }],
    });
    const gamma = planFor("/src/gamma", {
      copies: [{ source: "config.txt", destination: "${HOME}/shared.txt" }],
    });

    expect(() =>
      composeInstallationPlans([
        { source: "alpha", plan: alpha },
        { source: "beta", plan: beta },
        { source: "gamma", plan: gamma },
      ]),
    ).toThrow(DestinationCollisionError);
  });

  it("does not treat identical private-directory requests from two sources as a collision", () => {
    const alpha = planFor("/src/alpha", {
      privateDirectories: [{ path: "${HOME}/.ssh", create: true }],
    });
    const beta = planFor("/src/beta", {
      privateDirectories: [{ path: "${HOME}/.ssh", create: true }],
    });

    const composed = composeInstallationPlans([
      { source: "alpha", plan: alpha },
      { source: "beta", plan: beta },
    ]);
    expect(composed.operations).toHaveLength(2);
  });

  it("refuses a plan that manages one destination twice under a single source", () => {
    const alpha = planFor("/src/alpha", {
      links: [{ source: "a.txt", destination: "${HOME}/x" }],
    });
    // Simulate a hand-built plan (not manifest-validated) with a duplicate.
    const duplicated: Plan = {
      runtime: alpha.runtime,
      operations: [...alpha.operations, ...alpha.operations],
    };
    expect(() => composeInstallationPlans([{ source: "alpha", plan: duplicated }])).toThrow(
      /manages destination more than once/,
    );
  });
});

describe("applyComposedInstallation / verifyComposedInstallation", () => {
  it("applies every source's operations and verifies clean, attributing findings to their source", () => {
    const alpha = planFor("/src/alpha", {
      links: [{ source: "guidance.txt", destination: "${HOME}/.agents/alpha.txt" }],
    });
    const beta = planFor("/src/beta", {
      copies: [{ source: "config.txt", destination: "${HOME}/.config/beta.txt" }],
    });

    const fs = createMemoryFileSystem();
    fs.set("/src/alpha/guidance.txt", "alpha guidance");
    fs.set("/src/beta/config.txt", "beta config");

    const namedPlans = [
      { source: "alpha", plan: alpha },
      { source: "beta", plan: beta },
    ];

    const result = applyComposedInstallation(namedPlans, fs, { backupRoot });
    expect(result.changed).toHaveLength(2);
    expect(fs.read(`${home}/.config/beta.txt`)).toBe("beta config");

    expect(verifyComposedInstallation(namedPlans, fs)).toEqual([]);

    // Second apply is idempotent.
    expect(applyComposedInstallation(namedPlans, fs, { backupRoot }).changed).toHaveLength(0);
  });

  it("refuses to apply anything when composition collides — no partial apply", () => {
    const alpha = planFor("/src/alpha", {
      copies: [{ source: "config.txt", destination: "${HOME}/shared.txt" }],
    });
    const beta = planFor("/src/beta", {
      copies: [{ source: "config.txt", destination: "${HOME}/shared.txt" }],
    });

    const fs = createMemoryFileSystem();
    fs.set("/src/alpha/config.txt", "alpha config");
    fs.set("/src/beta/config.txt", "beta config");

    const namedPlans = [
      { source: "alpha", plan: alpha },
      { source: "beta", plan: beta },
    ];

    expect(() => applyComposedInstallation(namedPlans, fs, { backupRoot })).toThrow(
      DestinationCollisionError,
    );
    // Nothing was written by either source.
    expect(fs.lstat(`${home}/shared.txt`)).toBeUndefined();
  });

  it("reports drift findings tagged with the source whose plan produced them", () => {
    const alpha = planFor("/src/alpha", {
      links: [{ source: "guidance.txt", destination: "${HOME}/.agents/alpha.txt" }],
    });
    const fs = createMemoryFileSystem();
    fs.set("/src/alpha/guidance.txt", "alpha guidance");
    // Never applied — destination is missing, so verification should report drift.

    const findings = verifyComposedInstallation([{ source: "alpha", plan: alpha }], fs);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.source).toBe("alpha");
    expect(findings[0]?.rule).toBe("install/link-missing");
  });
});


describe("diffRetiredDestinations", () => {
  const previous: readonly RetiredDestination[] = [
    { destinationPath: "/home/op/.agents/skills/greet", source: "alpha-account", kind: "link" },
    { destinationPath: "/home/op/.claude/agent-policy.rules", source: "package-conventions", kind: "copy" },
  ];

  it("names a destination the previous run owned that the current run no longer claims", () => {
    const current: readonly ComposedPlanOperation[] = [
      {
        kind: "link",
        destinationPath: "/home/op/.agents/skills/greet",
        template: false,
        source: "alpha-account",
      },
    ];
    const report = diffRetiredDestinations(previous, current);
    expect(report.retired).toEqual([
      { destinationPath: "/home/op/.claude/agent-policy.rules", source: "package-conventions", kind: "copy" },
    ]);
  });

  it("reports nothing retired when every previous destination is still claimed", () => {
    const current: readonly ComposedPlanOperation[] = previous.map((entry) => ({
      kind: entry.kind,
      destinationPath: entry.destinationPath,
      template: false,
      source: entry.source,
    }));
    expect(diffRetiredDestinations(previous, current).retired).toEqual([]);
  });

  it("reports every previous destination retired when the current run is empty", () => {
    const report = diffRetiredDestinations(previous, []);
    expect(report.retired).toHaveLength(2);
    expect(report.retired.map((r) => r.destinationPath)).toEqual([
      "/home/op/.agents/skills/greet",
      "/home/op/.claude/agent-policy.rules",
    ]);
  });

  it("does not retire a destination merely because a DIFFERENT source now claims it — the source is part of the identity", () => {
    // A later run's ANOTHER source happening to claim the identical path is
    // not evidence the ORIGINAL owner's claim is still live; this function
    // reports what the current composition actually contains, and a
    // destination now claimed by someone new is, correctly, no longer
    // "retired" (nothing is orphaned -- something else owns it now).
    const current: readonly ComposedPlanOperation[] = [
      {
        kind: "link",
        destinationPath: "/home/op/.agents/skills/greet",
        template: false,
        source: "beta-account",
      },
    ];
    const report = diffRetiredDestinations(previous, current);
    expect(report.retired.some((r) => r.destinationPath === "/home/op/.agents/skills/greet")).toBe(false);
  });

  it("excludes private-directory operations from the comparison in both directions", () => {
    const withPrivateDir: readonly RetiredDestination[] = [
      ...previous,
      { destinationPath: "/home/op/.agents/skills", source: "alpha-account", kind: "private-directory" },
    ];
    const current: readonly ComposedPlanOperation[] = [
      { kind: "private-directory", destinationPath: "/home/op/.agents/skills", template: false, create: true, source: "beta-account" },
    ];
    const report = diffRetiredDestinations(withPrivateDir, current);
    // Both real destinations are retired (current claims neither); the
    // private directory itself never appears on either side of the report.
    expect(report.retired).toHaveLength(2);
    expect(report.retired.some((r) => r.kind === "private-directory")).toBe(false);
  });

  it("accepts a real ComposedPlan.operations array as `previous` without conversion", () => {
    const alpha = planFor("/src/alpha", {
      links: [{ source: "guidance.txt", destination: "${HOME}/.agents/alpha.txt" }],
    });
    const composed = composeInstallationPlans([{ source: "alpha", plan: alpha }]);
    // No narrowing, no mapping -- ComposedPlanOperation is structurally a
    // superset of RetiredDestination's three fields.
    const report = diffRetiredDestinations(composed.operations, []);
    expect(report.retired).toEqual([
      { destinationPath: `${home}/.agents/alpha.txt`, source: "alpha", kind: "link" },
    ]);
  });

  it("is deterministic and empty for two empty inputs", () => {
    expect(diffRetiredDestinations([], [])).toEqual({ retired: [] });
  });
});
