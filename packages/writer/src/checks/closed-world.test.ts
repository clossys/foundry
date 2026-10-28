import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { WriterCatalog } from "../catalog/ia/index.js";
import type { Block, ChromeNarrative, LongFormNarrative, PageNarrative, PassageRecord, PatternInstance, StringRecord, WriterLibrary, WriterRecord } from "../model/types.js";
import type { WriterCheckOptions, WriterDesignerEvidence } from "./freeze.js";
import { checkWriterClosedWorld, writerPassageSchemaDigest } from "./closed-world.js";

const common = { context: "Fixture copy", status: "draft", origin: "authored" } as const;
const contract = { kind: "passage", source: "writer", passageSchema: "passages.hero", copy: { fields: [] } };
// Pin the digest payload independently of catalog grouping and slot metadata.
const schemaDigest = createHash("sha256").update('{"copy":{"fields":[]},"kind":"passage","passageSchema":"passages.hero","source":"writer"}').digest("hex");
const catalog = (): WriterCatalog => ({
  placements: [],
  slots: [
    ["lexicon.preferred-terms", "lexicon"], ["lexicon.approved-claims", "lexicon"], ["strings.button-label", "string"],
    ["patterns.headline-subhead", "pattern"], ["narratives.page-story", "narrative"],
    ["narratives.site-chrome", "narrative"], ["narratives.article", "narrative"],
  ].map(([id, kind]) => ({ id: id!, layer: id!.split(".")[0]!, status: "draft", requires: [], contract: { kind, source: "writer" } }))
    .concat([{ id: "passages.hero", layer: "passages", status: "draft", requires: [], contract: structuredClone(contract) }]),
});
const designer = (): WriterDesignerEvidence => ({
  version: "fixture-v1", assets: ["assets.figure"], leaves: ["components.prose", "sections.figure"],
  configs: { "components.prose": ["body"], "sections.figure": [""] },
  frames: [{ id: "frames.page" }, { id: "frames.chrome", configs: ["main"] }, { id: "frames.article" }],
});
const string = (): StringRecord => ({ ...common, id: "st.0000000001", leaf: "strings.button-label", text: "Continue", assetRef: { assetId: "assets.figure", libraryVersion: "fixture-v1" } });
const pattern = (): PatternInstance => ({ ...common, id: "pt.0000000001", leaf: "patterns.headline-subhead", parts: { headline: { ref: { kind: "string", id: "st.0000000001" } }, subhead: { text: "Details" } } });
const passage = (): PassageRecord => ({ ...common, id: "ps.0000000001", leaf: "passages.hero", schema: "passages.hero", schemaDigest, fields: {
  heading: { ref: "pattern", id: "pt.0000000001", part: "headline" },
  description: [{ ref: "string", id: "st.0000000001" }, { ref: "term", id: "lx.0000000001" }, { ref: "pattern", id: "pt.0000000001" }],
} });
const chrome = (): ChromeNarrative => ({ ...common, id: "nr.0000000001", leaf: "narratives.site-chrome", frame: { frameId: "frames.chrome", configId: "main" }, regions: {
  footer: { label: { ref: "string", id: "st.0000000001" } },
} });
const page = (): PageNarrative => ({ ...common, id: "nr.0000000002", leaf: "narratives.page-story", frame: { frameId: "frames.page" }, chrome: "nr.0000000001", passages: ["ps.0000000001"] });
const block = (): Block => ({ type: "paragraph", designer: { id: "components.prose", configId: "body" }, text: "Details", claim: "lx.0000000002", children: [
  { type: "figure", designer: { id: "sections.figure", configId: "" }, assetRef: { assetId: "assets.figure", libraryVersion: "fixture-v1" } },
] });
const article = (): LongFormNarrative => ({ ...common, id: "nr.0000000003", leaf: "narratives.article", frame: { frameId: "frames.article" }, title: "st.0000000001", blocks: [block()] });
function library(extra: WriterRecord[] = []): WriterLibrary {
  return {
    manifest: { consumer: "example", defaultLocale: "en", locales: [{ tag: "en", dir: "ltr", state: "active" }], fallback: {}, strategist: { path: "strategy" },
      leafFreeze: { lexicon: "1", strings: "1", patterns: "1", passages: "1", narratives: "1" } },
    locales: { en: { documents: [], records: [
      { ...common, id: "lx.0000000001", leaf: "lexicon.preferred-terms", kind: "term", term: "Workspace", forms: [], termStatus: "preferred", reason: "Consistent naming" },
      { ...common, id: "lx.0000000002", leaf: "lexicon.approved-claims", kind: "claim", strategistClaimKey: "example", phrasings: ["Useful"], requiresCitation: true },
      string(), pattern(), passage(), chrome(), page(), article(), ...extra,
    ] } },
  };
}
const options = (): WriterCheckOptions => ({ catalog: catalog(), designerLibraries: [designer()] });
const check = (records: WriterRecord[], opts: WriterCheckOptions = options()) => {
  const value = library();
  value.locales.en!.records = records;
  return checkWriterClosedWorld(value, opts);
};

describe("WR3 closed-world references", () => {
  it("resolves every record form, nested refs, assets, configs, and pattern parts without mutation", () => {
    const value = library(), opts = options();
    const before = structuredClone({ value, opts });
    expect(checkWriterClosedWorld(value, opts)).toEqual([]);
    expect({ value, opts }).toEqual(before);
  });

  it("lets two pages share one passage without page bindings or ownership uniqueness", () => {
    const second = { ...page(), id: "nr.0000000004" as const };
    expect(checkWriterClosedWorld(library([second]), options())).toEqual([]);
    expect(passage()).not.toHaveProperty("binding");
  });

  it("resolves leaf IDs from slots independently of IA grouping", () => {
    const opts = options();
    opts.catalog!.placements = [{ layer: "passages", nodes: [{ id: "arbitrary-group", label: "Grouping", leaves: [] }] }];
    expect(checkWriterClosedWorld(library(), opts)).toEqual([]);
    const missing = { ...string(), leaf: "strings.missing" as const };
    expect(check([missing])).toContainEqual(expect.objectContaining({ code: "WR3", recordId: missing.id, field: "leaf" }));
    const wrongKind = { ...string(), leaf: "lexicon.preferred-terms" as const };
    expect(check([wrongKind])).toContainEqual(expect.objectContaining({ field: "leaf", message: expect.stringContaining("kind string") }));
  });

  it("rejects missing references in patterns, passages, chrome, pages, and long-form blocks", () => {
    const findings = check([pattern(), passage(), chrome(), page(), article()]);
    for (const field of ["parts.headline.ref.id", "fields.description[0].id", "fields.description[1].id", "regions.footer.label.id", "title", "blocks[0].claim"]) {
      expect(findings).toContainEqual(expect.objectContaining({ code: "WR3", severity: "error", field }));
    }
    const onlyPage = check([page()]);
    expect(onlyPage).toContainEqual(expect.objectContaining({ field: "chrome" }));
    expect(onlyPage).toContainEqual(expect.objectContaining({ field: "passages[0]" }));
  });

  it("requires exact target kinds, including term versus claim and chrome versus page", () => {
    const badPassage = passage();
    badPassage.fields = { heading: { ref: "term", id: "lx.0000000002" }, text: { ref: "string", id: "pt.0000000001" }, pattern: { ref: "pattern", id: "st.0000000001" } };
    const badPage = page();
    badPage.chrome = badPage.id;
    badPage.passages = ["st.0000000001"];
    const badArticle = article();
    badArticle.title = "pt.0000000001";
    badArticle.blocks[0]!.claim = "lx.0000000001";
    const value = library();
    value.locales.en!.records = value.locales.en!.records.map(record => record.id === badPassage.id ? badPassage : record.id === badPage.id ? badPage : record.id === badArticle.id ? badArticle : record);
    const findings = checkWriterClosedWorld(value, options());
    for (const field of ["fields.heading.id", "fields.text.id", "fields.pattern.id", "chrome", "passages[0]", "title", "blocks[0].claim"]) {
      expect(findings).toContainEqual(expect.objectContaining({ field, message: expect.stringContaining("must target") }));
    }
  });

  it("never uses fallback locales to satisfy a same-locale reference", () => {
    const value = library();
    value.manifest.fallback.fr = ["en"];
    value.manifest.locales.push({ tag: "fr", dir: "ltr", state: "active" });
    value.locales.fr = { documents: [], records: [pattern()] };
    expect(checkWriterClosedWorld(value, options())).toEqual([
      expect.objectContaining({ code: "WR3", locale: "fr", recordId: "pt.0000000001", field: "parts.headline.ref.id", message: expect.stringContaining("locale fr") }),
    ]);
  });

  it("rejects retired and ambiguous record targets", () => {
    const retired = { ...string(), status: "retired" as const };
    expect(check([retired, pattern()])).toContainEqual(expect.objectContaining({ field: "parts.headline.ref.id", message: expect.stringContaining("retired") }));
    const duplicate = check([string(), string(), pattern()]);
    expect(duplicate.filter(item => item.field === "id")).toHaveLength(2);
    expect(duplicate).toContainEqual(expect.objectContaining({ field: "parts.headline.ref.id", message: expect.stringContaining("exactly one") }));
  });

  it("rejects missing pattern parts and preserves valid whole-pattern references", () => {
    const value = passage();
    value.fields = { heading: { ref: "pattern", id: "pt.0000000001", part: "missing" } };
    expect(check([string(), pattern(), value])).toEqual([expect.objectContaining({ field: "fields.heading.part" })]);
  });

  it("checks passage schema identity and the digest of the live contract", () => {
    expect(writerPassageSchemaDigest(contract)).toBe(schemaDigest);
    expect(writerPassageSchemaDigest({ copy: { fields: [] }, source: "writer", passageSchema: "passages.hero", kind: "passage" })).toBe(schemaDigest);
    const wrongSchema = { ...passage(), schema: "passages.missing" as const, fields: {} };
    const missing = check([wrongSchema]);
    expect(missing).toContainEqual(expect.objectContaining({ field: "schema", message: expect.stringContaining("equal its leaf") }));
    expect(missing).toContainEqual(expect.objectContaining({ field: "schema", message: expect.stringContaining("exactly one slot") }));
    expect(check([{ ...passage(), schemaDigest: "stale", fields: {} }])).toEqual([expect.objectContaining({ field: "schemaDigest" })]);
    const opts = options();
    opts.catalog!.slots.find(slot => slot.id === "passages.hero")!.contract.copy = { fields: [{ key: "heading" }] };
    expect(check([{ ...passage(), fields: {} }], opts)).toEqual([expect.objectContaining({ field: "schemaDigest" })]);
    const wrongContract = options();
    wrongContract.catalog!.slots.find(slot => slot.id === "passages.hero")!.contract.passageSchema = "passages.other";
    expect(check([{ ...passage(), fields: {} }], wrongContract)).toContainEqual(expect.objectContaining({ field: "schema", message: expect.stringContaining("catalog contract") }));
  });

  it("accepts literal long-form titles and checks referenced string titles", () => {
    expect(check([{ ...article(), title: "A useful article", blocks: [] }])).toEqual([]);
    expect(check([{ ...article(), blocks: [] }])).toEqual([expect.objectContaining({ field: "title" })]);
  });
});

describe("WR3 consumer Designer evidence", () => {
  it("fails closed when Designer evidence is absent, blank-versioned, or ambiguous", () => {
    const value = { ...page(), chrome: undefined, passages: [] };
    for (const designerLibraries of [undefined, [], [{ ...designer(), version: "" }], [designer(), { ...designer(), version: "fixture-v2" }]]) {
      expect(check([value], { catalog: catalog(), designerLibraries })).toEqual([expect.objectContaining({ field: "frame.frameId", message: expect.stringContaining("exactly one versioned") })]);
    }
    expect(check([string()], { catalog: catalog() })).toEqual([expect.objectContaining({ field: "assetRef.libraryVersion" })]);
  });

  it("requires the asset's exact library version and exact registered asset ID", () => {
    expect(check([{ ...string(), assetRef: { assetId: "assets.figure", libraryVersion: "fixture-v2" } }])).toEqual([expect.objectContaining({ field: "assetRef.libraryVersion" })]);
    expect(check([{ ...string(), assetRef: { assetId: "assets.missing", libraryVersion: "fixture-v1" } }])).toEqual([expect.objectContaining({ field: "assetRef.assetId" })]);
    const opts = options();
    opts.designerLibraries = [designer(), { ...designer(), version: "fixture-v2", assets: ["assets.other"] }];
    expect(check([string()], opts)).toEqual([]);
    opts.designerLibraries = [designer(), designer()];
    expect(check([string()], opts)).toEqual([expect.objectContaining({ field: "assetRef.libraryVersion" })]);
  });

  it("requires registered frames, Designer leaves, and their explicit configs", () => {
    const badChrome = { ...chrome(), regions: {}, frame: { frameId: "frames.missing", configId: "main" } };
    expect(check([badChrome])).toEqual([expect.objectContaining({ field: "frame.frameId" })]);
    expect(check([{ ...chrome(), regions: {}, frame: { frameId: "frames.chrome", configId: "missing" } }])).toEqual([expect.objectContaining({ field: "frame.configId" })]);
    const badBlock: Block = { ...block(), designer: { id: "components.missing", configId: "body" }, children: [], claim: undefined };
    expect(check([{ ...article(), title: "Literal", blocks: [badBlock] }])).toEqual([expect.objectContaining({ field: "blocks[0].designer.id" })]);
    badBlock.designer = { id: "components.prose", configId: "missing" };
    expect(check([{ ...article(), title: "Literal", blocks: [badBlock] }])).toEqual([expect.objectContaining({ field: "blocks[0].designer.configId" })]);
  });

  it("requires evidence for nested block assets and treats empty configs as explicitly registered defaults", () => {
    const value = article();
    value.title = "Literal";
    value.blocks[0]!.claim = undefined;
    value.blocks[0]!.children![0]!.assetRef!.libraryVersion = "fixture-v2";
    expect(check([value])).toEqual([expect.objectContaining({ field: "blocks[0].children[0].assetRef.libraryVersion" })]);
    const opts = options();
    opts.designerLibraries = [{ ...designer(), configs: { "components.prose": ["body"] } }];
    value.blocks[0]!.children![0]!.assetRef!.libraryVersion = "fixture-v1";
    expect(check([value], opts)).toEqual([expect.objectContaining({ field: "blocks[0].children[0].designer.configId" })]);
  });
});
