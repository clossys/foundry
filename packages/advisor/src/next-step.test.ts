import { describe, expect, it } from "vitest";
import { nextStepInstruction } from "./index.js";

describe("nextStepInstruction (issue #1180, Advisor side)", () => {
  it("Claude Code opens with a slash command and the loop keyword (#1194)", () => {
    expect(nextStepInstruction("strategist", { tool: "claude-code", repositoryLabel: "your marketing site repository" })).toBe(
      'Open your marketing site repository in Claude Code and type "/clossys-strategist loop".',
    );
  });

  it("Cursor opens with an @-mention and the loop keyword (#1194)", () => {
    expect(nextStepInstruction("writer", { tool: "cursor", repositoryLabel: "the hub" })).toBe(
      'Open the hub in Cursor and mention "@clossys-writer loop".',
    );
  });

  it("Codex and an unknown tool still carry the loop keyword, without inventing a syntax", () => {
    for (const tool of ["codex", "unknown"] as const) {
      const text = nextStepInstruction("designer", { tool, repositoryLabel: "the hub" });
      expect(text).toContain("clossys-designer");
      expect(text).toContain("loop");
      expect(text).not.toContain("/clossys-designer");
      expect(text).not.toContain("@clossys-designer");
    }
  });

  it("every host names the correct skill slug and the loop keyword for the given role", () => {
    for (const tool of ["claude-code", "cursor", "codex", "unknown"] as const) {
      const text = nextStepInstruction("publisher", { tool, repositoryLabel: "x" });
      expect(text).toContain("clossys-publisher");
      expect(text).toContain("loop");
    }
  });

  it("never ships the bare loop skill name (#1194: 'Never ship a skill named bare loop')", () => {
    for (const tool of ["claude-code", "cursor", "codex", "unknown"] as const) {
      const text = nextStepInstruction("strategist", { tool, repositoryLabel: "x" });
      expect(text).not.toMatch(/[/@]loop\b/);
    }
  });
});
