import { AuthProvider } from "./client.js";
import { createSiteProxy as createEdgeSafeSiteProxy } from "./proxy-entry.js";
import { createSiteProxy } from "./proxy.js";

// @ts-expect-error Middleware helpers must remain isolated from the route-only server entry.
import { createSiteProxy as serverEntryIsNotEdgeSafe } from "./server.js";

// @ts-expect-error AuthProvider always owns a child subtree.
export const providerRequiresChildren = <AuthProvider />;

export const proxyPolicyIsExclusive = createSiteProxy({
  publicRoutes: ["/sign-in(.*)"],
  // @ts-expect-error A proxy policy cannot mix allow-list and protected-list modes.
  protectedRoutes: ["/app(.*)"],
});

export const validProvider = <AuthProvider><main /></AuthProvider>;
export const validProtectedProxy = createSiteProxy({ protectedRoutes: ["/app(.*)"] });
export const validPublishedProxyEntry = createEdgeSafeSiteProxy({ protectedRoutes: ["/app(.*)"] });
