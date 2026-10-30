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

import { projectNavigation } from "../../content-map/projections.js";
import { contentMapPath } from "../../content-map/check.js";
import type { ContentMap, ContentMapNavigationNode } from "../../content-map/contract.js";
import type { CopyRef, CopyResolver } from "@clossys/writer";
import type { SiteShellInput, SiteFooterInput, SiteLinkInput } from "@clossys/designer/frames";

/** Identity selections only: destinations and words always come from the map. */
export interface SiteShellNavigationOptions {
  readonly activeId: string;
  readonly header: {
    readonly label: CopyRef;
    readonly triggerLabel?: CopyRef;
    readonly closeLabel?: CopyRef;
    readonly entryIds: readonly string[];
    readonly mega?: boolean;
  };
  readonly footerGroupIds: readonly string[];
  /** One projected group becomes the image profile column; bindings contain asset identities only. */
  readonly social?: { readonly groupId: string; readonly imageAssetIds: Readonly<Record<string, string>> };
  readonly actions?: readonly { readonly actionId: string; readonly targetEntryId: string; readonly emphasis?: "primary" | "secondary" | "ghost"; readonly icon?: SiteLinkInput["icon"] }[];
  /** Actual host Writer references, keyed by map identity; never synthesized. */
  readonly entryCopyRefs: Readonly<Record<string, CopyRef>>;
  readonly actionCopyRefs?: Readonly<Record<string, CopyRef>>;
  readonly descriptionCopyRefs?: Readonly<Record<string, CopyRef>>;
  readonly locale?: { readonly label: CopyRef; readonly copyRefs: Readonly<Record<string, CopyRef>> };
  readonly resolveCopy: CopyResolver;
}
export interface SiteShellNavigationProjection {
  readonly nav: NonNullable<SiteShellInput["nav"]>;
  readonly actions: NonNullable<SiteShellInput["actions"]>;
  readonly columns: NonNullable<SiteFooterInput["columns"]>;
  readonly social?: SiteFooterInput["social"];
  readonly locale?: NonNullable<SiteShellInput["header"]>["locale"];
  /** Preserve the declared host command identity alongside its bound map destination. */
  readonly actionBindings: readonly { readonly actionId: string; readonly targetEntryId: string; readonly intent: string }[];
}

/** Bridge the canonical projection into existing frame slots. No routes, copy
 * references, action semantics or parallel navigation hierarchy are invented. */
export function projectSiteShellNavigation(map: ContentMap, options: SiteShellNavigationOptions): SiteShellNavigationProjection {
  const projected = projectNavigation(map, options.activeId);
  const nodes = new Map<string, ContentMapNavigationNode>();
  const collect = (rows: readonly ContentMapNavigationNode[]) => rows.forEach(node => {
    if (nodes.has(node.id)) throw new TypeError("Site navigation identities must be unique");
    nodes.set(node.id, node);
    collect(node.children ?? []);
  });
  collect(projected.tree);
  const unique = (ids: readonly string[]) => {
    if (!Array.isArray(ids) || ids.some(id => typeof id !== "string" || !id.trim()) || new Set(ids).size !== ids.length) throw new TypeError("Site navigation selections must have unique identities");
  };
  unique(options.header.entryIds);
  unique(options.footerGroupIds);
  const copy = (ref: CopyRef | undefined, expected?: string): CopyRef => {
    if (!ref || typeof ref.id !== "string" || !ref.id.trim()) throw new TypeError("An actual Writer copy reference is required");
    const resolution = options.resolveCopy(ref);
    if (!resolution || !resolution.text.trim() || !resolution.recordId || !resolution.revision || resolution.entryId !== ref.id || resolution.ref.id !== ref.id || (expected !== undefined && resolution.text !== expected)) throw new TypeError("Writer copy resolution must match the mapped label and retain record provenance");
    return ref;
  };
  const node = (id: string) => {
    const value = nodes.get(id);
    if (!value) throw new TypeError("Selected navigation identity is absent from projectNavigation");
    return value;
  };
  const link = (value: ContentMapNavigationNode) => {
    if (typeof value.href !== "string" || !value.href) throw new TypeError("A group without a page cannot become a site link");
    return { href: value.href, label: copy(options.entryCopyRefs[value.id], value.label) };
  };
  const nav = {
    label: copy(options.header.label),
    ...(options.header.triggerLabel === undefined ? {} : { triggerLabel: copy(options.header.triggerLabel) }),
    ...(options.header.closeLabel === undefined ? {} : { closeLabel: copy(options.header.closeLabel) }),
    links: options.header.mega ? [] : options.header.entryIds.map(id => ({ ...link(node(id)), ...(id === projected.activeId ? { isCurrent: true } : {}) })),
    ...(options.header.mega ? { mega: options.header.entryIds.map(id => {
      const group = node(id);
      if (group.href || !group.children?.length) throw new TypeError("Mega navigation requires a projected group with destinations");
      const leaves: ContentMapNavigationNode[] = [];
      const visit = (rows: readonly ContentMapNavigationNode[]) => rows.forEach(row => { if (row.href) leaves.push(row); if (row.children) visit(row.children); });
      visit(group.children);
      const features = leaves.filter(row => row.featured);
      if (features.length > 1) throw new TypeError("A mega navigation group accepts one featured destination");
      const grouped = new Map<string, ContentMapNavigationNode[]>();
      for (const row of leaves.filter(row => !row.featured)) {
        const key = row.group ?? id;
        grouped.set(key, [...(grouped.get(key) ?? []), row]);
      }
      if (!grouped.size) throw new TypeError("Mega navigation needs ordinary link columns");
      const featured = features[0];
      return { id, label: copy(options.entryCopyRefs[id], group.label), columns: [...grouped].map(([key, values]) => {
        const heading = map.entries.find(entry => entry.id === key);
        if (heading?.kind !== "group") throw new TypeError("Mega column heading must reference a mapped group");
        return { heading: copy(options.entryCopyRefs[key], heading.title), links: values.map(value => ({ ...link(value), ...(value.id === projected.activeId ? { isCurrent: true } : {}) })) };
      }), ...(featured ? { featured: { ...link(featured), ...(featured.description === undefined ? {} : { description: copy(options.descriptionCopyRefs?.[featured.id], featured.description) }) } } : {}) };
    }) } : {}),
  };
  const columns = options.footerGroupIds.map(id => {
    const value = node(id), entry = map.entries.find(entry => entry.id === id);
    if (entry?.kind !== "group" || value.href !== undefined || !value.children?.length) throw new TypeError("Footer columns require projected groups without pages");
    return { heading: copy(options.entryCopyRefs[id], value.label), links: value.children.map(link) };
  });
  let social: SiteFooterInput["social"];
  if (options.social !== undefined) {
    const selection = options.social;
    if (Object.keys(selection).some(key => !["groupId", "imageAssetIds"].includes(key))) throw new TypeError("Social bindings accept group and image asset identities only");
    if (options.footerGroupIds.includes(selection.groupId)) throw new TypeError("A social group cannot also render as a plain footer column");
    const value = node(selection.groupId), entry = map.entries.find(entry => entry.id === selection.groupId);
    if (entry?.kind !== "group" || value.href !== undefined || !value.children?.length) throw new TypeError("Social profiles require a projected group without a page");
    if (!record(selection.imageAssetIds) || Object.keys(selection.imageAssetIds).length !== value.children.length
      || Object.keys(selection.imageAssetIds).some(id => !value.children!.some(child => child.id === id))) throw new TypeError("Social image bindings must exactly match the projected group entries");
    social = {
      label: copy(options.entryCopyRefs[value.id], value.label),
      links: value.children.map(child => {
        const assetId = selection.imageAssetIds[child.id];
        if (typeof assetId !== "string" || !assetId.trim() || assetId.trim() !== assetId) throw new TypeError("Each social entry requires a consumer image asset identity");
        return { ...link(child), assetId };
      }),
    };
  }
  const selections = options.actions ?? [];
  unique(selections.map(binding => binding.actionId));
  const actionBindings: { actionId: string; targetEntryId: string; intent: string }[] = [];
  const actions = selections.map(binding => {
    if (Object.keys(binding).some(key => !["actionId", "targetEntryId", "emphasis", "icon"].includes(key))) throw new TypeError("Action bindings accept identities and action presentation only");
    if (binding.emphasis === "primary" && (!Array.isArray(binding.icon) || binding.icon.length === 0)) throw new TypeError("A primary site action requires a supplied consumer icon binding");
    const candidates = (map.actions ?? []).filter(action => action.id === binding.actionId);
    const targets = map.entries.filter(entry => entry.id === binding.targetEntryId);
    if (candidates.length !== 1 || targets.length !== 1) throw new TypeError("An unambiguous map action and target are required");
    const action = candidates[0]!, target = targets[0]!;
    if (target.kind === "group" || target.kind === "slide") throw new TypeError("A site action requires a navigable map destination");
    // Actions can target unpinned entries: pinning controls navigation discovery,
    // not whether a checked map destination can receive a call to action.
    const targetHref = target.kind === "page" || target.kind === "section" ? contentMapPath(target)
      : "href" in target && typeof target.href === "string" ? target.href : undefined;
    if (!targetHref) throw new TypeError("A site action requires a canonical map destination");
    if (!action.intent.trim()) throw new TypeError("A declared map action intent is required");
    actionBindings.push({ actionId: action.id, targetEntryId: target.id, intent: action.intent });
    return { href: targetHref, label: copy(options.actionCopyRefs?.[action.id], action.label), ...(binding.emphasis === undefined ? {} : { emphasis: binding.emphasis }), ...(binding.icon === undefined ? {} : { icon: binding.icon }) };
  });
  const locale = options.locale && projected.alternates ? {
    label: copy(options.locale.label),
    links: projected.alternates.map(alternate => ({ href: alternate.href, locale: alternate.locale, isCurrent: alternate.isCurrent, label: copy(options.locale!.copyRefs[alternate.locale], alternate.label) })),
  } : undefined;
  return { nav, actions, columns, ...(social === undefined ? {} : { social }), ...(locale ? { locale } : {}), actionBindings };
}
