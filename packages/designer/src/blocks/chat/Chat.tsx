import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Avatar } from "../../selected-components/Avatar.js";
import { Button } from "../../selected-components/Button.js";
import { IconButton } from "../../selected-components/IconButton.js";
import { Textarea } from "../../selected-components/Textarea.js";
import { Tooltip } from "../../selected-components/Tooltip.js";
import { ArrowRight } from "../../icons/ArrowRight.js";
import { ChevronUp } from "../../icons/ChevronUp.js";
import { ChevronDown } from "../../icons/ChevronDown.js";
import { FileText } from "../../icons/FileText.js";
import type { IconNode } from "../../icons/types.js";
import { defaultContent } from "./content.js";
import type { ChatActions, ChatLabels, ChatMessage, ChatProps } from "./types.js";
import { dsAttrs } from "../../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.chat", "foundry/sections.chat");

const PROGRESS_ROW_CLASSES = "flex flex-wrap items-center gap-sm text-body-s text-ink-secondary";

function MessageAction({ label, icon, onPress }: { label: string; icon: IconNode; onPress: () => void }) {
  return <Tooltip trigger={<IconButton label={label} icon={icon} size="sm" onPress={onPress} />}>{label}</Tooltip>;
}

interface MessageActionsProps extends ChatLabels { message: ChatMessage; actions: ChatActions }

function MessageActions({
  message, actions,
  /** @default "Message actions" */
  actionGroupLabel = "Message actions",
  /** @default "Copy message" */
  copyMessageLabel = "Copy message",
  /** @default "Regenerate response" */
  regenerateLabel = "Regenerate response",
  /** @default "Helpful response" */
  helpfulLabel = "Helpful response",
  /** @default "Unhelpful response" */
  unhelpfulLabel = "Unhelpful response",
}: MessageActionsProps) {
  return (
    <div className="flex flex-wrap gap-xs" role="group" aria-label={actionGroupLabel}>
      {actions.onCopy ? <MessageAction label={copyMessageLabel} icon={FileText} onPress={() => actions.onCopy?.(message)} /> : null}
      {message.role === "assistant" ? <>
        {actions.onRegenerate ? <MessageAction label={regenerateLabel} icon={ArrowRight} onPress={() => actions.onRegenerate?.(message)} /> : null}
        {actions.onFeedback ? <>
          <MessageAction label={helpfulLabel} icon={ChevronUp} onPress={() => actions.onFeedback?.(message, "up")} />
          <MessageAction label={unhelpfulLabel} icon={ChevronDown} onPress={() => actions.onFeedback?.(message, "down")} />
        </> : null}
      </> : null}
    </div>
  );
}

function AuthorGroup({ label, children }: { label: string; children: ReactNode }) {
  return <div role="group" aria-label={label} className="flex min-w-0 items-start gap-sm">
    <Avatar alt={label} size="sm" />
    <div className="flex min-w-0 flex-1 flex-col gap-sm">
      <p className="text-body-s font-semibold">{label}</p>
      {children}
    </div>
  </div>;
}

/** A controlled thread and composer. The host supplies and updates every message. */
export function Chat(props: ChatProps) {
  return <ChatView {...props} {...props.labels} />;
}

interface ChatViewProps extends ChatProps, ChatLabels {}

function ChatView({
  messages, status, onSend, onStop, onRetry, onSuggest, suggestions = [], renderContent, actions, labels,
  /** @default "Write a message…" */
  placeholder = "Write a message…",
  /** @default "Conversation" */
  label = "Conversation",
  /** @default "Conversation messages" */
  logLabel = "Conversation messages",
  /** @default "You" */
  userLabel = "You",
  /** @default "Assistant" */
  assistantLabel = "Assistant",
  /** @default "Start a conversation" */
  emptyLabel = "Start a conversation",
  /** @default "Jump to latest" */
  jumpLabel = "Jump to latest",
  /** @default "Assistant is responding…" */
  streamingLabel = "Assistant is responding…",
  /** @default "Response interrupted." */
  errorLabel = "Response interrupted.",
  /** @default "Retry" */
  retryLabel = "Retry",
  /** @default "Message" */
  composerLabel = "Message",
  /** @default "Stop" */
  stopLabel = "Stop",
  /** @default "Send" */
  sendLabel = "Send",
}: ChatViewProps) {
  const [draft, setDraft] = useState("");
  const [readingEarlier, setReadingEarlier] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const streaming = status === "streaming";
  const canSend = Boolean(draft.trim()) && !streaming;
  const groups: ChatMessage[][] = [];
  for (const message of messages) {
    const last = groups[groups.length - 1];
    if (last?.[0]?.role === message.role) last.push(message);
    else groups.push([message]);
  }

  useLayoutEffect(() => {
    const log = logRef.current;
    if (log && stickToBottom.current) log.scrollTop = log.scrollHeight;
  });

  useLayoutEffect(() => {
    const input = composerRef.current?.querySelector("textarea");
    if (input) {
      input.style.height = "auto";
      input.style.height = `${input.scrollHeight}px`;
    }
  }, [draft]);

  function focusComposer() { composerRef.current?.querySelector("textarea")?.focus(); }
  function send() {
    if (!canSend) return;
    onSend(draft.trim());
    setDraft("");
    stickToBottom.current = true;
    setReadingEarlier(false);
    focusComposer();
  }
  function keyDown(event: KeyboardEvent) {
    if (event.key === "Escape" && streaming && onStop) {
      event.preventDefault();
      event.stopPropagation();
      onStop();
    } else if (event.target === composerRef.current?.querySelector("textarea") && event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
      event.preventDefault();
      send();
    }
  }

  return (
    <section {...SECTION_STAMP} aria-label={label} className="flex h-full min-h-0 min-w-0 w-full flex-col bg-surface-base text-body text-ink-primary" onKeyDown={keyDown}>
      <div ref={logRef} role="log" aria-label={logLabel} aria-live="polite" className="flex min-h-0 min-w-0 flex-1 flex-col gap-lg overflow-y-auto break-words p-md" onScroll={() => {
        const log = logRef.current;
        if (!log) return;
        stickToBottom.current = Math.ceil(log.scrollTop + log.clientHeight) >= log.scrollHeight;
        setReadingEarlier(!stickToBottom.current);
      }}>
        {messages.length === 0 ? <div className="flex flex-col gap-sm">
          <p className="text-ink-secondary">{emptyLabel}</p>
          {suggestions.length ? <div className="flex flex-wrap gap-sm">
            {suggestions.map((suggestion, index) => <Button key={index} size="sm" variant="secondary" className="max-w-full whitespace-normal rounded-pill" isDisabled={!onSuggest || streaming} onPress={() => onSuggest?.(suggestion)}>{suggestion}</Button>)}
          </div> : null}
        </div> : null}
        {groups.map(group => {
          const content = group.map(message => <div key={message.id} className="flex min-w-0 flex-col gap-xs">
            {renderContent ? renderContent(message, defaultContent(message.content, labels)) : defaultContent(message.content, labels)}
            {message.timestamp ? <time className="text-caption text-ink-secondary">{message.timestamp}</time> : null}
            {actions ? <MessageActions message={message} actions={actions} {...labels} /> : null}
          </div>);
          return group[0]!.role === "user"
            ? <AuthorGroup key={group[0]!.id} label={userLabel}>{content}</AuthorGroup>
            : <AuthorGroup key={group[0]!.id} label={assistantLabel}>{content}</AuthorGroup>;
        })}
      </div>
      <div className="flex shrink-0 flex-col gap-sm border-t border-line-base p-md">
        {readingEarlier ? <Button variant="secondary" size="sm" onPress={() => {
          stickToBottom.current = true;
          setReadingEarlier(false);
          if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
          focusComposer();
        }}>{jumpLabel}</Button> : null}
        <div role="status" aria-live="polite" className={PROGRESS_ROW_CLASSES} style={{ minHeight: "var(--ui-density-row, var(--spacing-3xl, 48px))" }}>
          {streaming ? <span>{streamingLabel}</span> : status === "error" ? <>
            <span>{errorLabel}</span>
            {onRetry ? <Button size="sm" variant="secondary" onPress={onRetry}>{retryLabel}</Button> : null}
          </> : null}
        </div>
        <div ref={composerRef} className="min-w-0">
          <Textarea label={composerLabel} value={draft} onChange={setDraft} rows={1} placeholder={placeholder} textareaClassName="min-w-0 w-full resize-none overflow-y-auto max-h-6xl" />
        </div>
        <div className="flex flex-wrap justify-end gap-sm">
          {streaming && onStop ? <Button variant="secondary" onPress={onStop}>{stopLabel}</Button> : null}
          <Button isDisabled={!canSend} onPress={send}>{sendLabel}</Button>
        </div>
      </div>
    </section>
  );
}
