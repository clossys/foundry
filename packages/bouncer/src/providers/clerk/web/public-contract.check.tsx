import { AuthProvider } from "./client.js";
import { createSiteProxy as createEdgeSafeSiteProxy } from "./proxy-entry.js";
import { createSiteProxy } from "./proxy.js";
import { createSignOutRoute } from "./server.js";

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

const hardenedSignOut = {
  hardened: true,
  origin: "https://app.example.test",
  path: "/sign-out",
  confirmationPath: "/signed-out/confirm",
} as const;
export const validLegacySignOutRoute = () => createSignOutRoute({ redirectTo: "/", extraCookiesToClear: ["__refresh"] });
export const validHardenedSignOutRoute = () =>
  createSignOutRoute({
    ...hardenedSignOut,
    publishableKey: "configured",
    cookies: [{ name: "__refresh", scopes: [{ domain: "example.test" }] }],
    expiredSessionFallback: { jwtKey: "pem", issuer: "https://clerk.example.test", authorizedParties: ["https://app.example.test"], maxExpiredAgeMs: 60000 },
  });
// @ts-expect-error A hardened route never follows a configured redirect policy.
export const hardenedRefusesRedirectTo = () => createSignOutRoute({ ...hardenedSignOut, redirectTo: "/" });
// @ts-expect-error A hardened route never reads a target from the request.
export const hardenedRefusesDynamicTarget = () => createSignOutRoute({ ...hardenedSignOut, getRedirectTarget: () => "/" });
// @ts-expect-error A hardened route takes cookie rules, not a legacy delete list.
export const hardenedRefusesLegacyCookies = () => createSignOutRoute({ ...hardenedSignOut, extraCookiesToClear: ["__refresh"] });
// @ts-expect-error A hardened route owns its provider callback.
export const hardenedRefusesCallback = () => createSignOutRoute({ ...hardenedSignOut, signOut: () => undefined });
// @ts-expect-error Hardened-only keys need `hardened: true`.
export const legacyRefusesHardenedKeys = () => createSignOutRoute({ confirmationPath: "/signed-out/confirm" });
export const fallbackNeedsOneKeySource = () =>
  // @ts-expect-error The expired-session fallback takes exactly one of jwtKey or secretKey.
  createSignOutRoute({ ...hardenedSignOut, expiredSessionFallback: { jwtKey: "pem", secretKey: "sk", issuer: "https://clerk.example.test", authorizedParties: ["https://app.example.test"], maxExpiredAgeMs: 1 } });
