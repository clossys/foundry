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
  "activity-feed": mapping("ActivityFeed", { events: "events", grouping: "groups", filters: "filters" }, {}, { notes: ["Each event renders through EventItem; host supplies labels and emptyState. Groups name event ids and every event must sit in exactly one group. Root is section; header and band are external."] }),
  "access-matrix": mapping("AccessMatrix", { roles: "roles", permissions: "groups[].permissions" }, {}, { notes: ["Permissions are grouped; the host also supplies value, labels and optional onChange. The source owns a native table rather than a component table leaf."] }),
  "audit-log": mapping("AuditLog", { entries: "entries", filter: "filter", export: "exportAction" }, {}, { notes: ["Composes DataTable with fixed time, actor, action and target columns; host supplies labels. Filter and export are host regions in the DataTable toolbar; the block never filters or exports rows itself."] }),
  article: mapping("ArticleBody", { body: "children" }, {}, { notes: ["Accepts pre-structured React children, not a rich-node parser; no dedicated table-of-contents slot. Requires an external SectionFrame."] }),
  band: mapping("SectionFrame", {}, { ...values("ground", "ground", ["base", "sunken", "inverse"]), ...values("measure", "measure", ["prose", "content", "wide"]) }, { notes: ["SectionGround excludes transparent. Rhythm is fixed in source, with no specified contract member values."] }),
  "call-to-action": mapping("CallToAction", { header: "title,eyebrow,description", actions: "primaryAction,secondaryAction" }, {}, { notes: ["Header is the composed SectionHeader (eyebrow, title, description) on a section ground; actions are one primary and at most one secondary host node, so the two-action ceiling is structural."] }),
  cards: mapping("RecordCards", { records: "records" }, values("layout", "layout", ["grid", "list"]), { notes: ["Each record renders a Foundry Card (outline) with the title as its single Link and an optional Badge. Loading, empty and error states stay host-owned around the list."] }),
  chat: mapping("Chat", { parts: "messages", composer: "onSend" }, { "part.message": "messages", "part.bubble": "messages[role]", "part.scroller": "messages[scroll]" }, { propFiles: ["chat/types.ts"], notes: ["Messages cover only the message subset of the parts union. Composer is a built-in region (Textarea and Send button) that the host adapts through onSend and composerLabel; it is not replaceable by a host node. Host supplies status. English fallback labels and direct glyph imports remain; no attachment, trace or questionnaire API."] }),
  "column-mapper": mapping("ColumnMapper", { "source-columns": "sourceColumns", "target-fields": "targets", mapping: "mapping" }, {}, { notes: ["Host additionally supplies onMappingChange and labels; source uses Select and native fieldset layout."] }),
  comparison: mapping("Matrix", { columns: "columns", rows: "rows", highlight: "featured", controls: "records.controls" }, { "arrangement.library-board": "arrangement=library-board" }, { propFiles: ["Matrix.tsx", "library-board/LibraryBoardSection.tsx"], configs: { arrangement: "grid" }, notes: ["The exported Matrix preserves Matrix arrangement=grid for authored comparison cells and arrangement=choices for content-sized native RadioGroup rows. Choices accepts one or more library columns and unbounded leaf rows without an internal scroll region.", "The explicit library-board configuration selects LibraryBoardSection typed columns, rows and controls records through LIBRARY_BOARD_CONFIG; its canonical member is arrangement.library-board. Grid remains the existing literal. Selected runtime qualification remains separate.", "The choices assembly consumes SectionHeader, RadioGroup, Card, Badge, Tooltip and token-backed table layout; Studio supplies checked token, asset or component previews."] }),
  consent: mapping("ConsentBanner", { copy: "title,body", actions: "acceptLabel,rejectLabel", policy: "privacyLink" }, {}, { notes: ["Accept and reject are two equal-prominence built-in buttons labelled by the host, who also supplies onAccept and onReject. The banner owns no consent state, storage or network call."] }),
  content: mapping("ContentSection", { header: "heading,eyebrow,description,actions", body: "children", media: "media", footnote: "footnote" }, values("layout", "layout", ["stacked", "split-start", "split-end"]), { notes: ["Header is spread across heading, eyebrow, description and actions; there is no single section-header region prop. Source uses SectionIntro rather than the frozen section-header fill."] }),
  "data-grid": mapping("DataTable", { rows: "rows", cells: "columns", pinning: "model.pinnedColumns" }, {}, { notes: ["Cells are rendered by the column definitions (cell renderers); pinning binds the view model's pinnedColumns, a leading prefix of at most three visible columns. Host supplies rowKey, label and onModelChange."] }),
  "data-table": mapping("DataTable", { columns: "columns", rows: "rows", sort: "sortDescriptor", selection: "selectionMode", grouping: "model", toolbar: "toolbar", pagination: "footer" }, {}, { notes: ["Host supplies rowKey. Grouping uses the typed model API; footer is an arbitrary region, not a pagination controller. FlatGrid and ModelTable own implementation dependencies, including direct RAC imports."] }),
  "empty-state": mapping("EmptyState", { illustration: "icon", actions: "action" }, {}, { notes: ["Host supplies required title. No kind or scope API; source hand-renders its h2 and padding."] }),
  "error-state": mapping("ErrorState", { code: "code", retry: "retry", report: "report" }, values("kind", "kind", ["not-found", "failure", "forbidden", "offline"]), { notes: ["Kind is host data rendered as data-error-kind; title and description copy stay host-authored. Not a live region: the host moves focus or announces the replacement."] }),
  explorer: mapping("Explorer", { tree: "tree", selection: "selectedId", list: "list" }, {}, { notes: ["The tree prop is structured data, not a replaceable tree region. The list region is a host-owned pane laid out beside the tree (named by listLabel); renderDetails is a separate per-node detail callback. Host supplies label. Source implements tree keyboard handling locally."] }),
  faq: mapping("Faq", { items: "items" }, { "layout.list": "items[list]" }, { notes: ["Source has a fixed vertical disclosure list and no two-column layout API; section headings are hand-rendered."] }),
  features: mapping("FeatureGrid", { items: "items" }, { "layout.grid": "items[grid]" }, { notes: ["CompatFeatureGrid fixes the grid layout. Items have icon, heading and description but no per-item link prop; list and split layouts are absent."] }),
  "filter-builder": mapping("FilterBuilder", { fields: "fields", operators: "operators", groups: "groups" }, {}, { notes: ["Groups are controlled records of field/operator/value conditions with an all/any match; groups combine as all. Host supplies onGroupsChange and labels and evaluates the conditions; no date-picker or tag-group value editor is claimed."] }),
  gallery: mapping("Gallery", { images: "images,label" }, { "lightbox.enabled": "lightbox=true", "lightbox.disabled": "lightbox=false" }, { notes: ["Images are host nodes with their own alternative text; the lightbox is the Foundry Dialog opened from a React Aria button per image. The images content carries the gallery's accessible label with the images."] }),
  form: mapping("Form", { fields: "children", submit: "actions", "error-summary": "errorSummaryMessage" }, {}, { notes: ["Submit binds to the actions region; the host supplies the submit button. Error-summary content uses the errors and errorSummaryMessage API. Form is a block, not the unavailable components.form leaf."] }),
  hero: mapping("Hero", { header: "heading", media: "media", actions: "actions" }, { ...values("layout", "composition", ["editorial", "split"]), ...values("size", "size", ["display", "compact", "default"]) }, { notes: ["Header is a built-in SectionIntro region keyed by the required heading, with eyebrow and description as supporting props; it is not a replaceable section-header node. Source composes SectionIntro; headingLevel permits h1."] }),
  "link-index": mapping("NavGrid", { links: "items" }, { "layout.cards": "items[cards]" }, { notes: ["CompatNavGrid renders fixed linked/action cards; list and plain-grid modes are absent. No generic Items recipe configuration is invented."] }),
  "logo-cloud": mapping("LogoCloud", { logos: "items" }, { ...Object.fromEntries([3, 4, 6, 8, 12].map(count => [`count.${count}`, `items.length=${count}`])), "monochrome.true": "tone=monochrome", "monochrome.false": "tone=original" }, { notes: ["Source checks allowed items.length values and tone; logos are host React nodes. The source root is ul, with no band/header wrapper."] }),
  media: mapping("MediaFigure", { figure: "children" }, {}, { notes: ["Host supplies the image node and its src/alt/ratio; caption is a separate prop. Does not validate a structured figure record or bind anatomy."] }),
  newsletter: mapping("NewsletterBand", { email: "emailLabel", consent: "privacyNote", submit: "submitLabel,pendingLabel,sentMessage,failedMessage,action" }, {}, { notes: ["Email is a built-in email TextField the host adapts through emailLabel; it is not replaceable by a host node. The submit content carries the built-in action's copy (submitLabel, pendingLabel, sentMessage, failedMessage) and its same-origin form action. Consent text does not prove confirmation behavior."] }),
  notices: mapping("NoticeList", { notices: "notices" }, {}, { notes: ["Each notice renders a Foundry Banner whose tone sets its live-region role; the host supplies label and removes a notice on onDismiss. No queue or timer."] }),
  "page-header": mapping("PageHeader", { title: "title", description: "description", breadcrumbs: "breadcrumb", actions: "actions" }, {}, { notes: ["No record/standard config or meta API. Source renders its own h1 rather than shared section-header anatomy."] }),
  pagination: mapping("Pagination", { page: "page", total: "totalItems" }, { "mode.pages": "page" }, { notes: ["Host supplies pageCount and onPageChange. Only numbered pages exist; load-more and cursor modes are absent. Default visible messages remain in source."] }),
  people: mapping("PeopleGrid", { people: "people" }, {}, { notes: ["People have portrait, initials and one href, not an arbitrary links array. Root is ul; header and band are external."] }),
  pricing: mapping("PricingTable", { plans: "tiers", interval: "interval", highlight: "tiers[].isHighlighted" }, {}, { notes: ["Host supplies authored tiers and CTA nodes. Interval is displayed copy; controls is an arbitrary region, not a built-in interval toggle or checkout. Source also composes Matrix for comparison."] }),
  "record-detail": mapping("DetailView", { fields: "fields", actions: "actions", status: "title" }, {}, { notes: ["Status renders as a Badge the host composes into the title row. No grouped ledger API, so groups stay unmapped; RecordLedger is an independent exported part, not an automatically configured DetailView composition."] }),
  "resource-list": mapping("ResourceList", { records: "items", selection: "selectionMode", toolbar: "toolbar", pagination: "footer" }, {}, { notes: ["Footer is an arbitrary host region; emptyState is required. Source includes loading, empty and error APIs, but no runtime observations are supplied."] }),
  settings: mapping("SettingsSection", { groups: "groups", dirty: "dirty", "save-bar": "saveBar" }, {}, { notes: ["Each group is a FieldGroup fieldset holding host fields; dirty is a list of group ids marked unsaved. The save bar region renders only while a group is dirty. Persistence and toasts belong to the host; the source renders its own h2 rather than shared section-header anatomy."] }),
  "section-header": mapping("SectionHeader", { eyebrow: "eyebrow", heading: "title", description: "description", actions: "actions" }, { ...values("align", "align", ["start", "center"]), ...values("density", "density", ["display", "standard", "compact"]) }, { notes: ["Heading level is configurable via level; id is inherited HTML input. align and density map to the block's own props; the block enforces no two-action maximum."] }),
  stats: mapping("StatGroup", { stats: "items" }, values("layout", "layout", ["grid", "row"]), { notes: ["Each item renders one Stat (label, value, optional delta/trend and description); no sparkline or meter composition is claimed."] }),
  "status-list": mapping("StatusList", { items: "items", legend: "legendLabel" }, { ...values("status", "items[].state", ["available", "partial", "planned"]), "status.not-offered": "items[].disposition=not-offered" }, { notes: ["Host supplies labels including disposition labels and legendLabel. Not-offered is a separate disposition, never a fourth readiness state."] }),
  steps: mapping("OrderedStepSequence", { steps: "items" }, {}, { notes: ["Steps require authored ordinal and heading; no per-step status member. Source owns its heading and layout."] }),
  "table-of-contents": mapping("TableOfContents", { headings: "items", "active-id": "currentId" }, {}, { notes: ["Host supplies label. Items are heading ids/labels; optional scroll tracking is source behavior, not a conformance observation."] }),
  timeline: mapping("Timeline", { events: "events" }, {}, { notes: ["Events carry a machine-readable date, host-formatted dateText, heading and optional description. Root is an ordered list; the marker rail is drawn with line tokens, not a separator component."] }),
  "task-list": mapping("TaskList", { tasks: "items" }, {}, { notes: ["Tasks have status, not a done checkbox, due or assignee API. Host supplies statusLabels, progressText and emptyState. No checkbox/avatar composition is claimed."] }),
  wizard: mapping("FormWizard", { steps: "steps", progress: "progress", back: "onBack", next: "onNext", review: "review" }, {}, { notes: ["Current step is controlled by id; the host supplies onNext/onBack and validation. Progress defaults to a ProgressBar; review shows on the last step only. No band or section-header anatomy."] }),
  testimonials: mapping("TestimonialSet", { quotes: "items" }, { "layout.single": "items.length=1", "layout.grid": "items.length[2,3,4,6]" }, { notes: ["Source selects single or grid geometry from enforced item counts; quote attribution uses attributorName/attributorRole/portrait. Root is ul with external anatomy."] }),
  usage: mapping("UsageSummary", { meters: "meters" }, {}, { notes: ["Each meter record renders through UsageMeter (host-formatted used, limit and period text, optional thresholds). Root is section; an empty list requires emptyState."] }),
};

const GAPS: Readonly<Record<string, string>> = {
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
