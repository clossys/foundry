import type { FormatId } from "../formats/contract.js";
import type { CompleteRouteKind } from "../core/route-identities.js";
import type { RouteRegistration, RouteRegistry, RouteSourceExport } from "../core/route-registry.js";
import type { PublisherPlanItem } from "../planning/plan.js";
import type { PublisherChannelId } from "../planning/channel-ids.js";

export type ContentMapSource = { readonly planItemId: string; readonly frameId?: never; readonly sectionIds?: never }
  | { readonly planItemId?: never; readonly frameId: string; readonly sectionIds: readonly string[] };
export type ContentMapEntry = {
  readonly id: string;
  readonly parentId?: string;
  readonly order: number;
  readonly title: string;
  readonly kind: "page" | "slide" | "section" | "group";
  /** Groups and sections are pinnable as well as pages. A named group must be
   * an ancestor group, and pinned descendants require pinned ancestors. */
  readonly pin?: { readonly nav: true; readonly group?: string };
  readonly source: ContentMapSource;
  /** Host icon identity, resolved by the existing frame host port. */
  readonly icon?: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
} & ({ readonly path: string; readonly slug?: never } | { readonly slug: string; readonly path?: never });
export interface ContentMapAction {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  /** Serializable host command identity, never an executable callback. */
  readonly intent: string;
}
export interface ContentMap<F extends FormatId = FormatId> {
  readonly version: 1;
  readonly publicationId: string;
  readonly format: F;
  readonly entries: readonly ContentMapEntry[];
  readonly actions?: readonly ContentMapAction[];
}
export type ContentMapFindingCode = "contract" | "format" | "duplicate-id" | "duplicate-path" | "missing-parent" | "cycle" | "orphan" | "pin" | "web-path" | "depth" | "action-id";
export interface ContentMapFinding {
  readonly severity: "P0";
  readonly code: ContentMapFindingCode;
  readonly path: string;
  readonly entryId?: string;
  readonly message: string;
}
/** Web map hierarchy supports group > page > section; deck hierarchy has two
 * levels. Other concept formats have no invented hierarchy limits. */
export const CONTENT_MAP_MAX_DEPTH = { "web.page.responsive": 3, "deck.16x9": 2 } as const;
export interface ContentMapNavigationNode {
  readonly id: string;
  readonly label: string;
  readonly href?: string;
  readonly icon?: string;
  readonly children?: readonly ContentMapNavigationNode[];
}
export interface ContentMapNavigation {
  readonly tree: readonly ContentMapNavigationNode[];
  readonly activeId: string;
}
export type ContentMapCommand = {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: string;
} & ({ readonly href: string; readonly action?: never } | { readonly href?: never; readonly action: string });
export interface ContentMapCommandGroup { readonly id: string; readonly label: string; readonly items: readonly ContentMapCommand[] }
export interface ContentMapBreadcrumb { readonly id: string; readonly label: string; readonly href?: string }
export interface ContentMapSitemapEntry { readonly url: string }
export interface ContentMapCompleteRoute {
  readonly kind: CompleteRouteKind;
  readonly entry: RouteSourceExport;
  readonly loader: RouteSourceExport;
}
export interface ContentMapRouteOptions {
  readonly consumer: string;
  readonly channel: PublisherChannelId;
  readonly brand: RouteRegistration["brand"];
  /** Source metadata has no duplicated content title, path or navigation order. */
  readonly completeRoutes?: Readonly<Record<string, ContentMapCompleteRoute>>;
  /** Compatibility for existing plan commands. Their route identity/title/path
   * must agree with the map; disagreements are refused, never silently copied. */
  readonly planItems?: readonly Pick<PublisherPlanItem, "id" | "appRouteId" | "completeRoute">[];
  /** Actual registered assemblies for frame/section sources or legacy plans.
   * No projection fabricates an instance binding or source implementation. */
  readonly registrations?: readonly RouteRegistration[];
}
export type ContentMapRoutes = RouteRegistry;
export interface ContentMapSitemapOptions { readonly channel: PublisherChannelId; readonly origin: string }
