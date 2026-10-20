import { describe, expect, it } from "vitest";
import * as core from "./index.js";
import * as web from "../web/index.js";
import { SITE_SURFACE_KINDS } from "../web/frame/surface.js";

describe("Standard website Pack", () => {
  it("validates all eight explicit bindings and checks real exports for the Pack's used Frames and Views", () => {
    expect(core.validateInstanceRecords(core.STANDARD_WEBSITE_INSTANCES, [core.STANDARD_WEBSITE_PACK])).toEqual({ status: "valid" });
    expect(core.STANDARD_WEBSITE_INSTANCES).toHaveLength(8);
    expect(core.STANDARD_WEBSITE_PACK).toEqual({ packId: "pack.standard-website", label: "Standard website", instanceIds: [
      "standard.home", "standard.about", "standard.contact", "standard.terms", "standard.privacy", "standard.sign-in", "standard.not-found", "standard.error",
    ] });
    for (const record of core.STANDARD_WEBSITE_INSTANCES) {
      expect(web).toHaveProperty(record.frameBlockRef.blockId);
      expect(web).toHaveProperty(record.viewBlockRef.blockId);
      expect(record.context).toEqual({ medium: "web" });
      expect(record).not.toHaveProperty("uses");
      expect(record.packIds).toEqual(["pack.standard-website"]);
    }
  });
  it("pins the authored page bindings, Auth states and pathless error Instances", () => {
    expect(core.STANDARD_WEBSITE_INSTANCES.map(record => [record.instanceId, record.path, record.frameBlockRef.configId, record.viewBlockRef.blockId, record.viewBlockRef.configId])).toEqual([
      ["standard.home", "/", "site", "LandingView", "home"], ["standard.about", "/about", "site", "MarketingView", "about"],
      ["standard.contact", "/contact", "site", "ContactView", "contact"], ["standard.terms", "/terms", "site", "LegalView", "terms"],
      ["standard.privacy", "/privacy", "site", "LegalView", "privacy"], ["standard.sign-in", "/sign-in", "front-door", "AuthView", "sign-in"],
      ["standard.not-found", undefined, "site", "StatusView", "not-found"], ["standard.error", undefined, "site", "StatusView", "server-error"],
    ]);
    expect(core.STANDARD_WEBSITE_INSTANCES.find(record => record.instanceId === "standard.sign-in")?.viewStates).toEqual(["default", "submit-error", "provider-unavailable"]);
    for (const record of core.STANDARD_WEBSITE_INSTANCES.slice(-2)) expect(record).not.toHaveProperty("path");
  });
  it("mirrors the complete web surface-kind set and deeply freezes Standard data", () => {
    expect(core.INSTANCE_SITE_SURFACE_KINDS).toEqual(SITE_SURFACE_KINDS);
    const frozen = (value: unknown) => {
      if (value && typeof value === "object") { expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(frozen); }
    };
    [core.INSTANCE_FRAME_BLOCK_IDS, core.INSTANCE_VIEW_BLOCK_IDS, core.INSTANCE_SITE_SURFACE_KINDS, core.STANDARD_WEBSITE_PACK, core.STANDARD_WEBSITE_INSTANCES].forEach(frozen);
  });
});
