import { describe, expect, it } from "vitest";
import { computeDigest } from "../policy/digest.js";
import { isOwnedByRole, planCreateOrUpdate, planMove, planRetire, planSupersede } from "./artifacts.js";

describe("role ownership boundary", () => {
  it("accepts a path under the role's own clossys/<role>/ folder", () => {
    expect(isOwnedByRole("@clossys/advisor", "clossys/advisor/brief.json")).toBe(true);
  });

  it("rejects a path under a different role's folder", () => {
    expect(isOwnedByRole("@clossys/advisor", "clossys/strategist/direction.json")).toBe(false);
  });

  it("rejects a path escaping with a .. segment", () => {
    expect(isOwnedByRole("@clossys/advisor", "clossys/advisor/../strategist/direction.json")).toBe(false);
  });
});

describe("create/update planning", () => {
  it("plans a create when no file exists yet", () => {
    const plan = planCreateOrUpdate({ role: "@clossys/advisor", path: "clossys/advisor/brief.json", existing: null });
    expect(plan).toMatchObject({ kind: "create", requiresMerge: false });
  });

  it("plans a plain update when the file is unchanged since this role's own last write", () => {
    const content = "current content";
    const digest = computeDigest(content);
    const plan = planCreateOrUpdate({ role: "@clossys/advisor", path: "clossys/advisor/brief.json", existing: { content, lastWrittenFingerprint: digest } });
    expect(plan).toMatchObject({ kind: "update", requiresMerge: false });
  });

  it("requires a merge when the file's content no longer matches this role's own last write", () => {
    const plan = planCreateOrUpdate({
      role: "@clossys/advisor",
      path: "clossys/advisor/brief.json",
      existing: { content: "a human edited this", lastWrittenFingerprint: computeDigest("what the role originally wrote") },
    });
    expect(plan).toMatchObject({ kind: "update", requiresMerge: true });
  });

  it("requires a merge when there is no recorded last-written fingerprint at all", () => {
    const plan = planCreateOrUpdate({
      role: "@clossys/advisor",
      path: "clossys/advisor/brief.json",
      existing: { content: "found, not yet managed", lastWrittenFingerprint: null },
    });
    expect(plan).toMatchObject({ kind: "update", requiresMerge: true });
  });

  it("refuses a path outside the role's own folder", () => {
    const plan = planCreateOrUpdate({ role: "@clossys/advisor", path: "clossys/strategist/direction.json", existing: null });
    expect(plan.kind).toBe("refused");
  });
});

describe("move planning", () => {
  it("names every other file whose content cites the old path", () => {
    const plan = planMove({
      role: "@clossys/advisor",
      fromPath: "clossys/advisor/old-brief.json",
      toPath: "clossys/advisor/brief.json",
      candidateReferrers: [
        { path: "clossys/advisor/STATUS.md", content: "see clossys/advisor/old-brief.json" },
        { path: "clossys/advisor/loop.json", content: "no citation here" },
        { path: "docs/README.md", content: "clossys/advisor/old-brief.json is the mandate source" },
      ],
    });
    expect(plan).toMatchObject({ kind: "move", referencesToFix: ["clossys/advisor/STATUS.md", "docs/README.md"] });
  });

  it("never cites the file's own prior self as a referrer needing a fix", () => {
    const plan = planMove({
      role: "@clossys/advisor",
      fromPath: "clossys/advisor/old-brief.json",
      toPath: "clossys/advisor/brief.json",
      candidateReferrers: [{ path: "clossys/advisor/old-brief.json", content: "clossys/advisor/old-brief.json" }],
    });
    expect(plan).toMatchObject({ kind: "move", referencesToFix: [] });
  });

  it("refuses a destination outside the role's own folder", () => {
    const plan = planMove({ role: "@clossys/advisor", fromPath: "clossys/advisor/a.json", toPath: "clossys/strategist/a.json", candidateReferrers: [] });
    expect(plan.kind).toBe("refused");
  });
});

describe("supersede planning", () => {
  it("names what a new entry supersedes without proposing a delete", () => {
    const plan = planSupersede({ role: "@clossys/advisor", path: "clossys/advisor/proof.json", supersededEntryId: "entry-7" });
    expect(plan.kind).toBe("supersede");
    expect((plan as { supersededEntryId: string }).supersededEntryId).toBe("entry-7");
    expect(plan.kind).not.toBe("delete");
    expect((plan as { reason: string }).reason).toContain("never deleted");
  });

  it("refuses a path outside the role's own folder", () => {
    const plan = planSupersede({ role: "@clossys/advisor", path: "clossys/strategist/proof.json", supersededEntryId: "entry-7" });
    expect(plan.kind).toBe("refused");
  });
});

describe("retire planning", () => {
  it("plans a retirement when the manifest lists the path and nothing depends on it", () => {
    const plan = planRetire({ role: "@clossys/advisor", path: "clossys/advisor/legacy.json", manifestOutputs: ["clossys/advisor/legacy.json"], dependents: [] });
    expect(plan.kind).toBe("retire");
  });

  it("refuses a path the role's own manifest does not list as an output", () => {
    const plan = planRetire({ role: "@clossys/advisor", path: "clossys/advisor/unlisted.json", manifestOutputs: [], dependents: [] });
    expect(plan.kind).toBe("refused");
  });

  it("blocks, rather than refuses, when a dependent still needs the artifact", () => {
    const plan = planRetire({
      role: "@clossys/advisor",
      path: "clossys/advisor/legacy.json",
      manifestOutputs: ["clossys/advisor/legacy.json"],
      dependents: [{ role: "@clossys/strategist", path: "clossys/strategist/direction.json" }],
    });
    expect(plan.kind).toBe("blocked");
    expect((plan as { dependents: unknown[] }).dependents).toHaveLength(1);
  });

  it("checking dependents runs before nothing else can override it: two dependents both come back named, sorted", () => {
    const plan = planRetire({
      role: "@clossys/advisor",
      path: "clossys/advisor/legacy.json",
      manifestOutputs: ["clossys/advisor/legacy.json"],
      dependents: [
        { role: "@clossys/writer", path: "clossys/writer/voice.json" },
        { role: "@clossys/strategist", path: "clossys/strategist/direction.json" },
      ],
    });
    expect(plan.kind).toBe("blocked");
    expect((plan as { dependents: { role: string }[] }).dependents.map((d) => d.role)).toEqual(["@clossys/strategist", "@clossys/writer"]);
  });
});
