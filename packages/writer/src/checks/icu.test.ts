import { describe, expect, it } from "vitest";
import type { StringRecord, WriterLibrary, WriterRecord } from "../model/types.js";
import { checkWriterICU } from "./icu.js";

const string = (text: string, args: StringRecord["args"] = []): StringRecord => ({ id: "st.0123456789", leaf: "strings.actions", context: "Action", status: "draft", origin: "authored", text, args });
const library = (source: WriterRecord[], targets: Record<string, WriterRecord[]> = {}): WriterLibrary => ({
  manifest: { consumer: "example", defaultLocale: "en", locales: ["en", ...Object.keys(targets)].map(tag => ({ tag, dir: "ltr", state: "active" })), fallback: {}, strategist: { path: "strategist" }, leafFreeze: { lexicon: "", strings: "", patterns: "", passages: "", narratives: "" } },
  locales: Object.fromEntries(Object.entries({ en: source, ...targets }).map(([tag, records]) => [tag, { records, documents: [] }])),
});

describe("WR8 ICU validation", () => {
  it("accepts nested syntax and exact model declarations", () => {
    const text = "{n, plural, offset:1 =0 {Nobody} one {{who, select, person {A person} other {Someone}}} other {# guests}} {when, time, short}";
    const args: StringRecord["args"] = [{ name: "n", type: "plural" }, { name: "who", type: "select" }, { name: "when", type: "date" }];
    expect(checkWriterICU(library([string(text, args)]))).toEqual([]);
  });

  it("requires declared argument names and normalized types to match the text exactly", () => {
    const findings = checkWriterICU(library([string("{name} {count, number}", [{ name: "name", type: "number" }, { name: "extra", type: "string" }])]));
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "WR8", field: "text", message: expect.stringContaining("name uses string") }),
      expect.objectContaining({ message: expect.stringContaining("count (number) is not declared") }),
      expect.objectContaining({ message: expect.stringContaining("extra is missing") }),
    ]));
    expect(checkWriterICU(library([string("{x}", [{ name: "x", type: "string" }, { name: "x", type: "string" }])]))).toContainEqual(expect.objectContaining({ message: expect.stringContaining("declared more than once") }));
  });

  it("rejects incompatible repeated argument uses rather than guessing a type", () => {
    expect(checkWriterICU(library([string("{n} {n, plural, other {#}}", [{ name: "n", type: "plural" }])]))).toContainEqual(expect.objectContaining({ message: expect.stringContaining("n uses string") }));
  });

  it("checks cardinal and ordinal categories against each target locale", () => {
    const args: StringRecord["args"] = [{ name: "n", type: "plural" }];
    expect(checkWriterICU(library([string("{n, plural, one {one} other {many}}", args)], {
      ru: [string("{n, plural, one {one} few {few} many {many} other {other}}", args)],
      ar: [string("{n, plural, zero {zero} one {one} two {two} few {few} many {many} other {other}}", args)],
    }))).toEqual([]);
    expect(checkWriterICU(library([string("{n, plural, two {two} other {other}}", args)]))).toContainEqual(expect.objectContaining({ message: expect.stringContaining("two is not valid for en cardinal") }));
    expect(checkWriterICU(library([string("{n, selectordinal, one {first} two {second} few {third} other {later}}", args)]))).toEqual([]);
    expect(checkWriterICU(library([string("{n, plural, =2 {two} other {many}}", args)]))).toEqual([]);
  });

  it("reports unsupported plural locales instead of silently falling back", () => {
    const args: StringRecord["args"] = [{ name: "n", type: "plural" }];
    expect(checkWriterICU(library([], { zz: [string("{n, plural, other {#}}", args)] }))).toContainEqual(expect.objectContaining({ locale: "zz", incomplete: true, message: expect.stringContaining("unsupported locale") }));
  });

  it("requires target names and types to match the source even if both declarations are locally valid", () => {
    const findings = checkWriterICU(library([string("Hi {name}", [{ name: "name", type: "string" }])], {
      fr: [string("Salut {person}", [{ name: "person", type: "string" }])],
      de: [string("{name, number}", [{ name: "name", type: "number" }])],
    }));
    expect(findings.filter(finding => finding.message.includes("match source"))).toHaveLength(2);
  });

  it("treats time/date and selectordinal/plural as the declared model types", () => {
    const args: StringRecord["args"] = [{ name: "when", type: "date" }, { name: "rank", type: "plural" }];
    expect(checkWriterICU(library([string("{when, date} {rank, plural, other {#}}", args)], { fr: [string("{when, time} {rank, selectordinal, other {#}}", args)] }))).toEqual([]);
  });

  it("validates pattern literals and recursive long-form text and fails closed on undeclarable arguments", () => {
    const common = { context: "Copy", status: "draft", origin: "authored" } as const;
    const records: WriterRecord[] = [
      { ...common, id: "pt.0123456789", leaf: "patterns.headline-subhead", parts: { headline: { text: "Hello {name}" } } },
      { ...common, id: "nr.0123456789", leaf: "narratives.article", title: "Article", frame: { frameId: "article" }, blocks: [{ type: "paragraph", designer: { id: "components.prose", configId: "body" }, children: [{ type: "paragraph", designer: { id: "components.prose", configId: "body" }, text: "Broken }" }] }] },
      { ...common, id: "lx.0123456789", leaf: "lexicon.claims", kind: "claim", strategistClaimKey: "claim", requiresCitation: true, phrasings: ["{value, number}"] },
    ];
    const findings = checkWriterICU(library(records));
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "parts.headline.text", message: expect.stringContaining("Only String records") }),
      expect.objectContaining({ field: "blocks[0].children[0].text", message: expect.stringContaining("closing brace") }),
      expect.objectContaining({ field: "phrasings[0]", message: expect.stringContaining("Only String records") }),
    ]));
  });

  it("checks narrative Markdown source without treating it as a declaration scope", () => {
    const value = library([]);
    value.locales.en!.documents.push({ path: "narratives/article.md", source: "# Hello {name}" });
    expect(checkWriterICU(value)).toContainEqual(expect.objectContaining({ path: "locales.en.narratives/article.md", field: "source", message: expect.stringContaining("Only String records") }));
  });

  it("reports syntax errors with a field and offset and does not infer argument drift from invalid parses", () => {
    const findings = checkWriterICU(library([string("Hello")], { fr: [string("{n, plural, one {one}}", [{ name: "n", type: "plural" }])] }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: "WR8", severity: "error", locale: "fr", recordId: "st.0123456789", field: "text", message: expect.stringContaining("other branch") });
    expect(findings[0]?.message).toContain("offset");
  });
});
