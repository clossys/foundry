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
  "logo-mark": {"export": "SectionFrame", "propFiles": ["SectionFrame.tsx"], "slotMap": {"mark": "./blocks#SectionFrame.children"}, "propMap": {}, "notes": ["The public SectionFrame export supplies section framing. The private sections.logo-mark runtime adapter resolves the consumer's assets.mark media record to a Logomark child, with no extra public block export.", "mark maps to children as a host adaptation point, not a type-equivalent media-record prop. Its record carries slot=assets.mark, a declared member (mono, positive or reversed), src and optional asset name metadata. The runtime port has no asset resolver; the consumer must supply the registered member's resolved artwork and list it in assetClosure.", "The section has no copy slots or authored copy fields. Optional asset name metadata labels the image group and is never rendered as visible text. Without metadata the logo remains decorative."]},
  "sign-in-form": {"export": "Form", "propFiles": ["Form.tsx", "ContentSection.tsx"], "slotMap": {"header": "./blocks#Form.heading", "providers": "./blocks#Form.children", "credentials": "./blocks#Form.children", "verification": "./blocks#Form.children", "actions": "./blocks#Form.actions", "error": "./blocks#Form.submitError"}, "propMap": {}, "notes": ["Private sections.sign-in-form renderer composes public Form, ContentSection, TextField and Button. There is no public sign-in Block export.", "Mapping identifies Form adaptation regions, not type-equivalent SignInForm props. Header.heading is rendered by the surrounding ContentSection heading and aria-labelledby on Form; providers, credential fields and verification fields are composed children.", "Provider labels and every input/action/error string are host-authored passage content. Sensitive controlled values never enter runtime JSON content. Existing ConsumerRuntimePorts.sectionHosts carries phase, values, pending, onValueChange and onSubmit, plus onProvider/onBack/onResend for visible actions.", "Credentials and code are bounded host-selected UI phases only. Provider actions delegate ids; form submission delegates the current phase. No authentication, auth-provider import, redirect, session check, completed state, account creation, invitation, or reset behavior is claimed.", "Without a Section host the sample renders disabled controls. Pending blocks repeated submission and value changes. The host performs validation and authenticates; errors remain host-supplied copy.", "Descriptor only; package fill coverage does not prove consumer runtime conformance."]},
  "boundary-message": {"export": "EmptyState", "propFiles": ["EmptyState.tsx"], "slotMap": {"status": "./blocks#EmptyState.title", "title": "./blocks#EmptyState.title", "description": "./blocks#EmptyState.description", "actions": "./blocks#EmptyState.action", "notes": "./blocks#EmptyState.description"}, "propMap": {"kind.sign-in-unavailable": "./blocks#EmptyState.title", "kind.not-authorized": "./blocks#EmptyState.title", "kind.service-unavailable": "./blocks#EmptyState.title", "kind.sign-out-confirm": "./blocks#EmptyState.title"}, "notes": ["Public EmptyState is the existing fill anchor only; the private runtime boundary-message composition owns the separate status h1 and state metadata. The slot/prop pointers are adaptation endpoints, not an assertion that EmptyState alone accepts this section contract.", "Status and title adapt together to a separate h1 status and the existing block h2 title; no new public Blocks export is introduced.", "All visible and accessible copy is consumer authored. Each optional action requires its label when present and exactly one href or action id. Callback ids require sectionHosts[\"sections.boundary-message\"].onAction; no inert fallback callback is installed.", "The four bounded boundary kinds select host state; sign-out-confirm requires exactly two host-authored controls. No auth, sign-out, navigation, or persistence behavior is implemented.", "Shared deterministic preview copy comes from specimenDataset.sections.errorState and uses a navigation link, so preview needs no live host.", "Draft descriptor; runtime tests are source declarations, not consumer adoption or release clearance."]},
  "error-message": {"export": "ErrorState", "propFiles": ["ErrorState.tsx"], "slotMap": {"status": "./blocks#ErrorState.title", "title": "./blocks#ErrorState.title", "description": "./blocks#ErrorState.description", "actions": "./blocks#ErrorState.retry", "reference": "./blocks#ErrorState.code"}, "propMap": {"kind.not-found": "./blocks#ErrorState.kind=not-found", "kind.error": "./blocks#ErrorState.kind=failure", "kind.global-error": "./blocks#ErrorState.kind=failure"}, "notes": ["Public ErrorState is the existing fill anchor only; the private runtime error-message composition owns the separate status h1 and state metadata. The slot/prop pointers are adaptation endpoints, not an assertion that ErrorState alone accepts this section contract.", "Status and title adapt together to a separate h1 status and the existing block h2 title; no new public Blocks export is introduced.", "All visible and accessible copy is consumer authored. Each optional action requires its label when present and exactly one href or action id. Callback ids require sectionHosts[\"sections.error-message\"].onAction; no inert fallback callback is installed.", "not-found maps to ErrorState kind=not-found; error/global-error map to failure. Global errors are content for a host-owned document/frame, not a document or framework error adapter.", "Shared deterministic preview copy comes from specimenDataset.sections.errorState and uses a navigation link, so preview needs no live host.", "Draft descriptor; runtime tests are source declarations, not consumer adoption or release clearance."]},
  "legal-prose": {"export": "ContentSection", "propFiles": ["ContentSection.tsx"], "slotMap": {"heading": "./blocks#ContentSection.heading", "revision": "./blocks#ContentSection.description", "body": "./blocks#ContentSection.children"}, "propMap": {}, "notes": ["Private runtime composes existing ContentSection plus ArticleBody; ContentSection is the public fill pointer. heading binds to heading; revision {label,value} adapts to description; body typed paragraph/heading/list records adapt to ArticleBody children within ContentSection children. These bindings are adaptation points, not direct JSON prop equivalence.", "The host owns the legal heading, revision label/value and every policy section. A short placeholder is supported while final Writer-authored policy text remains host-owned. The renderer supplies no policy wording beyond isolated specimen preview content.", "Body accepts only paragraph/heading text and lists of text; React escapes text. Unknown node kinds and fields, arbitrary HTML and undeclared inputs are refused. Paragraph/list nodes use dir=auto and body headings render as h3 below the host heading at h2.", "Requires an external Designer SectionFrame; the surrounding page must use a Designer Frame. No legal route, data fetching or document ownership is introduced. Source checks and consumer runtime qualification remain separate."]},
  "account-summary": {"export": "DetailView", "propFiles": ["DetailView.tsx"], "slotMap": {"heading": "./blocks#DetailView.title", "identity": "./blocks#DetailView.fields", "rows": "./blocks#DetailView.fields", "actions": "./blocks#DetailView.actions"}, "propMap": {}, "notes": ["Private runtime composes existing DetailView with Avatar and the default registered Aria Link. heading binds to title; identity {name,nameLabel,email,emailLabel,avatar?} becomes two labelled fields; rows append label/value fields. identity and rows share fields through explicit adaptation, not two direct prop assignments.", "The host owns names, email, field labels/values and optional navigation actions. Optional avatar is a host-provided local or HTTP(S) image source. The renderer supports identity-only content and optional empty row/action lists.", "Actions are ordinary navigation links with consumer-provided label and local path, fragment or HTTP(S) href. No callbacks, auth SDK, Clerk UserProfile, session, network, sign-up, invite or reset behavior is implemented.", "Requires an external Designer SectionFrame inside an app Frame. Text uses dir=auto and is escaped. The default name-derived Avatar fallback comes from the existing component. No new public block or theme allowlist entry; source checks and consumer qualification remain separate."]},
  "activity-feed": mapping("ActivityFeed", { events: "events", grouping: "groups", filters: "filters" }, {}, { notes: ["Each event renders through EventItem; host supplies labels and emptyState. Groups name event ids and every event must sit in exactly one group. Root is section; header and band are external."] }),
  "access-matrix": mapping("AccessMatrix", { roles: "roles", permissions: "groups[].permissions" }, {}, { notes: ["Permissions are grouped; the host also supplies value, labels and optional onChange. The source owns a native table rather than a component table leaf."] }),
  "audit-log": mapping("AuditLog", { entries: "entries", filter: "filter", export: "exportAction" }, {}, { notes: ["Composes DataTable with fixed time, actor, action and target columns; host supplies labels. Filter and export are host regions in the DataTable toolbar; the block never filters or exports rows itself."] }),
  article: mapping("ArticleBody", { body: "children", toc: "toc" }, {}, { notes: ["Accepts pre-structured React children, not a rich-node parser. The toc region is a host node (the registered TableOfContents) laid beside the body from desktop, outside the body typography. Requires an external SectionFrame."] }),
  band: mapping("SectionFrame", {}, { ...values("ground", "ground", ["base", "sunken", "inverse", "transparent"]), ...values("measure", "measure", ["prose", "content", "wide"]) }, { notes: ["SectionFrame alone widens its ground with transparent (no surface, inherited ink); block grounds stay the closed SectionGround. Rhythm is fixed in source, with no specified contract member values."] }),
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
  faq: mapping("Faq", { items: "items" }, values("layout", "layout", ["list", "two-column"]), { notes: ["The layout prop renders one vertical disclosure list or two lists side by side from tablet, first half first; section headings are hand-rendered."] }),
  features: mapping("FeatureGrid", { items: "items" }, values("layout", "layout", ["grid", "list", "split"]), { notes: ["The layout prop selects the column grid, a one-per-row list with the icon beside the copy, or the heading region beside a two-column grid from desktop. Items have icon, heading and description but no per-item link prop."] }),
  "filter-builder": mapping("FilterBuilder", { fields: "fields", operators: "operators", groups: "groups" }, {}, { notes: ["Groups are controlled records of field/operator/value conditions with an all/any match; groups combine as all. Host supplies onGroupsChange and labels and evaluates the conditions; no date-picker or tag-group value editor is claimed."] }),
  gallery: mapping("Gallery", { images: "images,label" }, { "lightbox.enabled": "lightbox=true", "lightbox.disabled": "lightbox=false" }, { notes: ["Images are host nodes with their own alternative text; the lightbox is the Foundry Dialog opened from a React Aria button per image. The images content carries the gallery's accessible label with the images."] }),
  form: mapping("Form", { fields: "children", submit: "actions", "error-summary": "errorSummaryMessage" }, {}, { notes: ["Submit binds to the actions region; the host supplies the submit button. Error-summary content uses the errors and errorSummaryMessage API. Form is a block, not the unavailable components.form leaf."] }),
  hero: mapping("Hero", { header: "heading", media: "media", actions: "actions" }, { ...values("layout", "composition", ["editorial", "split"]), ...values("size", "size", ["display", "compact", "default"]) }, { notes: ["Header is a built-in SectionIntro region keyed by the required heading, with eyebrow and description as supporting props; it is not a replaceable section-header node. Source composes SectionIntro; headingLevel permits h1."] }),
  "link-index": mapping("NavGrid", { links: "items" }, { "layout.cards": "items[cards]" }, { notes: ["CompatNavGrid renders fixed linked/action cards; list and plain-grid modes are absent. No generic Items recipe configuration is invented."] }),
  "logo-hero": mapping("LogoHero", { mark: "mark", name: "name" }, {}, { notes: ["Logo-only section using the existing mark asset and its accessible name; no additional authored copy."] }),
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
  "section-header": mapping("SectionHeader", { eyebrow: "eyebrow", heading: "title", description: "description", actions: "actions", stats: "stats" }, { ...values("align", "align", ["start", "center"]), ...values("density", "density", ["display", "standard", "compact"]) }, { configs: { "level-2": "level=2", "level-3": "level=3", "level-4": "level=4", "level-5": "level=5", "level-6": "level=6" }, notes: ["Heading level is configurable via level; id is inherited HTML input. align and density map to the block's own props; the block enforces no two-action maximum."] }),
  stats: mapping("StatGroup", { stats: "items" }, values("layout", "layout", ["grid", "row"]), { notes: ["Each item renders one Stat (label, value, optional delta/trend and description); no sparkline or meter composition is claimed."] }),
  "status-list": mapping("StatusList", { items: "items", legend: "legendLabel" }, { ...values("status", "items[].state", ["available", "partial", "planned"]), "status.not-offered": "items[].disposition=not-offered" }, { notes: ["Host supplies labels including disposition labels and legendLabel. Not-offered is a separate disposition, never a fourth readiness state."] }),
  steps: mapping("OrderedStepSequence", { steps: "items" }, {}, { notes: ["Steps require authored ordinal and heading; no per-step status member. Source owns its heading and layout."] }),
  "table-of-contents": mapping("TableOfContents", { headings: "items", "active-id": "currentId", label: "label" }, {}, { notes: ["Host supplies label. Items are heading ids/labels; optional scroll tracking is source behavior, not a conformance observation."] }),
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
