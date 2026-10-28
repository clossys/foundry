import { describe, expect, it } from "vitest";
import type { CopyField } from "./composition.js";
import { computeContentDigest } from "./digest.js";
import { checkPageMetadata, outputPathFor, robotsFor } from "./metadata.js";
import type { CandidateContent, ContentSlot } from "./model.js";
import { createContentRevision } from "./revisions.js";
import type { ContentTree } from "./taxonomy.js";
import { contentFixture, registryFixture } from "./validate.test.js";
import { validateCandidateContent, validateContentRegistry, validateContentSlot } from "./validate.js";

const slotFixture = (): ContentSlot => registryFixture().slots[0] as ContentSlot;
const copy = (key: string, locale = "en", value = "Sample"): CopyField => ({ key, locale, value, source: "writer" });
const content = (pageMeta?: readonly CopyField[]): CandidateContent => ({ ...contentFixture(), ...(pageMeta === undefined ? {} : { pageMeta }) }) as CandidateContent;

describe("page metadata", () => {
  it("reports malformed copy before checking required text", () => {
    const malformed = { ...content(), pageMeta: [{ key: "title", locale: "en", value: 42, source: "writer" }] } as unknown as CandidateContent;
    expect(() => checkPageMetadata(slotFixture(), malformed)).not.toThrow();
    expect(checkPageMetadata(slotFixture(), malformed)).toContainEqual(expect.objectContaining({ rule: "string" }));
  });
  it("keeps missing metadata structurally readable while reporting required copy", () => {
    const slot = slotFixture();
    expect(validateCandidateContent(content())).toEqual([]);
    expect(checkPageMetadata(slot, content()).map(f => f.path)).toEqual(["content.pageMeta.en.title", "content.pageMeta.en.description"]);
    expect(checkPageMetadata(slot, content([copy("title"), copy("description")]))).toEqual([]);
    expect(checkPageMetadata(slot, content([copy("title", "en", " "), copy("description")]))).toContainEqual(expect.objectContaining({ path: "content.pageMeta.en.title", rule: "required-page-metadata" }));
  });
  it("derives default robots policy from kind and the selected tree child", () => {
    const slot = slotFixture();
    expect(robotsFor(slot)).toBe("index");
    expect(robotsFor({ ...slot, l2: "auth" })).toBe("noindex");
    expect(robotsFor({ ...slot, kind: "status" })).toBe("noindex");
    expect(robotsFor({ ...slot, kind: "redirect" })).toBe("noindex");
    const tree: ContentTree = { schemaVersion: 1, nodes: [{ id: "websites", label: "Websites", children: [{ id: "members", label: "Members", frame: "frames.auth-shell" }] }] };
    const custom = { ...slot, l2: "members" };
    expect(robotsFor(custom, tree)).toBe("noindex");
    expect(robotsFor({ ...custom, meta: { robots: "index" } }, tree)).toBe("index");
    expect(validateContentSlot(custom, tree)).toEqual([]);
    expect(validateContentRegistry({ ...registryFixture(), slots: [custom] }, tree)).toEqual([]);
  });
  it("allows description on noindex slots without requiring it", () => {
    const slot: ContentSlot = { ...slotFixture(), meta: { robots: "noindex" } };
    expect(checkPageMetadata(slot, content([copy("title")]))).toEqual([]);
    expect(checkPageMetadata(slot, content([copy("title"), copy("description", "en", "")]))).toEqual([]);
  });
  it("requires exact locale selections without requiring optional share copy", () => {
    const slot = { ...slotFixture(), locales: ["en-US", "fr"] };
    const fields = [copy("title", "en-US"), copy("description", "en-US"), copy("share-title", "en-US"), copy("title", "fr"), copy("description", "fr")];
    expect(checkPageMetadata(slot, content(fields))).toEqual([]);
    expect(checkPageMetadata(slot, content([...fields, copy("share-text", "fr", "")]))).toEqual([]);
    expect(checkPageMetadata(slot, content([...fields, copy("share-title", "fr")]))).toEqual([]);
    const findings = checkPageMetadata(slot, content([copy("title", "en"), copy("description", "en")]));
    expect(findings.some(f => f.rule === "slot-locale")).toBe(true);
    expect(findings.some(f => f.path === "content.pageMeta.en-US.title")).toBe(true);
  });
  it("validates writer fields and only Designer asset id shapes", () => {
    expect(validateCandidateContent({ ...content([copy("title")]), pageMetaAssets: { "og-image": "assets.sample.hero", icon: "assets.sample-icon" } })).toEqual([]);
    for (const pageMeta of [[{ ...copy("title"), source: "manual" }], [copy("unknown")], [{ ...copy("title"), value: 7 }], [copy("title"), copy("title")]]) {
      expect(validateCandidateContent({ ...content(), pageMeta }).length).toBeGreaterThan(0);
    }
    for (const pageMetaAssets of [{ icon: "words" }, { icon: 7 }, { icon: { assetId: "assets.sample" } }, { "share-image": "assets.sample" }]) {
      expect(validateCandidateContent({ ...content(), pageMetaAssets }).length).toBeGreaterThan(0);
    }
  });
  it("validates robots and absolute HTTP canonical URL shapes", () => {
    const slot = slotFixture();
    expect(validateContentSlot({ ...slot, meta: { robots: "index", canonical: "https://example.com/sample" } })).toEqual([]);
    expect(validateContentSlot({ ...slot, meta: { canonical: "http://example.com/" } })).toEqual([]);
    for (const meta of [null, [], { robots: "follow" }, { canonical: "/sample" }, { canonical: "https://" }, { canonical: "ftp://example.com/" }, { canonical: 7 }]) {
      expect(validateContentSlot({ ...slot, meta }).length).toBeGreaterThan(0);
    }
  });
  it("snapshots metadata without rewriting legacy digests or admitting slot workflow", () => {
    const legacy = content();
    const baseline = computeContentDigest(legacy);
    const draft = { ...legacy, pageMeta: [copy("title")], pageMetaAssets: { icon: "assets.sample" } };
    const snapshot = createContentRevision(draft, "r1", "2026-01-01T00:00:00Z");
    expect(computeContentDigest(draft)).not.toBe(baseline);
    expect(computeContentDigest({ ...legacy, pageMeta: undefined, pageMetaAssets: undefined })).toBe(baseline);
    draft.pageMeta[0] = copy("title", "en", "Changed");
    draft.pageMetaAssets.icon = "assets.other";
    expect(snapshot.content.pageMeta?.[0]?.value).toBe("Sample");
    expect(snapshot.content.pageMetaAssets?.icon).toBe("assets.sample");
    expect(Object.isFrozen(snapshot.content.pageMeta?.[0])).toBe(true);
    expect(computeContentDigest({ ...legacy, meta: { canonical: "https://example.com/" } } as CandidateContent)).toBe(baseline);
  });
});

describe("logical output paths", () => {
  it("refuses authored output fields on the stored slot", () => {
    for (const key of ["outputPath", "fileName"]) {
      expect(validateContentSlot({ ...slotFixture(), [key]: "authored.tsx" })).toContainEqual(expect.objectContaining({ rule: "derived-output-path" }));
    }
  });
  it("derives deterministic paths with collision-free encoded segments", () => {
    expect(outputPathFor({ deployTarget: "sample", route: "/" })).toBe("sample/app/page.tsx");
    expect(outputPathFor({ deployTarget: "sample", route: "/guides/start" })).toBe("sample/app/guides/start/page.tsx");
    const values = [
      { deployTarget: "sample/a", route: "/one.two" },
      { deployTarget: "sample", route: "/a/one.two" },
      { deployTarget: "sample", route: "/a/one%2Etwo" },
      { deployTarget: "..", route: "/hello world" },
    ];
    const paths = values.map(outputPathFor);
    expect(new Set(paths).size).toBe(values.length);
    expect(paths[0]).toBe("sample%2Fa/app/one%2Etwo/page.tsx");
    expect(paths[3]).toBe("%2E%2E/app/hello%20world/page.tsx");
    expect(values.map(outputPathFor)).toEqual(paths);
  });
  it.each([undefined, "relative", "https://example.com/", "//sample", "/a//b", "/a/", "/a?x=1", "/a#part", "/../a", "/a/./b", "/%2e%2e/a", "/a\\b", "/bad%escape"])("rejects noncanonical route %s", route => {
    expect(() => outputPathFor({ deployTarget: "sample", route })).toThrow(TypeError);
  });
  it.each([undefined, "", " "])("requires a deploy target %s", deployTarget => {
    expect(() => outputPathFor({ deployTarget, route: "/" })).toThrow(TypeError);
  });
});
