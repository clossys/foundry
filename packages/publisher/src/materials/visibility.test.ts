import { describe, expect, it } from "vitest";
import { checkMaterialsVisibility, MATERIALS_DEFAULT_VISIBILITY } from "./visibility.js";

describe("MATERIALS_DEFAULT_VISIBILITY", () => {
  it("is internal", () => {
    expect(MATERIALS_DEFAULT_VISIBILITY).toBe("internal");
  });
});

describe("checkMaterialsVisibility", () => {
  it("blocks an internal item whose output repository is public", () => {
    const result = checkMaterialsVisibility({ itemId: "materials-site", visibility: "internal", repositoryIsPublic: true });
    expect(result.blocked).toBe(true);
    expect(result.findings).toEqual([
      expect.objectContaining({ rule: "internal-item-in-public-repository", itemId: "materials-site" }),
    ]);
  });

  it("passes an internal item in a private repository", () => {
    expect(checkMaterialsVisibility({ itemId: "materials-site", visibility: "internal", repositoryIsPublic: false })).toEqual({ blocked: false, findings: [] });
  });

  it("passes a public item regardless of repository visibility", () => {
    expect(checkMaterialsVisibility({ itemId: "website", visibility: "public", repositoryIsPublic: true })).toEqual({ blocked: false, findings: [] });
    expect(checkMaterialsVisibility({ itemId: "website", visibility: "public", repositoryIsPublic: false })).toEqual({ blocked: false, findings: [] });
  });

  it("names moving to a private repository as the remedy", () => {
    const result = checkMaterialsVisibility({ itemId: "materials-site", visibility: "internal", repositoryIsPublic: true });
    expect(result.findings[0]?.message).toMatch(/private repository/);
  });
});
