import { describe, expect, it } from "vitest";
import { PLAN_CONTRACTS } from "./generated/plan-contracts.generated.js";
import { isRootEntryName, wouldViolateRootEntries } from "./root-entries.js";

/*
 * Issue #1178. Whether the root names some paths introduce would fail a
 * Controller repository profile's root vocabulary, read by the same rules
 * Controller's README states for profile schema v3.
 */
const entry = (name: string, disposition = "allowed", classification = "canonical") => ({ name, classification, disposition });
const v3 = (rootEntries: unknown) => ({ schemaVersion: 3, defaultBranch: "main", commands: [], protectedPaths: [], requirements: [], rootEntries });
const SET_PATHS = ["clossys/brief.json", ".agents/skills/clossys-writer/SKILL.md", ".claude/skills/clossys-writer", "clossys/.state/installed.json", "package.json"];

describe("wouldViolateRootEntries", () => {
  it("refuses nothing when the profile has no root vocabulary Controller checks: version 1 or 2, or an empty list", () => {
    expect(wouldViolateRootEntries({ schemaVersion: 1, defaultBranch: "main", commands: [], protectedPaths: [] }, SET_PATHS)).toEqual({ verdict: "satisfied", vocabulary: "none" });
    expect(wouldViolateRootEntries({ schemaVersion: 2, defaultBranch: "main", commands: [], protectedPaths: [], requirements: [] }, SET_PATHS)).toEqual({ verdict: "satisfied", vocabulary: "none" });
    expect(wouldViolateRootEntries(v3([]), SET_PATHS)).toEqual({ verdict: "satisfied", vocabulary: "none" });
  });

  it("names every root name a checked vocabulary does not declare, sorted and once each", () => {
    expect(wouldViolateRootEntries(v3([entry("package.json"), entry("src", "required")]), SET_PATHS)).toEqual({
      verdict: "violated",
      undeclared: [".agents", ".claude", "clossys"],
      prohibited: [],
    });
  });

  it("names a root name the vocabulary declares as prohibited, whatever its classification", () => {
    const profile = v3([entry("package.json"), entry(".agents"), entry(".claude"), entry("clossys", "prohibited", "legacy-artifact")]);
    expect(wouldViolateRootEntries(profile, SET_PATHS)).toEqual({ verdict: "violated", undeclared: [], prohibited: ["clossys"] });
  });

  it("is satisfied when every root name is declared allowed or required", () => {
    const profile = v3([entry("package.json", "required"), entry(".agents", "allowed", "extension"), entry(".claude"), entry("clossys", "allowed", "extension")]);
    expect(wouldViolateRootEntries(profile, SET_PATHS)).toEqual({ verdict: "satisfied", vocabulary: "checked" });
    expect(wouldViolateRootEntries(profile, [])).toEqual({ verdict: "satisfied", vocabulary: "checked" });
  });

  it("is indeterminate, never permissive, for anything Controller could not read as a root vocabulary", () => {
    const unknown = { verdict: "indeterminate", reason: "root-vocabulary-unknown" };
    for (const profile of [
      null,
      "profile",
      [],
      { schemaVersion: 4, rootEntries: [entry("clossys")] },
      { schemaVersion: 3 },
      { schemaVersion: 2, rootEntries: [] },
      v3("clossys"),
      v3([entry("clossys"), entry("clossys")]),
      v3([{ ...entry("clossys"), note: "x" }]),
      v3([entry("clossys", "maybe")]),
      v3([entry("clossys", "allowed", "vendored")]),
      v3([entry("a/b")]),
      v3([entry(" clossys")]),
      v3([entry("..")]),
      v3([{ name: "clossys", classification: "extension" }]),
    ]) {
      expect(wouldViolateRootEntries(profile, SET_PATHS), JSON.stringify(profile)).toEqual(unknown);
    }
  });

  it("refuses an unsafe path as a caller defect, naming its position only", () => {
    expect(() => wouldViolateRootEntries(v3([]), ["clossys/x", "../outside"])).toThrow(/^paths\[1\] is not a safe relative path$/);
  });
});

describe("isRootEntryName", () => {
  it("follows Controller's rule for one direct-child name", () => {
    for (const name of ["clossys", ".agents", "AGENTS.md", "a".repeat(255)]) expect(isRootEntryName(name), name).toBe(true);
    for (const name of ["", ".", "..", "a/b", "a\\b", " a", "a ", "a\u0007", "a".repeat(256), 3]) expect(isRootEntryName(name), String(name)).toBe(false);
  });

  it("agrees with the contracts' rootEntryName pattern", () => {
    const pattern = new RegExp(((PLAN_CONTRACTS["repository-change-set.json"] as { definitions: Record<string, { pattern: string }> }).definitions.rootEntryName!).pattern, "u");
    for (const name of ["clossys", ".agents", "AGENTS.md", "a".repeat(255), "", ".", "..", "a/b", "a\\b", " a", "a ", "a\u0007", "a\u007f", "a".repeat(256)]) {
      expect(pattern.test(name), JSON.stringify(name)).toBe(isRootEntryName(name));
    }
  });
});
