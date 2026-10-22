import type { ReactNode } from "react";

export interface ChatMessage {
  /** Stable across streamed updates. */
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  /** Optional display text; formatting belongs to the host. */
  readonly timestamp?: string;
}

export interface ChatActions {
  /** Supplying a callback shows its corresponding action. The host owns copying. */
  readonly onCopy?: (message: ChatMessage) => void;
  readonly onRegenerate?: (message: ChatMessage) => void;
  readonly onFeedback?: (message: ChatMessage, feedback: "up" | "down") => void;
}

export interface ChatLabels {
  /** @default "Conversation messages" */
  logLabel?: string;
  /** @default "You" */
  userLabel?: string;
  /** @default "Assistant" */
  assistantLabel?: string;
  /** @default "Message actions" */
  actionGroupLabel?: string;
  /** @default "Copy message" */
  copyMessageLabel?: string;
  /** @default "Regenerate response" */
  regenerateLabel?: string;
  /** @default "Helpful response" */
  helpfulLabel?: string;
  /** @default "Unhelpful response" */
  unhelpfulLabel?: string;
  /** @default "Start a conversation" */
  emptyLabel?: string;
  /** @default "Jump to latest" */
  jumpLabel?: string;
  /** @default "Assistant is responding…" */
  streamingLabel?: string;
  /** @default "Response interrupted." */
  errorLabel?: string;
  /** @default "Retry" */
  retryLabel?: string;
  /** @default "Message" */
  composerLabel?: string;
  /** @default "Stop" */
  stopLabel?: string;
  /** @default "Send" */
  sendLabel?: string;
  /** @default "Copy code" */
  copyCodeLabel?: string;
  /** @default "Copied" */
  copiedLabel?: string;
  /** @default "Copy unavailable" */
  copyUnavailableLabel?: string;
}

export interface ChatProps {
  readonly messages: readonly ChatMessage[];
  readonly status: "idle" | "streaming" | "error";
  readonly onSend: (text: string) => void;
  readonly onStop?: () => void;
  readonly onRetry?: () => void;
  readonly onSuggest?: (suggestion: string) => void;
  readonly suggestions?: readonly string[];
  /** Trusted React content. The second argument is the safe default rendering. */
  readonly renderContent?: (message: ChatMessage, defaultContent: ReactNode) => ReactNode;
  readonly actions?: ChatActions;
  /** @default "Write a message…" */
  readonly placeholder?: string;
  /** Accessible region name. @default "Conversation" */
  readonly label?: string;
  /** Host copy overrides; omitted entries use the documented English defaults. */
  readonly labels?: ChatLabels;
}
