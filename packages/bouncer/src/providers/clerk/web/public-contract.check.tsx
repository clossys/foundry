import { AuthProvider } from "./client.js";
import { createSiteProxy as createEdgeSafeSiteProxy } from "./proxy-entry.js";
import { createSiteProxy } from "./proxy.js";
import { createSignOutRoute } from "./server.js";
import type { LegacySignOutRouteOptions, SignOutRouteOptions } from "./server.js";

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

// A caller that forwards a value typed as the union still compiles (the third overload).
export const wrapSignOutRoute = (options: SignOutRouteOptions) => createSignOutRoute(options);
export const wrapOptionalSignOutRoute = (options?: SignOutRouteOptions) => createSignOutRoute(options);
// TypeScript cannot extend a union; a caller's own options interface extends the legacy shape instead.
interface AppSignOutOptions extends LegacySignOutRouteOptions {
  readonly label?: string;
}
export const extendedLegacySignOutRoute = (options: AppSignOutOptions) => createSignOutRoute(options);

// Variables, not fresh literals: excess-property checks do not apply, so only the `never` markers refuse these.
const hardenedWithRedirectTo = { ...hardenedSignOut, redirectTo: "/" };
const legacyWithOrigin = { redirectTo: "/", origin: "https://app.example.test" };
const legacyWithPath = { redirectTo: "/", path: "/sign-out" };
const legacyWithConfirmation = { redirectTo: "/", confirmationPath: "/signed-out/confirm" };
// @ts-expect-error The hardened `redirectTo?: never` marker refuses a variable that carries one.
export const hardenedVariableRefusesRedirectTo = () => createSignOutRoute(hardenedWithRedirectTo);
// @ts-expect-error The legacy `origin?: never` marker refuses a variable that carries one.
export const legacyVariableRefusesOrigin = () => createSignOutRoute(legacyWithOrigin);
// @ts-expect-error The legacy `path?: never` marker refuses a variable that carries one.
export const legacyVariableRefusesPath = () => createSignOutRoute(legacyWithPath);
// @ts-expect-error The legacy `confirmationPath?: never` marker refuses a variable that carries one.
export const legacyVariableRefusesConfirmation = () => createSignOutRoute(legacyWithConfirmation);
