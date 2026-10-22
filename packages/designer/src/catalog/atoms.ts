import type { AtomEntry, AtomGroupMap, Catalog, CatalogTree } from "./types.js";

/**
 * Atom display tree: the 4 existing L1 groups, 17 L2 groups. The former
 * Inputs family is split by input kind (text entry, choice, number and
 * range, date and time, color, files, form wiring).
 */
export const ATOM_GROUPS: CatalogTree<AtomGroupMap> = [
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

/** Atom leaves. One example entry for now; the full set follows. */
export const ATOM_ENTRIES: readonly AtomEntry[] = [
  {
    id: "act.button",
    label: "Button",
    l1: "interaction",
    l2: "actions",
    export: "Button",
    files: ["src/atoms/Button.tsx", "src/atoms/button-classes.ts"],
    racBase: { kind: "rac", parts: ["Button"] },
    status: "main",
    disposition: "keep",
    lifecycle: "draft",
    ownerReview: "not-yet-reviewed",
    contract: {
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
    },
    notes: ["The icon-end slot is the quiet variant's trailing icon, ChevronRight by default."],
  },
];

export const ATOM_CATALOG: Catalog<"atoms", AtomGroupMap, AtomEntry> = {
  kind: "atoms",
  groups: ATOM_GROUPS,
  entries: ATOM_ENTRIES,
};
