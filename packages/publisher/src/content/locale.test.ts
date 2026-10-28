import { describe, expect, it } from "vitest";
import { canonicalLocale } from "@clossys/writer/locale";
import { validateContentSlot, validateContentWorkspace } from "./validate.js";
import { isContentLocale } from "./vocabulary.js";

function workspaceFixture() {
  return {
    consumerId: "sample", defaultLocale: "en", locales: ["en", "fr"],
    deployTargets: [{ id: "sample", repo: "sample", app: "site" }], destinations: [],
  };
}

function slotFixture() {
  return {
    id: "sl_aaaaaaaaaa", aliases: ["websites/site/home"], locales: ["en"],
    l1: "websites", l2: "site", position: { order: 0, name: "home" }, name: "Home",
    kind: "content", route: "/", deployTarget: "sample", devOnly: false,
    tags: [], releases: [], createdAt: "2026-01-01T00:00:00Z",
  };
}

describe("canonical content locale vocabulary", () => {
  it.each(["en", "en-US", "zh-Hant-TW", "he-IL", "en-XA", "ar-XB", "en-US-u-ca-gregory"])(
    "accepts the canonical stored locale %s", value => {
      expect(canonicalLocale(value)).toBe(value);
      expect(isContentLocale(value)).toBe(true);
    },
  );

  it.each(["en-us", "ZH-hant-tw", "iw-IL", "in-ID", "en-xa", "ar-xb"])(
    "rejects valid but noncanonical stored locale %s", value => {
      expect(canonicalLocale(value)).not.toBe(value);
      expect(isContentLocale(value)).toBe(false);
    },
  );

  it.each(["", " ", "en_US", "en--US", "en-u", null, undefined, 42, [], {}])(
    "rejects malformed or non-string stored locale %j", value => {
      expect(isContentLocale(value)).toBe(false);
    },
  );
});

describe("stored content locale findings", () => {
  it("accepts canonical locales in complete workspace and slot fixtures", () => {
    const workspace = workspaceFixture();
    workspace.defaultLocale = "en-US";
    workspace.locales = ["en-US", "zh-Hant-TW", "en-XA", "ar-XB"];
    const slot = slotFixture();
    slot.locales = ["zh-Hant-TW", "ar-XB"];
    expect(validateContentWorkspace(workspace)).toEqual([]);
    expect(validateContentSlot(slot)).toEqual([]);
  });

  it("names noncanonical workspace default and selection findings without rewriting them", () => {
    const workspace = workspaceFixture();
    workspace.defaultLocale = "en-us";
    workspace.locales = ["en-us", "fr"];
    const before = structuredClone(workspace);
    expect(validateContentWorkspace(workspace).map(({ path, rule }) => ({ path, rule }))).toEqual([
      { path: "workspace.locales[0]", rule: "non-canonical-locale" },
      { path: "workspace.defaultLocale", rule: "non-canonical-locale" },
    ]);
    expect(workspace).toEqual(before);
  });

  it("names a noncanonical slot locale finding for an otherwise valid slot", () => {
    const slot = slotFixture();
    slot.locales = ["iw-IL"];
    const before = structuredClone(slot);
    expect(validateContentSlot(slot).map(({ path, rule }) => ({ path, rule }))).toEqual([
      { path: "slot.locales[0]", rule: "non-canonical-locale" },
    ]);
    expect(slot).toEqual(before);
  });

  it.each(["", "en_US"])("keeps the existing locale rule for invalid workspace tags %j", locale => {
    const workspace = workspaceFixture();
    workspace.defaultLocale = locale;
    workspace.locales = [locale];
    expect(validateContentWorkspace(workspace).map(({ path, rule }) => ({ path, rule }))).toEqual([
      { path: "workspace.locales[0]", rule: "locale" },
      { path: "workspace.defaultLocale", rule: "locale" },
    ]);
  });

  it.each(["", "en_US"])("keeps the existing locale rule for invalid slot tags %j", locale => {
    const slot = slotFixture();
    slot.locales = [locale];
    expect(validateContentSlot(slot).map(({ path, rule }) => ({ path, rule }))).toEqual([
      { path: "slot.locales[0]", rule: "locale" },
    ]);
  });

  it("keeps the existing empty selection findings", () => {
    const workspace = workspaceFixture();
    workspace.locales = [];
    expect(validateContentWorkspace(workspace)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "workspace.locales", rule: "nonempty-locales" }),
    ]));
    const slot = slotFixture();
    slot.locales = [];
    expect(validateContentSlot(slot).map(({ path, rule }) => ({ path, rule }))).toEqual([
      { path: "slot.locales", rule: "nonempty-locales" },
    ]);
  });
});
