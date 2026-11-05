/**
 * Component fill sources the selection and planning paths may offer or default.
 * Owner rule (2026-10-26): a component renders through a styled layer only, so
 * the allowed sources are shadcn-on-aria, Foundry and consumer-authored fills.
 * The react-aria starter fills stay in the catalog as inspectable upstream
 * bytes, but are never offered, picked or defaulted.
 */
export const NON_SELECTABLE_COMPONENT_SOURCES: ReadonlySet<string> = new Set(["rac-starter"]);

export const NON_SELECTABLE_SOURCE_REASON = "not a selectable component source (shadcn-on-aria, foundry or consumer-authored only)";

export function isSelectableComponentSource(source: string): boolean {
  return !NON_SELECTABLE_COMPONENT_SOURCES.has(source);
}
