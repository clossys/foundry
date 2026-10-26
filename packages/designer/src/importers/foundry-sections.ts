import sectionSlots from "../catalog/slots/sections.json" with { type: "json" };
import type { SectionSlot } from "../catalog-core/sections-contract.js";
import type { FillMeta } from "../catalog-core/types.js";
import { stableStringify } from "../catalog-core/stable.js";

/** Package API bindings, not observations of a consumer or SK conformance. */
export interface FoundrySectionMapping {
  export: string;
  propFiles: readonly string[];
  slotMap: Readonly<Record<string, string>>;
  propMap: Readonly<Record<string, string>>;
  configs?: Readonly<Record<string, string>>;
  notes?: readonly string[];
}
export interface FoundrySectionDescriptor {
  slot: string;
  source: "foundry";
  slotMap: Readonly<Record<string, string>>;
  propMap: Readonly<Record<string, string>>;
  configs: Readonly<Record<string, string>>;
  /** Empty: package pointers do not bind the consumer's shared anatomy fills. */
  parts: readonly string[];
  impl: { kind: "package"; module: "@clossys/designer/blocks"; export: string };
  license: "MIT";
  pin: { package: "@clossys/designer"; version: "0.12.0"; export: string };
  notes: readonly string[];
}
export interface FoundrySectionFillDoc {
  $extensions: { "com.clossys.fill": FillMeta };
  sections: Readonly<Record<string, FoundrySectionDescriptor>>;
}
export interface FoundrySectionCoverage {
  slot: string;
  /** Candidate/subset describes the declared API mapping only. */
  status: "candidate" | "subset" | "unavailable";
  supportedSlots: readonly string[];
  missingSlots: readonly string[];
  missingRequiredSlots: readonly string[];
  supportedMembers: readonly string[];
  missingMembers: readonly string[];
  unresolvedMemberAxes: readonly string[];
  notes: readonly string[];
}
export interface FoundrySectionImportInput {
  slots?: readonly SectionSlot[];
  mappings?: Readonly<Record<string, FoundrySectionMapping>>;
  /** Independently read public blocks barrel exports. */
  exports?: readonly string[];
}
export interface FoundrySectionImport {
  fills: readonly FoundrySectionFillDoc[];
  coverage: readonly FoundrySectionCoverage[];
}

const PACKAGE = "@clossys/designer";
const VERSION = "0.12.0";
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const sorted = (values: readonly string[]): string[] => [...new Set(values)].sort(compare);
const bind = (name: string, entries: Readonly<Record<string, string>>): Readonly<Record<string, string>> => Object.fromEntries(Object.entries(entries).map(([member, target]) => [member, `./blocks#${name}.${target}`]));
const mapping = (name: string, slots: Readonly<Record<string, string>>, members: Readonly<Record<string, string>> = {}, extra: Partial<FoundrySectionMapping> = {}): FoundrySectionMapping => ({ export: name, propFiles: [`${name}.tsx`], slotMap: bind(name, slots), propMap: bind(name, members), ...extra });
const values = (axis: string, prop: string, names: readonly string[]): Record<string, string> => Object.fromEntries(names.map(name => [`${axis}.${name}`, `${prop}=${name}`]));

/** Only APIs evidenced in public blocks source; generic recipe rows are not implementations. */
export const FOUNDRY_SECTION_MAP: Readonly<Record<string, FoundrySectionMapping>> = {
  "access-matrix": mapping("AccessMatrix", { roles: "roles", permissions: "groups[].permissions" }, {}, { notes: ["Permissions are grouped; the host also supplies value, labels and optional onChange. The source owns a native table rather than a component table leaf."] }),
  article: mapping("ArticleBody", { body: "children" }, {}, { notes: ["Accepts pre-structured React children, not a rich-node parser; no dedicated table-of-contents slot. Requires an external SectionFrame."] }),
  band: mapping("SectionFrame", {}, { ...values("ground", "ground", ["base", "sunken", "inverse"]), ...values("measure", "measure", ["prose", "content", "wide"]) }, { notes: ["SectionGround excludes transparent. Rhythm is fixed in source, with no specified contract member values."] }),
  chat: mapping("Chat", { parts: "messages" }, { "part.message": "messages", "part.bubble": "messages[role]", "part.scroller": "messages[scroll]" }, { propFiles: ["chat/types.ts"], notes: ["Messages cover only the message subset of the parts union. Composer is built in, not a host region slot. Host supplies status and onSend. English fallback labels and direct glyph imports remain; no attachment, trace or questionnaire API."] }),
  "column-mapper": mapping("ColumnMapper", { "source-columns": "sourceColumns", "target-fields": "targets", mapping: "mapping" }, {}, { notes: ["Host additionally supplies onMappingChange and labels; source uses Select and native fieldset layout."] }),
  comparison: mapping("Matrix", { columns: "columns", rows: "rows", highlight: "featured" }, {}, { configs: { arrangement: "grid" }, notes: ["The exported Matrix supports arrangement=grid for authored comparison cells and arrangement=choices for content-sized native RadioGroup rows. Choices accepts one or more library columns and unbounded leaf rows without an internal scroll region.", "The choices assembly consumes SectionHeader, RadioGroup, Card, Badge, Tooltip and token-backed table layout; Studio supplies checked token, asset or component previews."] }),
  content: mapping("ContentSection", { body: "children", media: "media", footnote: "footnote" }, values("layout", "layout", ["stacked", "split-start", "split-end"]), { notes: ["Header is spread across heading, eyebrow, description and actions; there is no section-header region prop. Source uses SectionIntro rather than the frozen section-header fill."] }),
  "data-table": mapping("DataTable", { columns: "columns", rows: "rows", sort: "sortDescriptor", selection: "selectionMode", grouping: "model", toolbar: "toolbar", pagination: "footer" }, {}, { notes: ["Host supplies rowKey. Grouping uses the typed model API; footer is an arbitrary region, not a pagination controller. FlatGrid and ModelTable own implementation dependencies, including direct RAC imports."] }),
  "empty-state": mapping("EmptyState", { illustration: "icon", actions: "action" }, {}, { notes: ["Host supplies required title. No kind or scope API; source hand-renders its h2 and padding."] }),
  explorer: mapping("Explorer", { tree: "tree", selection: "selectedId" }, {}, { notes: ["The tree prop is structured data, not a replaceable tree region. No list-pane region API; renderDetails is a selected-node detail callback. Host supplies label. Source implements tree keyboard handling locally."] }),
  faq: mapping("Faq", { items: "items" }, { "layout.list": "items[list]" }, { notes: ["Source has a fixed vertical disclosure list and no two-column layout API; section headings are hand-rendered."] }),
  features: mapping("FeatureGrid", { items: "items" }, { "layout.grid": "items[grid]" }, { notes: ["CompatFeatureGrid fixes the grid layout. Items have icon, heading and description but no per-item link prop; list and split layouts are absent."] }),
  form: mapping("Form", { fields: "children", submit: "actions", "error-summary": "errorSummaryMessage" }, {}, { notes: ["Submit binds to the actions region; the host supplies the submit button. Error-summary content uses the errors and errorSummaryMessage API. Form is a block, not the unavailable components.form leaf."] }),
  hero: mapping("Hero", { media: "media", actions: "actions" }, { ...values("layout", "composition", ["editorial", "split"]), ...values("size", "size", ["display", "compact", "default"]) }, { notes: ["Host supplies required heading. Header is distributed over heading and supporting props, not a section-header region. Source composes SectionIntro; headingLevel permits h1."] }),
  "link-index": mapping("NavGrid", { links: "items" }, { "layout.cards": "items[cards]" }, { notes: ["CompatNavGrid renders fixed linked/action cards; list and plain-grid modes are absent. No generic Items recipe configuration is invented."] }),
  "logo-cloud": mapping("LogoCloud", { logos: "items" }, { ...Object.fromEntries([3, 4, 6, 8, 12].map(count => [`count.${count}`, `items.length=${count}`])), "monochrome.true": "tone=monochrome", "monochrome.false": "tone=original" }, { notes: ["Source checks allowed items.length values and tone; logos are host React nodes. The source root is ul, with no band/header wrapper."] }),
  media: mapping("MediaFigure", { figure: "children" }, {}, { notes: ["Host supplies the image node and its src/alt/ratio; caption is a separate prop. Does not validate a structured figure record or bind anatomy."] }),
  newsletter: mapping("NewsletterBand", { consent: "privacyNote", submit: "submitLabel" }, {}, { notes: ["Email field is built in, not a host region; submitLabel is copy for the built-in action. Host supplies emailLabel, pendingLabel, sentMessage and failedMessage. Consent text does not prove confirmation behavior."] }),
  "page-header": mapping("PageHeader", { title: "title", description: "description", breadcrumbs: "breadcrumb", actions: "actions" }, {}, { notes: ["No record/standard config or meta API. Source renders its own h1 rather than shared section-header anatomy."] }),
  pagination: mapping("Pagination", { page: "page", total: "totalItems" }, { "mode.pages": "page" }, { notes: ["Host supplies pageCount and onPageChange. Only numbered pages exist; load-more and cursor modes are absent. Default visible messages remain in source."] }),
  people: mapping("PeopleGrid", { people: "people" }, {}, { notes: ["People have portrait, initials and one href, not an arbitrary links array. Root is ul; header and band are external."] }),
  pricing: mapping("PricingTable", { plans: "tiers", interval: "interval", highlight: "tiers[].isHighlighted" }, {}, { notes: ["Host supplies authored tiers and CTA nodes. Interval is displayed copy; controls is an arbitrary region, not a built-in interval toggle or checkout. Source also composes Matrix for comparison."] }),
  "record-detail": mapping("DetailView", { fields: "fields", actions: "actions" }, {}, { notes: ["No grouped ledger/status API. RecordLedger is an independent exported part, not an automatically configured DetailView composition."] }),
  "resource-list": mapping("ResourceList", { records: "items", selection: "selectionMode", toolbar: "toolbar", pagination: "footer" }, {}, { notes: ["Footer is an arbitrary host region; emptyState is required. Source includes loading, empty and error APIs, but no runtime observations are supplied."] }),
  "section-header": mapping("SectionHeader", { eyebrow: "eyebrow", heading: "title", description: "description", actions: "actions" }, {}, { notes: ["Heading level is configurable via level; id is inherited HTML input. No align or density members and no enforced two-action maximum."] }),
  "status-list": mapping("StatusList", { items: "items", legend: "legendLabel" }, { ...values("status", "items[].state", ["available", "partial", "planned"]), "status.not-offered": "items[].disposition=not-offered" }, { notes: ["Host supplies labels including disposition labels and legendLabel. Not-offered is a separate disposition, never a fourth readiness state."] }),
  steps: mapping("OrderedStepSequence", { steps: "items" }, {}, { notes: ["Steps require authored ordinal and heading; no per-step status member. Source owns its heading and layout."] }),
  "table-of-contents": mapping("TableOfContents", { headings: "items", "active-id": "currentId" }, {}, { notes: ["Host supplies label. Items are heading ids/labels; optional scroll tracking is source behavior, not a conformance observation."] }),
  "task-list": mapping("TaskList", { tasks: "items" }, {}, { notes: ["Tasks have status, not a done checkbox, due or assignee API. Host supplies statusLabels, progressText and emptyState. No checkbox/avatar composition is claimed."] }),
  testimonials: mapping("TestimonialSet", { quotes: "items" }, { "layout.single": "items.length=1", "layout.grid": "items.length[2,3,4,6]" }, { notes: ["Source selects single or grid geometry from enforced item counts; quote attribution uses attributorName/attributorRole/portrait. Root is ul with external anatomy."] }),
};

const GAPS: Readonly<Record<string, string>> = {
  "activity-feed": "EventItem is one event, not an exported activity-feed section.",
  "audit-log": "Registry row is a spec; no audit-log package export.",
  "call-to-action": "No Designer section export; a Publisher check fixture is not an implementation.",
  cards: "Items is a generic engine; the recipe row supplies no independently evidenced configured section.",
  "data-grid": "Registry row is a spec; internal PivotGrid is not a public data-grid section export.",
  "error-state": "Registry row is a spec; no error-state package export.",
  "filter-builder": "A filter model is not an exported filter-builder section.",
  gallery: "Registry row is a spec; no gallery package export.",
  notices: "Registry row is a spec; no notices package export.",
  settings: "Registry row is a spec; no settings/save-bar section export.",
  stats: "Stat accepts one scalar measurement; no verified configured stats-array section.",
  timeline: "A timeline model or recipe is not an exported timeline section.",
  usage: "UsageMeter accepts one meter; no verified configured meters-array section.",
  wizard: "Registry row is a spec; no wizard package export.",
};
const UNMEASURED = "Descriptor only; source imports, token reads, shared anatomy, accessibility, contrast and consumer runtime conformance are unmeasured. Content bindings describe host adaptation points, not type-equivalent converters.";

/** Pure generation; does not install a package, copy source or assert conformance. */
export function importFoundrySections(input: FoundrySectionImportInput = {}): FoundrySectionImport {
  const slots = input.slots ?? sectionSlots as unknown as readonly SectionSlot[];
  const mappings = input.mappings ?? FOUNDRY_SECTION_MAP;
  const fills: FoundrySectionFillDoc[] = [];
  const coverage: FoundrySectionCoverage[] = [];
  const seen = new Set<string>();
  for (const slot of [...slots].sort((a, b) => compare(a.id, b.id))) {
    if (slot.layer !== "sections" || slot.contract.kind !== "section" || !/^sections\.[a-z][a-z0-9-]*$/.test(slot.id) || seen.has(slot.id)) throw new Error(`foundry-sections: invalid or duplicate slot ${slot.id}`);
    seen.add(slot.id);
    const leaf = slot.id.slice("sections.".length);
    const entry = mappings[leaf];
    const names = slot.contract.slots.map(item => item.name);
    const members = slot.contract.members.names;
    const unresolvedMemberAxes = sorted(slot.contract.unresolvedMemberAxes ?? []);
    const slotMap: Record<string, string> = {};
    const propMap: Record<string, string> = {};
    if (entry) {
      if (!/^[A-Z][A-Za-z0-9]*$/.test(entry.export)) throw new Error(`foundry-sections: invalid export for ${slot.id}`);
      if (input.exports && !input.exports.includes(entry.export)) throw new Error(`foundry-sections: unavailable package export ./blocks#${entry.export}`);
      for (const [bindings, target, allowed, category] of [[entry.slotMap, slotMap, names, "content slot"], [entry.propMap, propMap, members, "member"]] as const) {
        for (const name of Object.keys(bindings).sort(compare)) {
          const pointer = bindings[name];
          if (!allowed.includes(name) || !pointer?.trim()) throw new Error(`foundry-sections: unknown or empty ${category} ${slot.id}.${name}`);
          if (!pointer.startsWith(`./blocks#${entry.export}.`) || !/^\.\/blocks#[A-Z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*(?:[.=[\],a-zA-Z0-9-]*)$/.test(pointer)) throw new Error(`foundry-sections: invalid package pointer ${pointer}`);
          target[name] = pointer;
        }
      }
    }
    const supportedSlots = sorted(Object.keys(slotMap));
    const missingSlots = sorted(names.filter(name => !supportedSlots.includes(name)));
    const missingRequiredSlots = sorted(slot.contract.slots.filter(item => item.required && missingSlots.includes(item.name)).map(item => item.name));
    const supportedMembers = sorted(Object.keys(propMap));
    const missingMembers = sorted(members.filter(member => !supportedMembers.includes(member)));
    const subset = !!(missingSlots.length || missingMembers.length || unresolvedMemberAxes.length);
    const notes = entry ? [...entry.notes ?? [], UNMEASURED] : [GAPS[leaf] ?? "No package implementation is available.", UNMEASURED];
    coverage.push({ slot: slot.id, status: entry ? subset ? "subset" : "candidate" : "unavailable", supportedSlots, missingSlots, missingRequiredSlots, supportedMembers, missingMembers, unresolvedMemberAxes, notes });
    if (!entry) continue;
    const pin = { package: PACKAGE, version: VERSION, export: `./blocks#${entry.export}` } as const;
    const unmapped = [...missingSlots.map(name => `slot.${name}`), ...missingMembers, ...unresolvedMemberAxes.map(axis => `axis.${axis}`)];
    const descriptor: FoundrySectionDescriptor = {
      slot: slot.id, source: "foundry", slotMap, propMap,
      configs: Object.fromEntries(Object.entries(entry.configs ?? {}).sort(([a], [b]) => compare(a, b))),
      parts: [], impl: { kind: "package", module: `${PACKAGE}/blocks`, export: entry.export }, license: "MIT", pin, notes,
    };
    fills.push({ $extensions: { "com.clossys.fill": {
      id: `foundry/${slot.id}`, slot: slot.id, source: "foundry", mode: "implementation", sourceAddress: pin.export,
      relation: subset ? "subset" : "same-contract", builtOn: [], conforms: [], evidence: [],
      author: "foundry", trust: "foundry", license: "MIT", pin, status: "draft", originKinds: ["adopted"],
      ...(unmapped.length ? { unmapped } : {}),
    } }, sections: { [leaf]: descriptor } });
  }
  for (const leaf of Object.keys(mappings)) if (!seen.has(`sections.${leaf}`)) throw new Error(`foundry-sections: mapping has no contract sections.${leaf}`);
  return { fills, coverage };
}

/** Exact local artifacts as bytes; filesystem writes remain caller-owned. */
export function generatedFoundrySectionFiles(input: FoundrySectionImportInput = {}): Readonly<Record<string, string>> {
  const result = importFoundrySections(input);
  return Object.fromEntries([
    ...result.fills.map(fill => [fill.$extensions["com.clossys.fill"].slot + ".json", stableStringify(fill)]),
    ["sections.coverage.json", stableStringify({ source: "foundry", package: PACKAGE, version: VERSION, coverage: result.coverage })],
  ]);
}
