/** Explicit specimen bindings for Studio preview only; selected runtime never imports this adapter. */
import { specimenDataset } from "./specimen-dataset.js";
import { heroCopyFromDataset } from "./hero-specimen.js";
import type { ChatCopy } from "../runtime/sections/copy-ports.js";
const S = specimenDataset.sections;
export const chatCopyFixture: ChatCopy = {
  label: S.chat.label, placeholder: S.chat.placeholder,
  labels: { logLabel: "Conversation messages", userLabel: "You", assistantLabel: "Assistant", actionGroupLabel: "Message actions", copyMessageLabel: "Copy message", regenerateLabel: "Regenerate response", helpfulLabel: "Helpful response", unhelpfulLabel: "Unhelpful response", emptyLabel: "Start a conversation", jumpLabel: "Jump to latest", streamingLabel: "Assistant is responding…", errorLabel: "Response interrupted.", retryLabel: "Retry", composerLabel: "Message", stopLabel: "Stop", sendLabel: "Send", copyCodeLabel: "Copy code", copiedLabel: "Copied", copyUnavailableLabel: "Copy unavailable" },
};
export function copyPortsFor(leaf: string, state = "default") {
  if (leaf === "sections.hero") return { heroCopy: heroCopyFromDataset(specimenDataset) };
  if (!["sections.data-table", "sections.data-grid", "sections.record-detail", "sections.chat"].includes(leaf)) return undefined;
  return {
    tableCopy: { label: leaf === "sections.data-grid" ? S.dataGrid.label : S.dataTable.label, emptyTitle: S.states.tableEmpty.title, emptyDescription: S.states.tableEmpty.description, paginationLabel: S.dataTable.paginationLabel },
    recordDetail: { title: S.detailView.title, fields: state === "empty" ? [] : S.detailView.fields, actionsLabel: "Actions" },
    chatCopy: chatCopyFixture,
  };
}
