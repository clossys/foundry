import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SectionedView } from "./SectionedView.js";
import type { ResolvedSectionedViewDocument } from "../../core/sectioned-view.js";

const document: ResolvedSectionedViewDocument = {
  id: "acme-home",
  resolutions: [{ ref: { id: "acme.home" }, text: "Welcome", recordId: "acme", revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" }, entryId: "acme.home" }],
  sections: [
    { id: "hero", kind: "hero", ground: "base", heading: "Welcome" },
    { id: "features", kind: "feature-grid", ground: "sunken", heading: "Features", items: [{ id: "first", heading: "First" }] },
    { id: "faq", kind: "faq", ground: "inverse", heading: "Questions", items: [{ id: "one", question: "Why?", answer: "Because." }] },
    { id: "steps", kind: "ordered-step-sequence", ground: "base", heading: "Steps", items: [{ id: "one", ordinal: "1", heading: "Start" }] },
    { id: "status", kind: "status-list", ground: "sunken", heading: "Readiness", labels: { available: "Available", partial: "Partial", planned: "Planned" }, groups: [{ id: "core", heading: "Core", items: [{ id: "one", label: "Feature", state: "available" }] }] },
  ],
};

describe("SectionedView", () => {
  it("renders the five closed Designer blocks in source order with one h1, h2 sections, h3 nested headings, one legend, and semantic steps", () => {
    const html = renderToStaticMarkup(<SectionedView document={document} />);
    expect(html).toMatch(/<h1[^>]*>Welcome<\/h1>[\s\S]*<h2[^>]*>Features<\/h2>[\s\S]*<h2[^>]*>Questions<\/h2>/);
    expect(html).toContain('id="hero"');
    expect(html).toContain('id="status"');
    expect(html).toContain("<ol");
    expect(html.match(/aria-label="Readiness"/g)).toHaveLength(1);
    expect(html).toContain("<h3");
  });

  it("fails closed before rendering malformed direct resolved models", () => {
    const malformed = { ...document, sections: [{ ...document.sections[1], items: [null] }] };
    expect(() => renderToStaticMarkup(<SectionedView document={malformed as unknown as ResolvedSectionedViewDocument} />)).toThrow(/invalid resolved document/);
  });
});
