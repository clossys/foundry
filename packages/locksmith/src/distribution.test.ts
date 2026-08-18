import { describe, expect, it } from "vitest";
import { defineDistributionManifest, keysFor, mayResolve, principalsFor } from "./index.js";

describe("defineDistributionManifest", () => {
  it("says which principal may resolve which name", () => {
    const manifest = defineDistributionManifest([
      { key: "APP_SIGNING_KEY", principals: ["service-api", "service-worker"] },
      { key: "BILLING_KEY", principals: ["service-billing"] },
    ]);

    expect(mayResolve(manifest, "service-api", "APP_SIGNING_KEY")).toBe(true);
    expect(mayResolve(manifest, "service-billing", "APP_SIGNING_KEY")).toBe(false);
    expect(mayResolve(manifest, "service-api", "NEVER_DECLARED")).toBe(false);
  });

  it("lists principals and keys from either direction", () => {
    const manifest = defineDistributionManifest([
      { key: "APP_SIGNING_KEY", principals: ["service-api", "service-worker"] },
      { key: "BILLING_KEY", principals: ["service-billing", "service-api"] },
    ]);

    expect(principalsFor(manifest, "APP_SIGNING_KEY")).toEqual(["service-api", "service-worker"]);
    expect(principalsFor(manifest, "NEVER_DECLARED")).toEqual([]);
    expect(keysFor(manifest, "service-api")).toEqual(["APP_SIGNING_KEY", "BILLING_KEY"]);
    expect(keysFor(manifest, "no-such-principal")).toEqual([]);
  });

  it("freezes the manifest, its entries, and each entry's principal list", () => {
    const manifest = defineDistributionManifest([{ key: "K", principals: ["p"] }]);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.entries)).toBe(true);
    expect(Object.isFrozen(manifest.entries[0])).toBe(true);
    expect(Object.isFrozen(manifest.entries[0]!.principals)).toBe(true);
  });
});
