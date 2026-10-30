import { describe, expect, it } from "vitest";
import { pages, studio, chat, arabic } from "./__fixtures__/copy.mjs";
import { prepareAdminPageCopyEnvelopes } from "./admin-copy-source.js";
import { createAdminPageCopy } from "./admin-copy.js";

const inputs = () => [
  { source: "admin-pages.r1.en.json", envelope: structuredClone(pages) },
  { source: "admin-studio.r1.en.json", envelope: structuredClone(studio) },
  { source: "admin-chat.r1.en.json", envelope: structuredClone(chat) },
  { source: "admin-pages.r1.ar.json", envelope: structuredClone(arabic) },
];

describe("server-side Writer draft envelope boundary", () => {
  it("keeps authentic optional fields, draft status and locale unchanged", () => {
    const source = inputs(), prepared = prepareAdminPageCopyEnvelopes(source);
    const original = source[0]!.envelope.records.find(record => !("limits" in record))!;
    expect(original).toBeDefined();
    const originalText = original.text;
    const record = prepared[0]!.envelope.records.find(record => record.id === original.id)!;
    expect(record).toEqual(original);
    expect(record).not.toHaveProperty("limits");
    expect(prepared[0]!.envelope.activation).toBe(source[0]!.envelope.activation);
    expect(prepared[0]!.envelope.state).toBe(source[0]!.envelope.state);
    expect(prepared[3]!.envelope.locale).toBe("ar");
    expect(Object.isFrozen(record)).toBe(true);
    source[0]!.envelope.records.find(record => record.id === original.id)!.text = "changed after preparation";
    expect(record.text).toBe(originalText);
  });

  it("uses Writer validation to refuse malformed draft records before client resolution", () => {
    const source = inputs();
    source[0]!.envelope.records[0]!.id = "not-a-writer-record";
    expect(() => prepareAdminPageCopyEnvelopes(source)).toThrow("Writer refused source string-record validation");
    expect(() => prepareAdminPageCopyEnvelopes([{ source: "", envelope: pages }])).toThrow(/source envelope/);
    expect(() => prepareAdminPageCopyEnvelopes([{ source: "admin-pages.r1.en.json", envelope: { ...pages, records: [{ ...pages.records[0], limits: { maxChars: -1 } }] } }])).toThrow(/Writer refused/);
  });

  it("refuses an alias without its declared Writer cell binding", () => {
    const source = inputs();
    source[0]!.envelope.bindings = source[0]!.envelope.bindings.filter(binding => binding.cellId !== "strings.admin.page.writer");
    const copy = createAdminPageCopy({ locale: "en", envelopes: prepareAdminPageCopyEnvelopes(source) });
    expect(() => copy("strings.admin.page.writer")).toThrow(/one bound record/);
  });
});
