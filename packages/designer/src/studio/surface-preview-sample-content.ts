/**
 * Neutral sample content for Studio previews of structured Foundry Sections and
 * Frames. Data only: surface-preview-samples.tsx renders each real block export
 * with it. Preview content, never adoption or conformance evidence.
 */
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

export const comparisonSample: MatrixGridProps = {
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

export const contentSample = {
  eyebrow: "Overview",
  heading: "One place for every project",
  description: "Plans, files and decisions stay together, so the team works from the same page.",
  body: "Start with a template, invite collaborators and publish when the work is ready.",
};

export interface SampleOrder { id: string; customer: string; status: string; total: string }
export const dataTableSample = {
  label: "Recent orders",
  headers: { id: "Order", customer: "Customer", status: "Status", total: "Total" },
  rows: [
    { id: "1042", customer: "Northwind", status: "Shipped", total: "$1,280.00" },
    { id: "1043", customer: "Contoso", status: "Processing", total: "$640.00" },
    { id: "1044", customer: "Fabrikam", status: "Delivered", total: "$2,015.50" },
  ] satisfies readonly SampleOrder[],
};

/**
 * The sample states a host can ask every package preview for (vf35). `default` is the ordinary sample; the
 * others render only for an export whose own props support that state, and every other export stays default.
 */
export const SURFACE_SAMPLE_STATES = ["default", "empty", "loading", "error", "long-content"] as const;
export type SurfaceSampleState = typeof SURFACE_SAMPLE_STATES[number];

/**
 * Copy for the non-default sample states (vf35): empty, loading, error and long content. Only exports whose
 * own props support a state use it (surface-preview-samples.tsx); every other export keeps its default sample.
 */
export const surfaceStateSample = {
  loadingLabel: "Loading projects",
  error: { title: "Projects could not load", description: "Check your connection, then try again." },
  tableEmpty: { title: "No orders yet", description: "Orders appear here once a customer checks out." },
  longTitle: "Quarterly customer research synthesis for the enterprise onboarding redesign programme",
  longDescription: "Interview notes, survey results and usability findings from every regional team, gathered into one reviewed summary with the decisions each finding led to and the open questions still waiting on an owner.",
  longCustomer: "Northwind Traders International Holdings and Subsidiaries",
  longTotal: "$148,920.75",
  longMeta: "Updated today",
};

export const formSample = {
  heading: "Contact details",
  fields: [{ id: "name", label: "Full name", type: "text" }, { id: "email", label: "Work email", type: "email" }],
  submit: "Save",
};

export const pricingSample = {
  heading: "Plans",
  tiers: [
    { id: "starter", name: "Starter", price: "$0", features: ["3 seats", "Email support"], cta: "Start free", featured: false, badge: undefined },
    { id: "team", name: "Team", price: "$24", features: ["25 seats", "Version history", "Priority support"], cta: "Choose Team", featured: true, badge: "Most popular" },
    { id: "scale", name: "Scale", price: "Contact us", features: ["Unlimited seats", "Dedicated support"], cta: "Talk to sales", featured: false, badge: undefined },
  ],
};

export const resourceListSample: Omit<ResourceListProps, "onAction"> = {
  "aria-label": "Projects",
  actionsLabel: text => `Actions for ${text}`,
  emptyState: { title: "No projects yet", description: "Create a project to start collecting work in one place." },
  items: [
    { id: "launch", textValue: "Spring launch", title: "Spring launch", description: "Campaign pages and assets.", meta: "Updated today" },
    { id: "docs", textValue: "Help centre", title: "Help centre", description: "Guides and reference articles.", meta: "Updated yesterday" },
    { id: "brand", textValue: "Brand refresh", title: "Brand refresh", description: "Logo, colour and type review.", meta: "Updated last week" },
  ],
};

export const statusListSample: StatusListProps = {
  heading: "Coverage",
  legendLabel: "Status",
  labels: { available: "Available", partial: "Partial", planned: "Planned", dispositions: { "not-offered": "Not offered" } },
  groups: [
    { id: "data", heading: "Data", items: [{ id: "reports", label: "Reports", state: "available" }, { id: "exports", label: "Exports", state: "partial" }] },
    { id: "alerts", heading: "Alerts", items: [{ id: "email", label: "Email alerts", state: "available" }, { id: "mobile", label: "Mobile alerts", state: "planned" }] },
  ],
};

export const taskListSample: TaskListProps = {
  "aria-label": "Launch checklist",
  progressText: "2 of 4 done",
  statusLabels: { todo: "To do", "in-progress": "In progress", blocked: "Blocked", done: "Done" },
  emptyState: { title: "No tasks", description: "Add a task to start the checklist." },
  items: [
    { id: "copy", title: "Write page copy", status: "done" },
    { id: "review", title: "Review with legal", status: "done" },
    { id: "assets", title: "Export final assets", status: "in-progress" },
    { id: "publish", title: "Publish the launch page", status: "todo" },
  ],
};

export const sheetSample = {
  heading: "Filters",
  closeLabel: "Close filters",
  trigger: "Open filters",
  body: "Narrow the list by status, owner and date.",
};

/** vf34: the app sidebar frame (AppNavigation). Kept in its own block. */
export const appSidebarSample = {
  label: "Workspace navigation",
  activeId: "projects",
  tree: [
    { id: "workspace", label: "Workspace", children: [{ id: "projects", label: "Projects", href: "#projects" }, { id: "members", label: "Members", href: "#members" }] },
    { id: "billing", label: "Billing", href: "#billing" },
    { id: "settings", label: "Settings", href: "#settings" },
  ],
} as const satisfies Pick<AppNavigationProps, "label" | "activeId" | "tree">;

export const chatSample = {
  label: "Support conversation",
  placeholder: "Ask about your workspace",
  messages: [
    { id: "ask", role: "user", content: "How do I invite a teammate to the workspace?", timestamp: "09:41" },
    { id: "answer", role: "assistant", content: "Open Settings, choose Members and select Invite. Enter their work email and pick a role; they get access as soon as they accept.", timestamp: "09:41" },
  ] satisfies readonly ChatMessage[],
  suggestions: ["Change a member's role", "Remove a member"],
};

export const explorerSample = {
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
};

export const heroSample = {
  eyebrow: "New",
  heading: "Ship pages your whole team can trust",
  description: "Draft, review and publish from one shared workspace, with every change checked before it goes live.",
  primary: "Start free",
  secondary: "Book a demo",
};

export const newsletterSample = {
  label: "Newsletter sign-up",
  emailLabel: "Work email",
  submitLabel: "Subscribe",
  pendingLabel: "Subscribing",
  sentMessage: "Thanks. Check your inbox to confirm your subscription.",
  failedMessage: "We could not subscribe you. Check the address and try again.",
  privacyNote: "One email a month. Unsubscribe at any time.",
};

const commandGroups: readonly CommandMenuGroup[] = [
  { id: "go", label: "Go to", items: [{ id: "projects", label: "Open projects", href: "#projects" }, { id: "settings", label: "Open settings", href: "#settings" }] },
  { id: "create", label: "Create", items: [{ id: "new-project", label: "New project", shortcutHint: "N", href: "#new-project" }] },
];

export const commandSample = {
  trigger: "Open command menu",
  heading: "Commands",
  searchLabel: "Find a command",
  closeLabel: "Close commands",
  emptyMessage: "No matching commands.",
  groups: commandGroups,
};

/** A neutral geometric mark: the frame shows the host mark only as an image. */
const SAMPLE_MARK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath fill='currentColor' d='M4 4h24v24H4z'/%3E%3C/svg%3E";

export const appFrameSample = {
  markSrc: SAMPLE_MARK,
  workspace: "Northwind",
  navigationLabel: "Workspace navigation",
  navigation: [
    { id: "overview", label: "Overview", href: "#overview" },
    { id: "projects", label: "Projects", href: "#projects", children: [{ id: "spring-launch", label: "Spring launch", href: "#spring-launch" }] },
    { id: "reports", label: "Reports", href: "#reports" },
  ] satisfies readonly AppNavigationNode[],
  activeId: "overview",
  page: "Overview",
  actor: { name: "Ada Park", secondaryText: "Design lead" },
  signedOutLabel: "Sign in",
  accountSection: "Account",
  accountEntries: [{ id: "profile", kind: "link", label: "Profile", href: "#profile" }, { id: "preferences", kind: "link", label: "Preferences", href: "#preferences" }] satisfies readonly AccountMenuLink[],
  commands: { ...commandSample, triggerLabel: "Search commands" },
  heading: "Next milestone",
  body: "Review the spring launch pages before Friday's planning session.",
};
