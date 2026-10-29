/** Host data adapters retain their types after the complete-page constructor retires. */
import type { DesignerPageProps } from "@clossys/designer/studio";
import type { DesignerRoutePageProps } from "@clossys/designer/studio/route";

export type StudioHostCopy = DesignerPageProps["copy"];
export type StudioRouteCopy = DesignerRoutePageProps["copy"];

// @ts-expect-error Hosts use Studio or the native route, rather than this private constructor.
type RetiredPage = typeof import("@clossys/designer/studio")["DesignerPage"];
// @ts-expect-error The implementation canvas is private to the Studio.
type PrivateCanvas = typeof import("@clossys/designer/studio")["SystemCanvas"];
