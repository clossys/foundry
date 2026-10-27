import { Chat } from "../../blocks/chat/Chat.js";
import type { ComponentProps } from "react";
import { anatomyOf, noop, recordsOf, refuseUnmapped, requireSlot, stringField, type SectionInputs, type SectionRenderer } from "./group-c-content.js";

const LEAF = "sections.chat";
type ChatMessage = ComponentProps<typeof Chat>["messages"][number];
const ROLES: readonly ChatMessage["role"][] = ["user", "assistant"];

/**
 * parts -> Chat.messages (message parts only); composer -> the built-in composer's label and placeholder.
 * part.message, part.bubble and part.scroller are the block's own message, bubble and scrolling log.
 */
export const chatInputs: SectionInputs = {
  slots: ["parts", "composer"],
  members: ["part.message", "part.bubble", "part.scroller"],
  unmapped: { members: ["part.attachment", "part.trace", "part.questionnaire"] },
};

export const renderChat: SectionRenderer = input => {
  refuseUnmapped(input, chatInputs);
  const messages = recordsOf(LEAF, "parts", requireSlot(input, LEAF, "parts")).map((row, index): ChatMessage => {
    const kind = stringField(row, "kind") ?? "message";
    if (kind !== "message") throw new TypeError(`${LEAF}: part ${index} is a ${kind} part; Chat renders message parts only (NEED)`);
    const id = stringField(row, "id"), role = stringField(row, "role"), content = stringField(row, "content"), timestamp = stringField(row, "timestamp");
    if (!id || content === undefined || !role || !(ROLES as readonly string[]).includes(role)) throw new TypeError(`${LEAF}: part ${index} needs an id, a user or assistant role and content`);
    return { id, role: role as ChatMessage["role"], content, ...(timestamp ? { timestamp } : {}) };
  });
  const composer = requireSlot(input, LEAF, "composer");
  const composerLabel = stringField(composer, "label"), placeholder = stringField(composer, "placeholder");
  const { label } = anatomyOf(input);
  const status = input.cell.state === "error" ? "error" : input.cell.state === "loading" ? "streaming" : "idle";
  return (
    <Chat
      messages={messages}
      status={status}
      onSend={noop}
      label={label}
      placeholder={placeholder}
      labels={composerLabel ? { composerLabel } : undefined}
    />
  );
};
