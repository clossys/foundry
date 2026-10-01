// The Launcher-owned guide the apply flow writes to clossys/AGENTS.md (RFC apply-approved-plan D30). Pure: no node builtin, no
// clock, no file read. The text is one constant -- no plan text, repository name or client detail -- so every repository gets the
// same bytes, and ownership is the installed-state ledger's digest of the whole file (D10): no marker sits inside the file.

/** Where the guide is written. */
export const AGENTS_GUIDE_PATH = "clossys/AGENTS.md";

/** The skill paths the guide carves out: the composed skills and the discovery links to them. */
export const CLOSSYS_SKILL_PATTERNS: readonly string[] = [".agents/skills/clossys-*", ".claude/skills/clossys-*", ".cursor/skills/clossys-*"];

/** The guide's bytes: LF line endings and one final line feed. */
export const AGENTS_GUIDE_TEXT = `# clossys/ guide

This directory and the \`clossys-*\` skills are owned by the Launcher. The Launcher writes them from an approved plan and checks
them byte for byte.

- Do not edit, rename or duplicate anything under \`clossys/\`.
- Do not edit, rename or duplicate a \`clossys-*\` skill. They are at:
${CLOSSYS_SKILL_PATTERNS.map((pattern) => `  - \`${pattern}\``).join("\n")}
- This repository's own skill policy carves out that namespace: a rule there about editing, renaming or adding skills does not
  apply to a path that matches one of the patterns above.
- A change to any of them goes through a new approved plan, never a hand edit.
- Everything outside \`clossys/\` and those patterns stays under this repository's own rules.
`;

/** True only when the text is exactly the guide: a changed byte, a line-ending change or an added line is false. */
export function verifyAgentsGuide(text: string): boolean {
  return text === AGENTS_GUIDE_TEXT;
}
