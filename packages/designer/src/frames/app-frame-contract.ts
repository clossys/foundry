import { APP_FRAME_WIDE_QUERY } from "./app-frame-layout.js";

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Finite host-data options at their actual AppFrameProps paths; null means an omitted inherited direction. */
export const APP_FRAME_CONFIG_SCHEMA = freeze({
  headerPosition: { values: ["sticky", "static"], default: null, omission: "legacy floating sticky bar" },
  headerSurface: { values: ["solid", "transparent", "glass"], default: null, omission: "legacy adaptive bar paint" },
  "commands.shortcutEnabled": { values: [false, true], default: true },
  "navigation.defaultCollapsed": { values: [false, true], default: false },
  "rightPanel.defaultCollapsed": { values: [false, true], default: false },
  "theme.defaultPreference": { values: ["system", "light", "dark"], default: "system" },
  dir: { values: ["ltr", "rtl"], default: null, omission: "inherit document direction" },
} as const);

/**
 * Source-backed composition metadata, separate from BlockRoleDescriptor and measured role evidence.
 * Public constituent references identify implementation exports and confer no qualification.
 */
export const APP_FRAME_CONTRACT = freeze({
  identity: "app-frame",
  role: "frame",
  revision: 2,
  medium: "web",
  adapter: { owner: "@clossys/designer", subpath: "frames", export: "AppFrame" },
  qualification: { status: "unverified", reasons: ["measurement-required"] },
  use: ["persistent application chrome surrounding one chrome-free View"],
  avoid: ["document bootstrap", "route placement", "identity services", "command indexing services", "nested main landmarks"],
  config: APP_FRAME_CONFIG_SCHEMA,
  defaults: {
    skipLabel: "Skip to content",
    mainId: "generated per instance when omitted",
    themeStorageKey: "ui-theme",
    rightPanelOpenLabel: "Open panel",
    rightPanelCloseLabel: "Close panel",
    navigation: {
      label: "Navigation", emptyMessage: "No destinations available",
      openLabel: "Open navigation", closeLabel: "Close navigation",
    },
  },
  regions: [
    { key: "bar", required: true, content: "title, centered navigation and actions" },
    { key: "page-info", required: false, content: "page.status, description, updatedAt, meta and scope" },
    { key: "navigation", required: true, content: "navigation.tree" },
    { key: "account", required: true, content: "account.sections", placement: "navigation footer" },
    { key: "main", required: true, content: "children" },
    { key: "right-panel", required: false, content: "rightPanel.children" },
    { key: "dock", required: false, content: "leased page modules and notices" },
  ],
  hostInputs: [
    "brand", "brand.markSrc", "brand.wordmark", "brand.label", "brand.href",
    "navigation.tree", "navigation.activeId", "navigation.activeHref", "navigation.navigationKey",
    "account.actor", "account.sections", "account.signedOutLabel", "account.contextLabel", "account.triggerLabel", "account.onRoute",
    "commands.groups", "commands.triggerLabel", "commands.heading", "commands.searchLabel", "commands.closeLabel", "commands.emptyMessage",
    "header", "onNavigate", "notices", "dock", "headerPosition", "headerSurface", "context",
    "page.title", "page.breadcrumb", "page.status", "page.description", "page.updatedAt", "page.meta", "page.actions", "page.scope", "workspaces",
    "breadcrumbLabel", "collapsedBreadcrumbLabel", "pageInfoLabel", "pageActionsLabel",
    "children", "rightPanel.children", "rightPanel.label", "rightPanel.handleLabel", "rightPanel.min", "rightPanel.max", "rightPanel.defaultValue",
    "theme.storageKey", "theme.preferenceLabels", "theme.toggleLabel", "theme.preferenceAnnouncement", "skipLabel", "mainId",
  ],
  statePorts: [
    "navigation.collapsed", "navigation.defaultCollapsed", "navigation.onCollapsedChange",
    "navigation.drawerOpen", "navigation.onDrawerOpenChange",
    "rightPanel.value", "rightPanel.onChange", "rightPanel.step",
    "rightPanel.collapsed", "rightPanel.defaultCollapsed", "rightPanel.onCollapsedChange",
  ],
  hostResponsibilities: [
    "supply resolved brand, navigation, account, command and accessible-label data",
    "own routing, navigation state, command index and all action callbacks",
    "omit account.actor for signed-out presentation; no guest identity is synthesized",
    "supply a definite-height host; stage uses the remaining space after header, side panels and bottom dock",
    "supply context content without main, banner or contentinfo landmarks or a second page h1",
    "supply one chrome-free View as children without another main landmark; when page is supplied, omit the View page header",
    "supply rightPanel content and numeric resize bounds when the optional panel is present",
    "mount getThemeInitScript in the document head when pre-paint theme initialization is required; match storageKey and defaultTheme to the frame provider",
    "mount the interactive assembly from frames in a client host",
  ],
  required: [
    "sole-main", "skip-target", "bottom-account-menu", "signed-out-without-actor",
    "host-command-index", "command-shortcut", "persisted-three-state-theme",
    "mobile-navigation-drawer", "resizable-right-panel", "collapsible-right-panel", "narrow-right-panel-drawer",
    "rtl", "forced-colors", "profile-avatar-mark", "brand-rooted-breadcrumb", "page-owned-heading",
    "positioned-isolated-stage", "page-header-slots",
    "stable-corner-controls", "minimum-center-stage", "page-information-overlay", "single-primary-action",
  ],
  behavior: {
    landmarks: "one focusable main with id mainId; skip link targets that same id",
    account: "AccountMenu with a supplied actor; Menu with signedOutLabel and supplied entries when actor is absent",
    commands: "CommandMenu filters host groups; frame owns open/query state; useCommandMenuShortcut supplies platform Ctrl/Cmd+K",
    theme: "ThemeProvider and ThemeToggle persist system/light/dark; system follows the operating-system preference",
    navigation: "one title-free AppNavigation owns the responsive Drawer; command search is first, account and theme are in the footer; closing removes the full panel without an icon rail",
    rightPanel: "optional ResizablePane when the remaining stage fits its minimum, collapsible to the corner trigger; otherwise an end Drawer",
    layout: "navigation and panel widths push an isolated positioned stage; the header and bottom dock reserve layout space",
    context: "optional host content immediately after brand and before the page trail; the frame preserves supplied accessible controls",
    stage: "full remaining width, positioned and isolated; no page-width switch",
    page: "optional page owns the bar h1, brand-rooted breadcrumb and sibling/workspace menus, optional information overlay and host actions; only the first primary request receives primary styling",
    bar: "sticky within the stage, translucent with supported backdrop blur; opaque for reduced transparency, forced colors or unsupported blur",
    responsiveQuery: APP_FRAME_WIDE_QUERY,
    brand: "existing host mark appears in the profile Avatar; no header brand",
    accessibility: "logical direction and forced-colors treatment apply to composed chrome and focus indicators",
  },
  constituents: [
    { owner: "@clossys/designer", subpath: "blocks", export: "PageBar" },
    { owner: "@clossys/designer", subpath: "components", export: "Button" },
    { owner: "@clossys/designer", subpath: "components", export: "Icon" },
    { owner: "@clossys/designer", subpath: "components", export: "Link" },
    { owner: "@clossys/designer", subpath: "components", export: "Popover" },
    { owner: "@clossys/designer", subpath: "components", export: "Avatar" },
    { owner: "@clossys/designer", subpath: "components", export: "Banner" },
    { owner: "@clossys/designer", subpath: "components", export: "Tooltip" },
    { owner: "@clossys/designer", subpath: "shell", export: "FrameSlotProvider" },
    { owner: "@clossys/designer", subpath: "blocks", export: "AppNavigation" },
    { owner: "@clossys/designer", subpath: "blocks", export: "AccountMenu" },
    { owner: "@clossys/designer", subpath: "components", export: "Menu" },
    { owner: "@clossys/designer", subpath: "blocks", export: "CommandMenu" },
    { owner: "@clossys/designer", subpath: "blocks", export: "useCommandMenuShortcut" },
    { owner: "@clossys/designer", subpath: "blocks", export: "ResizablePane" },
    { owner: "@clossys/designer", subpath: "blocks", export: "Drawer" },
    { owner: "@clossys/designer", subpath: "theme", export: "ThemeProvider" },
    { owner: "@clossys/designer", subpath: "theme", export: "ThemeToggle" },
    { owner: "@clossys/designer", subpath: "shell", export: "SkipLink" },
  ],
  specimen: { owner: "@clossys/designer", subpath: "frames", export: "AppFrameSpecimen", source: "src/frames/AppFrame.specimen.tsx" },
} as const);
