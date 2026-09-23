import { describe, expect, it } from "vitest";
import type { PackItem, PackManifest } from "./types.js";
import { validatePackManifest } from "./validate.js";

const FINGERPRINT = "a".repeat(64);
const NOW = "2026-09-22T00:00:00.000Z";
const LATER = "2026-09-22T01:00:00.000Z";

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

describe("validatePackManifest", () => {
  it("passes a minimal well-formed manifest", () => {
    const result = validatePackManifest(manifest([item({ id: "strategy-brief" })]));
    expect(result).toEqual({ exitCode: 0, findings: [] });
  });

  it("passes a manifest with satisfied needs and a verified item", () => {
    const result = validatePackManifest(
      manifest([
        item({ id: "strategy-brief", status: "published", approvedAt: NOW, verifiedAt: LATER, publishedTo: ["internal-record"] }),
        item({ id: "website", layer: "surface", owner: "publisher", visibility: "public", needs: ["strategy-brief"] }),
      ]),
    );
    expect(result).toEqual({ exitCode: 0, findings: [] });
  });

  it("accepts every real @clossys/controller PackStatus word, including in-review, kept, and published", () => {
    for (const status of ["absent", "found", "draft", "in-review", "kept", "published"] as const) {
      const overrides: Partial<PackItem> = { id: `status-${status}`, status };
      if (status === "kept" || status === "published") overrides.approvedAt = NOW;
      if (status === "published") overrides.verifiedAt = LATER;
      const result = validatePackManifest(manifest([item(overrides as Partial<PackItem> & Pick<PackItem, "id">)]));
      expect(result.findings.filter((finding) => finding.rule === "invalid-status")).toEqual([]);
    }
  });

  it("rejects a non-1 schemaVersion", () => {
    const result = validatePackManifest({ schemaVersion: 2 as 1, items: [] });
    expect(result.exitCode).toBe(1);
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "invalid-schema-version" })]));
  });

  it("rejects a duplicate id", () => {
    const result = validatePackManifest(manifest([item({ id: "dup" }), item({ id: "dup" })]));
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "duplicate-id", itemId: "dup" })]));
  });

  it("rejects an invalid layer, owner, visibility, status, condition, and version together", () => {
    const result = validatePackManifest(
      manifest([
        item({
          id: "bad",
          layer: "nonsense" as never,
          owner: "",
          visibility: "secret" as never,
          status: "queued" as never,
          condition: "unknown" as never,
          version: "0.1" as never,
        }),
      ]),
    );
    const rules = result.findings.map((finding) => finding.rule).sort();
    expect(rules).toEqual([
      "invalid-condition",
      "invalid-layer",
      "invalid-owner",
      "invalid-status",
      "invalid-version",
      "invalid-visibility",
    ]);
  });

  it("rejects a need naming an unknown item id, and a self-need (itself a degenerate needs cycle)", () => {
    const result = validatePackManifest(manifest([item({ id: "a", needs: ["a", "ghost"] })]));
    const rules = result.findings.map((finding) => finding.rule).sort();
    expect(rules).toEqual(["needs-cycle", "self-need", "unknown-need"]);
  });

  it("rejects a needs cycle", () => {
    const result = validatePackManifest(manifest([item({ id: "a", needs: ["b"] }), item({ id: "b", needs: ["a"] })]));
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "needs-cycle" })]));
  });

  it("rejects out-of-order timestamps", () => {
    const result = validatePackManifest(manifest([item({ id: "a", createdAt: LATER, updatedAt: NOW })]));
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "timestamp-order" })]));
  });

  it("rejects verified status without verifiedAt, and approved/verified without approvedAt", () => {
    const result = validatePackManifest(
      manifest([
        item({ id: "a", status: "published", approvedAt: NOW }),
        item({ id: "b", status: "kept" }),
      ]),
    );
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: "missing-verified-at", itemId: "a" }),
        expect.objectContaining({ rule: "missing-approved-at", itemId: "b" }),
      ]),
    );
  });

  it("rejects a premature approvedAt/verifiedAt on a not-yet-judged item", () => {
    const result = validatePackManifest(manifest([item({ id: "a", status: "draft", approvedAt: NOW })]));
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "premature-timestamp" })]));
  });

  it("rejects a malformed source pin", () => {
    const result = validatePackManifest(manifest([item({ id: "a", sourcePins: [{ path: "x", fingerprint: "not-hex" }] })]));
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "invalid-source-pin" })]));
  });

  it("accepts a well-formed source pin", () => {
    const result = validatePackManifest(manifest([item({ id: "a", sourcePins: [{ path: "x", fingerprint: FINGERPRINT }] })]));
    expect(result).toEqual({ exitCode: 0, findings: [] });
  });

  it("rejects a publishedTo destination on an item that is not yet verified", () => {
    const result = validatePackManifest(manifest([item({ id: "a", publishedTo: ["https://example.test"] })]));
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "premature-published-to" })]));
  });
});
