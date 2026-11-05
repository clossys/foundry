import { CalendarDate } from "@internationalized/date";
import type { AvatarProps } from "../components/Avatar.js";
import type { BannerProps } from "../components/Banner.js";
import type { ComboBoxOption } from "../components/ComboBox.js";
import type { LogomarkProps } from "../components/Logomark.js";
import type { MeterProps } from "../components/Meter.js";
import type { ProgressBarProps } from "../components/ProgressBar.js";
import type { SelectOption } from "../components/Select.js";
import type { SkeletonProps } from "../components/Skeleton.js";
import type { SpinnerProps } from "../components/Spinner.js";
import type { StatusMarkTone } from "../components/StatusMark.js";
import type { IconNode } from "../icons/types.js";
import { FileText } from "../icons/FileText.js";
import { identityStarterSeeds } from "../tokens/identity-kit.js";
import { defaultPreset, presetValues, sourceRoster, tokenContract } from "../catalog-core/token-contract.js";
import { oklchToLinearSRGB, parseOklch } from "../tokens/color.js";
import type { AppNavigationProps } from "../blocks/AppNavigation.js";
import type { AccountMenuLink } from "../blocks/account-menu-types.js";
import type { AppNavigationNode } from "../blocks/app-navigation-tree.js";
import type { ChatMessage } from "../blocks/chat/types.js";
import type { CommandMenuGroup } from "../blocks/command-menu-types.js";
import type { MatrixGridProps } from "../blocks/Matrix.js";
import type { ResourceListProps } from "../blocks/ResourceList.js";
import type { StatusListProps } from "../blocks/StatusList.js";
import type { TaskListProps } from "../blocks/TaskList.js";
import type { TreeNode } from "../blocks/tree-model.js";
import type { DetailViewProps } from "../blocks/DetailView.js";
import type { FaqProps } from "../blocks/Faq.js";
import type { FeatureGridProps } from "../blocks/FeatureGrid.js";
import type { NavGridProps } from "../blocks/NavGrid.js";
import type { OrderedStepSequenceProps } from "../blocks/OrderedStepSequence.js";
import type { PeopleGridProps } from "../blocks/PeopleGrid.js";
import type { TableOfContentsProps } from "../blocks/TableOfContents.js";
import type { TestimonialSetProps } from "../blocks/TestimonialSet.js";
import type { PageBarProps } from "../blocks/PageBar.js";
import type { RecordCardsProps } from "../blocks/RecordCards.js";
import type { NoticeListItem } from "../blocks/NoticeList.js";
import type { StatGroupProps } from "../blocks/StatGroup.js";
import { accessMatrixSample } from "../blocks/access-matrix/sample.js";
import { activityFeedSample } from "../blocks/activity-feed/sample.js";
import { auditLogSample } from "../blocks/audit-log/sample.js";
import { columnMapperSample } from "../blocks/column-mapper/sample.js";
import { filterBuilderSample } from "../blocks/filter-builder/sample.js";
import { formWizardSample } from "../blocks/form-wizard/sample.js";
import { settingsSectionSample } from "../blocks/settings-section/sample.js";
import { timelineSample } from "../blocks/timeline/sample.js";
import { usageSummarySample } from "../blocks/usage-summary/sample.js";

/**
 * The one shared, deterministic synthetic dataset every Studio specimen draws from, on all five layers: token
 * sample text and rulers, asset captions and the ratio fixture's geometry, component props, and Section and
 * Frame content. Data only: component-specimen-sample-content.ts and surface-preview-sample-content.ts address
 * into it, and the specimen files render the real registered parts with it. Nothing here reads the clock or a
 * random source: dates come from {@link SPECIMEN_ANCHOR_DATE} and every generated number from the seeded
 * generator below, evaluated once when the module loads, so each render draws the same values. Shapes follow
 * each component's own prop types. Preview content, never adoption or conformance evidence.
 */

/** The fixed seed every generated number in the dataset derives from. */
export const SPECIMEN_DATASET_SEED = 20260115;
/** The fixed date every date in the dataset is counted from. */
export const SPECIMEN_ANCHOR_DATE = new CalendarDate(2026, 1, 15);

/** mulberry32: a small deterministic generator, so a seed always yields the same sequence. The one generator every specimen uses. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const next = seeded(SPECIMEN_DATASET_SEED);
/** A whole number in [min, max], from the seeded sequence. */
const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
const series = (length: number, min: number, max: number) => Array.from({ length }, () => int(min, max));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const iso = (date: CalendarDate) => date.toString();

/** People: the table's customers, the avatars and the combobox's assignees. */
const people = [
  { id: "ada", name: "Ada Park", initials: "AP" },
  { id: "bram", name: "Bram Osei", initials: "BO" },
  { id: "chen", name: "Chen Wu", initials: "CW" },
  { id: "dara", name: "Dara Quinn", initials: "DQ" },
  { id: "emil", name: "Emil Varga", initials: "EV" },
  { id: "fern", name: "Fern Ali", initials: "FA" },
  { id: "gio", name: "Gio Russo", initials: "GR" },
  { id: "hana", name: "Hana Sato", initials: "HS" },
] as const;

const statuses = ["Shipped", "Pending", "Delivered", "Processing"];

/** Eight orders with mixed types: text, a status, a whole number, a currency amount and an ISO date. */
const orderRows = people.map((person, index) => {
  const items = int(1, 12);
  const cents = int(1_500, 240_000);
  return {
    id: `order-${1001 + index}`,
    order: `ORD-${1001 + index}`,
    customer: person.name,
    status: statuses[index % statuses.length]!,
    items: String(items),
    total: `$${(cents / 100).toFixed(2)}`,
    placed: iso(SPECIMEN_ANCHOR_DATE.subtract({ days: index * 3 })),
  };
});

/**
 * The brand mark, drawn by the identity kit that derives the registered `assets.mark` fill, for the sample name.
 * Its inks are the Foundry default preset's own token values, the same starter inputs a fresh library derives from.
 */
const brandName = "Northwind";
const preset = defaultPreset(sourceRoster);
const presetInk = (slot: string, member: string, theme: "light" | "dark" = "light"): string => {
  const value = presetValues(tokenContract, preset, slot)[member]?.[theme];
  if (value === undefined) throw new TypeError(`the default preset has no ${slot}.${member}`);
  return value;
};
/**
 * A preset colour in the form React Aria's colour parser reads: the token's own `oklch()` value, encoded as
 * sRGB hex. The colour picker's swatches are the default preset's first categorical chart colours.
 */
const presetSwatch = (slot: string, member: string, theme: "light" | "dark" = "light"): string => {
  const encode = (linear: number) => Math.round(255 * (linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055));
  return `#${oklchToLinearSRGB(parseOklch(presetInk(slot, member, theme))).map(channel => encode(channel).toString(16).padStart(2, "0")).join("")}`;
};
const chartSwatches = ["1", "2", "3"].map(n => presetSwatch(`themes.chart-${n}`, "default"));
const brandMark = identityStarterSeeds({ name: brandName }, {
  ink: presetInk("themes.foreground", "default"), onInverse: presetInk("themes.primary-foreground", "default"),
  surfaceBase: presetInk("themes.background", "default"), surfaceInverse: presetInk("themes.primary", "default"),
  accent: presetInk("themes.primary", "default"), onAccent: presetInk("themes.primary-foreground", "default"), fontFamily: "sans-serif",
}).mark;

const selectOptions: readonly SelectOption[] = [
  { id: "draft", label: "Draft" },
  { id: "review", label: "In review" },
  { id: "published", label: "Published" },
  { id: "archived", label: "Archived" },
];
const assignees: readonly ComboBoxOption[] = people.slice(0, 5).map(person => ({ id: person.id, label: person.name }));

const visits = series(4, 10, 30), returns = series(4, 4, 14);

/** Token layer: the sample text every text specimen sets, and one true-px ruler per size leaf. */
const tokens = {
  sampleText: "The quick brown fox jumped over the lazy dog",
  /** The two-glyph sample a blur specimen sets behind its glass. */
  glyphs: "Aa",
  /** The motion specimen's play control. */
  playLabel: "Play",
  /** The unit the last ruler tick is labelled in. */
  unit: "px",
  /** A 256px track drawn at a fixed scale per size leaf; the bar is the member's own length times `factor`. */
  rulers: {
    "themes.spacing": { scale: "2:1", factor: 2, ticks: [0, 32, 64, 96, 128] },
  } as Readonly<Record<string, { readonly scale: string; readonly factor: number; readonly ticks: readonly number[] }>>,
} as const;

/** Asset layer: the sizes and captions asset specimens draw, and the ratio fixture's generated landscape. */
const assetSamples = {
  /** The CSS sizes a favicon is drawn at: the tab strip, a high-density tab or bookmark, and a shortcut tile. */
  favicon: { sizes: [16, 32, 48], unit: "px" },
  /** A maskable icon's guaranteed safe zone: a circle of 80 percent of its side, in a 100-unit view box. */
  appIcon: { sizes: [192, 512], safeZoneShare: 0.8, viewBox: 100, dash: "3 2" },
  /** The image an image-ratio specimen crops: a sun and four ridges from its own fixed seed. */
  ratioFixture: {
    seed: 0x5eed,
    viewBox: { width: 1200, height: 800 },
    /** Ridges back to front, each lighter behind the next: aerial perspective on the neutral ramp. */
    ridges: [
      { base: 0.5, amplitude: 0.09, fill: "fill-neutral-300" },
      { base: 0.62, amplitude: 0.08, fill: "fill-neutral-400" },
      { base: 0.74, amplitude: 0.07, fill: "fill-neutral-600" },
      { base: 0.86, amplitude: 0.05, fill: "fill-neutral-800" },
    ],
    samples: 24,
    sun: { x: { from: 0.58, span: 0.16 }, y: { from: 0.26, span: 0.08 }, radius: 0.09 },
    frequencies: [1, 2, 5],
  },
} as const;

/** One order row of the Section data table samples. */
export interface SampleOrder { id: string; customer: string; status: string; total: string }
const sectionOrders = [
  { id: "1042", customer: "Northwind", status: "Shipped", total: "$1,280.00" },
  { id: "1043", customer: "Contoso", status: "Processing", total: "$640.00" },
  { id: "1044", customer: "Fabrikam", status: "Delivered", total: "$2,015.50" },
] satisfies readonly SampleOrder[];

const comparison: MatrixGridProps = {
  arrangement: "grid",
  featured: { column: "team" },
  featuredLabel: "Most popular",
  columns: [{ id: "starter", label: "Starter" }, { id: "team", label: "Team" }, { id: "scale", label: "Scale" }],
  rows: [
    { id: "seats", label: "Seats", cells: { starter: { type: "text", text: "3" }, team: { type: "text", text: "25" }, scale: { type: "text", text: "Unlimited" } } },
    { id: "history", label: "Version history", cells: { starter: { type: "text", text: "7 days" }, team: { type: "text", text: "1 year" }, scale: { type: "text", text: "Unlimited" } } },
    { id: "support", label: "Support", cells: { starter: { type: "text", text: "Email" }, team: { type: "text", text: "Priority" }, scale: { type: "text", text: "Dedicated" } } },
  ],
};

const projectsEmpty = { title: "No projects yet", description: "Create a project to start collecting work in one place." };

const resourceList: Omit<ResourceListProps, "onAction"> = {
  "aria-label": "Projects",
  actionsLabel: text => `Actions for ${text}`,
  emptyState: projectsEmpty,
  items: [
    { id: "launch", textValue: "Spring launch", title: "Spring launch", description: "Campaign pages and assets.", meta: "Updated today" },
    { id: "docs", textValue: "Help centre", title: "Help centre", description: "Guides and reference articles.", meta: "Updated yesterday" },
    { id: "brand", textValue: "Brand refresh", title: "Brand refresh", description: "Logo, colour and type review.", meta: "Updated last week" },
  ],
};

const statusList: StatusListProps = {
  heading: "Coverage",
  legendLabel: "Status",
  labels: { available: "Available", partial: "Partial", planned: "Planned", dispositions: { "not-offered": "Not offered" } },
  groups: [
    { id: "data", heading: "Data", items: [{ id: "reports", label: "Reports", state: "available" }, { id: "exports", label: "Exports", state: "partial" }] },
    { id: "alerts", heading: "Alerts", items: [{ id: "email", label: "Email alerts", state: "available" }, { id: "mobile", label: "Mobile alerts", state: "planned" }] },
  ],
};

/** A task list's progress line: how many of its tasks are done. */
const taskProgress = (done: number, total: number) => `${done} of ${total} done`;
const taskList: TaskListProps = {
  "aria-label": "Launch checklist",
  progressText: taskProgress(2, 4),
  statusLabels: { todo: "To do", "in-progress": "In progress", blocked: "Blocked", done: "Done" },
  emptyState: { title: "No tasks", description: "Add a task to start the checklist." },
  items: [
    { id: "copy", title: "Write page copy", status: "done" },
    { id: "review", title: "Review with legal", status: "done" },
    { id: "assets", title: "Export final assets", status: "in-progress" },
    { id: "publish", title: "Publish the launch page", status: "todo" },
  ],
};

const commandGroups: readonly CommandMenuGroup[] = [
  { id: "go", label: "Go to", items: [{ id: "projects", label: "Open projects", href: "#projects" }, { id: "settings", label: "Open settings", href: "#settings" }] },
  { id: "create", label: "Create", items: [{ id: "new-project", label: "New project", shortcutHint: "N", href: "#new-project" }] },
];
const command = {
  trigger: "Open command menu",
  heading: "Commands",
  searchLabel: "Find a command",
  closeLabel: "Close commands",
  emptyMessage: "No matching commands.",
  groups: commandGroups,
};

const people3 = [
  { id: "ada", name: "Ada Park", role: "Design lead", initials: "AP" },
  { id: "sam", name: "Sam Ortiz", role: "Engineering", initials: "SO" },
  { id: "lee", name: "Lee Chen", role: "Operations", initials: "LC" },
] as const;
const sectionLink = (label: string, href: string) => ({ label, href });

/** Section layer: the content every Studio-owned Section preview renders, by block. Block-owned samples are addressed, not copied. */
const sections = {
  comparison,
  content: {
    eyebrow: "Overview",
    heading: "One place for every project",
    description: "Plans, files and decisions stay together, so the team works from the same page.",
    body: "Start with a template, invite collaborators and publish when the work is ready.",
  },
  dataTable: {
    label: "Recent orders",
    headers: { id: "Order", customer: "Customer", status: "Status", total: "Total" },
    rows: sectionOrders,
    paginationLabel: "Order pages",
  },
  /** Copy for the non-default sample states (vf35): empty, loading, error and long content. */
  states: {
    loadingLabel: "Loading projects",
    error: { title: "Projects could not load", description: "Check your connection, then try again." },
    tableEmpty: { title: "No orders yet", description: "Orders appear here once a customer checks out." },
    longTitle: "Quarterly customer research synthesis for the enterprise onboarding redesign programme",
    longDescription: "Interview notes, survey results and usability findings from every regional team, gathered into one reviewed summary with the decisions each finding led to and the open questions still waiting on an owner.",
    longCustomer: "Northwind Traders International Holdings and Subsidiaries",
    longTotal: "$148,920.75",
    longMeta: "Updated today",
    longOrderId: "1045",
    longResourceId: "research",
  },
  form: {
    heading: "Contact details",
    fields: [{ id: "name", label: "Full name", type: "text" }, { id: "email", label: "Work email", type: "email" }],
    submit: "Save",
  },
  pricing: {
    heading: "Compare plans",
    tiers: [
      { id: "starter", name: "Starter", price: null, features: ["Shared workspace", "Core tools"], cta: "Explore Starter", featured: false, badge: undefined },
      { id: "team", name: "Team", price: null, features: ["Shared workspace", "Team workflows", "Review tools"], cta: "Explore Team", featured: true, badge: "Team workflows" },
      { id: "scale", name: "Scale", price: null, features: ["Shared workspace", "Advanced workflows", "Flexible support"], cta: "Explore Scale", featured: false, badge: undefined },
    ],
  },
  resourceList,
  statusList,
  taskList,
  sheet: {
    heading: "Filters",
    closeLabel: "Close filters",
    trigger: "Open filters",
    body: "Narrow the list by status, owner and date.",
  },
  chat: {
    label: "Support conversation",
    placeholder: "Ask about your workspace",
    messages: [
      { id: "ask", role: "user", content: "How do I invite a teammate to the workspace?", timestamp: "09:41" },
      { id: "answer", role: "assistant", content: "Open Settings, choose Members and select Invite. Enter their work email and pick a role; they get access as soon as they accept.", timestamp: "09:41" },
    ] satisfies readonly ChatMessage[],
    suggestions: ["Change a member's role", "Remove a member"],
  },
  explorer: {
    label: "Project files",
    selectedId: "landing-page",
    defaultExpandedIds: ["campaigns", "spring-launch"],
    tree: [
      { id: "brand", label: "Brand", children: [{ id: "logo", label: "Logo.svg" }, { id: "palette", label: "Colour palette.pdf" }] },
      { id: "campaigns", label: "Campaigns", children: [
        { id: "spring-launch", label: "Spring launch", children: [{ id: "landing-page", label: "Landing page.docx" }, { id: "launch-email", label: "Launch email.docx" }] },
      ] },
      { id: "readme", label: "Read me.md" },
    ] satisfies readonly TreeNode[],
    details: { "landing-page": "Edited today", "launch-email": "Edited yesterday", readme: "Edited last week" } as Readonly<Record<string, string>>,
  },
  hero: {
    eyebrow: "New",
    heading: "Ship pages your whole team can trust",
    description: "Draft, review and publish from one shared workspace, with every change checked before it goes live.",
    primary: "Start free",
    secondary: "Book a demo",
    headingLevel: 2,
  },
  newsletter: {
    label: "Newsletter sign-up",
    emailLabel: "Work email",
    submitLabel: "Subscribe",
    pendingLabel: "Subscribing",
    sentMessage: "Thanks. Check your inbox to confirm your subscription.",
    failedMessage: "We could not subscribe you. Check the address and try again.",
    privacyNote: "One email a month. Unsubscribe at any time.",
    /** The same-origin path the sign-up form posts to. */
    action: "/subscribe",
  },
  command,
  articleBody: { heading: "Getting started", body: "Set up a workspace, invite your team and publish the first page." },
  detailView: {
    title: "Order 1042",
    fields: [{ label: "Customer", value: "Northwind" }, { label: "Status", value: "Shipped" }, { label: "Total", value: "$1,280.00" }, { label: "Placed", value: "12 March 2026" }],
  } satisfies Pick<DetailViewProps, "title" | "fields">,
  emptyState: projectsEmpty,
  faq: {
    heading: "Questions",
    items: [
      { id: "billing", question: "How does billing work?", answer: "You are billed monthly for the seats in use." },
      { id: "cancel", question: "Can I cancel at any time?", answer: "Yes. Your workspace stays readable after cancelling." },
    ],
  } satisfies Pick<FaqProps, "heading" | "items">,
  featureGrid: {
    heading: "Why teams switch",
    items: [
      { id: "fast", heading: "Fast setup", description: "Start from a working default in minutes." },
      { id: "safe", heading: "Safe changes", description: "Every change is checked before it ships." },
      { id: "shared", heading: "Shared library", description: "One source of truth for every product." },
    ],
  } satisfies Pick<FeatureGridProps, "heading" | "items">,
  logoCloud: { names: ["Northwind", "Contoso", "Fabrikam"] },
  mediaFigure: { caption: "The workspace overview", label: "Workspace overview" },
  navGrid: {
    heading: "Explore",
    items: [
      { id: "guides", title: "Guides", description: "Step-by-step walkthroughs.", href: "#guides" },
      { id: "reference", title: "Reference", description: "Every option, in one place.", href: "#reference" },
    ],
  } satisfies NavGridProps,
  orderedSteps: {
    heading: "How it works",
    items: [
      { id: "connect", ordinal: 1, heading: "Connect", description: "Link your data source." },
      { id: "review", ordinal: 2, heading: "Review", description: "Check what will change." },
      { id: "publish", ordinal: 3, heading: "Publish", description: "Ship it to your audience." },
    ],
  } satisfies Pick<OrderedStepSequenceProps, "heading" | "items">,
  pageHeader: { title: "Projects", description: "Everything your team is working on." },
  pagination: { page: 2, pageCount: 8 },
  peopleGrid: { people: people3, columns: 3 } satisfies Pick<PeopleGridProps, "people" | "columns">,
  sectionFrame: { body: "A full-width band that holds one section." },
  sectionHeader: { eyebrow: "Overview", title: "Plan your launch", description: "The pieces you need, in the order you need them." },
  tableOfContents: {
    label: "On this page",
    items: [{ id: "intro", label: "Introduction" }, { id: "setup", label: "Setup" }, { id: "options", label: "Options", level: 3 }],
  } satisfies Pick<TableOfContentsProps, "label" | "items">,
  testimonials: {
    items: [
      { id: "one", quote: "We shipped our redesign in a week.", attributorName: people3[0].name, attributorRole: people3[0].role },
      { id: "two", quote: "Reviews take minutes, not days.", attributorName: people3[1].name, attributorRole: people3[1].role },
    ],
  } satisfies Pick<TestimonialSetProps, "items">,
  pageBar: {
    root: { label: "Workspace" },
    labels: { breadcrumb: "Breadcrumb", collapsedBreadcrumb: "More pages", pageInfo: "Page details", pageActions: "Page actions" },
  } satisfies Pick<PageBarProps, "root" | "labels">,
  callToAction: {
    eyebrow: "Get started",
    title: "Ship your next launch with one library",
    description: "Start free. Invite your team when you are ready.",
    primary: sectionLink("Start free", "#start"),
    secondary: sectionLink("Talk to sales", "#sales"),
  },
  recordCards: {
    records: [
      { id: "brand", title: "Brand refresh", description: "New marks, colour and type for the spring launch.", href: "#brand", badge: { label: "Active", variant: "success" }, meta: "Updated 2 days ago" },
      { id: "docs", title: "Docs site", description: "Guides and reference for the public API.", href: "#docs", badge: { label: "Review", variant: "warning" }, meta: "Updated today" },
      { id: "billing", title: "Billing portal", description: "Self-serve plans and invoices.", href: "#billing", meta: "Updated last week" },
    ],
  } satisfies Pick<RecordCardsProps, "records">,
  consentBanner: {
    title: "Cookies on this site",
    body: "We use analytics cookies to understand how the site is used. You can change your choice at any time.",
    acceptLabel: "Accept analytics",
    rejectLabel: "Reject analytics",
    privacy: sectionLink("Privacy policy", "#privacy"),
  },
  errorState: {
    code: "Error 503",
    title: "This page did not load",
    description: "The service is busy. Your work is saved; try again in a moment.",
    retryLabel: "Try again",
    report: sectionLink("Check service status", "#status"),
  },
  gallery: {
    label: "Workspace screens",
    images: [
      { id: "overview", label: "Workspace overview", caption: "Overview" },
      { id: "editor", label: "Page editor", caption: "Editor" },
      { id: "library", label: "Component library", caption: "Library" },
    ],
  },
  noticeList: {
    label: "Account notices",
    notices: [
      { id: "trial", tone: "warning", title: "Trial ends in 3 days.", message: "Choose a plan to keep your projects.", action: sectionLink("See plans", "#plans") },
      { id: "export", tone: "success", message: "Your export is ready to download." },
      { id: "maintenance", tone: "info", title: "Scheduled maintenance.", message: "Saving is paused on Sunday from 02:00 to 02:30 UTC.", dismissible: false },
    ] satisfies readonly (Omit<NoticeListItem, "action"> & { action?: { label: string; href: string } })[],
  },
  statGroup: {
    "aria-label": "Key figures",
    items: [
      { id: "active", label: "Active users", value: "2,481", delta: "+12%", trend: "up", description: "vs. last 30 days" },
      { id: "conversion", label: "Conversion", value: "3.4%", delta: "-0.2 pts", trend: "down", description: "vs. last 30 days" },
      { id: "revenue", label: "Revenue", value: "$48.2k", delta: "+4%", trend: "up", description: "vs. last 30 days" },
      { id: "churn", label: "Churn", value: "1.1%", delta: "0 pts", trend: "neutral", description: "vs. last 30 days" },
    ],
  } satisfies Pick<StatGroupProps, "aria-label" | "items">,
  /** Samples the blocks own beside their source, addressed here so every Section preview draws from this dataset. */
  accessMatrix: accessMatrixSample,
  activityFeed: activityFeedSample,
  auditLog: auditLogSample,
  columnMapper: columnMapperSample,
  filterBuilder: filterBuilderSample,
  formWizard: formWizardSample,
  settingsSection: settingsSectionSample,
  timeline: timelineSample,
  usageSummary: usageSummarySample,
  /** Chrome the group-b Section renderers draw beside their records (data-grid, audit-log, resource-list, task-list). */
  dataGrid: { label: "Order grid" },
  auditLogExport: { label: "Export entries" },
  resourceListChrome: {
    toolbar: { label: "Project list options", toggles: [{ id: "archived", label: "Show archived" }] },
    paginationLabel: "Project pages",
    selectRowLabel: (name: string) => `Select ${name}`,
  },
  taskProgress,
} as const;

/** A neutral geometric mark: the frame shows the host mark only as an image. */
const SAMPLE_MARK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath fill='currentColor' d='M4 4h24v24H4z'/%3E%3C/svg%3E";

const signInLabel = "Sign in";

/** Frame layer: the content every Studio-owned Frame preview renders. */
const frames = {
  document: { lang: "en", dir: "ltr", title: "Sample document" },
  /** vf34: the app sidebar frame (AppNavigation). */
  appSidebar: {
    label: "Workspace navigation",
    activeId: "projects",
    tree: [
      { id: "workspace", label: "Workspace", children: [{ id: "projects", label: "Projects", href: "#projects" }, { id: "members", label: "Members", href: "#members" }] },
      { id: "billing", label: "Billing", href: "#billing" },
      { id: "settings", label: "Settings", href: "#settings" },
    ],
  } satisfies Pick<AppNavigationProps, "label" | "activeId" | "tree">,
  /** The app sidebar frame's header command. */
  appSidebarHeader: { label: "New page", action: "page.new" },
  /** The app header frame (PageBar): the page bar's own labels plus the page's share command. */
  appHeader: { labels: sections.pageBar.labels, share: { id: "share", label: "Share", action: "page.share" } },
  app: {
    skipLabel: "Skip to content",
    markSrc: SAMPLE_MARK,
    workspace: brandName,
    navigationLabel: "Workspace navigation",
    navigation: [
      { id: "overview", label: "Overview", href: "#overview" },
      { id: "projects", label: "Projects", href: "#projects", children: [{ id: "spring-launch", label: "Spring launch", href: "#spring-launch" }] },
      { id: "reports", label: "Reports", href: "#reports" },
    ] satisfies readonly AppNavigationNode[],
    activeId: "overview",
    page: "Overview",
    actor: { name: people3[0].name, secondaryText: people3[0].role },
    signedOutLabel: signInLabel,
    accountSection: "Account",
    accountSectionId: "account",
    accountEntries: [{ id: "profile", kind: "link", label: "Profile", href: "#profile" }, { id: "preferences", kind: "link", label: "Preferences", href: "#preferences" }] satisfies readonly AccountMenuLink[],
    signOut: { id: "sign-out", kind: "action", label: "Sign out" },
    commands: { ...command, triggerLabel: "Search commands" },
    heading: "Next milestone",
    body: "Review the spring launch pages before Friday's planning session.",
  },
  inspector: {
    label: "Details", handleLabel: "Resize details", closeLabel: "Close details", openLabel: "Show details",
    min: 220, max: 420, defaultValue: 280,
    body: "Selected: Hero heading",
  },
  /** The sheet frame shows the same filters sheet the sheet Section does. */
  sheet: sections.sheet,
  command,
  siteHeader: {
    brand: brandName, homeLabel: `${brandName} home`, nav: sectionLink("Product", "#product"), menuLabel: "Menu",
    actions: [{ id: "sign-in", ...sectionLink(signInLabel, "#sign-in"), variant: "ghost" }, { id: "start", ...sections.callToAction.primary, variant: "primary" }],
  },
  siteFooter: {
    body: `${brandName}, sample footer`,
    columns: [
      { id: "product", heading: "Product", links: [sections.callToAction.primary, sections.callToAction.secondary] },
      { id: "company", heading: "Company", links: [sectionLink("About", "#about"), sectionLink("Contact", "#contact")] },
    ],
  },
} as const;

export const specimenDataset = {
  seed: SPECIMEN_DATASET_SEED,
  dates: {
    anchor: SPECIMEN_ANCHOR_DATE,
    range: { start: SPECIMEN_ANCHOR_DATE, end: SPECIMEN_ANCHOR_DATE.add({ days: 6 }) },
    calendar: { "aria-label": "Delivery date", defaultFocusedValue: SPECIMEN_ANCHOR_DATE },
    field: { label: "Start date", defaultValue: SPECIMEN_ANCHOR_DATE },
    picker: { label: "Due date", triggerLabel: "Choose date", defaultValue: SPECIMEN_ANCHOR_DATE.add({ days: 14 }) },
  },
  people,
  avatar: { alt: people[0].name } satisfies AvatarProps,
  avatars: people.slice(0, 3).map(person => ({ alt: person.name }) satisfies AvatarProps),
  /** Assets addressed by their registered asset slot and member. */
  assets: {
    mark: { slot: "assets.mark", member: "positive", name: brandName, svg: brandMark, src: `data:image/svg+xml,${encodeURIComponent(brandMark)}` },
    glyph: { slot: "assets.icon-file-text", glyph: FileText as IconNode },
    ...assetSamples,
  },
  tokens,
  sections,
  frames,
  logo: { src: `data:image/svg+xml,${encodeURIComponent(brandMark)}`, size: "md", title: brandName } satisfies LogomarkProps,
  icon: { glyph: FileText as IconNode, label: "Document" },
  table: {
    label: "Recent orders",
    columns: [
      { id: "order", label: "Order", allowsSorting: true },
      { id: "customer", label: "Customer", allowsSorting: true },
      { id: "status", label: "Status", allowsSorting: true },
      { id: "items", label: "Items", allowsSorting: true },
      { id: "total", label: "Total", allowsSorting: true },
      { id: "placed", label: "Placed", allowsSorting: true },
    ],
    rows: orderRows,
    sortDescriptor: { column: "placed", direction: "descending" },
  },
  /** One toast per variant, for a toast region that takes a queue. */
  toasts: {
    info: { title: "Sync scheduled", description: "Changes publish at the top of the hour." },
    success: { title: "Order shipped", description: "Order ORD-1001 left the warehouse." },
    warning: { title: "Storage nearly full", description: "4.6 of 5 GB is in use." },
    danger: { title: "Payment failed", description: "The card on file was declined." },
  },
  /** The contained toast region: its label, the cell's show action and which variant's toast that action queues. */
  toaster: { label: "Notifications", trigger: "Show toast", variant: "success" as const },
  dialog: {
    trigger: "Open details",
    title: "Order details",
    body: "Order ORD-1001 ships in two days.",
    actions: [{ id: "cancel", label: "Cancel" }, { id: "confirm", label: "Save changes" }],
  },
  popover: { trigger: "Show info", label: "Order info", content: "Updated two days ago." },
  tooltip: { trigger: "Copy link", content: "Copies the page address." },
  menu: { trigger: "Actions", label: "Order actions", items: [{ id: "rename", label: "Rename" }, { id: "duplicate", label: "Duplicate" }, { id: "archive", label: "Archive" }] },
  select: { label: "Status", placeholder: "Choose a status", options: selectOptions, defaultSelectedKey: "review" },
  combobox: { label: "Assignee", placeholder: "Search people", options: assignees },
  list: { label: "Saved notes", items: [{ id: "plan", label: "Planning note" }, { id: "review", label: "Review checklist" }, { id: "launch", label: "Launch plan" }] },
  radio: { label: "Billing plan", defaultValue: "monthly", items: [{ id: "monthly", label: "Monthly" }, { id: "yearly", label: "Yearly" }] },
  tabs: { label: "Order sections", items: [{ id: "summary", label: "Summary", content: "Summary of order ORD-1001." }, { id: "activity", label: "Activity", content: "Shipped by Bram Osei." }] },
  tags: { label: "Labels", items: [{ id: "urgent", label: "Urgent" }, { id: "gift", label: "Gift" }, { id: "wholesale", label: "Wholesale" }] },
  toggles: { label: "Alignment", items: [{ id: "left", label: "Left" }, { id: "center", label: "Center" }, { id: "right", label: "Right" }], defaultSelectedKeys: ["left"] },
  toolbar: { label: "Formatting", items: [{ id: "bold", label: "Bold" }, { id: "italic", label: "Italic" }] },
  breadcrumbs: { items: [{ id: "home", label: "Home", href: "#home" }, { id: "orders", label: "Orders", href: "#orders" }, { id: "current", label: "Order ORD-1001" }] },
  navigation: { label: "Sections", items: [{ id: "overview", label: "Overview", href: "#overview" }, { id: "settings", label: "Settings", href: "#settings" }] },
  tree: {
    label: "Files",
    items: [
      { id: "docs", label: "Documents", expandLabel: "Toggle Documents", children: [{ id: "invoice", label: "Invoice.pdf", expandLabel: "Toggle Invoice.pdf" }] },
      { id: "media", label: "Media", expandLabel: "Toggle Media", children: [{ id: "cover", label: "Cover.png", expandLabel: "Toggle Cover.png" }] },
    ],
    defaultExpandedKeys: ["docs"],
  },
  disclosure: { items: [{ id: "shipping", label: "Shipping", content: "Ships in two days." }, { id: "returns", label: "Returns", content: "Returns within thirty days." }] },
  card: { title: "Order ORD-1001", content: "Three items, shipped to Ada Park." },
  text: {
    action: "Save changes",
    badge: "New",
    banner: "Your trial ends in three days.",
    checkbox: "Email me updates",
    switch: "Notifications",
    toggle: "Bold",
    link: "View order",
    linkHref: "#order-1001",
    upload: "Upload receipt",
    submit: "Submit",
    keyboard: "⌘K",
    statusMark: "Shipped",
    paragraph: "Plans and notes stay together.",
    draft: "Save draft",
  },
  banner: { variant: "info" } satisfies Pick<BannerProps, "variant">,
  statusMark: { tone: "success" as StatusMarkTone },
  textField: { label: "Project name", placeholder: "Untitled project", description: "Shown on the dashboard." },
  searchField: { label: "Search orders", placeholder: "Order or customer" },
  field: { label: "Project name", description: "Shown on the dashboard." },
  numberField: { label: "Quantity", defaultValue: int(2, 8), minValue: 0, maxValue: 10, incrementLabel: "Increase quantity", decrementLabel: "Decrease quantity" },
  slider: { label: "Volume", defaultValue: int(20, 80) },
  progress: { label: "Upload progress", value: int(30, 90) } satisfies ProgressBarProps,
  meter: { label: "Storage used", value: 3, scaleMax: 5, valueText: "3 of 5 GB", tone: "info" } satisfies Partial<MeterProps>,
  resize: { label: "Resize panel", min: 160, max: 480, value: 280, resetValue: 280 },
  spinner: { label: "Loading orders" } satisfies SpinnerProps,
  skeleton: { shape: "text", "aria-label": "Loading order" } satisfies SkeletonProps,
  separator: { orientation: "horizontal" as const },
  semantic: { as: "p" as const },
  semanticMedia: {
    image: { src: `data:image/svg+xml,${encodeURIComponent(brandMark)}`, alt: brandName, width: 32, height: 32 },
    source: { srcSet: `data:image/svg+xml,${encodeURIComponent(brandMark)} 32w`, type: "image/svg+xml" },
  },
  nativeAction: { type: "button" as const },
  color: { label: "Chart color", defaultValue: chartSwatches[0]!, swatches: chartSwatches },
  charts: {
    /** Row-shaped chart libraries (Recharts): the field each row names its category by, and the frame drawn before measuring. */
    rows: { categoryKey: "category", frame: { width: 320, height: 200 } },
    area: { title: "Weekly visits", x: MONTHS.slice(0, 4), series: [{ name: "Visits", values: visits }, { name: "Returns", values: returns }] },
    bar: { title: "Orders by region", categories: ["North", "South", "East"], series: [{ name: "Orders", values: series(3, 6, 20) }] },
    heatmap: { title: "Activity by day", rows: ["Mon", "Tue", "Wed"], columns: ["Morning", "Midday", "Evening"], values: [series(3, 0, 6), series(3, 0, 6), series(3, 0, 6)] },
    line: { title: "Response time", x: [1, 2, 3, 4], series: [{ name: "Median", values: series(4, 100, 130) }] },
    range: {
      title: "Project schedule", ticks: ["Phase A", "Phase B", "Phase C", "Phase D"],
      rows: [{ id: "design", label: "Design", from: 0, to: 1.5 }, { id: "build", label: "Build", from: 1, to: 3.5 }],
      labels: { table: "Schedule data", category: "Activity", from: "Start", to: "End", status: "State" },
    },
    scatter: {
      title: "Size and cost", labels: { table: "Show values", category: "Item" },
      x: { label: "Size", min: 0, max: 100 }, y: { label: "Cost", min: 0, max: 100 },
      points: ["a", "b", "c"].map((id, index) => ({ id, label: `Item ${id.toUpperCase()}`, x: 20 + index * 25, y: int(20, 80) })),
    },
    sparkline: { title: "Daily signups", values: series(6, 2, 9) },
    statusStrip: { title: "Service status", segments: [{ from: 0, to: 6, status: "ok" }, { from: 6, to: 8, status: "warn" }, { from: 8, to: 12, status: "ok" }] },
    waterfall: {
      title: "Balance change", start: { label: "Opening", value: 100 },
      steps: [{ id: "in", label: "Added", value: int(10, 40) }, { id: "out", label: "Removed", value: -int(5, 25) }], end: { label: "Closing" },
      labels: { table: "Show values", category: "Stage", value: "Amount" },
    },
  },
} as const;

export type SpecimenDataset = typeof specimenDataset;

/** Fixed preset values per theme; changing the Studio theme never mutates a shared specimen. */
export const specimenThemeValues = Object.fromEntries((["light", "dark"] as const).map(theme => [theme, {
  ink: presetInk("themes.foreground", "default", theme),
  surface: presetInk("themes.background", "default", theme),
  accent: presetInk("themes.primary", "default", theme),
  swatches: ["1", "2", "3"].map(n => presetSwatch(`themes.chart-${n}`, "default", theme)),
}])) as Record<"light" | "dark", { ink: string; surface: string; accent: string; swatches: string[] }>;

/** Reproducible interaction fixtures share the same dates, people and labels in both themes. */
export const specimenStateFixtures = {
  default: specimenDataset,
  empty: { ...specimenDataset, people: [], avatars: [], table: { ...specimenDataset.table, rows: [] } },
  disabled: { ...specimenDataset, isDisabled: true },
  loading: { ...specimenDataset, isLoading: true },
  error: { ...specimenDataset, error: specimenDataset.sections.states.error },
  long: { ...specimenDataset, heading: specimenDataset.sections.states.longTitle },
} as const;
export function specimenDatasetFor(theme: "light" | "dark") {
  const values = specimenThemeValues[theme];
  return { ...specimenDataset, theme, themeValues: values,
    color: { ...specimenDataset.color, defaultValue: values.swatches[0]!, swatches: values.swatches } };
}
