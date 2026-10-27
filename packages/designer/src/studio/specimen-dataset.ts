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

/**
 * The one shared, deterministic synthetic dataset every Studio component specimen draws from. Data only:
 * component-specimen-sample-content.ts addresses each component's props into it and
 * component-specimen-samples.tsx renders the real registered fill with them. Nothing here reads the clock or a
 * random source: dates come from {@link SPECIMEN_ANCHOR_DATE} and every generated number from the seeded
 * generator below, evaluated once when the module loads, so each render draws the same values. Shapes follow
 * each component's own prop types. Preview content, never adoption or conformance evidence.
 */

/** The fixed seed every generated number in the dataset derives from. */
export const SPECIMEN_DATASET_SEED = 20260115;
/** The fixed date every date in the dataset is counted from. */
export const SPECIMEN_ANCHOR_DATE = new CalendarDate(2026, 1, 15);

/** mulberry32: a small deterministic generator, so a seed always yields the same sequence. */
function seeded(seed: number): () => number {
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
    order: `#${1001 + index}`,
    customer: person.name,
    status: statuses[index % statuses.length]!,
    items: String(items),
    total: `$${(cents / 100).toFixed(2)}`,
    placed: iso(SPECIMEN_ANCHOR_DATE.subtract({ days: index * 3 })),
  };
});

/** The brand mark, drawn by the identity kit that derives the registered `assets.mark` fill, for the sample name. */
const brandName = "Northwind";
const brandMark = identityStarterSeeds({ name: brandName }, {
  ink: "#1f2937", onInverse: "#ffffff", surfaceBase: "#ffffff", surfaceInverse: "#111827",
  accent: "#2563eb", onAccent: "#ffffff", fontFamily: "sans-serif",
}).mark;

const selectOptions: readonly SelectOption[] = [
  { id: "draft", label: "Draft" },
  { id: "review", label: "In review" },
  { id: "published", label: "Published" },
  { id: "archived", label: "Archived" },
];
const assignees: readonly ComboBoxOption[] = people.slice(0, 5).map(person => ({ id: person.id, label: person.name }));

const visits = series(4, 10, 30), returns = series(4, 4, 14);

export const specimenDataset = {
  seed: SPECIMEN_DATASET_SEED,
  dates: {
    anchor: SPECIMEN_ANCHOR_DATE,
    range: { start: SPECIMEN_ANCHOR_DATE, end: SPECIMEN_ANCHOR_DATE.add({ days: 6 }) },
    calendar: { "aria-label": "Delivery date", defaultFocusedValue: SPECIMEN_ANCHOR_DATE },
    field: { label: "Start date", defaultValue: SPECIMEN_ANCHOR_DATE },
  },
  people,
  avatar: { alt: people[0].name } satisfies AvatarProps,
  avatars: people.slice(0, 3).map(person => ({ alt: person.name }) satisfies AvatarProps),
  /** Assets addressed by their registered asset slot and member. */
  assets: {
    mark: { slot: "assets.mark", member: "positive", name: brandName, svg: brandMark, src: `data:image/svg+xml,${encodeURIComponent(brandMark)}` },
    glyph: { slot: "assets.icon-file-text", glyph: FileText as IconNode },
  },
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
    success: { title: "Order shipped", description: "Order #1001 left the warehouse." },
    warning: { title: "Storage nearly full", description: "4.6 of 5 GB is in use." },
    danger: { title: "Payment failed", description: "The card on file was declined." },
  },
  dialog: {
    trigger: "Open details",
    title: "Order details",
    body: "Order #1001 ships in two days.",
    actions: [{ id: "cancel", label: "Cancel" }, { id: "confirm", label: "Save changes" }],
  },
  popover: { trigger: "Show info", label: "Order info", content: "Updated two days ago." },
  tooltip: { trigger: "Copy link", content: "Copies the page address." },
  menu: { trigger: "Actions", label: "Order actions", items: [{ id: "rename", label: "Rename" }, { id: "duplicate", label: "Duplicate" }, { id: "archive", label: "Archive" }] },
  select: { label: "Status", placeholder: "Choose a status", options: selectOptions, defaultSelectedKey: "review" },
  combobox: { label: "Assignee", placeholder: "Search people", options: assignees },
  list: { label: "Saved notes", items: [{ id: "plan", label: "Planning note" }, { id: "review", label: "Review checklist" }, { id: "launch", label: "Launch plan" }] },
  radio: { label: "Billing plan", defaultValue: "monthly", items: [{ id: "monthly", label: "Monthly" }, { id: "yearly", label: "Yearly" }] },
  tabs: { label: "Order sections", items: [{ id: "summary", label: "Summary", content: "Summary of order #1001." }, { id: "activity", label: "Activity", content: "Shipped by Bram Osei." }] },
  tags: { label: "Labels", items: [{ id: "urgent", label: "Urgent" }, { id: "gift", label: "Gift" }, { id: "wholesale", label: "Wholesale" }] },
  toggles: { label: "Alignment", items: [{ id: "left", label: "Left" }, { id: "center", label: "Center" }, { id: "right", label: "Right" }], defaultSelectedKeys: ["left"] },
  toolbar: { label: "Formatting", items: [{ id: "bold", label: "Bold" }, { id: "italic", label: "Italic" }] },
  breadcrumbs: { items: [{ id: "home", label: "Home", href: "#home" }, { id: "orders", label: "Orders", href: "#orders" }, { id: "current", label: "Order #1001" }] },
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
  card: { title: "Order #1001", content: "Three items, shipped to Ada Park." },
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
  nativeAction: { type: "button" as const },
  color: { label: "Accent color", defaultValue: "hsl(215, 65%, 50%)", swatches: ["hsl(215, 65%, 50%)", "hsl(155, 55%, 40%)", "hsl(30, 75%, 55%)"] },
  charts: {
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
