import { describe, expect, it } from "vitest";
import { WRITER_LAYERS, isValidWriterLeafId, isWriterLayer } from "./ids.js";

describe("Writer leaf identity", () => {
  it("exports the ordered five-layer vocabulary", () => {
    expect(WRITER_LAYERS).toEqual(["lexicon", "strings", "patterns", "passages", "narratives"]);
  });
  it.each(["lexicon", "strings", "patterns", "passages", "narratives"])("accepts layer %s", layer => {
    expect(isWriterLayer(layer)).toBe(true);
    expect(isValidWriterLeafId(`${layer}.example-2`)).toBe(true);
  });
  it.each([undefined, null, 1, {}, "Lexicon", "tokens", "lexicon.extra", " lexicon", "lexicon\n"])("rejects layer %s", layer => {
    expect(isWriterLayer(layer)).toBe(false);
  });
  it.each(["lexicon.term", "strings.action-label", "patterns.error-404", "passages.hero", "narratives.story-2"])("accepts leaf %s", id => {
    expect(isValidWriterLeafId(id)).toBe(true);
  });
  it.each([
    undefined, null, 1, {}, "", "term", "tokens.term", "Lexicon.term", "lexicon.Term", "lexicon.2term",
    "lexicon.-term", "lexicon.term-", "lexicon.term--name", "lexicon.term_name", "lexicon.term.name",
    "lexicon..term", "lexicon.term.", "lexicon.térm", "lexicon.tеrm", "lexicon.ｔerm", "lexicon.term\n", "lexicon.term\r", "lexicon.term\r\n",
    " lexicon.term", "lexicon.term ",
  ])("rejects malformed leaf %s", id => expect(isValidWriterLeafId(id)).toBe(false));
});
