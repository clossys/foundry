# Chat

`Chat` from `@clossys/designer/blocks` presents a conversation in a bounded panel. Import the Designer styles and give its parent a height. The block fills that height, wraps at narrow widths, and reads the current theme's surface and ink tokens.

The host supplies `messages` and `status` (`idle`, `streaming`, or `error`). A message has a stable `id`, a `role` (`user` or `assistant`), string `content`, and optional display `timestamp`. Consecutive messages with the same role share an author group. The component holds only the unsent draft and reading position; it does not append messages itself.

`onSend(text)` receives trimmed, nonempty text. The host should update `status` to `streaming` when accepting a send. Enter sends; Shift+Enter adds a newline; composition Enter keeps the draft. The Textarea grows to the existing `spacing-6xl` token and then scrolls internally. Send is disabled for whitespace and during streaming. `onStop` enables Stop and Escape during streaming; cancellation and the following status update belong to the host. `onRetry` enables the inline error recovery action. A reserved progress row keeps idle and streaming content in the same place.

`suggestions` supplies strings for the empty state; `onSuggest(suggestion)` receives the selected text without sending it. Missing `onSuggest` leaves suggestions disabled. `label` names the conversation region (default `Conversation`); `placeholder` defaults to `Write a message…`. The composer has a visible `Message` label. Optional `labels: ChatLabels` overrides the log name, author labels, empty and progress text, action labels, composer label and clipboard announcements; each field documents its English default. The log defaults to `Conversation messages` and can be named separately with `labels.logLabel`.

`actions` optionally supplies `onCopy(message)`, `onRegenerate(message)`, and `onFeedback(message, "up" | "down")`. Each callback enables its named icon button and tooltip. Copy appears on both roles; regeneration and feedback appear on assistant messages. The host owns these actions and any result feedback. There are no message actions by default.

The default content renderer accepts paragraphs, consecutive flat unordered or ordered lists, backtick inline code, fenced code blocks and explicit links. HTML remains escaped text. Links accept `http:`, `https:`, `mailto:`, root-relative paths and fragment destinations, and carry `rel="noopener noreferrer"`; unsupported destinations remain text. Links stay in the current tab. Code blocks scroll horizontally and offer Copy code, with a local success or failure announcement. Clipboard permission failures show `Copy unavailable`.

`renderContent(message, defaultContent)` can return trusted React content or wrap the safe default rendering. The caller owns the safety and accessibility of custom content. The slot is called for both roles; no HTML-string injection API is provided.

New content follows the bottom until the reader scrolls up. Jump to latest resumes following and returns focus to the composer. Incoming messages do not move keyboard focus. When the same message is updated incrementally, keep its `id` stable.

```tsx
import { useRef, useState } from "react";
import { Chat, type ChatMessage, type ChatProps } from "@clossys/designer/blocks";

async function* fakeSource() {
  for (const part of ["Here is ", "a short ", "example."]) {
    await new Promise(resolve => setTimeout(resolve, 200));
    yield part;
  }
}

export function ConversationPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatProps["status"]>("idle");
  const generation = useRef(0);
  const sequence = useRef(0);
  const lastPrompt = useRef("");

  async function respond(text: string, retry = false) {
    lastPrompt.current = text;
    const run = ++generation.current;
    const id = `answer-${++sequence.current}`;
    setMessages(previous => [
      ...previous,
      ...(retry ? [] : [{ id: `question-${sequence.current}`, role: "user" as const, content: text }]),
      { id, role: "assistant", content: "" },
    ]);
    setStatus("streaming");
    try {
      for await (const part of fakeSource()) {
        if (run !== generation.current) return;
        setMessages(previous => previous.map(message => message.id === id
          ? { ...message, content: message.content + part } : message));
      }
      if (run === generation.current) setStatus("idle");
    } catch {
      if (run === generation.current) setStatus("error");
    }
  }

  return <Chat
    messages={messages}
    status={status}
    onSend={text => { void respond(text); }}
    onStop={() => { generation.current++; setStatus("idle"); }}
    onRetry={() => { void respond(lastPrompt.current, true); }}
    suggestions={["Help me start"]}
    onSuggest={text => { void respond(text); }}
  />;
}
```

The fake source yields local text on a timer. The generation counter discards stale chunks after Stop or a replacement run. A production host also cleans up its source when its panel unmounts.

The block composes Avatar, Textarea, Button, IconButton (which composes Icon), Tooltip and Link. Its plain semantic elements provide the conversation region, log, author/message layout, optional timestamp, progress row and safe text structure. Suggestion pills use Button because the Chip component's action removes a label rather than selecting a suggestion.
