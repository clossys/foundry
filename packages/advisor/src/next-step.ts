/**
 * Next-step phrasing (issue #1180, Advisor side): tell the client exactly
 * how to open the next repository and call the next role, in their own
 * tool. Launcher records which hosts it linked (`clossys/.state/`,
 * #1180's Launcher side); that shape has not landed yet, so this module
 * defines the small input type this function needs and nothing more.
 * When Launcher's recorded-host shape lands, the caller adapts it into
 * this type rather than this package growing a dependency on Launcher.
 *
 * Codex's real skill-discovery path has not been verified (#1180's own
 * done-when item 3, owned by Launcher); its phrasing below is a
 * best-effort placeholder pending that verification, not a proven claim.
 */
export type ClientTool = "claude-code" | "cursor" | "codex" | "unknown";

export interface NextStepHostContext {
  tool: ClientTool;
  /** How the client refers to the target repository, e.g. its name or a path/URL they can open. Never invented; the caller supplies it. */
  repositoryLabel: string;
}

/** Package directory (short role name) to its `clossys-<role>` skill slug. */
function skillSlug(role: string): string {
  return `clossys-${role}`;
}

/**
 * One plain-language instruction, correct for the given host, for
 * opening the next repository and calling the next role. `role` is a
 * package directory (short name), e.g. `"strategist"`.
 */
export function nextStepInstruction(role: string, host: NextStepHostContext): string {
  const skill = skillSlug(role);
  switch (host.tool) {
    case "claude-code":
      return `Open ${host.repositoryLabel} in Claude Code and type "/${skill}".`;
    case "cursor":
      return `Open ${host.repositoryLabel} in Cursor and mention "@${skill}".`;
    case "codex":
      return `Open ${host.repositoryLabel} in Codex and start the "${skill}" skill.`;
    default:
      return `Open ${host.repositoryLabel} and start the "${skill}" skill for your tool.`;
  }
}
