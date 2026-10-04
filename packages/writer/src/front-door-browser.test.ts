import { describe, expect, it } from "vitest";
import { FRONT_DOOR_COPY_IDS, FRONT_DOOR_COPY_EN, resolveFrontDoorCopy as legacy } from "./front-door.js";
import { resolveFrontDoorCopy as browser } from "./front-door-browser.js";

const nouns = { brand: "Brand", surface: "Surface", identifier: "visitor", digest: "trace", requestAccessLabel: "Request access" };

describe("immutable browser front-door defaults", () => {
  it("matches pristine strict-root resolutions for all 63 keys, pruning unused nouns", () => {
    expect(FRONT_DOOR_COPY_IDS).toHaveLength(63);
    for (const key of FRONT_DOOR_COPY_IDS) {
      const result = browser(key, nouns);
      expect(result).toEqual(legacy(key, nouns));
      expect(result.complete).toBe(true);
      expect(result.resolution).not.toHaveProperty("approval");
      expect(Object.keys(result.resolution!.ref.values!)).toEqual(FRONT_DOOR_COPY_EN.entries.find(e => e.id === key)!.placeholders ?? []);
    }
  });
  it("preserves total refusal ordering and never emits partial text", () => {
    const hostile = [null, [], Object.create(null), new Proxy({}, { ownKeys() { throw Error("unreadable"); } }), { surface: " ", surprise: "value", another: "value" }, { get surface() { throw Error("unreadable"); } }, { surface: "{raw}" }];
    for (const input of hostile) for (const key of FRONT_DOOR_COPY_IDS) expect(browser(key, input as never)).toEqual(legacy(key, input as never));
    for (const key of [null, {}, Object.create(null), { toString() { throw Error("unreadable"); } }, Symbol("key"), "front-door.missing.title"])
      expect(browser(key as never, nouns)).toEqual(legacy(key as never, nouns));
    const refused = browser("front-door.not-authorized.description", { surprise: "value", surface: " ", identifier: "" } as never);
    expect(refused.issues.map(i => i.reason)).toEqual(["unknown-noun", "missing-noun", "missing-noun"]);
    expect(refused).not.toHaveProperty("text"); expect(refused).not.toHaveProperty("resolution");
  });
  it("isolates private defaults from mutable root catalog and prior returned provenance", () => {
    const baseline = browser("front-door.sign-in.description", nouns);
    const entry = FRONT_DOOR_COPY_EN.entries.find(e => e.id === "front-door.sign-in.description")!;
    const saved = { ...entry };
    try {
      entry.text = "Changed {surface}"; entry.status = "draft";
      expect(legacy("front-door.sign-in.description", nouns).complete).toBe(false);
      expect(browser("front-door.sign-in.description", nouns)).toEqual(baseline);
    } finally { Object.assign(entry, saved); }
    baseline.resolution!.source!.reference = "changed";
    baseline.resolution!.ref.values!.surface = "changed";
    expect(browser("front-door.sign-in.description", nouns)).toEqual(legacy("front-door.sign-in.description", nouns));
  });
});
