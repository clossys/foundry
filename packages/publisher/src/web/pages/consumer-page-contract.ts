import type { SectionFill } from "../../core/instance-binding.js";
import { isRegisteredContentRef } from "../../core/instance-binding.js";
import type { AdminPageCopyRef } from "./admin-copy.js";
import type { PageCopyPortRefs } from "./admin-copy-ports.js";
import { ADMIN_CHAT_LABEL_KEYS } from "./admin-copy-ports.js";

export type ConsumerPageSectionStyle = Pick<SectionFill, "section" | "config" | "members" | "span">;
export interface ConsumerPageColumn { readonly key: string; readonly kind: "text" | "badge" | "status" | "date" | "preview" | "list"; readonly label: AdminPageCopyRef }
export interface ConsumerPageConfig {
  readonly version: 1;
  readonly id: string;
  /** Entry ids are references. Path, title and plan ownership remain in the map. */
  readonly entryId: string;
  readonly namespace: string;
  readonly title: AdminPageCopyRef;
  /** Explicit native module, or no module. Omission is unbound-preview compatibility only. */
  readonly pageModule?: SectionFill | null;
  readonly levels: {
    readonly l0: { readonly verb: "normalize"; readonly header: ConsumerPageSectionStyle; readonly empty?: ConsumerPageSectionStyle };
    readonly l1: { readonly verb: "unlock"; readonly band: ConsumerPageSectionStyle; readonly header: ConsumerPageSectionStyle; readonly key: string };
    readonly l2: { readonly verb: "cohere"; readonly table: ConsumerPageSectionStyle; readonly key: string };
    readonly l3: { readonly verb: "create"; readonly key: "id" };
  };
  readonly columns: readonly ConsumerPageColumn[];
  readonly copy: PageCopyPortRefs & { readonly outline: AdminPageCopyRef; readonly count: AdminPageCopyRef };
  readonly item?: { readonly entryId: string; readonly sections: readonly { readonly id: string; readonly label: AdminPageCopyRef; readonly estimate: number; readonly fill: SectionFill }[] };
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim() === value && value.length > 0;
const fields = (value: object, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
function plain(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  if (![Object.prototype, null, ...(Array.isArray(value) ? [Array.prototype] : [])].includes(Object.getPrototypeOf(value))) return false;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !descriptor.enumerable || !("value" in descriptor) || !plain(descriptor.value, seen)) return false;
  }
  seen.delete(value); return !Array.isArray(value) || Object.keys(value).length === value.length;
}
function copyRef(value: unknown): value is AdminPageCopyRef {
  return object(value) && fields(value, ["id", "locale", "values"]) && text(value.id) && (value.locale === undefined || text(value.locale))
    && (value.values === undefined || object(value.values) && Object.values(value.values).every(item => typeof item === "string" || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)));
}
const style = (value: unknown): boolean => object(value) && fields(value, ["section", "config", "members", "span"]) && text(value.section) && value.section.startsWith("sections.")
  && (value.config === undefined || text(value.config)) && (value.span === undefined || text(value.span)) && (value.members === undefined || object(value.members) && Object.values(value.members).every(text));
function fill(value: unknown, depth = 0): boolean {
  return depth <= 8 && object(value) && fields(value, ["section", "config", "members", "span", "content", "repeat", "children"])
    && style(Object.fromEntries(Object.entries(value).filter(([key]) => ["section", "config", "members", "span"].includes(key))))
    && object(value.content) && Object.values(value.content).every(isRegisteredContentRef)
    && (value.repeat === undefined || object(value.repeat) && fields(value.repeat, ["over", "key"]) && isRegisteredContentRef(value.repeat.over) && value.repeat.over.kind === "records" && text(value.repeat.key))
    && (value.children === undefined || Array.isArray(value.children) && value.children.length > 0 && value.children.every(child => fill(child, depth + 1)));
}
/** Page composition is plain consumer data. Native library validation still
 * decides whether its selected leaves/configs/members and slots can execute. */
export function checkConsumerPageConfig(value: unknown): readonly string[] {
  if (!plain(value) || !object(value) || !fields(value, ["version", "id", "entryId", "namespace", "title", "pageModule", "levels", "columns", "copy", "item"]) || value.version !== 1
    || ![value.id, value.entryId, value.namespace].every(text) || !copyRef(value.title)) return ["A versioned consumer page config with Writer title reference is required"];
  const errors: string[] = [], levels = value.levels;
  if (value.pageModule !== undefined && value.pageModule !== null && !fill(value.pageModule)) errors.push("Page module requires a native SectionFill or explicit null");
  if (!object(levels) || !fields(levels, ["l0", "l1", "l2", "l3"])) errors.push("Four page levels are required");
  else {
    const { l0, l1, l2, l3 } = levels;
    if (!object(l0) || !fields(l0, ["verb", "header", "empty"]) || l0.verb !== "normalize" || !style(l0.header) || l0.empty !== undefined && !style(l0.empty)) errors.push("L0 normalize requires a selected header");
    if (!object(l1) || !fields(l1, ["verb", "band", "header", "key"]) || l1.verb !== "unlock" || !style(l1.band) || !style(l1.header) || !text(l1.key)) errors.push("L1 unlock requires selected band/header and a stable key");
    if (!object(l2) || !fields(l2, ["verb", "table", "key"]) || l2.verb !== "cohere" || !style(l2.table) || !text(l2.key)) errors.push("L2 cohere requires a selected table and stable key");
    if (!object(l3) || !fields(l3, ["verb", "key"]) || l3.verb !== "create" || l3.key !== "id") errors.push("L3 create requires the native row id");
  }
  if (!Array.isArray(value.columns) || !value.columns.length || value.columns.some(column => !object(column) || !fields(column, ["key", "kind", "label"]) || !text(column.key) || !["text", "badge", "status", "date", "preview", "list"].includes(column.kind as string) || !copyRef(column.label))
    || new Set(value.columns.map(column => column.key)).size !== value.columns.length) errors.push("Unique columns require Writer labels and native cell kinds");
  const copy = value.copy;
  if (!object(copy) || !fields(copy, ["outline", "count", "itemHeading", "itemActionsLabel", "table", "chat"]) || ![copy.outline, copy.count, copy.itemHeading, copy.itemActionsLabel].every(copyRef)
    || !object(copy.table) || !fields(copy.table, ["label", "emptyTitle", "emptyDescription", "paginationLabel", "summary"]) || ![copy.table.label, copy.table.emptyTitle, copy.table.emptyDescription, copy.table.paginationLabel, copy.table.summary].every(copyRef)
    || !object(copy.chat) || !fields(copy.chat, ["label", "placeholder", "labels"]) || !copyRef(copy.chat.label) || !copyRef(copy.chat.placeholder) || !object(copy.chat.labels) || !fields(copy.chat.labels, ADMIN_CHAT_LABEL_KEYS) || ADMIN_CHAT_LABEL_KEYS.some(key => !copyRef((copy.chat as { labels: Record<string, unknown> }).labels[key]))) errors.push("Copy ports require explicit Writer references");
  if (value.item !== undefined && (!object(value.item) || !fields(value.item, ["entryId", "sections"]) || !text(value.item.entryId) || value.item.entryId === value.entryId || !Array.isArray(value.item.sections) || !value.item.sections.length
    || value.item.sections.some(section => !object(section) || !fields(section, ["id", "label", "estimate", "fill"]) || !text(section.id) || !copyRef(section.label) || typeof section.estimate !== "number" || section.estimate < 0 || !fill(section.fill))
    || new Set(value.item.sections.map(section => section.id)).size !== value.item.sections.length)) errors.push("Item sections require distinct ids, Writer labels and native fills");
  return errors;
}
