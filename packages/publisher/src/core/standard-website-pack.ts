import type { InstanceRecord, PackRecord } from "./instance-record.js";

function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const pages = [
  ["home", "Home", "/", "LandingView", "home"],
  ["about", "About", "/about", "MarketingView", "about"],
  ["contact", "Contact", "/contact", "ContactView", "contact"],
  ["terms", "Terms", "/terms", "LegalView", "terms"],
  ["privacy", "Privacy", "/privacy", "LegalView", "privacy"],
  ["sign-in", "Sign in", "/sign-in", "AuthView", "sign-in"],
  ["not-found", "Not found", undefined, "StatusView", "not-found"],
  ["error", "Error", undefined, "StatusView", "server-error"],
] as const;
/** Standard page bindings are data, not routes, rendering or qualification records. */
export const STANDARD_WEBSITE_INSTANCES: readonly InstanceRecord[] = freeze(pages.map(([id, label, path, blockId, configId]) => ({
  instanceId: `standard.${id}`, label, ...(path === undefined ? {} : { path }), surface: "site" as const,
  frameBlockRef: { blockId: "SiteFrame" as const, configId: blockId === "AuthView" ? "front-door" : "site" },
  viewBlockRef: { blockId, configId }, ...(id === "sign-in" ? { viewStates: ["default", "submit-error", "provider-unavailable"] } : {}),
  context: { medium: "web" as const }, packIds: ["pack.standard-website"],
})));
export const STANDARD_WEBSITE_PACK: Readonly<PackRecord> = freeze({
  packId: "pack.standard-website", label: "Standard website", instanceIds: STANDARD_WEBSITE_INSTANCES.map(record => record.instanceId),
});
