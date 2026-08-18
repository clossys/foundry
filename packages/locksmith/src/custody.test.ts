import { describe, expect, it } from "vitest";
import { custodyOf, defineKeyCustody, unownedKeys } from "./index.js";

describe("defineKeyCustody", () => {
  it("normalizes a missing owner to null rather than an empty string", () => {
    const manifest = defineKeyCustody([
      { key: "APP_SIGNING_KEY", owner: "team-platform", store: "infisical" },
      { key: "LEGACY_WEBHOOK_KEY", owner: null, store: "environment" },
    ]);

    expect(manifest.version).toBe(1);
    expect(custodyOf(manifest, "APP_SIGNING_KEY")?.owner).toBe("team-platform");
    expect(custodyOf(manifest, "LEGACY_WEBHOOK_KEY")?.owner).toBeNull();
    expect(custodyOf(manifest, "NEVER_DECLARED")).toBeUndefined();
  });

  it("reports every key with no recorded owner", () => {
    const manifest = defineKeyCustody([
      { key: "OWNED", owner: "team-platform", store: "infisical" },
      { key: "ORPHAN_ONE", owner: null, store: "infisical" },
      { key: "ORPHAN_TWO", owner: null, store: "environment" },
    ]);

    expect(unownedKeys(manifest)).toEqual(["ORPHAN_ONE", "ORPHAN_TWO"]);
  });

  it("freezes the manifest and every entry", () => {
    const manifest = defineKeyCustody([{ key: "K", owner: "team", store: "infisical" }]);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.entries)).toBe(true);
    expect(Object.isFrozen(manifest.entries[0])).toBe(true);
  });

  it("omits notes entirely when not supplied, rather than storing undefined", () => {
    const manifest = defineKeyCustody([{ key: "K", owner: "team", store: "infisical" }]);
    expect(Object.hasOwn(manifest.entries[0]!, "notes")).toBe(false);
  });
});
