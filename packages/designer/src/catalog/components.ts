import type {
  ComponentContract,
  ComponentDisposition,
  ComponentEntry,
  ComponentGroupMap,
  ComponentId,
  ComponentPlacement,
  Catalog,
  CatalogTree,
  RacBase,
  WorkRef,
} from "./types.js";

/**
 * Component display tree: the 4 existing L1 groups, 17 L2 groups. The former
 * Inputs family is split by input kind (text entry, choice, number and
 * range, date and time, color, files, form wiring).
 */
export const COMPONENT_GROUPS: CatalogTree<ComponentGroupMap> = [
  {
    id: "interaction",
    label: "Interaction",
    children: [
      { id: "actions", label: "Actions" },
      { id: "navigation", label: "Navigation" },
      { id: "text-entry", label: "Text entry" },
      { id: "choice", label: "Choice" },
      { id: "number-and-range", label: "Number and range" },
      { id: "date-and-time", label: "Date and time" },
      { id: "color", label: "Color" },
      { id: "files", label: "Files" },
      { id: "form-wiring", label: "Form wiring" },
    ],
  },
  {
    id: "content",
    label: "Content",
    children: [
      { id: "data-display", label: "Data display" },
      { id: "text", label: "Text" },
      { id: "imagery", label: "Imagery" },
      { id: "charts", label: "Charts" },
    ],
  },
  {
    id: "feedback",
    label: "Feedback",
    children: [
      { id: "messages", label: "Messages" },
      { id: "progress-and-loading", label: "Progress and loading" },
    ],
  },
  {
    id: "containment",
    label: "Containment",
    children: [
      { id: "structure", label: "Structure" },
      { id: "overlays", label: "Overlays" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A react-aria-components base, optionally with the lowest release that ships it. */
const rac = (...parts: string[]): RacBase => ({ kind: "rac", parts });
const racFrom = (minVersion: string, ...parts: string[]): RacBase => ({ kind: "rac", parts, minVersion });

/** No react-aria-components base today. */
const none = (reason: "presentational" | "hand-built" | "native-element", mapsTo?: string[]): RacBase =>
  mapsTo === undefined ? { kind: "none", reason } : { kind: "none", reason, mapsTo };

const issue = (number: number): WorkRef => ({ kind: "issue", number });

/** A placement; an L2 from another L1 is a type error. */
const at = <L1 extends keyof ComponentGroupMap>(l1: L1, l2: ComponentGroupMap[L1]): ComponentPlacement =>
  ({ l1, l2 }) as ComponentPlacement;

interface Leaf {
  readonly id: ComponentId;
  readonly label: string;
  readonly racBase: RacBase;
  readonly disposition: ComponentDisposition;
  readonly notes?: readonly string[];
  readonly contract?: ComponentContract;
}

const review = { ownerReview: "not-yet-reviewed" } as const;

/** Built and exported on the default branch. */
const onMain = (place: ComponentPlacement, exportName: string, files: string[], leaf: Leaf): ComponentEntry => ({
  ...leaf,
  ...place,
  ...review,
  export: exportName,
  files,
  status: "main",
  lifecycle: "draft",
});

/** Built, but parked: no react-aria-components base, kept untouched and hidden. */
const parked = (exportName: string, file: string, leaf: Leaf): ComponentEntry => ({
  ...leaf,
  ...at("content", "charts"),
  ...review,
  export: exportName,
  files: [file],
  status: "parked",
  lifecycle: "parked",
});

/** Being built by an open issue or pull request; nothing on the default branch yet. */
const building = (place: ComponentPlacement, ref: WorkRef, leaf: Leaf): ComponentEntry => ({
  ...leaf,
  ...place,
  ...review,
  export: null,
  files: [],
  status: "in-flight",
  inFlight: ref,
  lifecycle: "draft",
});

/** react-aria-components has it and nothing exists here. */
const gap = (place: ComponentPlacement, leaf: Leaf): ComponentEntry => ({
  ...leaf,
  ...place,
  ...review,
  export: null,
  files: [],
  status: "gap",
  lifecycle: "draft",
});

const PRESENTATIONAL = "Presentational exception, pending owner sign-off.";
const DEMAND = "Not now: built when a block or a brand asks for it.";

const BUTTON_CONTRACT: ComponentContract = {
  props: [
    { name: "variant", values: ["primary", "secondary", "ghost", "danger", "outline", "tonal", "quiet"], default: "primary" },
    { name: "size", values: ["sm", "md", "lg"], default: "md" },
    { name: "ground", values: ["base", "sunken", "inverse"], default: "base" },
    { name: "isDisabled", values: [true, false], default: false },
  ],
  variants: ["primary", "secondary", "ghost", "danger", "outline", "tonal", "quiet"],
  sizes: ["sm", "md", "lg"],
  states: ["isHovered", "isFocusVisible", "isDisabled"],
  grounds: ["base", "sunken", "inverse"],
  slots: ["label", "icon-end"],
  tokens: [
    "--color-primary",
    "--color-primary-hover",
    "--color-ink-on-primary",
    "--color-ink-primary",
    "--color-ink-on-inverse",
    "--color-surface-raised",
    "--color-surface-sunken",
    "--color-line-base",
    "--color-status-danger",
    "--color-status-danger-text",
    "--color-control-tonal",
    "--color-control-tonal-hover",
    "--color-control-tonal-inverse",
    "--color-control-tonal-inverse-hover",
    "--color-control-quiet",
    "--color-focus-ring",
    "--radius-md",
    "--text-sm",
    "--text-base",
    "--text-lg",
    "--spacing",
  ],
  a11y: {
    role: "button",
    nameFrom: "children text, or aria-label when the content is an icon",
    keys: [
      { key: "Enter", action: "activate" },
      { key: "Space", action: "activate" },
    ],
  },
  configs: [],
};

// ---------------------------------------------------------------------------
// Leaves: 79 (48 on the default branch, 9 of them parked charts; 14 in flight; 17 gaps)
// ---------------------------------------------------------------------------

const ACTIONS = at("interaction", "actions");
const NAVIGATION = at("interaction", "navigation");
const TEXT_ENTRY = at("interaction", "text-entry");
const CHOICE = at("interaction", "choice");
const NUMBER = at("interaction", "number-and-range");
const DATES = at("interaction", "date-and-time");
const COLOR = at("interaction", "color");
const FILES = at("interaction", "files");
const FORM_WIRING = at("interaction", "form-wiring");
const DATA_DISPLAY = at("content", "data-display");
const TEXT = at("content", "text");
const IMAGERY = at("content", "imagery");
const MESSAGES = at("feedback", "messages");
const PROGRESS = at("feedback", "progress-and-loading");
const STRUCTURE = at("containment", "structure");
const OVERLAYS = at("containment", "overlays");

/** Component leaves, in display order. */
export const COMPONENT_ENTRIES: readonly ComponentEntry[] = [
  // Interaction / Actions
  onMain(ACTIONS, "NativeAction", ["src/components/NativeAction.tsx", "src/components/button-classes.ts"], {
    id: "act.native-action", label: "Native action", racBase: none("native-element", ["button"]), disposition: "keep",
    notes: ["Fixed primary/md/base appearance, native button semantics and explicit type. Local draft capability awaiting owner review; runtime qualification remains separate."],
  }),
  onMain(ACTIONS, "Button", ["src/components/Button.tsx", "src/components/button-classes.ts"], {
    id: "act.button",
    label: "Button",
    racBase: rac("Button"),
    disposition: "keep",
    contract: BUTTON_CONTRACT,
    notes: ["The icon-end slot is the quiet variant's trailing icon, ChevronRight by default."],
  }),
  onMain(ACTIONS, "IconButton", ["src/components/IconButton.tsx", "src/components/button-classes.ts"], {
    id: "act.icon-button",
    label: "Icon button",
    racBase: rac("Button"),
    disposition: "keep",
  }),
  onMain(ACTIONS, "Menu", ["src/components/Menu.tsx"], {
    id: "act.menu",
    label: "Menu",
    racBase: rac("Menu", "MenuItem", "MenuTrigger", "MenuSection", "Header", "Popover", "Separator"),
    disposition: "keep",
  }),
  gap(ACTIONS, {
    id: "act.toolbar",
    label: "Toolbar",
    racBase: rac("Toolbar"),
    disposition: "build-now",
    notes: ["Three existing blocks import the react-aria-components Toolbar directly. First in the build order."],
  }),
  gap(ACTIONS, {
    id: "act.toggle-button",
    label: "Toggle button",
    racBase: rac("ToggleButton"),
    disposition: "build-now",
    notes: ["Only if a toolbar block needs a pressed state; that need is unverified. Sixth in the build order."],
  }),

  // Interaction / Navigation
  onMain(NAVIGATION, "Link", ["src/components/Link.tsx"], {
    id: "act.link",
    label: "Link",
    racBase: rac("Link"),
    disposition: "keep",
  }),
  onMain(NAVIGATION, "Breadcrumb", ["src/components/Breadcrumb.tsx"], {
    id: "act.breadcrumb",
    label: "Breadcrumb",
    racBase: rac("Breadcrumbs", "Breadcrumb", "Link"),
    disposition: "keep",
  }),
  onMain(NAVIGATION, "Tabs", ["src/components/Tabs.tsx"], {
    id: "reveal.tabs",
    label: "Tabs",
    racBase: rac("Tabs", "TabList", "Tab", "TabPanel"),
    disposition: "keep",
  }),
  gap(NAVIGATION, {
    id: "act.navigation-tree",
    label: "Navigation tree",
    racBase: racFrom("1.21.0", "NavigationTree"),
    disposition: "build-now",
    notes: [
      "The app navigation block is a custom tree today. Needs the react-aria-components floor raised. Fourth in the build order.",
    ],
  }),

  // Interaction / Text entry
  onMain(TEXT_ENTRY, "TextField", ["src/components/TextField.tsx"], {
    id: "enter.text-field",
    label: "Text field",
    racBase: rac("TextField", "Input", "Label", "Text", "FieldError"),
    disposition: "keep",
  }),
  onMain(TEXT_ENTRY, "Textarea", ["src/components/Textarea.tsx"], {
    id: "enter.textarea",
    label: "Text area",
    racBase: rac("TextField", "TextArea", "Label", "Text", "FieldError"),
    disposition: "keep",
  }),
  onMain(TEXT_ENTRY, "SearchField", ["src/components/SearchField.tsx"], {
    id: "enter.search-field",
    label: "Search field",
    racBase: rac("SearchField", "Input", "Button", "Label", "Text", "FieldError"),
    disposition: "keep",
  }),
  gap(TEXT_ENTRY, {
    id: "enter.token-field",
    label: "Token field",
    racBase: racFrom("1.21.0", "TokenField"),
    disposition: "not-now",
    notes: [DEMAND],
  }),

  // Interaction / Choice
  onMain(CHOICE, "Checkbox", ["src/components/Checkbox.tsx"], {
    id: "enter.checkbox",
    label: "Checkbox",
    racBase: rac("Checkbox"),
    disposition: "keep",
  }),
  building(CHOICE, issue(2350), {
    id: "enter.checkbox-group",
    label: "Checkbox group",
    racBase: rac("CheckboxGroup"),
    disposition: "finish",
  }),
  onMain(CHOICE, "Switch", ["src/components/Switch.tsx"], {
    id: "enter.switch",
    label: "Switch",
    racBase: rac("Switch"),
    disposition: "keep",
  }),
  onMain(CHOICE, "RadioGroup", ["src/components/RadioGroup.tsx"], {
    id: "enter.radio-group",
    label: "Radio group",
    racBase: rac("RadioGroup", "Radio", "Label", "Text", "FieldError"),
    disposition: "keep",
  }),
  building(CHOICE, issue(2351), {
    id: "enter.segmented-control",
    label: "Segmented control",
    racBase: rac("ToggleButtonGroup", "ToggleButton", "SelectionIndicator"),
    disposition: "finish",
  }),
  onMain(CHOICE, "Select", ["src/components/Select.tsx"], {
    id: "enter.select",
    label: "Select",
    racBase: rac("Select", "SelectValue", "Button", "Popover", "ListBox", "ListBoxItem", "Label", "Text", "FieldError"),
    disposition: "keep",
  }),
  onMain(CHOICE, "ComboBox", ["src/components/ComboBox.tsx"], {
    id: "enter.combo-box",
    label: "Combo box",
    racBase: rac("ComboBox", "Input", "Button", "Popover", "ListBox", "ListBoxItem", "Label", "Text", "FieldError"),
    disposition: "keep",
    notes: ["Autocomplete stays internal."],
  }),
  building(CHOICE, issue(2352), {
    id: "enter.listbox",
    label: "Listbox",
    racBase: rac("ListBox", "ListBoxItem", "ListBoxSection"),
    disposition: "finish",
    notes: ["Whether it ships as a standalone export is unverified."],
  }),
  building(CHOICE, issue(2352), {
    id: "enter.tag-field",
    label: "Tag field",
    racBase: rac("TagGroup", "TagList", "Tag"),
    disposition: "finish",
  }),

  // Interaction / Number and range
  building(NUMBER, issue(2362), {
    id: "enter.number-field",
    label: "Number field",
    racBase: rac("NumberField"),
    disposition: "finish",
  }),
  building(NUMBER, issue(2362), {
    id: "enter.slider",
    label: "Slider",
    racBase: rac("Slider", "SliderTrack", "SliderThumb", "SliderOutput"),
    disposition: "finish",
  }),

  // Interaction / Date and time
  onMain(DATES, "DateField", ["src/components/DateField.tsx"], {
    id: "enter.date-field",
    label: "Date field",
    racBase: rac("DateField", "DateInput", "DateSegment", "Label", "Text", "FieldError"),
    disposition: "keep",
  }),
  building(DATES, issue(2353), {
    id: "enter.time-field",
    label: "Time field",
    racBase: rac("TimeField"),
    disposition: "finish",
  }),
  building(DATES, issue(2353), {
    id: "enter.calendar",
    label: "Calendar",
    racBase: rac(
      "Calendar",
      "CalendarGrid",
      "CalendarGridHeader",
      "CalendarHeaderCell",
      "CalendarGridBody",
      "CalendarCell",
    ),
    disposition: "finish",
  }),
  building(DATES, issue(2353), {
    id: "enter.range-calendar",
    label: "Range calendar",
    racBase: rac("RangeCalendar"),
    disposition: "finish",
  }),
  building(DATES, issue(2353), {
    id: "enter.date-picker",
    label: "Date picker",
    racBase: rac("DatePicker"),
    disposition: "finish",
  }),
  building(DATES, issue(2354), {
    id: "enter.date-range-picker",
    label: "Date range picker",
    racBase: rac("DateRangePicker"),
    disposition: "finish",
  }),

  // Interaction / Color
  gap(COLOR, {
    id: "enter.color-field",
    label: "Color field",
    racBase: rac("ColorField"),
    disposition: "not-now",
    notes: [DEMAND],
  }),
  gap(COLOR, {
    id: "enter.color-picker",
    label: "Color picker",
    racBase: rac("ColorPicker"),
    disposition: "not-now",
  }),
  gap(COLOR, {
    id: "enter.color-area",
    label: "Color area",
    racBase: rac("ColorArea", "ColorThumb"),
    disposition: "not-now",
  }),
  gap(COLOR, {
    id: "enter.color-slider",
    label: "Color slider",
    racBase: rac("ColorSlider", "SliderTrack", "ColorThumb"),
    disposition: "not-now",
  }),
  gap(COLOR, {
    id: "enter.color-wheel",
    label: "Color wheel",
    racBase: rac("ColorWheel", "ColorWheelTrack", "ColorThumb"),
    disposition: "not-now",
  }),
  gap(COLOR, {
    id: "depict.color-swatch",
    label: "Color swatch",
    racBase: rac("ColorSwatch"),
    disposition: "not-now",
    notes: ["The token preview may want it; that is its demand trigger."],
  }),
  gap(COLOR, {
    id: "enter.color-swatch-picker",
    label: "Color swatch picker",
    racBase: rac("ColorSwatchPicker", "ColorSwatchPickerItem"),
    disposition: "not-now",
  }),

  // Interaction / Files
  onMain(FILES, "FileTrigger", ["src/components/FileTrigger.tsx"], {
    id: "enter.file-trigger",
    label: "File trigger",
    racBase: rac("FileTrigger"),
    disposition: "keep",
  }),
  building(FILES, issue(2357), {
    id: "enter.drop-zone",
    label: "Drop zone",
    racBase: rac("DropZone"),
    disposition: "finish",
    notes: ["Used inside the file field block today; exported as an component when that block lands."],
  }),

  // Interaction / Form wiring
  onMain(FORM_WIRING, "Field", ["src/components/Field.tsx"], {
    id: "enter.field",
    label: "Field",
    racBase: none("hand-built"),
    disposition: "remove",
    notes: [
      "Every field component built on react-aria-components already composes Label, Text and FieldError. Folds into those components at the next owner-signed minor.",
    ],
  }),
  gap(FORM_WIRING, {
    id: "enter.form",
    label: "Form",
    racBase: rac("Form"),
    disposition: "build-now",
    notes: ["The form block wraps a native form today. Second in the build order."],
  }),

  // Content / Data display
  onMain(DATA_DISPLAY, "Badge", ["src/components/Badge.tsx"], {
    id: "inform.badge",
    label: "Badge",
    racBase: none("presentational"),
    disposition: "presentational-exception",
    notes: [PRESENTATIONAL, "Parks if the exception is declined. Used by 7 block files."],
  }),
  onMain(DATA_DISPLAY, "Chip", ["src/components/Chip.tsx"], {
    id: "inform.chip",
    label: "Chip",
    racBase: rac("Button"),
    disposition: "keep",
    notes: ["Tag groups cover multi-select tags."],
  }),
  onMain(DATA_DISPLAY, "Meter", ["src/components/Meter.tsx"], {
    id: "inform.meter",
    label: "Meter",
    racBase: none("native-element", ["Meter"]),
    disposition: "map-to-rac",
    notes: ["Renders a native meter element today and imports nothing from react-aria-components."],
  }),
  onMain(DATA_DISPLAY, "Table", ["src/components/Table.tsx"], {
    id: "group.table",
    label: "Table",
    racBase: rac("Table", "TableHeader", "TableBody", "Column", "Row", "Cell"),
    disposition: "keep",
  }),
  onMain(DATA_DISPLAY, "GridList", ["src/components/GridList.tsx"], {
    id: "group.grid-list",
    label: "Grid list",
    racBase: rac("GridList", "GridListItem", "GridListSection", "GridListHeader"),
    disposition: "keep",
  }),
  gap(DATA_DISPLAY, {
    id: "group.tree",
    label: "Tree",
    racBase: rac("Tree", "TreeItem", "TreeItemContent", "TreeSection"),
    disposition: "build-now",
    notes: [
      "The tree block is an org-chart list and the explorer block a custom model today. Third in the build order.",
    ],
  }),

  // Content / Text
  building(TEXT, issue(2382), {
    id: "depict.text",
    label: "Text",
    racBase: rac("Text", "Heading", "Header"),
    disposition: "finish",
  }),
  gap(TEXT, {
    id: "depict.kbd",
    label: "Keyboard key",
    racBase: rac("Keyboard"),
    disposition: "not-now",
    notes: [DEMAND],
  }),

  // Content / Imagery
  onMain(IMAGERY, "Avatar", ["src/components/Avatar.tsx", "src/components/Avatar.server.tsx"], {
    id: "depict.avatar",
    label: "Avatar",
    racBase: none("presentational"),
    disposition: "presentational-exception",
    notes: [PRESENTATIONAL, "Used by the account menu, testimonial and chat blocks."],
  }),
  onMain(IMAGERY, "Icon", ["src/components/Icon.tsx"], {
    id: "depict.icon",
    label: "Icon",
    racBase: none("presentational"),
    disposition: "presentational-exception",
    notes: [PRESENTATIONAL, "Used by 16 block and shell files."],
  }),
  onMain(IMAGERY, "Logomark", ["src/components/Logomark.tsx"], {
    id: "depict.logomark",
    label: "Logomark",
    racBase: none("presentational"),
    disposition: "presentational-exception",
    notes: [PRESENTATIONAL, "Used by the lockup and brandmark blocks."],
  }),

  // Content / Charts (parked; code untouched)
  parked("BarChart", "src/charts/BarChart.tsx", {
    id: "depict.bar-chart",
    label: "Bar chart",
    racBase: none("hand-built"),
    disposition: "park",
    notes: ["Hand-built SVG."],
  }),
  parked("LineChart", "src/charts/LineChart.tsx", {
    id: "depict.line-chart",
    label: "Line chart",
    racBase: none("hand-built"),
    disposition: "park",
  }),
  parked("Sparkline", "src/charts/Sparkline.tsx", {
    id: "depict.sparkline",
    label: "Sparkline",
    racBase: none("hand-built"),
    disposition: "park",
  }),
  parked("WaterfallChart", "src/charts/WaterfallChart.tsx", {
    id: "depict.waterfall-chart",
    label: "Waterfall chart",
    racBase: none("hand-built"),
    disposition: "park",
  }),
  parked("RangeChart", "src/charts/RangeChart.tsx", {
    id: "depict.range-chart",
    label: "Range chart",
    racBase: none("hand-built"),
    disposition: "park",
  }),
  parked("ScatterChart", "src/charts/ScatterChart.tsx", {
    id: "depict.scatter-chart",
    label: "Scatter chart",
    racBase: none("hand-built"),
    disposition: "park",
  }),
  parked("AreaChart", "src/charts/AreaChart.tsx", {
    id: "depict.area-chart",
    label: "Area chart",
    racBase: none("hand-built"),
    disposition: "park",
  }),
  parked("Heatmap", "src/charts/Heatmap.tsx", {
    id: "depict.heatmap",
    label: "Heatmap",
    racBase: none("hand-built"),
    disposition: "park",
  }),
  parked("StatusStrip", "src/charts/StatusStrip.tsx", {
    id: "depict.status-strip",
    label: "Status strip",
    racBase: none("hand-built"),
    disposition: "park",
    notes: ["ChartFrame parks with the set and is not a leaf."],
  }),

  // Feedback / Messages
  onMain(MESSAGES, "Banner", ["src/components/Banner.tsx"], {
    id: "inform.banner",
    label: "Banner",
    racBase: none("native-element", ["Button"]),
    disposition: "map-to-rac",
    notes: ["The dismiss control becomes a react-aria-components Button. The region stays presentational."],
  }),
  onMain(MESSAGES, "StatusMark", ["src/components/StatusMark.tsx"], {
    id: "inform.status-mark",
    label: "Status mark",
    racBase: none("presentational"),
    disposition: "presentational-exception",
    notes: [PRESENTATIONAL, "12 consumers, including the range chart."],
  }),
  onMain(MESSAGES, "Toaster", ["src/shell/Toaster.tsx"], {
    id: "inform.toast",
    label: "Toast",
    racBase: rac("UNSTABLE_ToastRegion", "UNSTABLE_Toast", "UNSTABLE_ToastContent", "Text"),
    disposition: "register",
    notes: [
      "Exported from the shell entry, not the components entry. It stays shell infrastructure and is listed here once for preview.",
    ],
  }),

  // Feedback / Progress and loading
  onMain(PROGRESS, "ProgressBar", ["src/components/ProgressBar.tsx"], {
    id: "inform.progress-bar",
    label: "Progress bar",
    racBase: rac("ProgressBar", "Label"),
    disposition: "keep",
  }),
  onMain(PROGRESS, "Spinner", ["src/components/Spinner.tsx"], {
    id: "inform.spinner",
    label: "Spinner",
    racBase: none("hand-built", ["ProgressBar"]),
    disposition: "map-to-rac",
    notes: ["Maps to an indeterminate react-aria-components ProgressBar."],
  }),
  onMain(PROGRESS, "Skeleton", ["src/components/Skeleton.tsx"], {
    id: "inform.skeleton",
    label: "Skeleton",
    racBase: none("presentational"),
    disposition: "presentational-exception",
    notes: [PRESENTATIONAL, "No block consumer found. Parks if the exception is declined."],
  }),

  // Containment / Structure
  onMain(STRUCTURE, "Card", ["src/components/Card.tsx"], {
    id: "group.card",
    label: "Card",
    racBase: none("presentational"),
    disposition: "presentational-exception",
    notes: [PRESENTATIONAL, "Used by 6 block files. Interactive cards use a stretched react-aria-components Link."],
  }),
  onMain(STRUCTURE, "Separator", ["src/components/Separator.tsx"], {
    id: "group.separator",
    label: "Separator",
    racBase: rac("Separator"),
    disposition: "keep",
  }),
  onMain(STRUCTURE, "Disclosure", ["src/components/Disclosure.tsx"], {
    id: "reveal.disclosure",
    label: "Disclosure",
    racBase: rac("Disclosure", "DisclosurePanel", "Button"),
    disposition: "keep",
  }),
  gap(STRUCTURE, {
    id: "reveal.accordion",
    label: "Accordion",
    racBase: rac("DisclosureGroup"),
    disposition: "build-now",
    notes: ["Only if the FAQ block needs single-open; that need is unverified. Fifth in the build order."],
  }),
  gap(STRUCTURE, {
    id: "group.group",
    label: "Group",
    racBase: rac("Group"),
    disposition: "not-now",
    notes: [DEMAND],
  }),
  onMain(STRUCTURE, "ResizeHandle", ["src/components/ResizeHandle.tsx"], {
    id: "enter.resize-handle",
    label: "Resize handle",
    racBase: none("hand-built", ["Separator", "useMove"]),
    disposition: "decision-pending",
    notes: [
      "Moved here from the inputs: it resizes regions and is not a data input.",
      "Owner decision: rebuild on Separator plus the useMove hook, or park together with the resizable pane block.",
    ],
  }),

  // Containment / Overlays
  onMain(OVERLAYS, "Dialog", ["src/components/Dialog.tsx"], {
    id: "reveal.dialog",
    label: "Dialog",
    racBase: rac("Dialog", "DialogTrigger", "Modal", "ModalOverlay", "Heading"),
    disposition: "keep",
  }),
  onMain(OVERLAYS, "Popover", ["src/components/Popover.tsx"], {
    id: "reveal.popover",
    label: "Popover",
    racBase: rac("Popover", "Dialog", "DialogTrigger"),
    disposition: "keep",
  }),
  onMain(OVERLAYS, "Tooltip", ["src/components/Tooltip.tsx"], {
    id: "reveal.tooltip",
    label: "Tooltip",
    racBase: rac("Tooltip", "TooltipTrigger"),
    disposition: "keep",
  }),
  building(OVERLAYS, issue(2344), {
    id: "reveal.sheet",
    label: "Sheet",
    racBase: racFrom("1.22.1", "Sheet", "SheetTrigger", "SheetOverlay", "SheetContent"),
    disposition: "finish",
    notes: ["The open issue builds an internal sheet on Modal; it is to be re-pointed to the react-aria-components Sheet."],
  }),
  gap(OVERLAYS, {
    id: "reveal.preview-card",
    label: "Preview card",
    racBase: racFrom("1.21.0", "PreviewTrigger"),
    disposition: "not-now",
    notes: [DEMAND],
  }),
];

/**
 * Runtime exports of the components and charts entries that are not leaves, each
 * with the reason. Every other export of those entries is exactly one leaf.
 */
export const COMPONENT_EXPORT_EXCLUSIONS: Readonly<Record<string, string>> = {
  buttonLinkClassName: "Class helper shared by act.button and act.icon-button; not a component.",
  iconButtonClassName: "Class helper shared by act.button and act.icon-button; not a component.",
  iconButtonLinkClassName: "Class helper shared by act.button and act.icon-button; not a component.",
  mergeUiClasses: "Class-merging utility; not a component.",
  COMPONENT_GUIDANCE: "Guidance data for the admin; not a component.",
  COMPONENT_API_FACTS: "Guidance data for the admin; not a component.",
  COMPONENT_DISPLAY_GROUPS: "The earlier component display tree; this catalog supersedes it.",
  COMPONENT_COMPARISON: "Guidance data for the admin; not a component.",
  ChartFrame: "Chart internals: parks with the chart set and is not a leaf.",
};

export const COMPONENT_CATALOG: Catalog<"components", ComponentGroupMap, ComponentEntry> = {
  kind: "components",
  groups: COMPONENT_GROUPS,
  entries: COMPONENT_ENTRIES,
};
