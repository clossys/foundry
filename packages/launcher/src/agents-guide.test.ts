import { describe, expect, it } from "vitest";
import { AGENTS_GUIDE_PATH, AGENTS_GUIDE_TEXT, CLOSSYS_SKILL_PATTERNS, verifyAgentsGuide } from "./agents-guide.js";

describe("constant text and verify", () => {
  it("lives at clossys/AGENTS.md and lists the three skill patterns", () => {
    expect(AGENTS_GUIDE_PATH).toBe("clossys/AGENTS.md");
    expect(CLOSSYS_SKILL_PATTERNS).toEqual([".agents/skills/clossys-*", ".claude/skills/clossys-*", ".cursor/skills/clossys-*"]);
  });

  it("names all three patterns, says what is owned and carved out, and has no marker line", () => {
    for (const pattern of [".agents/skills/clossys-*", ".claude/skills/clossys-*", ".cursor/skills/clossys-*"]) expect(AGENTS_GUIDE_TEXT, pattern).toContain(`\`${pattern}\``);
    expect(AGENTS_GUIDE_TEXT).toContain("owned by the Launcher");
    expect(AGENTS_GUIDE_TEXT).toMatch(/not edit, rename or duplicate/u);
    expect(AGENTS_GUIDE_TEXT).toMatch(/carves out that namespace/u);
    for (const line of AGENTS_GUIDE_TEXT.split("\n")) {
      expect(line, line).not.toMatch(/\b(begin|end)\b/iu);
      for (const comment of ["<!--", "--!>", "-->"]) expect(line.includes(comment), line).toBe(false);
    }
    expect(AGENTS_GUIDE_TEXT).not.toContain("\r");
    expect(AGENTS_GUIDE_TEXT.endsWith("\n")).toBe(true);
    expect(AGENTS_GUIDE_TEXT.endsWith("\n\n")).toBe(false);
  });

  it("carries no plan text, repository name or client detail", () => {
    expect(AGENTS_GUIDE_TEXT).toMatch(/^[\x20-\x7e\n]*$/u);
    expect(AGENTS_GUIDE_TEXT).not.toMatch(/https?:|@|\.json|example/iu);
  });

  it("verifies exact bytes only", () => {
    expect(verifyAgentsGuide(AGENTS_GUIDE_TEXT)).toBe(true);
    expect(verifyAgentsGuide(AGENTS_GUIDE_TEXT.replace("Do not", "Do NOT"))).toBe(false);
    expect(verifyAgentsGuide(AGENTS_GUIDE_TEXT.replaceAll("\n", "\r\n"))).toBe(false);
    expect(verifyAgentsGuide(AGENTS_GUIDE_TEXT.slice(0, -1))).toBe(false);
    expect(verifyAgentsGuide(`${AGENTS_GUIDE_TEXT}\n`)).toBe(false);
    expect(verifyAgentsGuide("")).toBe(false);
  });

  it("fails when a pattern is dropped from the text", () => {
    for (const pattern of CLOSSYS_SKILL_PATTERNS) expect(verifyAgentsGuide(AGENTS_GUIDE_TEXT.replace(`\`${pattern}\``, "")), pattern).toBe(false);
  });
});
