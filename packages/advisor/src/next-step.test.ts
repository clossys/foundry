import { describe, expect, it } from "vitest";
import { nextStepInstruction } from "./index.js";

describe("nextStepInstruction (issue #1180, Advisor side)", () => {
  it("Claude Code opens with a slash command", () => {
    expect(nextStepInstruction("strategist", { tool: "claude-code", repositoryLabel: "your marketing site repository" })).toBe(
      'Open your marketing site repository in Claude Code and type "/clossys-strategist".',
    );
  });

  it("Cursor opens with an @-mention", () => {
    expect(nextStepInstruction("writer", { tool: "cursor", repositoryLabel: "the hub" })).toBe('Open the hub in Cursor and mention "@clossys-writer".');
  });

  it("an unknown tool still names the skill, without inventing a syntax", () => {
    const text = nextStepInstruction("designer", { tool: "unknown", repositoryLabel: "the hub" });
    expect(text).toContain("clossys-designer");
    expect(text).not.toContain("/clossys-designer");
    expect(text).not.toContain("@clossys-designer");
  });

  it("every host names the correct skill slug for the given role", () => {
    for (const tool of ["claude-code", "cursor", "codex", "unknown"] as const) {
      expect(nextStepInstruction("publisher", { tool, repositoryLabel: "x" })).toContain("clossys-publisher");
    }
  });
});
