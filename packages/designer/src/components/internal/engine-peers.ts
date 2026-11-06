import reactAriaComponentsPackageJson from "react-aria-components/package.json" with { type: "json" };
import { assertPeerVersion } from "../../internal/peer-version.js";
import { REACT_ARIA_COMPONENTS_DECLARED_RANGE } from "../../internal/declared-peer-ranges.js";

/**
 * The Components-layer headless-engine peer guard for a barrel above
 * Components: checks the installed `react-aria-components` against its
 * declared range, so a layer above reads no headless-engine package itself.
 * `react` is not a headless engine; such a barrel guards it directly.
 */
export function assertEnginePeers(): void {
  assertPeerVersion({
    peer: "react-aria-components",
    declaredRange: REACT_ARIA_COMPONENTS_DECLARED_RANGE,
    foundVersion: reactAriaComponentsPackageJson.version,
  });
}
