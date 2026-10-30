import { TOKENS } from "../tokens/index.js";

/** Shared technical threshold for AppFrame navigation and contextual sheets. */
export const APP_FRAME_WIDE_QUERY = `(min-width: ${TOKENS["--breakpoint-tablet-lg"]!.value})`;
/** Synthetic queries let the existing navigation Drawer follow measured stage capacity. */
export const APP_FRAME_ALWAYS_WIDE = "all";
export const APP_FRAME_ALWAYS_NARROW = "not all";

/** Local specimen routing keys, not labels or messages. */
export const APP_FRAME_SPECIMEN_COMMAND_IDS = {
  group: "destinations", overview: "overview", projects: "projects", tasks: "tasks",
} as const;

/** Resolve the one main landmark and its skip destination from the same ID. */
export function appFrameMainId(authored: string | undefined, generated: string): string {
  return authored ?? generated + "-main";
}


const variable = (name: keyof typeof TOKENS) => `var(${name})`;
/** Technical layout values, sourced from the existing token registry rather than message defaults. */
export const APP_FRAME_LAYOUT = {
  minimum: Number.parseFloat(TOKENS["--breakpoint-mobile-lg"]!.value),
  sidebarDefault: Number.parseFloat(TOKENS["--ui-layout-sidebar-w"]!.value),
  sidebar: variable("--ui-layout-sidebar-w"),
  tap: variable("--ui-layout-tap-target"),
  gutter: variable("--spacing-md"),
  gap: variable("--spacing-sm"),
  raised: variable("--color-surface-raised"),
  glass: variable("--color-surface-glass"),
  blur: `blur(${variable("--blur-glass")})`,
  barLayer: variable("--ui-z-sticky"),
  controlLayer: variable("--ui-z-shell"),
} as const;

export { APP_FRAME_NAVIGATION_SIZE, APP_FRAME_PANEL_SIZE, APP_FRAME_PANEL_WIDTH_VAR } from "./app-frame-size-classes.js";

/** Reserve only docked panels; opening a panel that cannot leave the minimum stage uses a sheet. */
export function appFramePanels(available: number, wide: boolean, sidebar: number, panel: number, navigationOpen: boolean, panelOpen: boolean) {
  if (!wide) return { navigationOverlay: true, panelOverlay: true };
  const minimum = APP_FRAME_LAYOUT.minimum;
  const navigationDocked = navigationOpen && available - sidebar >= minimum;
  const panelDocked = panelOpen && available - panel - (navigationDocked ? sidebar : 0) >= minimum;
  return {
    navigationOverlay: navigationOpen ? !navigationDocked : available - sidebar - (panelDocked ? panel : 0) < minimum,
    panelOverlay: panelOpen ? !panelDocked : available - panel - (navigationDocked ? sidebar : 0) < minimum,
  };
}

/** Position the existing modal close over the actual opener, including an embedded frame offset. */
export function appFrameCorner(element: HTMLElement, direction: "ltr" | "rtl") {
  const rect = element.getBoundingClientRect();
  return { position: "fixed" as const, direction, insetBlockStart: rect.top,
    insetInlineStart: direction === "rtl" ? `calc(100% - ${rect.right}px)` : rect.left, insetInlineEnd: "auto" as const };
}
