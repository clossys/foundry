import type { SpecimenUnavailableReason } from "./preview-outcome.js";

/**
 * Neutral sample content for Studio specimens of data-driven Foundry components. Data only:
 * component-specimen-samples.tsx renders each bound implementation export with it. Keyed by the
 * Foundry descriptor's `pin.export`. Preview content, never adoption or conformance evidence.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr"] as const;

/** Props objects for components whose whole input is data. */
export const componentSpecimenProps: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  "./components#Avatar": { alt: "Sample Person" },
  "./components#Meter": { label: "Storage used", value: 3, scaleMax: 5, valueText: "3 of 5 GB", tone: "info" },
  "./components#NativeAction": { type: "button" },
  "./components#NumberField": { label: "Quantity", defaultValue: 4, minValue: 0, maxValue: 10, incrementLabel: "Increase quantity", decrementLabel: "Decrease quantity" },
  "./components#ResizeHandle": { label: "Resize panel", min: 160, max: 480, value: 280, resetValue: 280 },
  "./components#SemanticContent": { as: "p" },
  "./charts#AreaChart": { title: "Weekly visits", x: [...MONTHS], series: [{ name: "Visits", values: [12, 18, 15, 22] }, { name: "Returns", values: [6, 8, 9, 11] }] },
  "./charts#BarChart": { title: "Orders by region", categories: ["North", "South", "East"], series: [{ name: "Orders", values: [14, 9, 11] }] },
  "./charts#Heatmap": { title: "Activity by day", rows: ["Mon", "Tue", "Wed"], columns: ["Morning", "Midday", "Evening"], values: [[2, 5, 3], [4, 6, 1], [3, 2, 4]] },
  "./charts#LineChart": { title: "Response time", x: [1, 2, 3, 4], series: [{ name: "Median", values: [120, 110, 125, 105] }] },
  "./charts#RangeChart": {
    title: "Project schedule", ticks: ["Phase A", "Phase B", "Phase C", "Phase D"],
    rows: [{ id: "design", label: "Design", from: 0, to: 1.5 }, { id: "build", label: "Build", from: 1, to: 3.5 }],
    labels: { table: "Schedule data", category: "Activity", from: "Start", to: "End", status: "State" },
  },
  "./charts#ScatterChart": {
    title: "Size and cost", labels: { table: "Show values", category: "Item" },
    x: { label: "Size", min: 0, max: 100 }, y: { label: "Cost", min: 0, max: 100 },
    points: [{ id: "a", label: "Item A", x: 20, y: 30 }, { id: "b", label: "Item B", x: 45, y: 55 }, { id: "c", label: "Item C", x: 70, y: 65 }],
  },
  "./charts#Sparkline": { title: "Daily signups", values: [3, 5, 4, 7, 6, 8] },
  "./charts#StatusStrip": { title: "Service status", segments: [{ from: 0, to: 6, status: "ok" }, { from: 6, to: 8, status: "warn" }, { from: 8, to: 12, status: "ok" }] },
  "./charts#WaterfallChart": {
    title: "Balance change", start: { label: "Opening", value: 100 },
    steps: [{ id: "in", label: "Added", value: 30 }, { id: "out", label: "Removed", value: -20 }], end: { label: "Closing" },
    labels: { table: "Show values", category: "Stage", value: "Amount" },
  },
};

/** Text content for components that draw their children. */
export const componentSpecimenText: Readonly<Record<string, string>> = {
  "./components#NativeAction": "Save draft",
  "./components#SemanticContent": "Plans and notes stay together.",
};

/** Labelled items for collection components, drawn with the component's own item parts. */
export const componentSpecimenCollections = {
  "./components#Breadcrumb": { items: [{ id: "home", label: "Home", href: "#home" }, { id: "projects", label: "Projects", href: "#projects" }, { id: "current", label: "Roadmap" }] },
  "./components#GridList": { label: "Saved notes", items: [{ id: "plan", label: "Planning note" }, { id: "review", label: "Review checklist" }] },
  "./components#Toolbar": { label: "Formatting", items: [{ id: "bold", label: "Bold" }, { id: "italic", label: "Italic" }] },
  "./components#Tree": { label: "Files", items: [{ id: "docs", label: "Documents", expandLabel: "Toggle Documents" }, { id: "media", label: "Media", expandLabel: "Toggle Media" }] },
  "./components#NavigationTree": { label: "Sections", items: [{ id: "overview", label: "Overview", href: "#overview" }, { id: "settings", label: "Settings", href: "#settings" }] },
} as const;

/** A two-column table with a row header. */
export const componentSpecimenTable = {
  label: "Recent orders",
  columns: [{ id: "order", label: "Order" }, { id: "status", label: "Status" }],
  rows: [{ id: "a", order: "Order 1001", status: "Shipped" }, { id: "b", order: "Order 1002", status: "Pending" }],
} as const;

/** A labelled field around one native input. */
export const componentSpecimenField = { label: "Project name", description: "Shown on the dashboard." } as const;

/** A trigger and its content for overlay components, which draw only their trigger at rest. */
export const componentSpecimenOverlays = {
  "./components#Dialog": { trigger: "Open details", content: "Details for the selected project." },
  "./components#Popover": { trigger: "Show info", label: "Project info", content: "Updated two days ago." },
  "./components#Tooltip": { trigger: "Copy link", content: "Copies the page address." },
  "./components#Menu": { trigger: "Actions", items: [{ id: "rename", label: "Rename" }, { id: "archive", label: "Archive" }] },
} as const;

/** A starting color and a few swatches to pick from. */
export const componentSpecimenColor = {
  label: "Accent color",
  defaultValue: "hsl(215, 65%, 50%)",
  swatches: ["hsl(215, 65%, 50%)", "hsl(155, 55%, 40%)", "hsl(30, 75%, 55%)"],
} as const;

/**
 * Exports a preview cannot draw from sample data, and why. The brand lockup draws the host's own mark asset
 * and wordmark.
 */
export const componentSpecimenUnavailable: Readonly<Record<string, SpecimenUnavailableReason>> = {
  "./shell#Brandmark": "needs-brand-asset",
};

/** The Toaster's sample: its region label, the cell's show action and the one toast that action queues. */
export const componentSpecimenToast = {
  label: "Notifications",
  trigger: "Show toast",
  toast: { title: "Changes saved", description: "Your draft is up to date.", variant: "success" },
} as const;

/**
 * Neutral sample content for vendored shadcn@aria source components, keyed by the descriptor's
 * `impl.entry#export`. Drawn with the component's own sibling parts from that module, never a stand-in.
 */
export const componentSpecimenSourceSamples = {
  "components/breadcrumbs/breadcrumb.tsx#Breadcrumb": { items: [{ id: "home", label: "Home", href: "#home" }, { id: "projects", label: "Projects", href: "#projects" }, { id: "current", label: "Overview" }] },
  "components/tabs/tabs.tsx#Tabs": { label: "Sections", items: [{ id: "summary", label: "Summary", content: "Summary content" }, { id: "activity", label: "Activity", content: "Activity content" }] },
  "components/radio-group/radio-group.tsx#RadioGroup": { label: "Plan", defaultValue: "monthly", items: [{ id: "monthly", label: "Monthly" }, { id: "yearly", label: "Yearly" }] },
  "components/disclosure/accordion.tsx#Accordion": { items: [{ id: "shipping", label: "Shipping", content: "Ships in two days." }, { id: "returns", label: "Returns", content: "Returns within thirty days." }] },
  "components/avatar/avatar.tsx#Avatar": { initials: "SP" },
  "components/card/card.tsx#Card": { title: "Card title", content: "Card content" },
  "components/progress-bar/progress.tsx#Progress": { label: "Upload progress", value: 60 },
  "components/slider/slider.tsx#Slider": { label: "Volume", defaultValue: 40 },
  "components/popover/popover.tsx#Popover": { trigger: "Open popover", title: "Popover title", content: "Popover content" },
  "components/menu/dropdown-menu.tsx#DropdownMenu": { label: "Actions", items: [{ id: "edit", label: "Edit item" }, { id: "archive", label: "Archive item" }] },
  "components/tooltip/tooltip.tsx#Tooltip": { trigger: "Show tooltip", content: "Tooltip content" },
  "components/dialog/dialog.tsx#Dialog": { title: "Dialog title", content: "Dialog content" },
} as const;
