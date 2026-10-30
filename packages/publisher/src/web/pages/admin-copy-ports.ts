import type { ChatLabels, DetailViewField } from "@clossys/designer/blocks";
import type { RuntimeContent } from "@clossys/designer/catalog";
import { assertAdminPageContent, assertAdminPageCopy, type AdminPageCopy, type AdminPageCopyRef } from "./admin-copy.js";

export const ADMIN_CHAT_LABEL_KEYS = ["logLabel", "userLabel", "assistantLabel", "actionGroupLabel", "copyMessageLabel", "regenerateLabel", "helpfulLabel", "unhelpfulLabel", "emptyLabel", "jumpLabel", "streamingLabel", "errorLabel", "retryLabel", "composerLabel", "stopLabel", "sendLabel", "copyCodeLabel", "copiedLabel", "copyUnavailableLabel"] as const satisfies readonly (keyof Required<ChatLabels>)[];
export interface PageCopyPortRefs {
  readonly itemHeading: AdminPageCopyRef;
  readonly itemActionsLabel: AdminPageCopyRef;
  readonly table: { readonly label: AdminPageCopyRef; readonly emptyTitle: AdminPageCopyRef; readonly emptyDescription: AdminPageCopyRef; readonly paginationLabel: AdminPageCopyRef; readonly summary: AdminPageCopyRef };
  readonly chat: { readonly label: AdminPageCopyRef; readonly placeholder: AdminPageCopyRef; readonly labels: Readonly<Record<typeof ADMIN_CHAT_LABEL_KEYS[number], AdminPageCopyRef>> };
}
/** Compatibility copy bindings for the admin preview. Generic page configs
 * supply their own refs and never select a bundle by a page name. */
export const ADMIN_PAGE_COPY_PORT_REFS: PageCopyPortRefs = {
  itemHeading: { id: "strings.admin.item.heading" }, itemActionsLabel: { id: "strings.admin.item.actionsLabel" },
  table: { label: { id: "strings.admin.table.label" }, emptyTitle: { id: "strings.admin.empty.title" }, emptyDescription: { id: "strings.admin.empty.description" }, paginationLabel: { id: "strings.admin.pagination.label" }, summary: { id: "strings.admin.pagination.range" } },
  chat: { label: { id: "strings.admin.chat.label" }, placeholder: { id: "strings.admin.chat.placeholder" }, labels: Object.fromEntries(ADMIN_CHAT_LABEL_KEYS.map(key => [key, { id: `strings.admin.chat.${key}` }])) as PageCopyPortRefs["chat"]["labels"] },
};
export function adminPageChatHost(copy: AdminPageCopy, bindings: PageCopyPortRefs = ADMIN_PAGE_COPY_PORT_REFS) {
  assertAdminPageCopy(copy);
  return { chatCopy: { label: copy(bindings.chat.label), placeholder: copy(bindings.chat.placeholder), labels: Object.fromEntries(ADMIN_CHAT_LABEL_KEYS.map(key => [key, copy(bindings.chat.labels[key])])) as Required<ChatLabels> } };
}
/** All six pages bind the same required native ports. Item data remains scoped
 * to its page; the shared Chat receives the same Writer-backed copy once. */
export function adminPageSectionHosts(input: { readonly copy: AdminPageCopy; readonly title: AdminPageCopyRef; readonly bindings?: PageCopyPortRefs; readonly item?: boolean; readonly includeRecordDetail?: boolean; readonly fields?: RuntimeContent }) {
  const { copy } = input; assertAdminPageCopy(copy);
  const bindings = input.bindings ?? ADMIN_PAGE_COPY_PORT_REFS;
  if (input.item && input.includeRecordDetail !== false && !input.fields) throw new TypeError("Bound item fields are required for record-detail");
  if (input.fields) assertAdminPageContent(copy, input.fields);
  const fields = input.fields?.value ?? [];
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  if (!Array.isArray(fields)) throw new TypeError("Writer-bound item fields must be native DetailView fields");
  const detailFields = fields.map((field): DetailViewField => {
    if (!object(field) || typeof field.label !== "string" || !(typeof field.value === "string" || typeof field.value === "number" || typeof field.value === "boolean" || field.value === null)
      || field.span !== undefined && field.span !== 1 && field.span !== 2) throw new TypeError("Writer-bound item fields must be native DetailView fields");
    return { label: field.label, value: field.value, ...(field.span === undefined ? {} : { span: field.span }) };
  });
  const recordDetail = { title: copy({ ...bindings.itemHeading, values: { ...bindings.itemHeading.values, name: copy(input.title) } }), fields: detailFields, actionsLabel: copy(bindings.itemActionsLabel) };
  const tableCopy = { label: copy(bindings.table.label), emptyTitle: copy(bindings.table.emptyTitle), emptyDescription: copy(bindings.table.emptyDescription), paginationLabel: copy(bindings.table.paginationLabel) };
  const { chatCopy } = adminPageChatHost(copy, bindings);
  const { format, ...messageData } = copy.message(bindings.table.summary, { start: 0, end: 0, total: 0, page: 1, pageCount: 1, pages: 1 });
  const paginationSummary = { key: "pagination.totalText" as const, ...messageData };
  const formatCopyMessage = (message: typeof paginationSummary) => {
    if (message.key !== paginationSummary.key || message.writerId !== paginationSummary.writerId || message.locale !== paginationSummary.locale || message.message !== paginationSummary.message) throw new TypeError("Writer pagination message identity differs from its bound source");
    return format(message.values);
  };
  return { ...(input.includeRecordDetail === false ? {} : { "sections.record-detail": { recordDetail } }), "sections.data-table": { tableCopy, paginationSummary, formatCopyMessage }, "sections.chat": { chatCopy } };
}
