import type { ReactNode } from "react";
import type { RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import type { DetailViewField } from "../../blocks/DetailView.js";
import type { ChatLabels } from "../../blocks/chat/types.js";

type Input = RuntimeRenderInput<ReactNode>;
export interface TableCopy { readonly label: string; readonly emptyTitle: string; readonly emptyDescription: string; readonly paginationLabel: string }
export interface RecordDetailCopy { readonly title: string; readonly fields: readonly DetailViewField[]; readonly actionsLabel: string }
export interface ChatCopy { readonly label: string; readonly placeholder: string; readonly labels: Required<ChatLabels> }
export const CHAT_LABEL_KEYS = ["logLabel", "userLabel", "assistantLabel", "actionGroupLabel", "copyMessageLabel", "regenerateLabel", "helpfulLabel", "unhelpfulLabel", "emptyLabel", "jumpLabel", "streamingLabel", "errorLabel", "retryLabel", "composerLabel", "stopLabel", "sendLabel", "copyCodeLabel", "copiedLabel", "copyUnavailableLabel"] as const satisfies readonly (keyof ChatLabels)[];

function object(input: Input, key: string): Record<string, unknown> {
  const value = input.sectionHost?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${input.fill.leaf}: ${key} host port is required`);
  return value as Record<string, unknown>;
}
function text(value: unknown, key: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${key}: resolved nonempty copy is required`);
  return value;
}
export function tableCopyOf(input: Input): TableCopy {
  const value = object(input, "tableCopy");
  return Object.fromEntries(["label", "emptyTitle", "emptyDescription", "paginationLabel"].map(key => [key, text(value[key], `tableCopy.${key}`)])) as unknown as TableCopy;
}
export function recordDetailCopyOf(input: Input): RecordDetailCopy {
  const value = object(input, "recordDetail");
  if (!Array.isArray(value.fields) || value.fields.some(field => !field || typeof field !== "object" || typeof field.label !== "string" || !field.label.trim() || !("value" in field))) throw new TypeError("recordDetail.fields: bound item fields are required");
  return { title: text(value.title, "recordDetail.title"), fields: value.fields as DetailViewField[], actionsLabel: text(value.actionsLabel, "recordDetail.actionsLabel") };
}
export function chatCopyOf(input: Input): ChatCopy {
  const value = object(input, "chatCopy"), labels = value.labels;
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) throw new TypeError("chatCopy.labels: complete resolved labels are required");
  const copy = Object.fromEntries(CHAT_LABEL_KEYS.map(key => [key, text((labels as Record<string, unknown>)[key], `chatCopy.labels.${key}`)])) as unknown as Required<ChatLabels>;
  return { label: text(value.label, "chatCopy.label"), placeholder: text(value.placeholder, "chatCopy.placeholder"), labels: copy };
}
