/*
 * The docked region size classes live in their own module with no template
 * literals: the compiled-CSS scanner pairs backticks across a file, and the
 * interpolated templates in app-frame-layout.ts would swallow these strings,
 * so their utilities would never be generated.
 */
/**
 * Docked navigation width as classes, not inline style, so a media rule can close it before hydration:
 * server markup assumes a wide stage, and below the overlay breakpoint the docked width is zero and
 * hidden from first paint instead of collapsing once the client measures.
 */
export const APP_FRAME_NAVIGATION_SIZE = {
  docked: "frame-nav-width max-tablet-lg:invisible",
  closed: "frame-region-closed",
} as const;

/** The docked right panel's measured width travels as a custom property; the media-ruled class owns inline-size. */
export const APP_FRAME_PANEL_WIDTH_VAR = "--frame-panel-w";
/** Same first-paint contract as the navigation: below the overlay breakpoint a docked panel is zero wide and hidden. */
export const APP_FRAME_PANEL_SIZE = {
  docked: "frame-panel-width max-tablet-lg:invisible",
  closed: "frame-region-closed",
} as const;
