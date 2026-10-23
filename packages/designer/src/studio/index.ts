/**
 * @clossys/designer/studio: the library Studio. A consumer picks, per slot, which source's fill the library uses, sees every
 * candidate in its own values and re-themes the page live. The Studio is interactive only (state, effects and a media query),
 * so it has no `/server` entry. All copy comes from `labels`; reading and saving go through the host's `adapter`.
 */
import { version as reactVersion } from "react";
import reactAriaComponentsPackageJson from "react-aria-components/package.json" with { type: "json" };
import { REACT_ARIA_COMPONENTS_DECLARED_RANGE, REACT_DECLARED_RANGE } from "../internal/declared-peer-ranges.js";
import { assertPeerVersion } from "../internal/peer-version.js";

assertPeerVersion({ peer: "react", declaredRange: REACT_DECLARED_RANGE, foundVersion: reactVersion });
assertPeerVersion({
  peer: "react-aria-components",
  declaredRange: REACT_ARIA_COMPONENTS_DECLARED_RANGE,
  foundVersion: reactAriaComponentsPackageJson.version,
});

export { Studio } from "./Studio.js";
export { StudioProvider } from "./StudioProvider.js";
export { StudioHeader } from "./StudioHeader.js";
export { catalogStudioAdapter } from "./catalog-adapter.js";
export { demoStudioAdapter } from "./demo-adapter.js";
export type { StudioAdapter, StudioLabels, StudioProps, StudioProviderProps, StudioHeaderProps, StudioCanvasProps, StudioPanelInsets } from "./types.js";
