import type { LegacyRouteRegistration } from "../core/route-registry.js";

/** Historical publication data only. These descriptors cannot register or emit a page. */
export type CompleteRouteMetadataKind = "designer" | "writer" | "publisher";
export function isCompleteRouteMetadataKind(value: unknown): value is CompleteRouteMetadataKind {
  return value === "designer" || value === "writer" || value === "publisher";
}
export interface CompleteRouteMetadata extends Omit<LegacyRouteRegistration, "composition"> {
  readonly composition: {
    readonly complete: { readonly kind: CompleteRouteMetadataKind };
    readonly loader?: import("../core/route-registry.js").RouteSourceExport;
  };
}
