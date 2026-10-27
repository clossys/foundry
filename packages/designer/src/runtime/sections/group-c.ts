import type { RuntimeJson } from "../../catalog-core/runtime-ports.js";
import type { SpecimenDataset } from "../../studio/specimen-dataset.js";
import { cardsInputs, renderCards } from "./cards.js";
import { chatInputs, renderChat } from "./chat.js";
import { consentInputs, renderConsent } from "./consent.js";
import { emptyStateInputs, renderEmptyState } from "./empty-state.js";
import { errorStateInputs, renderErrorState } from "./error-state.js";
import { formInputs, renderForm } from "./form.js";
import { plainJson } from "./dataset-json.js";
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
const plain = (value: unknown): string => typeof value === "string" ? value : "";
/** Types a row list as JSON records, so literal rows with differing optional fields stay RuntimeJson. */
const rows = (list: readonly RuntimeObject[]): readonly RuntimeObject[] => list;

/**
 * Leaf -> its content, keyed by contract slot, bound to the shared synthetic dataset: each leaf reads its
 * `specimenDataset.sections` record (L7); regions no record carries (illustrations, breadcrumbs, form controls a
 * block sample holds as React nodes) read the shared component records. `header` carries the anatomy copy no
 * contract slot holds yet (see group-c-content `ANATOMY_CONTENT_KEY`).
 */
export const sectionDatasetC: Readonly<Record<GroupCLeaf, (dataset: SpecimenDataset) => Content>> = {
  cards: ({ sections: S }) => ({
    records: plainJson(S.recordCards.records),
  }),
  chat: ({ sections: S }) => ({
    parts: plainJson(S.chat.messages),
    composer: { placeholder: S.chat.placeholder },
  }),
  consent: ({ sections: S }) => ({
    copy: { title: S.consentBanner.title, body: S.consentBanner.body },
    actions: [{ label: S.consentBanner.acceptLabel }, { label: S.consentBanner.rejectLabel }],
    policy: plainJson(S.consentBanner.privacy),
  }),
  "empty-state": d => ({
    [ANATOMY_CONTENT_KEY]: { heading: d.sections.emptyState.title, description: d.sections.emptyState.description },
    illustration: { icon: "FileText", label: d.icon.label },
    actions: [{ label: d.text.upload }],
  }),
  "error-state": ({ sections: S }) => ({
    [ANATOMY_CONTENT_KEY]: { heading: S.errorState.title, description: S.errorState.description },
    code: S.errorState.code,
    retry: { label: S.errorState.retryLabel },
    report: plainJson(S.errorState.report),
  }),
  form: ({ sections: S }) => ({
    [ANATOMY_CONTENT_KEY]: { heading: S.form.heading },
    fields: rows(S.form.fields.map(field => ({ id: field.id, kind: field.type, label: field.label }))),
    submit: { label: S.form.submit },
  }),
  "link-index": ({ sections: S }) => ({
    [ANATOMY_CONTENT_KEY]: { heading: S.navGrid.heading },
    links: plainJson(S.navGrid.items),
  }),
  notices: ({ sections: S }) => ({
    [ANATOMY_CONTENT_KEY]: { label: S.noticeList.label },
    // The notice record's link action has no contract component (NEED: components.link), so it is left out.
    notices: S.noticeList.notices.map(({ action: _action, ...notice }) => plainJson(notice)),
  }),
  "page-header": d => ({
    title: d.sections.pageHeader.title,
    description: d.sections.pageHeader.description,
    breadcrumbs: { items: d.breadcrumbs.items.map((item): RuntimeObject => "href" in item ? { id: item.id, label: item.label, href: item.href } : { id: item.id, label: item.label }) },
    actions: [{ label: d.dialog.trigger }],
  }),
  pagination: ({ sections: S }) => ({
    page: plainJson(S.pagination),
  }),
  "section-header": d => ({
    eyebrow: d.sections.sectionHeader.eyebrow,
    heading: d.sections.sectionHeader.title,
    description: d.sections.sectionHeader.description,
    actions: [{ label: d.text.link, href: d.text.linkHref }],
  }),
  settings: d => {
    const sample = d.sections.settingsSection;
    const [general, notifications] = sample.groups;
    return {
      [ANATOMY_CONTENT_KEY]: { heading: plain(sample.heading), description: plain(sample.description) },
      // The sample's controls are React nodes; the group ids and legends are its, the controls the component records.
      groups: rows([
        {
          id: general!.id, legend: plain(general!.legend),
          controls: [{ id: "status", kind: "select", label: d.select.label, placeholder: d.select.placeholder, selected: d.select.defaultSelectedKey, options: d.select.options.map(option => ({ id: option.id, label: plain(option.label) })) }],
        },
        {
          id: notifications!.id, legend: plain(notifications!.legend),
          controls: [{ id: "switch", kind: "switch", label: d.text.switch, selected: true }, { id: "checkbox", kind: "switch", label: d.text.checkbox }],
        },
      ]),
      dirty: [...(sample.dirty ?? [])],
      "save-bar": { label: plain(sample.labels?.saveBar), save: d.text.action, discard: d.dialog.actions[0].label, unsaved: plain(sample.labels?.unsaved) },
    };
  },
  steps: ({ sections: S }) => ({
    [ANATOMY_CONTENT_KEY]: { heading: S.orderedSteps.heading },
    steps: plainJson(S.orderedSteps.items),
  }),
  "table-of-contents": ({ sections: S }) => ({
    [ANATOMY_CONTENT_KEY]: { label: S.tableOfContents.label },
    headings: plainJson(S.tableOfContents.items),
    "active-id": S.tableOfContents.items[0]!.id,
  }),
  wizard: d => {
    const sample = d.sections.formWizard;
    return {
      [ANATOMY_CONTENT_KEY]: { label: sample.labels.steps },
      // The sample's step bodies are React nodes; ids, labels and the current step are its.
      steps: sample.steps.map(step => ({ id: step.id, label: plain(step.label), current: step.id === sample.currentStep })),
      progress: { label: d.progress.label },
      back: { label: sample.labels.back },
      next: { label: sample.labels.next, finish: sample.labels.finish },
      review: { label: sample.labels.review },
    };
  },
};
