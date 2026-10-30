import { describe, expect, it } from "vitest";
import { leafRegistryFixture, libraryFixture, pinnedReviewFixture, reviewFixture } from "./__fixtures__/review.js";
import { validateContentRegistry } from "./validate.js";

const expectedLeaves = [
  ["sl_boyi4ashca", "websites/site/home", "content", "/"],
  ["sl_2xv4y3uo7k", "websites/site/privacy", "content", "/privacy"],
  ["sl_ke6mhs5hmu", "websites/site/terms", "content", "/terms"],
  ["sl_prd6v4nkk3", "websites/site/not-found", "status", undefined],
  ["sl_wl546svpom", "websites/auth/sign-in", "content", "/sign-in"],
  ["sl_x5c5vjqxez", "websites/auth/sign-in-unavailable", "status", "/sign-in-unavailable"],
  ["sl_wlpwozbd7y", "websites/auth/not-authorized", "status", "/not-authorized"],
  ["sl_4hiswon2mp", "websites/auth/service-unavailable", "status", "/service-unavailable"],
  ["sl_asgvb7lcju", "websites/auth/sign-out-confirm", "content", "/sign-out-confirm"],
  ["sl_pwsyw4hn2e", "websites/auth/not-found", "status", undefined],
  ["sl_w7u7k6agdr", "websites/auth/error", "status", undefined],
  ["sl_wnelzobehr", "websites/auth/global-error", "status", undefined],
  ["sl_rkjigy5k5p", "websites/admin/workspace-home", "content", "/"],
  ["sl_7pz5qp7kyz", "websites/admin/account", "content", "/account"],
  ["sl_622lk7eoar", "websites/admin/agents-designer", "content", "/agents/designer"],
  ["sl_hfkj3prso2", "websites/admin/agents-publisher", "content", "/agents/publisher"],
  ["sl_lsqwmhpf6l", "websites/admin/agents-writer", "content", "/agents/writer"],
  ["sl_sjhh4tpouv", "websites/admin/agents-foundry", "content", "/agents/foundry"],
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
      consumerId: "sample", defaultLocale: "en", locales: ["en"],
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
    expect(moved.slots[0]?.id).toBe("sl_boyi4ashca");
    expect(moved.slots[0]?.aliases).toEqual(["websites/site/home"]);
    expect(leafRegistryFixture().slots[0]).toEqual(home);
  });

  it("preserves the single-home review and pinned-source fixtures", () => {
    const registry = reviewFixture();
    expect(validateContentRegistry(registry)).toEqual([]);
    expect(registry.slots).toHaveLength(1);
    expect(registry.slots[0]?.id).toBe("sl_boyi4ashca");
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
