/**
 * Neutral sample content for Studio previews of structured Foundry Sections and
 * Frames. Data only: surface-preview-samples.tsx renders each real block export
 * with it. Preview content, never adoption or conformance evidence.
 */
import type { AppNavigationProps } from "../blocks/AppNavigation.js";
import type { MatrixGridProps } from "../blocks/Matrix.js";
import type { ResourceListProps } from "../blocks/ResourceList.js";
import type { StatusListProps } from "../blocks/StatusList.js";
import type { TaskListProps } from "../blocks/TaskList.js";

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
