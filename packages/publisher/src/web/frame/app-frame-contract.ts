function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Finite host-data options at their actual AppFrameProps paths; null means an omitted inherited direction. */
export const APP_FRAME_CONFIG_SCHEMA = freeze({
  "brand.markInk": { values: ["accent", "image"], default: "accent" },
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
  revision: 1,
  medium: "web",
  adapter: { owner: "@clossys/publisher", subpath: "web/client", export: "AppFrame" },
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
      expandLabel: "Expand navigation", collapseLabel: "Collapse navigation",
    },
  },
  regions: [
    { key: "header", required: true, content: "brand and command/theme controls" },
    { key: "navigation", required: true, content: "navigation.tree" },
    { key: "account", required: true, content: "account.sections", placement: "navigation footer" },
    { key: "main", required: true, content: "children" },
    { key: "right-panel", required: false, content: "rightPanel.children" },
  ],
  hostInputs: [
    "brand", "brand.markSrc", "brand.wordmark", "brand.label", "brand.href",
    "navigation.tree", "navigation.activeId", "navigation.activeHref", "navigation.navigationKey",
    "account.actor", "account.sections", "account.signedOutLabel", "account.contextLabel", "account.triggerLabel", "account.onRoute",
    "commands.groups", "commands.triggerLabel", "commands.heading", "commands.searchLabel", "commands.closeLabel", "commands.emptyMessage",
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
    "supply one chrome-free View as children without another main landmark",
    "supply rightPanel content and numeric resize bounds when the optional panel is present",
    "mount getThemeInitScript in the document head when pre-paint theme initialization is required; match storageKey and defaultTheme to the frame provider",
    "mount the interactive assembly from web/client in a client host",
  ],
  required: [
    "sole-main", "skip-target", "bottom-account-menu", "signed-out-without-actor",
    "host-command-index", "command-shortcut", "persisted-three-state-theme",
    "mobile-navigation-drawer", "resizable-right-panel", "collapsible-right-panel", "narrow-right-panel-drawer",
    "rtl", "forced-colors", "desktop-accent-mark-and-natural-wordmark", "mobile-centered-accent-mark", "original-image-opt-out",
  ],
  behavior: {
    landmarks: "one focusable main with id mainId; skip link targets that same id",
    account: "AccountMenu with a supplied actor; Menu with signedOutLabel and supplied entries when actor is absent",
    commands: "CommandMenu filters host groups; frame owns open/query state; useCommandMenuShortcut supplies platform Ctrl/Cmd+K",
    theme: "ThemeProvider and ThemeToggle persist system/light/dark; system follows the operating-system preference",
    navigation: "one AppNavigation owns the responsive navigation Drawer and bottom account region",
    rightPanel: "optional ResizablePane on wide screens, collapsible to a trigger; end Drawer on narrow screens",
    responsiveQuery: "(min-width: 768px)",
    brand: "desktop accent silhouette with natural text wordmark; mobile centered accent mark; markInk image preserves original artwork",
    accessibility: "logical direction and forced-colors treatment apply to composed chrome and focus indicators",
  },
  constituents: [
    { owner: "@clossys/designer", subpath: "atoms", export: "Button" },
    { owner: "@clossys/designer", subpath: "atoms", export: "Icon" },
    { owner: "@clossys/designer", subpath: "blocks", export: "AppNavigation" },
    { owner: "@clossys/designer", subpath: "blocks", export: "AccountMenu" },
    { owner: "@clossys/designer", subpath: "atoms", export: "Menu" },
    { owner: "@clossys/designer", subpath: "blocks", export: "CommandMenu" },
    { owner: "@clossys/designer", subpath: "blocks", export: "useCommandMenuShortcut" },
    { owner: "@clossys/designer", subpath: "blocks", export: "ResizablePane" },
    { owner: "@clossys/designer", subpath: "blocks", export: "Drawer" },
    { owner: "@clossys/designer", subpath: "theme", export: "ThemeProvider" },
    { owner: "@clossys/designer", subpath: "theme", export: "ThemeToggle" },
    { owner: "@clossys/designer", subpath: "shell", export: "SkipLink" },
  ],
  specimen: { owner: "@clossys/publisher", subpath: "web/client", export: "AppFrameSpecimen", source: "src/web/frame/AppFrame.specimen.tsx" },
} as const);
