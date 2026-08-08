import { describe, expect, it } from "vitest";
import type { WebMeta } from "@vespeneventures/compose";
import { buildWebHeadMetadata } from "./headMetadata.js";

describe("buildWebHeadMetadata", () => {
  it("carries required fields straight through and defaults jsonLd to an empty array", () => {
    const meta: WebMeta = { channel: "web", title: "T", description: "D" };
    expect(buildWebHeadMetadata(meta)).toEqual({
      title: "T",
      description: "D",
      jsonLd: [],
    });
  });

  it("omits every optional key that WebMeta itself did not set — not present as undefined", () => {
    const meta: WebMeta = { channel: "web", title: "T", description: "D" };
    const head = buildWebHeadMetadata(meta);
    expect(Object.keys(head).sort()).toEqual(["description", "jsonLd", "title"]);
  });

  it("carries canonical, robots, and keywords through verbatim when present", () => {
    const meta: WebMeta = {
      channel: "web",
      title: "T",
      description: "D",
      canonical: "https://example.com/p",
      robots: "noindex, nofollow",
      keywords: ["a", "b"],
    };
    const head = buildWebHeadMetadata(meta);
    expect(head.canonical).toBe("https://example.com/p");
    expect(head.robots).toBe("noindex, nofollow");
    expect(head.keywords).toEqual(["a", "b"]);
  });

  it("copies keywords into a new array rather than aliasing WebMeta's own", () => {
    const keywords = ["a", "b"];
    const meta: WebMeta = { channel: "web", title: "T", description: "D", keywords };
    const head = buildWebHeadMetadata(meta);
    expect(head.keywords).not.toBe(keywords);
    expect(head.keywords).toEqual(keywords);
  });

  it("renames og -> openGraph and only includes the og fields WebMeta itself set", () => {
    const meta: WebMeta = {
      channel: "web",
      title: "T",
      description: "D",
      og: { title: "OG title" },
    };
    const head = buildWebHeadMetadata(meta);
    expect(head.openGraph).toEqual({ title: "OG title" });
    expect(head.openGraph).not.toHaveProperty("description");
    expect(head.openGraph).not.toHaveProperty("image");
    expect(head.openGraph).not.toHaveProperty("type");
  });

  it("carries twitter through, field by field", () => {
    const meta: WebMeta = {
      channel: "web",
      title: "T",
      description: "D",
      twitter: { card: "summary_large_image", site: "@acme" },
    };
    const head = buildWebHeadMetadata(meta);
    expect(head.twitter).toEqual({ card: "summary_large_image", site: "@acme" });
  });

  it("serializes and escapes every jsonLd entry independently, preserving order", () => {
    const meta: WebMeta = {
      channel: "web",
      title: "T",
      description: "D",
      jsonLd: [
        { "@type": "WebPage", name: "One" },
        { "@type": "BreadcrumbList", name: "Two" },
      ],
    };
    const head = buildWebHeadMetadata(meta);
    expect(head.jsonLd).toEqual([
      '{"@type":"WebPage","name":"One"}',
      '{"@type":"BreadcrumbList","name":"Two"}',
    ]);
  });
});
