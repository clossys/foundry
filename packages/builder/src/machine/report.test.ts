import { describe, expect, it } from "vitest";
import { applyComposedInstallation } from "../composition.js";
import { createMemoryFileSystem } from "../memory-fs.test-helper.js";
import { createRuntimeContext, planInstallation } from "../runtime.js";
import { createMemoryDiscoveryFileSystem } from "./memory-discovery.test-helper.js";
import { MACHINE_VERIFY_INPUTS_VERSION, verifyMachine } from "./report.js";
import { buildSkillsManifest } from "./skills-manifest.js";
import { THIRD_PARTY_DECLARATION_FILENAME, WORKSPACE_MARKER_FILENAME } from "./types.js";

const home = "/home/op";
const accountsRoot = "/code/accounts";
const thirdPartyRoot = "/code/third-party";
const composedSkillsRoot = `${home}/.agents/skills`;

function workspaceMarker(account: string, skillsPath = "skills"): string {
  return JSON.stringify({ schemaVersion: 1, account, skillsPath });
}

function thirdPartyDeclaration(skills: readonly string[]): string {
  return JSON.stringify({ schemaVersion: 1, skills });
}

function baseInputs(overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: MACHINE_VERIFY_INPUTS_VERSION,
    home,
    composedSkillsRoot,
    accountWorkspacesRoot: accountsRoot,
    ...overrides,
  };
}

describe("verifyMachine — inputs", () => {
  it("is indeterminate when no inputs are supplied", () => {
    const report = verifyMachine(createMemoryDiscoveryFileSystem(), createMemoryFileSystem(), undefined);
    expect(report.overall.verdict).toBe("indeterminate");
    expect(report.exitCode).toBe(2);
  });

  it("is indeterminate when the inputs are malformed", () => {
    const report = verifyMachine(createMemoryDiscoveryFileSystem(), createMemoryFileSystem(), { schemaVersion: 1 });
    expect(report.overall.verdict).toBe("indeterminate");
    expect(report.exitCode).toBe(2);
  });
});

describe("verifyMachine — a source that cannot be read", () => {
  it("is indeterminate for the whole run, and never composes the sources that DID resolve", () => {
    const discovery = createMemoryDiscoveryFileSystem();
    // A good workspace, fully resolvable.
    discovery.setFile(`${accountsRoot}/good/${WORKSPACE_MARKER_FILENAME}`, workspaceMarker("good-account"));
    discovery.setDirectory(`${accountsRoot}/good/skills/greet`);
    // A broken workspace: declared itself a workspace, but its marker is malformed.
    discovery.setFile(`${accountsRoot}/broken/${WORKSPACE_MARKER_FILENAME}`, "not json");

    const fs = createMemoryFileSystem();
    const report = verifyMachine(discovery, fs, baseInputs());

    expect(report.overall.verdict).toBe("indeterminate");
    expect(report.exitCode).toBe(2);

    const composition = report.rows.find((row) => row.row === "composition");
    expect(composition?.result.verdict).toBe("indeterminate");
    if (composition?.result.verdict === "indeterminate") {
      expect(composition.result.reason).toBe("sources-indeterminate");
    }

    // The good workspace's own row still reports satisfied on its own terms...
    const goodRow = report.rows.find((row) => row.row === "account-workspace:good-account");
    expect(goodRow?.result.verdict).toBe("satisfied");
    // ...but nothing was ever applied or verified against the filesystem for it,
    // because composition never ran. No destination in the composed directory
    // exists.
    expect(fs.paths().some((path) => path.startsWith(composedSkillsRoot))).toBe(false);
  });

  it("is indeterminate when the account workspaces root itself cannot be resolved", () => {
    const discovery = createMemoryDiscoveryFileSystem();
    const fs = createMemoryFileSystem();
    const report = verifyMachine(discovery, fs, baseInputs({ accountWorkspacesRoot: "/nowhere" }));
    expect(report.overall.verdict).toBe("indeterminate");
    expect(report.exitCode).toBe(2);
  });
});

describe("verifyMachine — destination collisions", () => {
  it("reports two sources claiming the same skill name as a violated conflict, never last-writer-wins", () => {
    const discovery = createMemoryDiscoveryFileSystem();
    discovery.setFile(`${accountsRoot}/alpha/${WORKSPACE_MARKER_FILENAME}`, workspaceMarker("alpha-account"));
    discovery.setDirectory(`${accountsRoot}/alpha/skills/shared-skill`);
    discovery.setFile(`${accountsRoot}/beta/${WORKSPACE_MARKER_FILENAME}`, workspaceMarker("beta-account"));
    discovery.setDirectory(`${accountsRoot}/beta/skills/shared-skill`);

    const fs = createMemoryFileSystem();
    const report = verifyMachine(discovery, fs, baseInputs());

    expect(report.overall.verdict).toBe("violated");
    expect(report.exitCode).toBe(1);

    const composition = report.rows.find((row) => row.row === "composition");
    expect(composition?.result.verdict).toBe("violated");
    if (composition?.result.verdict === "violated") {
      expect(composition.result.findings).toHaveLength(1);
      expect(composition.result.findings[0]?.rule).toBe("machine/skill-collision");
      expect(composition.result.findings[0]?.message).toContain("alpha-account");
      expect(composition.result.findings[0]?.message).toContain("beta-account");
      expect(composition.result.findings[0]?.message).toContain(`${composedSkillsRoot}/shared-skill`);
    }
  });

  it("also refuses a collision between an account workspace and the third-party source", () => {
    const discovery = createMemoryDiscoveryFileSystem();
    discovery.setFile(`${accountsRoot}/alpha/${WORKSPACE_MARKER_FILENAME}`, workspaceMarker("alpha-account"));
    discovery.setDirectory(`${accountsRoot}/alpha/skills/neon-postgres`);
    discovery.setFile(`${thirdPartyRoot}/${THIRD_PARTY_DECLARATION_FILENAME}`, thirdPartyDeclaration(["neon-postgres"]));
    discovery.setDirectory(`${thirdPartyRoot}/neon-postgres`);

    const fs = createMemoryFileSystem();
    const report = verifyMachine(discovery, fs, baseInputs({ thirdPartySkillsRoot: thirdPartyRoot }));

    expect(report.overall.verdict).toBe("violated");
    const composition = report.rows.find((row) => row.row === "composition");
    if (composition?.result.verdict === "violated") {
      expect(composition.result.findings[0]?.rule).toBe("machine/skill-collision");
      expect(composition.result.findings[0]?.message).toContain("third-party");
    } else {
      throw new Error("expected composition row to be violated");
    }
  });
});

describe("verifyMachine — no sources", () => {
  it("is indeterminate, not satisfied, when discovery is clean but finds nothing to compose", () => {
    const discovery = createMemoryDiscoveryFileSystem();
    discovery.setDirectory(accountsRoot); // readable, but nothing declares itself a workspace
    const fs = createMemoryFileSystem();
    const report = verifyMachine(discovery, fs, baseInputs());
    expect(report.overall.verdict).toBe("indeterminate");
    const composition = report.rows.find((row) => row.row === "composition");
    if (composition?.result.verdict === "indeterminate") {
      expect(composition.result.reason).toBe("no-sources-found");
    } else {
      throw new Error("expected composition row to be indeterminate");
    }
  });

  it("treats an unconfigured third-party source as absent, not as a failure", () => {
    const discovery = createMemoryDiscoveryFileSystem();
    discovery.setFile(`${accountsRoot}/alpha/${WORKSPACE_MARKER_FILENAME}`, workspaceMarker("alpha-account"));
    discovery.setDirectory(`${accountsRoot}/alpha/skills/greet`);
    const fs = createMemoryFileSystem();
    fs.setDirectory(`${accountsRoot}/alpha/skills/greet`);

    const report = verifyMachine(discovery, fs, baseInputs());
    expect(report.rows.some((row) => row.row === "third-party-skills")).toBe(false);
    // No third-party row at all -- composition still runs off the one account source
    // (and reports violated because nothing has been applied yet, not indeterminate).
    expect(report.overall.verdict).toBe("violated");
  });
});

describe("verifyMachine — idempotent verification against an applied machine", () => {
  it("reports violated before applying, satisfied immediately after, and satisfied again on a second run", () => {
    const discovery = createMemoryDiscoveryFileSystem();
    discovery.setFile(`${accountsRoot}/alpha/${WORKSPACE_MARKER_FILENAME}`, workspaceMarker("alpha-account"));
    discovery.setDirectory(`${accountsRoot}/alpha/skills/greet`);

    const fs = createMemoryFileSystem();
    fs.setDirectory(`${accountsRoot}/alpha/skills/greet`);

    const inputs = baseInputs();

    const before = verifyMachine(discovery, fs, inputs);
    expect(before.overall.verdict).toBe("violated");
    expect(before.exitCode).toBe(1);

    // Apply exactly what verifyMachine itself would have composed.
    const manifest = buildSkillsManifest(["greet"], { composedSkillsRoot });
    const runtime = createRuntimeContext(manifest, {
      home,
      sourceRoot: `${accountsRoot}/alpha/skills`,
      workspaceRoot: home,
    });
    const plan = planInstallation(manifest, runtime);
    const applied = applyComposedInstallation(
      [{ source: "alpha-account", plan }],
      fs,
      { backupRoot: `${home}/.config-backups/run-1` },
    );
    expect(applied.changed).toHaveLength(1);

    const afterFirstApply = verifyMachine(discovery, fs, inputs);
    expect(afterFirstApply.overall.verdict).toBe("satisfied");
    expect(afterFirstApply.exitCode).toBe(0);

    // Re-running the apply changes nothing.
    const reapplied = applyComposedInstallation(
      [{ source: "alpha-account", plan }],
      fs,
      { backupRoot: `${home}/.config-backups/run-2` },
    );
    expect(reapplied.changed).toHaveLength(0);
    expect(reapplied.unchanged).toHaveLength(1);

    const afterSecondApply = verifyMachine(discovery, fs, inputs);
    expect(afterSecondApply.overall.verdict).toBe("satisfied");
    expect(afterSecondApply.exitCode).toBe(0);
  });
});
