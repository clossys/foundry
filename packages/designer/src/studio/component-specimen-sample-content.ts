import type { SpecimenUnavailableReason } from "./preview-outcome.js";
import { specimenDataset as d } from "./specimen-dataset.js";

/**
 * Where each Studio specimen's sample content comes from in the shared synthetic dataset (specimen-dataset.ts).
 * Addresses only: every value here is a dataset node or a value read from one, never an inline array or
 * literal (component-specimen-dataset.test.ts walks them). component-specimen-samples.tsx renders each bound
 * implementation export with it. Foundry entries are keyed by the descriptor's `pin.export`.
 */

/** Props objects for components whose whole input is data. */
export const componentSpecimenProps: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  "./components#Avatar": d.avatar,
  "./components#Banner": d.banner,
  "./components#Calendar": d.dates.calendar,
  "./components#ComboBox": d.combobox,
  "./components#DateField": d.dates.field,
  "./components#Icon": d.icon,
  "./components#Logomark": d.logo,
  "./components#Meter": d.meter,
  "./components#NativeAction": d.nativeAction,
  "./components#NumberField": d.numberField,
  "./components#ProgressBar": d.progress,
  "./components#ResizeHandle": d.resize,
  "./components#SearchField": d.searchField,
  "./components#Select": d.select,
  "./components#SemanticContent": d.semantic,
  "./components#Separator": d.separator,
  "./components#Skeleton": d.skeleton,
  "./components#Slider": d.slider,
  "./components#Spinner": d.spinner,
  "./components#StatusMark": d.statusMark,
  "./components#TextField": d.textField,
  "./charts#AreaChart": d.charts.area,
  "./charts#BarChart": d.charts.bar,
  "./charts#Heatmap": d.charts.heatmap,
  "./charts#LineChart": d.charts.line,
  "./charts#RangeChart": d.charts.range,
  "./charts#ScatterChart": d.charts.scatter,
  "./charts#Sparkline": d.charts.sparkline,
  "./charts#StatusStrip": d.charts.statusStrip,
  "./charts#WaterfallChart": d.charts.waterfall,
};

/** Text content for components that draw their children. */
export const componentSpecimenText: Readonly<Record<string, string>> = {
  "./components#Badge": d.text.badge,
  "./components#Banner": d.text.banner,
  "./components#Button": d.text.action,
  "./components#Checkbox": d.text.checkbox,
  "./components#Link": d.text.link,
  "./components#NativeAction": d.text.draft,
  "./components#SemanticContent": d.text.paragraph,
  "./components#StatusMark": d.text.statusMark,
  "./components#Switch": d.text.switch,
  "./components#ToggleButton": d.text.toggle,
};

/** Labelled items for collection components, drawn with the component's own item parts. */
export const componentSpecimenCollections = {
  "./components#Breadcrumb": d.breadcrumbs,
  "./components#GridList": d.list,
  "./components#Toolbar": d.toolbar,
  "./components#Tree": d.tree,
  "./components#NavigationTree": d.navigation,
  "./components#RadioGroup": d.radio,
  "./components#Tabs": d.tabs,
  "./components#TagGroup": d.tags,
  "./components#ToggleGroup": d.toggles,
  "./components#Disclosure": d.disclosure,
} as const;

/** A sortable table: mixed-type rows under sortable columns, the first a row header. */
export const componentSpecimenTable = d.table;

/** A labelled field around one native input. */
export const componentSpecimenField = d.field;

/** A card's heading and body. */
export const componentSpecimenCard = d.card;

/** A link's destination and the pressable children of FileTrigger and Form. */
export const componentSpecimenActions = { href: d.text.linkHref, upload: d.text.upload, submit: d.text.submit, field: d.textField } as const;

/** A trigger and its content for overlay components, which draw only their trigger at rest. */
export const componentSpecimenOverlays = {
  "./components#Dialog": { trigger: d.dialog.trigger, title: d.dialog.title, content: d.dialog.body },
  "./components#Popover": d.popover,
  "./components#Tooltip": d.tooltip,
  "./components#Menu": d.menu,
} as const;

/** A starting color and a few swatches to pick from. */
export const componentSpecimenColor = d.color;

/**
 * Exports a preview cannot draw from sample data, and why. The toast region renders only the app-wide queue
 * (it takes no queue of its own, so the dataset's toasts cannot reach it); the brand lockup draws the host's own
 * mark asset and wordmark.
 */
export const componentSpecimenUnavailable: Readonly<Record<string, SpecimenUnavailableReason>> = {
  "./shell#Toaster": "needs-host-queue",
  "./shell#Brandmark": "needs-brand-asset",
};

/**
 * Sample content for vendored shadcn@aria source components, keyed by the descriptor's `impl.entry#export`.
 * Drawn with the component's own sibling parts from that module, never a stand-in.
 */
export const componentSpecimenSourceSamples = {
  "components/breadcrumbs/breadcrumb.tsx#Breadcrumb": d.breadcrumbs,
  "components/tabs/tabs.tsx#Tabs": d.tabs,
  "components/radio-group/radio-group.tsx#RadioGroup": d.radio,
  "components/disclosure/accordion.tsx#Accordion": d.disclosure,
  "components/avatar/avatar.tsx#Avatar": d.people[0],
  "components/card/card.tsx#Card": d.card,
  "components/progress-bar/progress.tsx#Progress": d.progress,
  "components/slider/slider.tsx#Slider": d.slider,
  "components/popover/popover.tsx#Popover": { trigger: d.popover.trigger, title: d.popover.label, content: d.popover.content },
  "components/menu/dropdown-menu.tsx#DropdownMenu": d.menu,
  "components/tooltip/tooltip.tsx#Tooltip": d.tooltip,
  "components/dialog/dialog.tsx#Dialog": { title: d.dialog.title, content: d.dialog.body },
  "components/keyboard/kbd.tsx#Kbd": { text: d.text.keyboard },
  "components/badge/badge.tsx#Badge": { text: d.text.badge },
  "components/button/button.tsx#Button": { text: d.text.action },
  "components/switch/switch.tsx#Switch": { text: d.text.switch },
  "components/checkbox/checkbox.tsx#Checkbox": { text: d.text.checkbox },
  "components/toggle-button/toggle.tsx#Toggle": { text: d.text.toggle },
} as const;
