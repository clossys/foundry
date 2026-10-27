import type { RuntimeJson } from "../../catalog-core/runtime-ports.js";
import type { SpecimenDataset } from "../../studio/specimen-dataset.js";
import { cardsInputs, renderCards } from "./cards.js";
import { chatInputs, renderChat } from "./chat.js";
import { consentInputs, renderConsent } from "./consent.js";
import { emptyStateInputs, renderEmptyState } from "./empty-state.js";
import { errorStateInputs, renderErrorState } from "./error-state.js";
import { formInputs, renderForm } from "./form.js";
import { ANATOMY_CONTENT_KEY, type RuntimeObject, type SectionInputs, type SectionRenderer } from "./group-c-content.js";
import { linkIndexInputs, renderLinkIndex } from "./link-index.js";
import { noticesInputs, renderNotices } from "./notices.js";
import { pageHeaderInputs, renderPageHeader } from "./page-header.js";
import { paginationInputs, renderPagination } from "./pagination.js";
import { renderSectionHeader, sectionHeaderInputs } from "./section-header.js";
import { renderSettings, settingsInputs } from "./settings.js";
import { renderSteps, stepsInputs } from "./steps.js";
import { renderTableOfContents, tableOfContentsInputs } from "./table-of-contents.js";
import { renderWizard, wizardInputs } from "./wizard.js";

/** The fifteen group-c Section leaves, by their name under `sections.`. */
export const GROUP_C_LEAVES = [
  "cards", "chat", "consent", "empty-state", "error-state", "form", "link-index", "notices",
  "page-header", "pagination", "section-header", "settings", "steps", "table-of-contents", "wizard",
] as const;
export type GroupCLeaf = (typeof GROUP_C_LEAVES)[number];

/** Leaf -> package-owned runtime renderer. Each renders its registered Foundry block from `RuntimeRenderInput`. */
export const sectionRenderersC: Readonly<Record<`sections.${GroupCLeaf}`, SectionRenderer>> = {
  "sections.cards": renderCards,
  "sections.chat": renderChat,
  "sections.consent": renderConsent,
  "sections.empty-state": renderEmptyState,
  "sections.error-state": renderErrorState,
  "sections.form": renderForm,
  "sections.link-index": renderLinkIndex,
  "sections.notices": renderNotices,
  "sections.page-header": renderPageHeader,
  "sections.pagination": renderPagination,
  "sections.section-header": renderSectionHeader,
  "sections.settings": renderSettings,
  "sections.steps": renderSteps,
  "sections.table-of-contents": renderTableOfContents,
  "sections.wizard": renderWizard,
};

/** Leaf -> the contract slots and members its renderer maps, and those it refuses for want of an API. */
export const sectionInputsC: Readonly<Record<GroupCLeaf, SectionInputs>> = {
  cards: cardsInputs,
  chat: chatInputs,
  consent: consentInputs,
  "empty-state": emptyStateInputs,
  "error-state": errorStateInputs,
  form: formInputs,
  "link-index": linkIndexInputs,
  notices: noticesInputs,
  "page-header": pageHeaderInputs,
  pagination: paginationInputs,
  "section-header": sectionHeaderInputs,
  settings: settingsInputs,
  steps: stepsInputs,
  "table-of-contents": tableOfContentsInputs,
  wizard: wizardInputs,
};

type Content = Readonly<Record<string, RuntimeJson>>;
const PAGE_SIZE = 3;
const plain = (value: unknown): string => typeof value === "string" ? value : "";
/** Types a row list as JSON records, so literal rows with differing optional fields stay RuntimeJson. */
const rows = (list: readonly RuntimeObject[]): readonly RuntimeObject[] => list;

/**
 * Leaf -> its content, keyed by contract slot, bound to the shared synthetic dataset. Every string is a dataset
 * record; `header` carries the anatomy copy no contract slot holds yet (see group-c-content `ANATOMY_CONTENT_KEY`).
 */
export const sectionDatasetC: Readonly<Record<GroupCLeaf, (dataset: SpecimenDataset) => Content>> = {
  cards: d => ({
    records: d.table.rows.slice(0, PAGE_SIZE).map(row => ({ id: row.id, title: row.order, description: row.customer, href: `#${row.id}`, meta: row.total })),
  }),
  chat: d => ({
    parts: [{ id: "ask", role: "user", content: d.dialog.trigger }, { id: "answer", role: "assistant", content: d.dialog.body }],
    composer: { label: d.searchField.label, placeholder: d.searchField.placeholder },
  }),
  consent: d => ({
    copy: { title: d.toasts.info.title, body: d.toasts.info.description },
    actions: [{ id: d.dialog.actions[1].id, label: d.dialog.actions[1].label }, { id: d.dialog.actions[0].id, label: d.dialog.actions[0].label }],
    policy: { label: d.text.link, href: d.text.linkHref },
  }),
  "empty-state": d => ({
    [ANATOMY_CONTENT_KEY]: { heading: d.list.label, description: d.text.paragraph },
    illustration: { icon: "FileText", label: d.icon.label },
    actions: [{ label: d.text.upload }],
  }),
  "error-state": d => ({
    [ANATOMY_CONTENT_KEY]: { heading: d.toasts.danger.title, description: d.toasts.danger.description },
    code: d.table.rows[0]!.order,
    retry: { label: d.text.submit },
    report: { label: d.text.link, href: d.text.linkHref },
  }),
  form: d => ({
    [ANATOMY_CONTENT_KEY]: { heading: d.dialog.title },
    fields: rows([
      { id: "name", kind: "text", label: d.textField.label, placeholder: d.textField.placeholder, description: d.textField.description },
      { id: "status", kind: "select", label: d.select.label, placeholder: d.select.placeholder, options: d.select.options.map(option => ({ id: option.id, label: plain(option.label) })) },
      { id: "updates", kind: "checkbox", label: d.text.checkbox },
    ]),
    submit: { label: d.text.submit },
  }),
  "link-index": d => ({
    [ANATOMY_CONTENT_KEY]: { heading: d.navigation.label },
    links: d.navigation.items.map(item => ({ id: item.id, title: item.label, href: item.href })),
  }),
  notices: d => ({
    [ANATOMY_CONTENT_KEY]: { label: d.toaster.label },
    notices: (["info", "warning", "danger"] as const).map(tone => ({ id: tone, tone, title: d.toasts[tone].title, message: d.toasts[tone].description })),
  }),
  "page-header": d => ({
    title: d.card.title,
    description: d.card.content,
    breadcrumbs: { items: d.breadcrumbs.items.map((item): RuntimeObject => "href" in item ? { id: item.id, label: item.label, href: item.href } : { id: item.id, label: item.label }) },
    actions: [{ label: d.dialog.trigger }],
  }),
  pagination: d => ({
    page: { page: 1, pageCount: Math.ceil(d.table.rows.length / PAGE_SIZE), pageSize: PAGE_SIZE },
    total: d.table.rows.length,
  }),
  "section-header": d => ({
    eyebrow: d.text.badge,
    heading: d.table.label,
    description: d.text.paragraph,
    actions: [{ label: d.text.link, href: d.text.linkHref }],
  }),
  settings: d => ({
    [ANATOMY_CONTENT_KEY]: { heading: d.navigation.items[1].label },
    groups: rows([
      {
        id: "general", legend: d.navigation.items[1].label,
        controls: [{ id: "status", kind: "select", label: d.select.label, placeholder: d.select.placeholder, selected: d.select.defaultSelectedKey, options: d.select.options.map(option => ({ id: option.id, label: plain(option.label) })) }],
      },
      {
        id: "notifications", legend: d.toaster.label,
        controls: [{ id: "alerts", kind: "switch", label: d.text.switch, selected: true }, { id: "updates", kind: "switch", label: d.text.checkbox }],
      },
    ]),
    dirty: ["notifications"],
    "save-bar": { label: d.text.action, save: d.text.action, discard: d.dialog.actions[0].label, unsaved: d.text.draft },
  }),
  steps: d => ({
    [ANATOMY_CONTENT_KEY]: { heading: d.list.label },
    steps: d.list.items.map(item => ({ id: item.id, heading: item.label })),
  }),
  "table-of-contents": d => ({
    [ANATOMY_CONTENT_KEY]: { label: d.navigation.label },
    headings: [...d.tabs.items, ...d.disclosure.items].map(item => ({ id: item.id, label: item.label })),
    "active-id": d.tabs.items[0].id,
  }),
  wizard: d => ({
    [ANATOMY_CONTENT_KEY]: { label: d.tabs.label },
    steps: [...d.tabs.items, d.disclosure.items[0]].map((item, index) => ({ id: item.id, label: item.label, content: item.content, current: index === 1 })),
    progress: { label: d.progress.label },
    back: { label: d.dialog.actions[0].label },
    next: { label: d.text.submit, finish: d.text.action },
    review: { label: d.card.title, summary: d.card.content },
  }),
};
