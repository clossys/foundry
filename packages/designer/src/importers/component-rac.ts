import { REACT_ARIA_COMPONENTS_DECLARED_RANGE } from "../internal/declared-peer-ranges.js";
import { RAC_PACKAGE, type ComponentCheckFill } from "../catalog-core/check-components.js";

/**
 * The react-aria-components declaration every catalog descriptor carries (CC3 consumer-singleton check).
 *
 * - `instance` names the package the descriptor binds; the consumer's resolved install is observed separately.
 * - `range` is the descriptor's own direct react-aria-components dependency range (an exact pin becomes the
 *   caret range of that release line), or this package's declared peer range when the descriptor has none.
 * - `peer` is true only when the caller states that the descriptor's package declares react-aria-components
 *   as a peer dependency (this package's own `peerDependencies`, verified by `declared-peer-ranges.test.ts`).
 *   Source descriptors are copied into the consumer and resolve the consumer's own install, so they are never peers.
 */
export function componentRacDeclaration(fill: { deps: ComponentCheckFill["deps"]; impl: { kind: string } }, options: { peer: boolean }): NonNullable<ComponentCheckFill["rac"]> {
  const dependency = fill.deps.find(dep => dep.name === RAC_PACKAGE && !dep.registryItem);
  const range = dependency ? (/^\d+\.\d+\.\d+$/.test(dependency.version) ? `^${dependency.version}` : dependency.version) : REACT_ARIA_COMPONENTS_DECLARED_RANGE;
  return { range, peer: fill.impl.kind === "package" && options.peer, instance: RAC_PACKAGE };
}
