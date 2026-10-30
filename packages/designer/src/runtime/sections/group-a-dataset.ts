/**
 * Group-a Section content bound to the shared synthetic dataset's `specimenDataset.sections` records (L7).
 * Data only: every value is plain RuntimeJson addressed by contract slot, exactly
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
import { plainJson } from "./dataset-json.js";

export const GROUP_A_LEAVES = ["article", "band", "call-to-action", "comparison", "content", "faq", "features", "gallery", "hero", "logo-cloud", "media", "newsletter", "people", "pricing", "testimonials"] as const;
export type GroupALeaf = (typeof GROUP_A_LEAVES)[number];

const S = data.sections;
const barMedia = { kind: "chart", chart: "bar", title: data.charts.bar.title, categories: [...data.charts.bar.categories], series: data.charts.bar.series.map(row => ({ name: row.name, values: [...row.values] })) };
const lineMedia = { kind: "chart", chart: "line", title: data.charts.line.title, x: [...data.charts.line.x], series: data.charts.line.series.map(row => ({ name: row.name, values: [...row.values] })) };
const markMedia = (title: string) => ({ kind: "mark", src: data.assets.mark.src, title });

/**
 * Content values per leaf, keyed by contract slot. Only slots the leaf's fill maps appear here. Every leaf with a
 * `specimenDataset.sections` record reads it; media the records do not carry (charts, the brand mark) comes from
 * the shared asset and chart records.
 */
export const GROUP_A_CONTENT: Readonly<Record<GroupALeaf, Readonly<Record<string, RuntimeJson>>>> = {
  article: { body: [{ kind: "heading", text: S.articleBody.heading }, { kind: "paragraph", text: S.articleBody.body }] },
  band: {},
  "call-to-action": {
    header: { eyebrow: S.callToAction.eyebrow, title: S.callToAction.title, description: S.callToAction.description },
    actions: { primary: plainJson(S.callToAction.primary), secondary: plainJson(S.callToAction.secondary) },
  },
  comparison: {
    // Text cells from the comparison record. Mark cells need markLabels and a keyLabel the comparison contract
    // has no slot for (owner item), so the preview binds none.
    columns: plainJson(S.comparison.columns),
    rows: plainJson(S.comparison.rows),
    highlight: plainJson({ ...S.comparison.featured, label: S.comparison.featuredLabel }),
  },
  content: {
    header: { eyebrow: S.content.eyebrow, heading: S.content.heading, description: S.content.description, actions: [{ label: data.text.link, href: data.text.linkHref, variant: "primary" }] },
    body: [{ kind: "paragraph", text: S.content.body }],
    media: lineMedia,
    footnote: data.popover.content,
  },
  faq: { items: plainJson(S.faq.items) },
  features: { items: plainJson(S.featureGrid.items) },
  gallery: { images: { label: S.gallery.label, items: S.gallery.images.map(image => ({ id: image.id, label: image.label, media: markMedia(image.label), caption: image.caption })) }, controls: S.gallery.labels },
  hero: {
    header: { eyebrow: S.hero.eyebrow, heading: S.hero.heading, description: S.hero.description },
    media: barMedia,
    actions: { primary: { label: S.hero.primary, href: S.callToAction.primary.href }, secondary: { label: S.hero.secondary, href: S.callToAction.secondary.href } },
  },
  "logo-cloud": { logos: S.logoCloud.names.map(name => ({ id: name, name, src: data.assets.mark.src })), controls: { pause: "Pause motion", resume: "Resume motion" } },
  media: { figure: { media: barMedia, caption: S.mediaFigure.caption } },
  newsletter: {
    email: { label: S.newsletter.emailLabel },
    consent: S.newsletter.privacyNote,
    submit: { label: S.newsletter.submitLabel, pendingLabel: S.newsletter.pendingLabel, sentMessage: S.newsletter.sentMessage, failedMessage: S.newsletter.failedMessage, action: S.newsletter.action },
  },
  people: { people: plainJson(S.peopleGrid.people) },
  pricing: {
    plans: S.pricing.tiers.map(tier => plainJson({ id: tier.id, name: tier.name, price: tier.price, features: tier.features, cta: { label: tier.cta, href: `#${tier.id}` }, badge: tier.badge })),
    highlight: S.pricing.tiers.filter(tier => tier.featured).map(tier => tier.id),
  },
  testimonials: { quotes: plainJson(S.testimonials.items), controls: { previous: "Previous quote", next: "Next quote" } },
};

/** Members the preview selects per leaf; every one is in the leaf's fill propMap. */
export const GROUP_A_MEMBERS: Readonly<Record<GroupALeaf, readonly string[]>> = {
  article: [], band: ["ground.sunken", "measure.content"], "call-to-action": [], comparison: [], content: ["layout.split-end"],
  faq: ["layout.list"], features: ["layout.grid"], gallery: ["lightbox.enabled"], hero: ["layout.split", "size.display"],
  "logo-cloud": ["count.3", "monochrome.false"], media: [], newsletter: [], people: [], pricing: [], testimonials: ["layout.grid"],
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
