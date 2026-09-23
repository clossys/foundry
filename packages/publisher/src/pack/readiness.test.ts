import { describe, expect, it } from "vitest";
import type { PackItem, PackManifest } from "./types.js";
import { computePackReadiness, planPackOrder, sealableItemIds } from "./readiness.js";

const NOW = "2026-09-22T00:00:00.000Z";

function item(overrides: Partial<PackItem> & Pick<PackItem, "id">): PackItem {
  return {
    layer: "foundation",
    owner: "strategist",
    visibility: "internal",
    needs: [],
    status: "found",
    condition: "current",
    version: "v0.1",
    createdAt: NOW,
    updatedAt: NOW,
    approvedAt: null,
    verifiedAt: null,
    sourcePins: [],
    outputPaths: [],
    publishedTo: [],
    nextAction: null,
    ...overrides,
  };
}

function manifest(items: PackItem[]): PackManifest {
  return { schemaVersion: 1, items };
}

describe("planPackOrder", () => {
  it("orders needs before dependents", () => {
    const order = planPackOrder(
      manifest([
        item({ id: "website", layer: "surface", needs: ["brand-kit", "strategy-brief"] }),
        item({ id: "brand-kit", layer: "identity", needs: ["strategy-brief"] }),
        item({ id: "strategy-brief" }),
      ]),
    );
    expect(order.indexOf("strategy-brief")).toBeLessThan(order.indexOf("brand-kit"));
    expect(order.indexOf("brand-kit")).toBeLessThan(order.indexOf("website"));
    expect(order).toHaveLength(3);
  });

  it("throws on a needs cycle rather than silently truncating", () => {
    expect(() => planPackOrder(manifest([item({ id: "a", needs: ["b"] }), item({ id: "b", needs: ["a"] })]))).toThrow(/needs cycle/);
  });
});

describe("computePackReadiness", () => {
  it("is ready when an item has no needs", () => {
    const readiness = computePackReadiness(manifest([item({ id: "strategy-brief" })]));
    expect(readiness).toEqual({ ready: true, items: [{ itemId: "strategy-brief", ready: true, blockedBy: [] }] });
  });

  it("is not ready when a need is only found, not yet approved", () => {
    const readiness = computePackReadiness(
      manifest([item({ id: "strategy-brief", status: "found" }), item({ id: "website", layer: "surface", needs: ["strategy-brief"] })]),
    );
    expect(readiness.ready).toBe(false);
    expect(readiness.items.find((entry) => entry.itemId === "website")).toEqual({ itemId: "website", ready: false, blockedBy: ["strategy-brief"] });
  });

  it("is ready when a need is approved, and also when verified", () => {
    for (const status of ["kept", "published"] as const) {
      const readiness = computePackReadiness(
        manifest([
          item({ id: "strategy-brief", status, approvedAt: NOW, verifiedAt: status === "published" ? NOW : null }),
          item({ id: "website", layer: "surface", needs: ["strategy-brief"] }),
        ]),
      );
      expect(readiness.items.find((entry) => entry.itemId === "website")?.ready).toBe(true);
    }
  });

  it("treats a blocked need as unsatisfied even if approved", () => {
    const readiness = computePackReadiness(
      manifest([
        item({ id: "strategy-brief", status: "kept", approvedAt: NOW, condition: "blocked" }),
        item({ id: "website", layer: "surface", needs: ["strategy-brief"] }),
      ]),
    );
    expect(readiness.items.find((entry) => entry.itemId === "website")?.ready).toBe(false);
  });

  it("treats an unknown need as unsatisfied, never as vacuously ready", () => {
    const readiness = computePackReadiness(manifest([item({ id: "website", layer: "surface", needs: ["ghost"] })]));
    expect(readiness.items).toEqual([{ itemId: "website", ready: false, blockedBy: ["ghost"] }]);
  });
});

describe("sealableItemIds", () => {
  it("returns an approved item with no needs", () => {
    const ids = sealableItemIds(manifest([item({ id: "strategy-brief", status: "kept", approvedAt: NOW })]));
    expect(ids).toEqual(["strategy-brief"]);
  });

  it("includes an approved item with no needs but excludes one whose need is not yet verified", () => {
    const ids = sealableItemIds(
      manifest([
        item({ id: "strategy-brief", status: "kept", approvedAt: NOW }),
        item({ id: "website", layer: "surface", status: "kept", approvedAt: NOW, needs: ["strategy-brief"] }),
      ]),
    );
    expect(ids).toEqual(["strategy-brief"]);
  });

  it("includes an approved item once its need is verified, and excludes a draft or blocked item", () => {
    const ids = sealableItemIds(
      manifest([
        item({ id: "strategy-brief", status: "published", approvedAt: NOW, verifiedAt: NOW }),
        item({ id: "website", layer: "surface", status: "kept", approvedAt: NOW, needs: ["strategy-brief"] }),
        item({ id: "email-kit", layer: "surface", status: "draft" }),
        item({ id: "social-kit", layer: "surface", status: "kept", approvedAt: NOW, condition: "blocked" }),
      ]),
    );
    expect(ids).toEqual(["website"]);
  });
});
