import type { StudioOpenContext } from "./open-context.js";
/** Officially documented prompt-only handoffs; these functions never launch anything. */
export const studioOpenHrefs = {
  // https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link
  claude: (context: StudioOpenContext): string => `claude://code/new?q=${encodeURIComponent(context.prompt)}&folder=${encodeURIComponent(context.projectPath)}`,
  // https://learn.chatgpt.com/docs/reference/commands
  codex: (context: StudioOpenContext): string => `codex://new?prompt=${encodeURIComponent(context.prompt)}&path=${encodeURIComponent(context.projectPath)}`,
  // https://cursor.com/docs/reference/deeplinks — no project-directory parameter documented.
  cursor: (context: StudioOpenContext): string | undefined => {
    const href = `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(context.prompt)}`;
    return href.length <= 10_000 ? href : undefined;
  },
};
