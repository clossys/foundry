import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { editorialDate } from "../../blocks/PageHeaderMetadata.js";
import { renderPageHeader } from "./page-header.js";
import { renderCards } from "./cards.js";
import { renderLinkIndex } from "./link-index.js";

const input = (leaf: string, config: string, content: Record<string, unknown>, locale?: string) => ({
  locale, selection: { leaf: `sections.${leaf}`, config, members: [] },
  content: Object.fromEntries(Object.entries(content).map(([key, value]) => [key, { value }])),
}) as unknown as RuntimeRenderInput<ReactNode>;
const metadata = {
  author: { name: "ExampleCo editor", label: "Written by", href: "/authors/editor" },
  date: { value: "2026-10-29", label: "Published" },
  readingTime: { value: "8 min", label: "Reading time" },
  tags: [{ id: "guides", label: "Guides", href: "/guides" }],
};
const image = { slot: "assets.image", kind: "photo", src: "/exampleco/cover.webp", alt: "ExampleCo sample cover", width: 1200, height: 800,
  sources: [{ media: "(min-width: 48rem)", src: "/exampleco/cover-large.webp", width: 1800, height: 1200 }] };
const html = (node: ReactNode) => renderToStaticMarkup(node);
const json = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

describe("editorial section configurations", () => {
  it("renders article metadata with the page locale and a native machine-readable date", () => {
    const de = html(renderPageHeader(input("page-header", "article", { title: "ExampleCo guide", meta: metadata }, "de-DE")));
    expect(de).toContain('<time dateTime="2026-10-29">');
    expect(de).toContain(new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeZone: "UTC" }).format(new Date("2026-10-29T00:00:00Z")));
    for (const copy of ["ExampleCo editor", "Written by", "Published", "Reading time", "8 min", "Guides"]) expect(de).toContain(copy);
    expect(de).toContain('href="/authors/editor"');
    expect(de).toContain('href="/guides"');
    const ja = html(renderPageHeader(input("page-header", "article", { title: "ExampleCo guide", meta: metadata }, "ja-JP")));
    expect(ja).toContain(editorialDate("2026-10-29", "ja-JP"));
    expect(ja).not.toEqual(de);
  });

  it("refuses an absent/invalid page locale and invalid calendar dates", () => {
    expect(() => editorialDate("2026-10-29", undefined)).toThrow(/page locale/);
    expect(() => editorialDate("2026-10-29", "bad_locale")).toThrow();
    for (const date of ["2026-02-30", "2026-13-01", "not-a-date", "2026-1-2"]) expect(() => editorialDate(date, "en-GB")).toThrow(/valid ISO/);
    expect(editorialDate("2024-02-29", "en-GB")).toContain("29");
  });

  it("renders case-study summary and labelled outcomes without added labels", () => {
    const markup = html(renderPageHeader(input("page-header", "case-study", { title: "ExampleCo case study", meta: { summary: "A sample project summary", outcomeStats: [{ id: "time", label: "Time saved", value: "25%" }] } })));
    expect(markup).toContain("A sample project summary");
    expect(markup).toContain("Time saved");
    expect(markup).toContain("25%");
    expect(markup).not.toContain("Published");
  });

  it.each(["post", "post-featured", "case-study"])("renders %s cards with registered responsive image and metadata", config => {
    const markup = html(renderCards(input("cards", config, { records: [{ id: "one", title: "ExampleCo story", href: "/story", image, editorial: metadata }] }, "en-GB")));
    expect(markup).toContain(`data-card-config="${config}"`);
    expect(markup).toContain('data-asset-slot="assets.image"');
    expect(markup).toContain('alt="ExampleCo sample cover"');
    expect(markup).toContain('srcSet="/exampleco/cover-large.webp 1800w"');
    expect(markup).toContain(editorialDate("2026-10-29", "en-GB"));
    expect(markup).toContain('href="/story"');
    if (config === "post-featured") expect(markup).not.toContain("desktop:grid-cols-3");
  });

  it("refuses undeclared image resources and unresolved Writer metadata", () => {
    expect(() => renderCards(input("cards", "post", { records: [{ id: "one", title: "ExampleCo", image: { ...image, slot: "assets.video" } }] }))).toThrow(/assets.image/);
    expect(() => renderPageHeader(input("page-header", "article", { title: "ExampleCo", meta: { author: {} } }))).toThrow(/requires name/);
    expect(() => renderPageHeader(input("page-header", "article", { title: "ExampleCo", meta: { tags: [{ id: "one" }] } }))).toThrow(/requires label/);
  });

  it("renders the roles configuration as real destination links with caller-owned detail labels", () => {
    const markup = html(renderLinkIndex(input("link-index", "roles", { links: [{ id: "designer", title: "Designer", href: "/roles/designer", description: "Sample role", details: [{ id: "location", label: "Location", value: "Remote" }] }] })));
    expect(markup).toContain('data-link-index-config="roles"');
    expect(markup).toContain('href="/roles/designer"');
    expect(markup).toContain("Location");
    expect(markup).toContain("Remote");
    expect(markup).not.toContain("<button");
    expect(() => renderLinkIndex(input("link-index", "roles", { links: [{ id: "one", title: "ExampleCo" }] }))).toThrow(/destination/);
  });

  it("publishes the exact configuration names and Writer fields from the canonical schemas", () => {
    for (const [leaf, configs] of [["page-header", ["article", "case-study"]], ["cards", ["case-study", "post", "post-featured"]], ["link-index", ["roles"]]] as const) {
      const fill = json(`../../catalog/fills/foundry/sections.${leaf}.json`);
      expect(Object.keys(fill.sections[leaf].configs).sort()).toEqual([...configs].sort());
      const section = json("../../catalog/slots/sections.json").find((row: { id: string }) => row.id === `sections.${leaf}`);
      const passage = json("../../../../writer/src/catalog/slots/passages.json").find((row: { id: string }) => row.id === `passages.${leaf}`);
      expect(passage.contract.copy).toEqual(section.contract.copy);
      expect(passage.status).toBe("draft");
    }
    const fields = json("../../catalog/slots/sections.json").find((row: { id: string }) => row.id === "sections.page-header").contract.copy.fields.map((field: { key: string }) => field.key);
    for (const key of ["meta.author.name", "meta.date.label", "meta.readingTime.value", "meta.tags[].label", "meta.summary", "meta.outcomeStats[].label", "meta.outcomeStats[].value"]) expect(fields).toContain(key);
  });
});
