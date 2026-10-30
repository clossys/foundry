import { TOKENS } from "../tokens/index.js";

/** The inspector docks from the existing tablet (md) breakpoint upward. */
export const INSPECTOR_DOCK_QUERY = "(min-width: " + TOKENS["--breakpoint-tablet"]!.value + ")";

/** The AppFrame right panel's resize bounds, in CSS pixels. */
export type AppFrameRightPanelConfig = Readonly<{ min: number; max: number; defaultValue: number }>;

/** Reads a shipped `--ui-layout-inspector-*` length as the CSS-pixel number the resizable panel takes. */
const inspectorLength = (property: "--ui-layout-inspector-w" | "--ui-layout-inspector-min-w" | "--ui-layout-inspector-max-w"): number =>
  Number.parseFloat(TOKENS[property]!.value);

/**
 * The AppFrame right panel's shipped size preset: the bounds the frame specimen
 * passes as `rightPanel.min`, `rightPanel.max` and `rightPanel.defaultValue`.
 * The values are the `tokens.region-width` inspector members, read from the
 * token source rather than restated here. Designer library columns read their
 * maximum width from this one object rather than copying its numbers.
 */
export const APP_FRAME_RIGHT_PANEL_CONFIG: AppFrameRightPanelConfig = Object.freeze({
  min: inspectorLength("--ui-layout-inspector-min-w"),
  max: inspectorLength("--ui-layout-inspector-max-w"),
  defaultValue: inspectorLength("--ui-layout-inspector-w"),
});
