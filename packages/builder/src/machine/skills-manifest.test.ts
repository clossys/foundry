import { describe, expect, it } from "vitest";
import { buildSkillsManifest } from "./skills-manifest.js";

const composedSkillsRoot = "/home/op/.agents/skills";

describe("buildSkillsManifest", () => {
  it("builds one links entry per skill, sorted, each destined inside the composed directory", () => {
    const manifest = buildSkillsManifest(["zeta", "alpha"], { composedSkillsRoot });
    expect(manifest.links).toEqual([
      { source: "alpha", destination: `${composedSkillsRoot}/alpha` },
      { source: "zeta", destination: `${composedSkillsRoot}/zeta` },
    ]);
    expect(manifest.copies).toEqual([]);
    expect(manifest.managedBlocks).toEqual([]);
    expect(manifest.privateDirectories).toEqual([]);
  });

  it("builds a manifest loadManifest itself considers valid, for an empty skill list too", () => {
    // loadManifest is called internally; a thrown error here would mean this
    // module drifted from the manifest engine's own validation rules.
    expect(() => buildSkillsManifest([], { composedSkillsRoot })).not.toThrow();
    expect(buildSkillsManifest([], { composedSkillsRoot }).links).toEqual([]);
  });

  it("refuses a skill name containing a path separator, rather than trust a hostile readdir result", () => {
    expect(() => buildSkillsManifest(["../escape"], { composedSkillsRoot })).toThrow(/unsafe skill name/);
    expect(() => buildSkillsManifest(["a/b"], { composedSkillsRoot })).toThrow(/unsafe skill name/);
  });
});
