import type { FormatId } from "../formats/contract.js";
import type { CompleteRouteMetadataKind, CompleteRouteMetadata } from "./complete-route-metadata.js";
import type { RouteRegistration, AnyRouteRegistration, RouteSourceExport } from "../core/route-registry.js";
import type { PublisherPlanItem } from "../planning/plan.js";
import type { PublisherChannelId } from "../planning/channel-ids.js";
import type { SectionFill } from "../core/instance-binding.js";
import type { RegisteredPageManifest } from "../content/taxonomy.js";

/** The same slot-addressed Section fills used by page bindings. Library and
 * content-registry resolution still belongs to the registered-page checks. */
export type ContentMapConstructs = Readonly<Record<string, readonly SectionFill[]>>;

export type ContentMapSource = { readonly planItemId: string; readonly frameId?: never; readonly sectionIds?: never }
  | { readonly planItemId?: never; readonly frameId: string; readonly sectionIds: readonly string[] };
export interface ContentMapIndexing { readonly mode: "index" | "noindex"; readonly reason?: string }
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
  /** Optional together for compatibility with route-only maps. Manifest
   * placements address these constructs, never a second hand-built outline. */
  readonly manifest?: RegisteredPageManifest;
  readonly constructs?: ContentMapConstructs;
  /** Host icon identity, resolved by the existing frame host port. */
  readonly icon?: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
  readonly indexing?: ContentMapIndexing;
  /** Consumer-supplied ISO date or timestamp; no implicit build-time clock. */
  readonly lastModified?: string;
  /** Existing group identity used for a navigation column; no extra IA layer. */
  readonly group?: string;
  /** Marks a mapped destination as its navigation group's featured card. */
  readonly featured?: boolean;
  /** Actual translated routes for this page, including its current locale. */
  readonly alternates?: readonly { readonly locale: string; readonly entryId: string; readonly label: string }[];
} & ({ readonly path: string; readonly slug?: never } | { readonly slug: string; readonly path?: never })
  /** A present config narrows sourced entries without admitting external nodes. */
  & ({ readonly pageConfig: string } | { readonly pageConfig?: never });
/** A local redirect identity and an external navigation destination, never an
 * executable page source. Sourced entry contracts retain their required source. */
export type ContentMapExternalEntry = Omit<ContentMapEntry, "kind" | "source" | "path" | "slug" | "pageConfig" | "manifest" | "constructs"> & {
  readonly kind: "external";
  readonly path: string;
  readonly href: string;
  readonly source?: never;
  readonly slug?: never;
  readonly pageConfig?: never;
  readonly manifest?: never;
  readonly constructs?: never;
};
export type ContentMapNode = ContentMapEntry | ContentMapExternalEntry;
export interface ContentMapRedirectDeclaration { readonly from: string; readonly to: string; readonly permanent: boolean }
export interface ContentMapRedirect { readonly source: string; readonly destination: string; readonly permanent: boolean }
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
  readonly entries: readonly ContentMapNode[];
  readonly actions?: readonly ContentMapAction[];
  readonly redirects?: readonly ContentMapRedirectDeclaration[];
}
export type ContentMapFindingCode = "contract" | "format" | "duplicate-id" | "duplicate-path" | "missing-parent" | "cycle" | "orphan" | "pin" | "web-path" | "depth" | "action-id" | "redirect";
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
  readonly external?: true;
  readonly icon?: string;
  readonly children?: readonly ContentMapNavigationNode[];
  readonly group?: string;
  readonly featured?: boolean;
  readonly description?: string;
}
export interface ContentMapNavigation {
  readonly tree: readonly ContentMapNavigationNode[];
  readonly activeId: string;
  readonly alternates?: readonly { readonly locale: string; readonly href: string; readonly label: string; readonly isCurrent: boolean }[];
}
export type ContentMapCommand = {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: string;
} & ({ readonly href: string; readonly action?: never } | { readonly href?: never; readonly action: string });
export interface ContentMapCommandGroup { readonly id: string; readonly label: string; readonly items: readonly ContentMapCommand[] }
export interface ContentMapBreadcrumb { readonly id: string; readonly label: string; readonly href?: string }
/** Ordered publication topology with placement-backed in-page headings. Heading
 * identities are entry ID + "#" + page anchor; validation refuses collisions
 * with entry identities. Hrefs retain the page's real anchors. */
export interface ContentMapOutlineNode extends ContentMapBreadcrumb {
  readonly children?: readonly ContentMapOutlineNode[];
}
/** Depth is structural; no rendered page or slide number is fabricated. */
export interface ContentMapTocEntry extends ContentMapBreadcrumb { readonly level: number }
export interface ContentMapSitemapEntry { readonly url: string; readonly lastModified?: string }
export interface ContentMapStaticParams { readonly slug: string[] }
export interface ContentMapCompleteRoute {
  readonly kind: CompleteRouteMetadataKind;
  readonly entry: RouteSourceExport;
  readonly loader: RouteSourceExport;
}
export interface ContentMapRouteOptions {
  readonly consumer: string;
  readonly channel: PublisherChannelId;
  readonly brand: RouteRegistration["brand"];
  /** Historical source metadata only; executable route registration refuses complete descriptors. */
  readonly completeRoutes?: Readonly<Record<string, ContentMapCompleteRoute>>;
  /** Read-only compatibility for historical plan data. Its route identity/title/path
   * must agree with the map; disagreements are refused, never silently copied. */
  readonly planItems?: readonly Pick<PublisherPlanItem, "id" | "appRouteId" | "completeRoute">[];
  /** Actual registered assemblies for frame/section sources or legacy plans.
   * No projection fabricates an instance binding or source implementation. */
  readonly registrations?: readonly AnyRouteRegistration[];
}
/** Publication topology, including historical metadata. This is not an executable route registry. */
export interface ContentMapRoutes {
  readonly version: 1;
  readonly consumer: string;
  readonly routes: readonly (AnyRouteRegistration | CompleteRouteMetadata)[];
}
export interface ContentMapSitemapOptions { readonly channel: PublisherChannelId; readonly origin: string }
