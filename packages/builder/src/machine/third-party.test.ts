import { describe, expect, it } from "vitest";
import {
  loadThirdPartySkills,
  resolveThirdPartyRoot,
  THIRD_PARTY_ROOT_ENV_VAR,
  THIRD_PARTY_SCOPE,
} from "./third-party.js";
import { createMemoryDiscoveryFileSystem } from "./memory-discovery.test-helper.js";
import { THIRD_PARTY_DECLARATION_FILENAME } from "./types.js";

const root = "/code/third-party-skills";

function declaration(skills: readonly string[]): string {
  return JSON.stringify({ schemaVersion: 1, skills });
}

describe("resolveThirdPartyRoot", () => {
  it("prefers an explicit root over the environment variable", () => {
    expect(
      resolveThirdPartyRoot({ root: "/explicit", env: { [THIRD_PARTY_ROOT_ENV_VAR]: "/from-env" } }),
    ).toBe("/explicit");
  });

  it("falls back to the environment variable", () => {
    expect(resolveThirdPartyRoot({ env: { [THIRD_PARTY_ROOT_ENV_VAR]: "/from-env" } })).toBe("/from-env");
  });

  it("returns undefined rather than inventing a default", () => {
    expect(resolveThirdPartyRoot({})).toBeUndefined();
  });
});

describe("THIRD_PARTY_SCOPE", () => {
  it("is the literal 'third-party', drawn from controller's own SkillScope union", () => {
    // If controller's SkillScope union ever drops "third-party", the assignment
    // inside third-party.ts stops compiling -- this assertion is the runtime
    // half of that same guarantee.
    expect(THIRD_PARTY_SCOPE).toBe("third-party");
  });
});

describe("loadThirdPartySkills", () => {
  it("is indeterminate when no root is declared", () => {
    const fs = createMemoryDiscoveryFileSystem();
    const result = loadThirdPartySkills(fs, { root: undefined });
    expect(result.verdict).toBe("indeterminate");
    expect(result.reason).toBe("root-not-declared");
    expect(result.skills).toEqual([]);
  });

  it("is indeterminate when the root cannot be listed", () => {
    const fs = createMemoryDiscoveryFileSystem();
    const result = loadThirdPartySkills(fs, { root: "/nowhere" });
    expect(result.verdict).toBe("indeterminate");
    expect(result.reason).toBe("root-unreadable");
  });

  it("is indeterminate when the declaration file is missing", () => {
    const fs = createMemoryDiscoveryFileSystem();
    fs.setDirectory(root);
    const result = loadThirdPartySkills(fs, { root });
    expect(result.verdict).toBe("indeterminate");
    expect(result.reason).toBe("declaration-unreadable");
  });

  it("is indeterminate when the declaration is malformed JSON", () => {
    const fs = createMemoryDiscoveryFileSystem();
    fs.setFile(`${root}/${THIRD_PARTY_DECLARATION_FILENAME}`, "{not json");
    const result = loadThirdPartySkills(fs, { root });
    expect(result.verdict).toBe("indeterminate");
    expect(result.reason).toBe("declaration-malformed");
  });

  it("is indeterminate when the declaration's schema is invalid", () => {
    const fs = createMemoryDiscoveryFileSystem();
    fs.setFile(`${root}/${THIRD_PARTY_DECLARATION_FILENAME}`, JSON.stringify({ schemaVersion: 1, skills: [1, 2] }));
    const result = loadThirdPartySkills(fs, { root });
    expect(result.verdict).toBe("indeterminate");
    expect(result.reason).toBe("declaration-invalid-schema");
  });

  it("is indeterminate when a declared skill does not exist on disk — never a silently shorter list", () => {
    const fs = createMemoryDiscoveryFileSystem();
    fs.setFile(`${root}/${THIRD_PARTY_DECLARATION_FILENAME}`, declaration(["neon-postgres", "ghost-skill"]));
    fs.setDirectory(`${root}/neon-postgres`);
    const result = loadThirdPartySkills(fs, { root });
    expect(result.verdict).toBe("indeterminate");
    expect(result.reason).toBe("declared-skill-missing-on-disk");
    expect(result.detail).toContain("ghost-skill");
    expect(result.skills).toEqual([]);
  });

  it("resolves every declared skill, tagged third-party scope, when the declaration matches disk", () => {
    const fs = createMemoryDiscoveryFileSystem();
    fs.setFile(`${root}/${THIRD_PARTY_DECLARATION_FILENAME}`, declaration(["neon-postgres"]));
    fs.setDirectory(`${root}/neon-postgres`);

    const result = loadThirdPartySkills(fs, { root });
    expect(result.verdict).toBe("satisfied");
    expect(result.skills).toEqual([{ name: "neon-postgres", scope: "third-party" }]);
  });
});
