/**
 * Group-a Section content bound to the shared synthetic dataset (studio/specimen-dataset.ts until the L7
 * dataset contract lands). Data only: every value is plain RuntimeJson addressed by contract slot, exactly
 * what a consumer's resolveContent would hand the assembly, and every name, number and series is read from
 * the dataset rather than restated. `groupASectionInput` builds the RuntimeRenderInput a preview or test
 * passes to a renderer; the real manifest producer and its renderer descriptors are L9's.
 */
import type { ReactNode } from "react";
import sectionSlots from "../../catalog/slots/sections.json" with { type: "json" };
import type { SectionSlot } from "../../catalog-core/sections-contract.js";
import type { CompositeResolved } from "../../catalog-core/types.js";
import { runtimeHash, type RuntimeContent, type RuntimeContentRef, type RuntimeFillDescriptor, type RuntimeJson, type RuntimeRenderInput, type RuntimeSourceClosure } from "../../catalog-core/runtime-ports.js";
import { specimenDataset as data } from "../../studio/specimen-dataset.js";

export const GROUP_A_LEAVES = ["article", "band", "call-to-action", "comparison", "content", "faq", "features", "gallery", "hero", "logo-cloud", "media", "newsletter", "people", "pricing", "testimonials"] as const;
export type GroupALeaf = (typeof GROUP_A_LEAVES)[number];

const brand = data.assets.mark.name;
const [ada, bram, chen, dara] = data.people;
const roles = ["Design lead", "Engineering", "Operations", "Support"] as const;
const team = [ada, bram, chen, dara].map((person, index) => ({ id: person.id, name: person.name, initials: person.initials, role: roles[index]! }));
const barMedia = { kind: "chart", chart: "bar", title: data.charts.bar.title, categories: [...data.charts.bar.categories], series: data.charts.bar.series.map(row => ({ name: row.name, values: [...row.values] })) };
const lineMedia = { kind: "chart", chart: "line", title: data.charts.line.title, x: [...data.charts.line.x], series: data.charts.line.series.map(row => ({ name: row.name, values: [...row.values] })) };
const markMedia = { kind: "mark", src: data.assets.mark.src, title: brand };
const plans = data.radio.items;
/** One tier's amount per billing interval, read from the dataset's seeded order totals. */
const prices = (tier: number) => Object.fromEntries(plans.map((plan, interval) => {
  const amount = data.table.rows[tier * plans.length + interval]!.total;
  return [plan.id, { amount, priceText: `${amount} ${plan.label}` }];
}));
/** A select option's label; the dataset types option labels as nodes, the runtime content must be text. */
const optionLabel = (index: number): string => {
  const label = data.select.options[index]?.label;
  if (typeof label !== "string") throw new Error(`group-a dataset: select option ${index} has no text label`);
  return label;
};

/** Content values per leaf, keyed by contract slot. Only slots the leaf's fill maps appear here. */
export const GROUP_A_CONTENT: Readonly<Record<GroupALeaf, Readonly<Record<string, RuntimeJson>>>> = {
  article: {
    body: [
      { kind: "heading", text: data.tabs.items[0].label },
      { kind: "paragraph", text: data.tabs.items[0].content },
      { kind: "heading", text: data.tabs.items[1].label },
      { kind: "paragraph", text: data.tabs.items[1].content },
      { kind: "list", items: data.list.items.map(item => item.label) },
    ],
  },
  band: {},
  "call-to-action": {
    header: { eyebrow: data.text.badge, title: data.dialog.title, description: data.dialog.body },
    actions: { primary: { label: data.text.link, href: data.text.linkHref }, secondary: { label: data.breadcrumbs.items[1].label, href: data.breadcrumbs.items[1].href } },
  },
  comparison: {
    columns: plans.map(plan => ({ id: plan.id, label: plan.label })),
    // Figure cells from the dataset's weekly series, one series per plan column. Mark cells need markLabels and
    // a keyLabel the comparison contract has no slot for, so the preview binds none.
    rows: data.tags.items.map((tag, index) => ({ id: tag.id, label: tag.label, cells: Object.fromEntries(plans.map((plan, column) => [plan.id, { type: "figure", value: String(data.charts.area.series[column]!.values[index]) }])) })),
    highlight: { column: plans[1].id, label: data.text.badge },
  },
  content: {
    header: { eyebrow: data.text.statusMark, heading: data.card.title, description: data.card.content, actions: [{ label: data.text.link, href: data.text.linkHref, variant: "primary" }] },
    body: [{ kind: "paragraph", text: data.toasts.success.description }, { kind: "list", items: data.toolbar.items.map(item => item.label) }],
    media: lineMedia,
    footnote: data.popover.content,
  },
  faq: { items: data.disclosure.items.map(item => ({ id: item.id, question: item.label, answer: item.content })) },
  features: { items: Object.entries(data.toasts).slice(0, 3).map(([id, toast]) => ({ id, heading: toast.title, description: toast.description })) },
  gallery: {
    images: {
      label: data.charts.bar.title,
      items: [
        { id: "orders", label: data.charts.bar.title, media: barMedia, caption: data.charts.bar.series[0].name },
        { id: "response", label: data.charts.line.title, media: lineMedia, caption: data.charts.line.series[0].name },
        { id: "mark", label: brand, media: markMedia, caption: brand },
      ],
    },
  },
  hero: {
    header: { eyebrow: data.text.badge, heading: brand, description: data.text.paragraph },
    media: barMedia,
    actions: { primary: { label: data.text.link, href: data.text.linkHref }, secondary: { label: data.navigation.items[0].label, href: data.navigation.items[0].href } },
  },
  "logo-cloud": { logos: ["", " Labs", " Retail", " Health"].map((suffix, index) => ({ id: `logo-${index + 1}`, name: `${brand}${suffix}`, src: data.assets.mark.src })) },
  media: { figure: { media: barMedia, caption: data.charts.bar.title } },
  newsletter: {
    // The dataset has no email field or form destination yet (needs-from-L7); these two are the only literals here.
    email: { label: "Email address" },
    consent: data.text.checkbox,
    submit: { label: data.text.submit, pendingLabel: data.spinner.label, sentMessage: data.toasts.success.title, failedMessage: data.toasts.danger.title, action: "/subscribe" },
  },
  people: { people: team },
  pricing: {
    plans: [
      { id: "starter", name: optionLabel(0), description: data.text.paragraph, priceByInterval: prices(0), features: data.tags.items.slice(0, 2).map(tag => tag.label), cta: { label: data.text.action, href: data.text.linkHref } },
      { id: "team", name: optionLabel(2), description: data.card.content, priceByInterval: prices(1), features: data.tags.items.map(tag => tag.label), cta: { label: data.text.submit, href: data.text.linkHref }, badge: data.text.badge },
    ],
    interval: plans[0].id,
    highlight: ["team"],
  },
  testimonials: { quotes: [data.toasts.success, data.toasts.info, data.toasts.warning].map((toast, index) => ({ id: team[index]!.id, quote: toast.description, attributorName: team[index]!.name, attributorRole: team[index]!.role })) },
};

/** Members the preview selects per leaf; every one is in the leaf's fill propMap. */
export const GROUP_A_MEMBERS: Readonly<Record<GroupALeaf, readonly string[]>> = {
  article: [], band: ["ground.sunken", "measure.content"], "call-to-action": [], comparison: [], content: ["layout.split-end"],
  faq: ["layout.list"], features: ["layout.grid"], gallery: ["lightbox.enabled"], hero: ["layout.split", "size.display"],
  "logo-cloud": ["count.4", "monochrome.false"], media: [], newsletter: [], people: [], pricing: [], testimonials: ["layout.grid"],
};

const contracts = sectionSlots as unknown as readonly SectionSlot[];
const slotKind = (leaf: string, slot: string): RuntimeContentRef["kind"] => {
  const kind = contracts.find(row => row.id === `sections.${leaf}`)?.contract.slots.find(row => row.name === slot)?.type;
  if (!kind) throw new Error(`group-a dataset: sections.${leaf} has no content slot ${slot}`);
  return kind as RuntimeContentRef["kind"];
};

/** The dataset content for one leaf as resolved RuntimeContent (reference, value and value hash). */
export function groupASectionContent(leaf: GroupALeaf): Readonly<Record<string, RuntimeContent>> {
  return Object.fromEntries(Object.entries(GROUP_A_CONTENT[leaf]).map(([slot, value]) => {
    const reference: RuntimeContentRef = { kind: slotKind(leaf, slot), ref: `dataset:${data.seed}/sections.${leaf}.${slot}` };
    return [slot, { reference, value, hash: runtimeHash(value) }];
  }));
}

/** The generated Foundry fill document's mapped keys, as the runtime fill descriptor reports them. */
export interface GroupAFillDocument {
  readonly $extensions: { readonly "com.clossys.fill": { readonly id: string; readonly slot: string } };
  readonly sections: Readonly<Record<string, { readonly slotMap: Readonly<Record<string, string>>; readonly propMap: Readonly<Record<string, string>> }>>;
}

/**
 * A preview RuntimeRenderInput for one leaf from its generated fill and the dataset. The renderer descriptor is
 * a preview identity only (`package:<leaf>`), not the L9 runtime manifest's.
 */
export function groupASectionInput(leaf: GroupALeaf, doc: GroupAFillDocument, options: { readonly members?: readonly string[]; readonly slots?: Readonly<Record<string, readonly ReactNode[]>> } = {}): RuntimeRenderInput<ReactNode> {
  const meta = doc.$extensions["com.clossys.fill"], entry = doc.sections[leaf];
  if (!entry || meta.slot !== `sections.${leaf}`) throw new Error(`group-a dataset: fill ${meta.id} is not sections.${leaf}`);
  const source: RuntimeSourceClosure = { entry: "index.ts", files: { "index.ts": `export { GROUP_A_SECTION_RENDERERS } from "@clossys/designer/runtime/sections/group-a";\n` }, dependencies: {} };
  const content = groupASectionContent(leaf);
  const fill: RuntimeFillDescriptor = {
    kind: "section", library: "foundry", fill: meta.id, leaf: `sections.${leaf}`, config: null,
    slots: Object.keys(entry.slotMap).sort(), members: Object.keys(entry.propMap).sort(), states: ["default"],
    renderer: { id: `package:sections.${leaf}`, source, sourceHash: runtimeHash(source) },
  };
  return {
    path: `sections.main.0`, fill, cell: { theme: "light", state: "default", width: 1280 }, content, slots: options.slots ?? {},
    selection: { leaf: fill.leaf, fill: fill.fill, config: null, members: options.members ?? GROUP_A_MEMBERS[leaf], content: Object.fromEntries(Object.entries(content).map(([slot, row]) => [slot, row.reference])) },
    profile: {} as CompositeResolved,
  };
}
