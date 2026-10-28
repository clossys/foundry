/** Diagnostics contain destinations and structural paths, never resolved audience copy. */
export interface UnregisteredFrameRoute {
  readonly path: string;
  readonly href: string;
  readonly rule: "unregistered-navigation-route";
}
export interface FrameRouteBoundary {
  readonly registeredPaths: readonly string[];
  readonly report: (finding: UnregisteredFrameRoute) => void;
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Filter host navigation and palette data before copy resolution or rendering. */
export function filterRegisteredFrameRoutes(frame: Readonly<Record<string, unknown>>, boundary: FrameRouteBoundary): Readonly<Record<string, unknown>> {
  const paths = new Set(boundary.registeredPaths);
  const items = (values: readonly unknown[], path: string, commands = false): unknown[] => values.flatMap((value, index) => {
    if (!record(value)) return [value];
    const at = `${path}.${index}`;
    if (typeof value.href === "string") {
      const pathname = value.href.split(/[?#]/, 1)[0]!;
      if (!paths.has(pathname)) {
        boundary.report({ path: `${at}.href`, href: value.href, rule: "unregistered-navigation-route" });
        return [];
      }
    }
    if (Array.isArray(value.children)) {
      const children = items(value.children, `${at}.children`, commands);
      return children.length ? [{ ...value, children }] : [];
    }
    // Commands without a destination may be callback actions.
    return typeof value.href === "string" || commands ? [value] : [];
  });
  const navigation = record(frame.navigation) && Array.isArray(frame.navigation.tree)
    ? { ...frame.navigation, tree: items(frame.navigation.tree, "appFrame.navigation.tree") } : frame.navigation;
  const commands = record(frame.commands) && Array.isArray(frame.commands.groups)
    ? { ...frame.commands, groups: frame.commands.groups.flatMap((group, index) => {
      if (!record(group) || !Array.isArray(group.items)) return [group];
      const children = items(group.items, `appFrame.commands.groups.${index}.items`, true);
      return children.length ? [{ ...group, items: children }] : [];
    }) } : frame.commands;
  return { ...frame, navigation, commands };
}
