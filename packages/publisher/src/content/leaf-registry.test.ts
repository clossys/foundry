import { describe, expect, it } from "vitest";
import { leafRegistryFixture, libraryFixture, pinnedReviewFixture, reviewFixture } from "./__fixtures__/review.js";
import { validateContentRegistry } from "./validate.js";
import { contentTreeFixture } from "./__fixtures__/content-tree.js";

const expectedLeaves = [
  ["sl_fixturesaf", "websites/site/home", "content", "/"],
  ["sl_fixturesaa", "websites/site/privacy", "content", "/privacy"],
  ["sl_fixturesah", "websites/site/terms", "content", "/terms"],
  ["sl_fixturesaj", "websites/site/not-found", "status", undefined],
  ["sl_fixturesao", "websites/auth/sign-in", "content", "/sign-in"],
  ["sl_fixturesar", "websites/auth/sign-in-unavailable", "status", "/sign-in-unavailable"],
  ["sl_fixturesap", "websites/auth/not-authorized", "status", "/not-authorized"],
  ["sl_fixturesab", "websites/auth/service-unavailable", "status", "/service-unavailable"],
  ["sl_fixturesae", "websites/auth/sign-out-confirm", "content", "/sign-out-confirm"],
  ["sl_fixturesak", "websites/auth/not-found", "status", undefined],
  ["sl_fixturesan", "websites/auth/error", "status", undefined],
  ["sl_fixturesaq", "websites/auth/global-error", "status", undefined],
  ["sl_fixturesal", "websites/admin/workspace-home", "content", "/"],
  ["sl_fixturesad", "websites/admin/account", "content", "/account"],
  ["sl_fixturesac", "websites/admin/agents-designer", "content", "/agents/designer"],
  ["sl_fixturesag", "websites/admin/agents-publisher", "content", "/agents/publisher"],
  ["sl_fixturesai", "websites/admin/agents-writer", "content", "/agents/writer"],
  ["sl_fixturesam", "websites/admin/agents-foundry", "content", "/agents/foundry"],
] as const;

describe("leaf registry inventory", () => {
  it("validates eighteen slots without inventing candidates or releases", () => {
    const registry = leafRegistryFixture();
    expect(registry.slots).toHaveLength(18);
    expect(registry.candidates).toEqual([]);
    expect(validateContentRegistry(registry)).toEqual([]);
    for (const slot of registry.slots) {
      expect(slot.activeCandidateId).toBeUndefined();
      expect(slot.releases).toEqual([]);
    }
  });

  it("pins issued identities, legacy addresses, kinds and route bindings", () => {
    const { slots } = leafRegistryFixture();
    expect(slots.map(slot => [slot.id, slot.aliases[0], slot.kind, slot.route])).toEqual(expectedLeaves);
    expect(new Set(slots.map(slot => slot.id)).size).toBe(18);
    expect(new Set(slots.flatMap(slot => slot.aliases)).size).toBe(18);
    for (const slot of slots) {
      expect(slot.id).toMatch(/^sl_[a-z2-7]{10}$/);
      expect(slot.aliases).toEqual([`${slot.l1}/${slot.l2}/${slot.position.name}`]);
      expect(Number.isFinite(slot.position.order)).toBe(true);
    }
    expect(slots[0]?.position).toEqual({ order: 0, name: "home" });
  });

  it("uses English and generic deployment targets across the active website boards", () => {
    const { workspace, slots } = leafRegistryFixture();
    expect(workspace).toEqual({
      consumerId: "sample", tree: contentTreeFixture(), defaultLocale: "en", locales: ["en"],
      deployTargets: [
        { id: "product-site", repo: "sample", app: "site" },
        { id: "product-admin", repo: "sample", app: "admin" },
      ],
      destinations: [],
    });
    expect([...new Set(slots.map(slot => slot.l2))]).toEqual(["site", "auth", "admin"]);
    for (const slot of slots) {
      expect(slot.l1).toBe("websites");
      expect(slot.locales).toEqual(["en"]);
      expect(slot.deployTarget).toBe(slot.l2 === "site" ? "product-site" : "product-admin");
      expect(slot.devOnly).toBe(false);
      expect(slot).not.toHaveProperty("frame");
      expect(slot).not.toHaveProperty("frameId");
      expect(slot.tags).toEqual(slot.position.name === "agents-foundry" ? ["parked"] : []);
    }
  });

  it("preserves issued identity and legacy aliases when placement and route change", () => {
    const registry = leafRegistryFixture();
    const home = registry.slots[0]!;
    const moved = {
      ...registry,
      slots: [{ ...home, l1: "documents" as const, l2: "docs" as const,
        position: { order: 12, name: "overview" }, name: "Overview", route: "/overview" }, ...registry.slots.slice(1)],
    };
    expect(validateContentRegistry(moved)).toEqual([]);
    expect(moved.slots[0]?.id).toBe("sl_fixturesaf");
    expect(moved.slots[0]?.aliases).toEqual(["websites/site/home"]);
    expect(leafRegistryFixture().slots[0]).toEqual(home);
  });

  it("preserves the single-home review and pinned-source fixtures", () => {
    const registry = reviewFixture();
    expect(validateContentRegistry(registry)).toEqual([]);
    expect(registry.slots).toHaveLength(1);
    expect(registry.slots[0]?.id).toBe("sl_fixturesaf");
    expect(registry.slots[0]?.aliases).toEqual(["websites/site/home"]);
    expect(registry.slots[0]?.locales).toEqual(["en"]);
    expect(registry.candidates).toHaveLength(1);
    expect(registry.candidates[0]?.slotId).toBe(registry.slots[0]?.id);
    expect(registry.candidates[0]?.state).toBe("active");
    expect(libraryFixture()[0]?.consumerId).toBe("sample");
    const pinned = pinnedReviewFixture();
    expect(validateContentRegistry(pinned)).toEqual([]);
    expect(pinned.slots).toHaveLength(1);
    expect(pinned.candidates.map(candidate => candidate.id)).toEqual(["sample", "source"]);
    expect(pinned.candidates[0]?.composition?.sections[0]?.ref).toEqual({ candidateId: "source", revision: "r1", sectionKey: "intro" });
  });
});
