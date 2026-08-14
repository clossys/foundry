import { describe, expect, it } from "vitest";
import { validateStructuredDocument } from "./validate.js";
import type { StructuredDocument } from "./types.js";

// Minimal, obviously-fictional fixtures — the same "acme" placeholder
// convention this repository's tests already use throughout. Never real
// product prose.

const ref = (id: string) => ({ id });

function minimalDoc(overrides: Partial<StructuredDocument> = {}): StructuredDocument {
  return {
    id: "acme.help.getting-started",
    title: ref("acme.help.title"),
    sections: [],
    ...overrides,
  };
}

describe("validateStructuredDocument — shape and the empty/degenerate cases", () => {
  it("accepts an empty document (sections: []) with zero findings", () => {
    expect(validateStructuredDocument(minimalDoc())).toEqual([]);
  });

  it("rejects a non-object value", () => {
    expect(validateStructuredDocument(null)).toEqual([{ rule: "document-shape", severity: "error", message: expect.any(String), path: "" }]);
    expect(validateStructuredDocument("not a document")[0]!.rule).toBe("document-shape");
  });

  it("rejects a missing/empty id", () => {
    const findings = validateStructuredDocument(minimalDoc({ id: "" }));
    expect(findings).toContainEqual(expect.objectContaining({ rule: "document-id-shape", path: "id" }));
  });

  it("rejects a missing/malformed title CopyRef", () => {
    const findings = validateStructuredDocument({ ...minimalDoc(), title: "not-a-copy-ref" });
    expect(findings).toContainEqual(expect.objectContaining({ rule: "copy-ref-shape", path: "title" }));
  });

  it("rejects sections that is not an array, and stops there (nothing further to walk)", () => {
    const findings = validateStructuredDocument({ ...minimalDoc(), sections: "nope" });
    expect(findings).toEqual([expect.objectContaining({ rule: "document-sections-shape", path: "sections" })]);
  });

  it("accepts a fully-populated document: nested sections two levels deep, a table, a list, a definition list, a callout, and a cross-reference link — zero findings", () => {
    const doc: StructuredDocument = {
      id: "acme.help.full",
      title: ref("acme.help.title"),
      sections: [
        {
          kind: "section",
          id: "overview",
          level: 2,
          heading: ref("acme.help.overview.heading"),
          blocks: [
            { kind: "paragraph", content: [{ kind: "text", text: ref("acme.help.overview.p1") }, { kind: "link", text: ref("acme.help.overview.link"), href: "#pricing" }] },
            { kind: "list", style: "unordered", items: [[{ kind: "text", text: ref("acme.help.overview.item1") }], [{ kind: "text", text: ref("acme.help.overview.item2") }]] },
            { kind: "callout", tone: "info", content: [{ kind: "text", text: ref("acme.help.overview.callout") }] },
            {
              kind: "section",
              id: "overview-details",
              level: 3,
              heading: ref("acme.help.overview.details.heading"),
              blocks: [{ kind: "definition-list", items: [{ term: ref("acme.help.term1"), description: ref("acme.help.desc1") }] }],
            },
          ],
        },
        {
          kind: "section",
          id: "pricing",
          level: 2,
          heading: ref("acme.help.pricing.heading"),
          blocks: [
            {
              kind: "table",
              caption: ref("acme.help.pricing.caption"),
              headers: [ref("acme.help.pricing.plan"), ref("acme.help.pricing.price")],
              rows: [
                [ref("acme.help.pricing.plan1"), ref("acme.help.pricing.price1")],
                [ref("acme.help.pricing.plan2"), ref("acme.help.pricing.price2")],
              ],
            },
            { kind: "paragraph", content: [{ kind: "link", text: ref("acme.help.pricing.back"), href: "https://acme.example/pricing" }] },
          ],
        },
      ],
    };
    expect(validateStructuredDocument(doc)).toEqual([]);
  });
});

describe("validateStructuredDocument — heading-order validation", () => {
  it("flags a top-level section whose level is not 2", () => {
    const doc = minimalDoc({ sections: [{ kind: "section", id: "s1", level: 3, heading: ref("h"), blocks: [] }] });
    expect(validateStructuredDocument(doc)).toEqual([expect.objectContaining({ rule: "section-level-must-be-two-at-top", path: "sections.0.level" })]);
  });

  it("flags an h2 -> h4 skip (the exact jump this issue exists to catch)", () => {
    const doc = minimalDoc({
      sections: [
        {
          kind: "section",
          id: "s1",
          level: 2,
          heading: ref("h"),
          blocks: [{ kind: "section", id: "s1a", level: 4, heading: ref("h2"), blocks: [] }],
        },
      ],
    });
    expect(validateStructuredDocument(doc)).toEqual([expect.objectContaining({ rule: "section-level-skip", path: "sections.0.blocks.0.level" })]);
  });

  it("flags a nested section at the SAME level as its parent (no increase)", () => {
    const doc = minimalDoc({
      sections: [{ kind: "section", id: "s1", level: 2, heading: ref("h"), blocks: [{ kind: "section", id: "s1a", level: 2, heading: ref("h2"), blocks: [] }] }],
    });
    expect(validateStructuredDocument(doc)).toEqual([expect.objectContaining({ rule: "section-level-skip" })]);
  });

  it("flags a nested section at a LOWER level than its parent", () => {
    const doc = minimalDoc({
      sections: [{ kind: "section", id: "s1", level: 2, heading: ref("h"), blocks: [{ kind: "section", id: "s1a", level: 3, heading: ref("h2"), blocks: [{ kind: "section", id: "s1a-i", level: 2, heading: ref("h3"), blocks: [] }] }] }],
    });
    expect(validateStructuredDocument(doc)).toEqual([expect.objectContaining({ rule: "section-level-skip", path: "sections.0.blocks.0.blocks.0.level" })]);
  });

  it("flags a nested section under a level-6 section as section-level-max-depth, not section-level-skip", () => {
    function deepen(level: number, id: string): StructuredDocument["sections"][number] {
      const blocks: StructuredDocument["sections"][number]["blocks"] =
        level >= 6 ? [{ kind: "section", id: `${id}-over`, level: 6, heading: ref("over"), blocks: [] }] : [deepen(level + 1, `${id}-${level + 1}`)];
      return { kind: "section", id, level: level as 2 | 3 | 4 | 5 | 6, heading: ref(id), blocks: level === 2 ? blocks : blocks };
    }
    const doc = minimalDoc({ sections: [deepen(2, "s")] });
    const findings = validateStructuredDocument(doc);
    expect(findings.some((f) => f.rule === "section-level-max-depth")).toBe(true);
    expect(findings.some((f) => f.rule === "section-level-skip")).toBe(false);
  });
});

describe("validateStructuredDocument — anchors", () => {
  it("flags a duplicate DocumentSection.id anywhere in the document, not just among siblings, naming the first occurrence's path", () => {
    const doc = minimalDoc({
      sections: [
        { kind: "section", id: "dup", level: 2, heading: ref("h1"), blocks: [] },
        { kind: "section", id: "s2", level: 2, heading: ref("h2"), blocks: [{ kind: "section", id: "dup", level: 3, heading: ref("h3"), blocks: [] }] },
      ],
    });
    const findings = validateStructuredDocument(doc);
    const duplicate = findings.find((f) => f.rule === "section-anchor-duplicate");
    expect(duplicate).toBeDefined();
    expect(duplicate!.path).toBe("sections.1.blocks.0.id");
    expect(duplicate!.message).toContain("sections.0.id");
  });

  it("never auto-renames or drops a colliding section — both sections are still present in the finding count as a single finding, not silently resolved", () => {
    const doc = minimalDoc({
      sections: [
        { kind: "section", id: "dup", level: 2, heading: ref("h1"), blocks: [] },
        { kind: "section", id: "dup", level: 2, heading: ref("h2"), blocks: [] },
      ],
    });
    expect(validateStructuredDocument(doc).filter((f) => f.rule === "section-anchor-duplicate")).toHaveLength(1);
  });
});

describe("validateStructuredDocument — link validation", () => {
  function docWithLink(href: string): StructuredDocument {
    return minimalDoc({
      sections: [
        {
          kind: "section",
          id: "target",
          level: 2,
          heading: ref("h"),
          blocks: [{ kind: "paragraph", content: [{ kind: "link", text: ref("t"), href }] }],
        },
      ],
    });
  }

  it.each(["https://acme.example/docs", "http://acme.example/docs", "mailto:hello@acme.example"])("allows the %s scheme", (href) => {
    expect(validateStructuredDocument(docWithLink(href))).toEqual([]);
  });

  it.each(["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd", "not a url at all"])("rejects the %s scheme as link-scheme-not-allowed, an error finding, not a silent drop", (href) => {
    const findings = validateStructuredDocument(docWithLink(href));
    expect(findings).toEqual([expect.objectContaining({ rule: "link-scheme-not-allowed", severity: "error" })]);
  });

  it.each(["/pricing", "/docs/getting-started?tab=cli", "/"])("allows the root-relative href %s, which is same-origin by construction", (href) => {
    expect(validateStructuredDocument(docWithLink(href))).toEqual([]);
  });

  it.each(["//evil.example/steal", "//evil.example"])("rejects the protocol-relative href %s, which reads as same-site but is not", (href) => {
    const findings = validateStructuredDocument(docWithLink(href));
    expect(findings).toEqual([expect.objectContaining({ rule: "link-protocol-relative", severity: "error" })]);
  });

  it.each(["docs/foo", "../sibling", "./same"])("rejects the path-relative href %s, which would resolve differently per mount point", (href) => {
    const findings = validateStructuredDocument(docWithLink(href));
    expect(findings).toEqual([expect.objectContaining({ rule: "link-scheme-not-allowed", severity: "error" })]);
  });

  it.each(["JaVaScRiPt:alert(1)", "  javascript:alert(1)", "java\tscript:alert(1)"])("rejects %s — case and whitespace tricks normalise through URL parsing rather than defeating the allowlist", (href) => {
    const findings = validateStructuredDocument(docWithLink(href));
    expect(findings).toEqual([expect.objectContaining({ rule: "link-scheme-not-allowed", severity: "error" })]);
  });

  it("resolves an in-document fragment link against a real DocumentSection.id", () => {
    expect(validateStructuredDocument(docWithLink("#target"))).toEqual([]);
  });

  it("flags a fragment link with no matching DocumentSection.id anywhere in the document", () => {
    const findings = validateStructuredDocument(docWithLink("#does-not-exist"));
    expect(findings).toEqual([expect.objectContaining({ rule: "link-fragment-unresolved" })]);
  });
});

describe("validateStructuredDocument — table validation", () => {
  function docWithTable(table: { caption?: unknown; headers: unknown; rows: unknown }): StructuredDocument {
    return minimalDoc({ sections: [{ kind: "section", id: "s", level: 2, heading: ref("h"), blocks: [{ kind: "table", ...table } as never] }] });
  }

  it("accepts an empty table body (headers present, zero rows) — a degenerate case, not a finding", () => {
    expect(validateStructuredDocument(docWithTable({ headers: [ref("a"), ref("b")], rows: [] }))).toEqual([]);
  });

  it("rejects empty headers as table-headers-required", () => {
    const findings = validateStructuredDocument(docWithTable({ headers: [], rows: [] }));
    expect(findings).toContainEqual(expect.objectContaining({ rule: "table-headers-required" }));
  });

  it("flags a row with too few cells, reported per offending row index, never silently padded", () => {
    const findings = validateStructuredDocument(docWithTable({ headers: [ref("a"), ref("b")], rows: [[ref("only-one")]] }));
    expect(findings).toEqual([expect.objectContaining({ rule: "table-row-length-mismatch", path: "sections.0.blocks.0.rows.0" })]);
  });

  it("flags a row with too many cells, never silently truncated", () => {
    const findings = validateStructuredDocument(docWithTable({ headers: [ref("a")], rows: [[ref("one"), ref("two")]] }));
    expect(findings).toEqual([expect.objectContaining({ rule: "table-row-length-mismatch" })]);
  });
});

describe("validateStructuredDocument — list, callout, definition-list, and unknown-block cases", () => {
  it("accepts an empty list (items: []) — a degenerate case, not a finding", () => {
    const doc = minimalDoc({ sections: [{ kind: "section", id: "s", level: 2, heading: ref("h"), blocks: [{ kind: "list", style: "unordered", items: [] }] }] });
    expect(validateStructuredDocument(doc)).toEqual([]);
  });

  it("rejects an unknown list style", () => {
    const doc = minimalDoc({ sections: [{ kind: "section", id: "s", level: 2, heading: ref("h"), blocks: [{ kind: "list", style: "bulleted" as never, items: [] }] }] });
    expect(validateStructuredDocument(doc)).toEqual([expect.objectContaining({ rule: "list-style-shape" })]);
  });

  it("rejects an unknown callout tone", () => {
    const doc = minimalDoc({ sections: [{ kind: "section", id: "s", level: 2, heading: ref("h"), blocks: [{ kind: "callout", tone: "urgent" as never, content: [] }] }] });
    expect(validateStructuredDocument(doc)).toEqual([expect.objectContaining({ rule: "callout-tone-shape" })]);
  });

  it("rejects an unknown block kind", () => {
    const doc = minimalDoc({ sections: [{ kind: "section", id: "s", level: 2, heading: ref("h"), blocks: [{ kind: "video" } as never] }] });
    expect(validateStructuredDocument(doc)).toEqual([expect.objectContaining({ rule: "block-kind-unknown" })]);
  });

  it("validates a definition list's term/description as CopyRefs", () => {
    const doc = minimalDoc({ sections: [{ kind: "section", id: "s", level: 2, heading: ref("h"), blocks: [{ kind: "definition-list", items: [{ term: "not-a-ref" as never, description: ref("d") }] }] }] });
    expect(validateStructuredDocument(doc)).toEqual([expect.objectContaining({ rule: "copy-ref-shape", path: "sections.0.blocks.0.items.0.term" })]);
  });
});
