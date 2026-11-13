import { describe, expect, it } from "vitest";
import { parseWriterCell } from "./parse.js";

/** Writer candidate Markdown grammar. The legacy cells/tree.json store and its compile/migrate verbs are retired (R-FLAT-SLOTS). */
describe("Writer candidate Markdown grammar", () => {
  const document = [
    "---", "id: sample.auth", "version: 1", "status: draft", "updated: 2026-10-29", "links: []", "locales: [en]", "---", "", "## en", "### sample.auth.title",
    '<!-- {"id":"st.0000000001","leaf":"strings.page-titles","status":"draft","origin":"foundry-default","bindings":[]} -->',
    "A generic heading", "",
  ].join("\n");

  it("reads record text and metadata from authored Markdown independently of serialization", () => {
    const parsed = parseWriterCell(document, "cells/sample.auth/v1.md");
    expect(parsed.id).toBe("sample.auth");
    expect(parsed.records).toEqual([{ locale: "en", record: { id: "st.0000000001", leaf: "strings.page-titles", status: "draft", origin: "foundry-default", context: "sample.auth.title", text: "A generic heading" }, bindings: [] }]);
  });

  it("rejects a frontmatter id that disagrees with its permanent path", () => {
    expect(() => parseWriterCell(document, "cells/sample.other/v1.md")).toThrow(/id|path/i);
  });

  it("rejects a frontmatter version that disagrees with its path", () => {
    expect(() => parseWriterCell(document, "cells/sample.auth/v2.md")).toThrow(/version|path/i);
  });

  it("rejects grouping segments inside Writer cell ids", () => {
    expect(() => parseWriterCell(document.replace("id: sample.auth", "id: sample.group.auth"))).toThrow(/id/i);
  });

  it("rejects unknown frontmatter keys instead of silently losing authored data", () => {
    expect(() => parseWriterCell(document.replace("links: []", "links: []\nunknown: value"))).toThrow(/unknown|key|field/i);
  });

  it("rejects locale sections absent from the declared locale profile", () => {
    expect(() => parseWriterCell(document.replace("## en", "## ar"))).toThrow(/locale|section/i);
  });
});
