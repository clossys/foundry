/**
 * React Aria is the default headless engine. Another headless engine (for
 * example TanStack Table) is allowed only per component, with a registered
 * exception record here, and must still render through Foundry/Aria styled
 * parts. Enforced by src/render-primitive-imports.test.ts. Empty by design.
 */
export interface HeadlessEngineException {
  /** Module path relative to packages/, e.g. "designer/src/components/DataGrid.tsx". */
  component: string;
  /** The non-Aria engine module specifier the component imports, e.g. "@tanstack/react-table". */
  engine: string;
  /** Why this component needs the other engine. */
  reason: string;
  /** The concrete capability React Aria lacks for it. */
  ariaGap: string;
}

export const HEADLESS_ENGINE_EXCEPTIONS: readonly HeadlessEngineException[] = [];
