/**
 * Edge-safe Clerk middleware entry point. Route and server-component helpers
 * deliberately live in `./server.js` so importing this entry never pulls
 * `next/headers`, `next/navigation`, React, or client components.
 */
export { createClerkMiddleware, createSiteProxy } from "./proxy.js";
export type { ClerkMiddlewareOptionsCallback, SiteProxyConfig } from "./proxy.js";
