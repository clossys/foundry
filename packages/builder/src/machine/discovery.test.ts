import { describe, expect, it } from "vitest";
import { discoverAccountWorkspaces, resolveWorkspacesRoot, WORKSPACES_ROOT_ENV_VAR } from "./discovery.js";
import { createMemoryDiscoveryFileSystem } from "./memory-discovery.test-helper.js";
import { WORKSPACE_MARKER_FILENAME } from "./types.js";

const root = "/code/projects";

function marker(account: string, skillsPath = "skills"): string {
  return JSON.stringify({ schemaVersion: 1, account, skillsPath });
}

describe("resolveWorkspacesRoot", () => {
  it("prefers an explicit root over the environment variable", () => {
    expect(
      resolveWorkspacesRoot({ root: "/explicit", env: { [WORKSPACES_ROOT_ENV_VAR]: "/from-env" } }),
    ).toBe("/explicit");
  });

  it("falls back to the environment variable when no root is supplied", () => {
    expect(resolveWorkspacesRoot({ env: { [WORKSPACES_ROOT_ENV_VAR]: "/from-env" } })).toBe("/from-env");
  });

  it("returns undefined rather than inventing a default", () => {
    expect(resolveWorkspacesRoot({})).toBeUndefined();
    expect(resolveWorkspacesRoot({ root: "" })).toBeUndefined();
    expect(resolveWorkspacesRoot({ env: {} })).toBeUndefined();
  });
});

describe("discoverAccountWorkspaces", () => {
  it("reports indeterminate, never a guessed default, when no root is declared", () => {
    const fs = createMemoryDiscoveryFileSystem();
    const result = discoverAccountWorkspaces(fs, { root: undefined });
    expect(result.verdict).toBe("indeterminate");
    expect(result.rootReason).toBe("root-not-declared");
    expect(result.candidates).toEqual([]);
  });

  it("reports indeterminate when the root cannot be listed", () => {
    const fs = createMemoryDiscoveryFileSystem();
    const result = discoverAccountWorkspaces(fs, { root: "/nowhere" });
    expect(result.verdict).toBe("indeterminate");
    expect(result.rootReason).toBe("root-unreadable");
  });

  it("excludes a directory with no marker — it never declared itself a workspace", () => {
    const fs = createMemoryDiscoveryFileSystem();
    fs.setDirectory(`${root}/other-checkout`);
    fs.setFile(`${root}/other-checkout/package.json`, "{}");
    const result = discoverAccountWorkspaces(fs, { root });
    expect(result.verdict).toBe("satisfied");
    expect(result.candidates).toEqual([]);
  });

  it("finds a well-formed workspace and lists its skills, sorted", () => {
    const fs = createMemoryDiscoveryFileSystem();
    fs.setFile(`${root}/alpha/${WORKSPACE_MARKER_FILENAME}`, marker("alpha-account"));
    fs.setDirectory(`${root}/alpha/skills/zeta`);
    fs.setDirectory(`${root}/alpha/skills/beta`);

    const result = discoverAccountWorkspaces(fs, { root });
    expect(result.verdict).toBe("satisfied");
    expect(result.candidates).toEqual([
      {
        verdict: "found",
        path: `${root}/alpha`,
        account: "alpha-account",
        skillsPath: `${root}/alpha/skills`,
        skillNames: ["beta", "zeta"],
      },
    ]);
  });

  it("is indeterminate, and names the candidate, when the marker is malformed JSON", () => {
    const fs = createMemoryDiscoveryFileSystem();
    fs.setFile(`${root}/alpha/${WORKSPACE_MARKER_FILENAME}`, "{not json");
    const result = discoverAccountWorkspaces(fs, { root });
    expect(result.verdict).toBe("indeterminate");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ verdict: "indeterminate", reason: "marker-malformed" });
  });

  it("is indeterminate when the marker's schema is invalid", () => {
    const fs = createMemoryDiscoveryFileSystem();
    fs.setFile(`${root}/alpha/${WORKSPACE_MARKER_FILENAME}`, JSON.stringify({ schemaVersion: 1 }));
    const result = discoverAccountWorkspaces(fs, { root });
    expect(result.verdict).toBe("indeterminate");
    expect(result.candidates[0]).toMatchObject({ verdict: "indeterminate", reason: "marker-invalid-schema" });
  });

  it("is indeterminate when the declared skillsPath cannot be read — never silently dropped", () => {
    const fs = createMemoryDiscoveryFileSystem();
    fs.setFile(`${root}/alpha/${WORKSPACE_MARKER_FILENAME}`, marker("alpha-account", "missing-skills"));
    const result = discoverAccountWorkspaces(fs, { root });
    expect(result.verdict).toBe("indeterminate");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      verdict: "indeterminate",
      account: "alpha-account",
      reason: "skills-path-unreadable",
    });
  });

  it("never drops one broken candidate while reporting the rest as a clean pass", () => {
    const fs = createMemoryDiscoveryFileSystem();
    fs.setFile(`${root}/good/${WORKSPACE_MARKER_FILENAME}`, marker("good-account"));
    fs.setDirectory(`${root}/good/skills/one`);
    fs.setFile(`${root}/broken/${WORKSPACE_MARKER_FILENAME}`, "not json at all");

    const result = discoverAccountWorkspaces(fs, { root });
    expect(result.verdict).toBe("indeterminate");
    expect(result.candidates).toHaveLength(2);
    const paths = result.candidates.map((c) => c.path).sort();
    expect(paths).toEqual([`${root}/broken`, `${root}/good`]);
  });

  it("downgrades every candidate sharing a duplicate account to indeterminate", () => {
    const fs = createMemoryDiscoveryFileSystem();
    fs.setFile(`${root}/alpha/${WORKSPACE_MARKER_FILENAME}`, marker("shared-account"));
    fs.setDirectory(`${root}/alpha/skills`);
    fs.setFile(`${root}/beta/${WORKSPACE_MARKER_FILENAME}`, marker("shared-account"));
    fs.setDirectory(`${root}/beta/skills`);

    const result = discoverAccountWorkspaces(fs, { root });
    expect(result.verdict).toBe("indeterminate");
    expect(result.candidates).toHaveLength(2);
    for (const candidate of result.candidates) {
      expect(candidate.verdict).toBe("indeterminate");
      expect(candidate).toMatchObject({ reason: "duplicate-account", account: "shared-account" });
    }
  });

  it("reports an empty, readable skills directory as found with an empty skill list", () => {
    const fs = createMemoryDiscoveryFileSystem();
    fs.setFile(`${root}/alpha/${WORKSPACE_MARKER_FILENAME}`, marker("alpha-account"));
    fs.setDirectory(`${root}/alpha/skills`);

    const result = discoverAccountWorkspaces(fs, { root });
    expect(result.verdict).toBe("satisfied");
    expect(result.candidates[0]).toMatchObject({ verdict: "found", skillNames: [] });
  });
});
