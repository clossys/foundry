import type { StudioShellCopy } from '../frames/studio-shell';
import { studioCopy } from './studio-copy';
import { studioGroups } from './studio-route-map';

/** The agents the chat names, from the content-map groups: "A, B and C". */
function agentList(): string {
  const names = studioGroups().map(group => group.label);
  if (names.length < 2) return names.join('');
  return studioCopy('studio.agent-list', { head: names.slice(0, -1).join(', '), last: names.at(-1)! });
}

/** Every word `frames.studio-shell` shows, resolved from the pinned Writer strings. */
export function studioShellCopy(): StudioShellCopy {
  const chat = studioCopy('studio.chat');
  return {
    copied: studioCopy('studio.copied'),
    copyPrompt: studioCopy('studio.copy-prompt'),
    search: {
      title: studioCopy('studio.find-a-page'),
      description: studioCopy('studio.search-studio-pages-and-commands'),
      placeholder: studioCopy('studio.search-pages-and-commands'),
      label: studioCopy('studio.pages'),
      empty: studioCopy('studio.no-matching-pages'),
      page: studioCopy('studio.this-page'),
    },
    resizeChat: studioCopy('studio.resize-chat'),
    toggleSidebar: studioCopy('studio.toggle-sidebar'),
    toggleTheme: studioCopy('studio.toggle-theme'),
    toggleChat: studioCopy('studio.toggle-chat'),
    chat: {
      title: chat,
      emptyTitle: studioCopy('studio.no-conversation-yet'),
      emptyDescription: studioCopy('studio.chat-empty-description', { agents: agentList() }),
      sheets: {
        left: { title: studioCopy('studio.sidebar'), description: studioCopy('studio.sidebar-sheet-description') },
        chat: { title: chat, description: studioCopy('studio.chat-sheet-description') },
      },
    },
    sidebar: {
      team: studioCopy('studio.workspace-name'),
      plan: studioCopy('studio.studio'),
      localPlan: studioCopy('studio.local-workspace'),
      user: { name: studioCopy('studio.local-workspace'), email: studioCopy('studio.producer-on-this-machine'), initials: studioCopy('studio.local-workspace-initials') },
    },
  };
}
