import { AuthProvider } from "./client.js";
import { createSiteProxy } from "./proxy.js";

// @ts-expect-error AuthProvider always owns a child subtree.
export const providerRequiresChildren = <AuthProvider />;

export const proxyPolicyIsExclusive = createSiteProxy({
  publicRoutes: ["/sign-in(.*)"],
  // @ts-expect-error A proxy policy cannot mix allow-list and protected-list modes.
  protectedRoutes: ["/app(.*)"],
});

export const validProvider = <AuthProvider><main /></AuthProvider>;
export const validProtectedProxy = createSiteProxy({ protectedRoutes: ["/app(.*)"] });
