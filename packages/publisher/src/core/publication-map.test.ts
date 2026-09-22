import { describe, expect, it } from "vitest";

import {
  findPublicationMapEntryByPath,
  findPublicationMapEntryBySlideIndex,
  listPublicationMapPaths,
  validatePublicationMap,
  validatePublicationMapRoutes,
  type PublicationMap,
} from "./publication-map.js";

const knownTemplates = ["MarketingView", "PitchDeck"];

const validMap: PublicationMap = {
  entries: [
    {
      id: "marketing-home",
      template: "MarketingView",
      documentId: "doc-marketing-home",
      location: { kind: "path", path: "/marketing" },
    },
    {
      id: "pitch-opening",
      template: "PitchDeck",
      documentId: "doc-pitch-0",
      location: { kind: "slide", index: 0 },
    },
  ],
};

describe("validatePublicationMap", () => {
  it("accepts a map with one path and one slide", () => {
    expect(validatePublicationMap(validMap, knownTemplates)).toEqual([]);
  });

  it("fails when a template is not registered", () => {
    const findings = validatePublicationMap(
      {
        entries: [{ id: "orphan", template: "MissingView", documentId: "doc-1", location: { kind: "path", path: "/orphan" } }],
      },
      knownTemplates,
    );
    expect(findings.map((finding) => finding.rule)).toContain("entry-template-unknown");
  });

  it("fails when a path location is empty", () => {
    const findings = validatePublicationMap(
      {
        entries: [{ id: "blank-path", template: "MarketingView", documentId: "doc-1", location: { kind: "path", path: "   " } }],
      },
      knownTemplates,
    );
    expect(findings.map((finding) => finding.rule)).toContain("location-path-empty");
  });

  it("fails when a slide index is negative", () => {
    const findings = validatePublicationMap(
      {
        entries: [{ id: "bad-slide", template: "PitchDeck", documentId: "doc-1", location: { kind: "slide", index: -1 } }],
      },
      knownTemplates,
    );
    expect(findings.map((finding) => finding.rule)).toContain("location-slide-index-negative");
  });

  it("fails when entry ids duplicate", () => {
    const findings = validatePublicationMap(
      {
        entries: [
          { id: "dup", template: "MarketingView", documentId: "doc-1", location: { kind: "path", path: "/a" } },
          { id: "dup", template: "MarketingView", documentId: "doc-2", location: { kind: "path", path: "/b" } },
        ],
      },
      knownTemplates,
    );
    expect(findings.map((finding) => finding.rule)).toContain("entry-id-duplicate");
  });
});

describe("publication map resolve helpers", () => {
  it("lists paths, finds by path, and finds by slide index", () => {
    expect(listPublicationMapPaths(validMap)).toEqual(["/marketing"]);
    expect(findPublicationMapEntryByPath(validMap, "/marketing")?.documentId).toBe("doc-marketing-home");
    expect(findPublicationMapEntryBySlideIndex(validMap, 0)?.template).toBe("PitchDeck");
  });

  it("validatePublicationMapRoutes fails when a route is missing from the map", () => {
    const findings = validatePublicationMapRoutes(["/marketing", "/pricing"], validMap);
    expect(findings.map((finding) => finding.rule)).toEqual(["route-missing-from-map"]);
    expect(findings[0]?.message).toContain("/pricing");
  });
});
