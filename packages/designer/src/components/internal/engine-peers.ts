import { version as reactVersion } from "react";
import reactAriaComponentsPackageJson from "react-aria-components/package.json" with { type: "json" };
import { assertPeerVersion } from "../../internal/peer-version.js";
import { REACT_ARIA_COMPONENTS_DECLARED_RANGE, REACT_DECLARED_RANGE } from "../../internal/declared-peer-ranges.js";

/**
 * The Components-layer peer guard for a barrel above Components: checks the
 * installed `react` and `react-aria-components` against the declared ranges,
 * so a layer above reads no headless-engine package itself.
 */
export function assertEnginePeers(): void {
  assertPeerVersion({ peer: "react", declaredRange: REACT_DECLARED_RANGE, foundVersion: reactVersion });
  assertPeerVersion({
    peer: "react-aria-components",
    declaredRange: REACT_ARIA_COMPONENTS_DECLARED_RANGE,
    foundVersion: reactAriaComponentsPackageJson.version,
  });
}
