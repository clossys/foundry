import { AGENT_LISTS } from "../agent-lists.generated.js";
import type { LegacyRouteRegistration } from "../core/route-registry.js";

/** Historical publication data only. These descriptors cannot register or emit a page. */
export type CompleteRouteMetadataKind = (typeof AGENT_LISTS)["policy"][number];
export function isCompleteRouteMetadataKind(value: unknown): value is CompleteRouteMetadataKind {
  return (AGENT_LISTS.policy as readonly unknown[]).includes(value);
}
export interface CompleteRouteMetadata extends Omit<LegacyRouteRegistration, "composition"> {
  readonly composition: {
    readonly complete: { readonly kind: CompleteRouteMetadataKind };
    readonly loader?: import("../core/route-registry.js").RouteSourceExport;
  };
}
