// @vitest-environment jsdom
import { COPY_FINGERPRINT_ALGORITHM, computeCopyFingerprint, createCopyResolver, resolveCopyRef, type CopyRegistry } from "@clossys/writer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { checkSectionVariety, resolveSectionedViewDocument, validateSectionedViewDocument, type SectionedViewDocument } from "../../core/sectioned-view.js";
import { SectionedView } from "./SectionedView.js";
import { SectionedView as ServerSectionedView } from "./SectionedView.server.js";
import { CATALOG_FIXTURES, catalogCopyResolver } from "../../preview/catalog/index.js";
import { buildCatalogFunctionPages } from "../../preview/render-content-catalog.js";

const copy = { heading: "Reading guide", before: "Read the ", link: "guide", after: " before continuing.", second: "Keep the source beside the record." };
const ref = (key: string) => ({ id: `prose-test.${key}` });
const registry: CopyRegistry = {
  id: "prose-test", locale: "en", revision: "1",
  source: { kind: "consumer", reference: "fixture" },
  entries: Object.entries(copy).map(([key, text]) => ({ id: ref(key).id, text, context: "Prose rendering fixture", status: "approved" })),
};
const resolver = createCopyResolver(registry);
const plain = (key = "second") => ({ type: "text", text: ref(key) });
const link = (href = "/guide") => ({ type: "link", text: ref("link"), href });
const block = () => ({ type: "prose", paragraphs: [[plain("before"), link(), plain("after")], [plain()]] });
function authored(content: unknown = block()): SectionedViewDocument {
  return { id: "prose-test", sections: [{ id: "reading", kind: "content-section", heading: ref("heading"), block: content }] } as SectionedViewDocument;
}
function resolvedWith(content: unknown) {
  const resolved = resolveSectionedViewDocument(authored(), resolver);
  return { ...resolved, sections: [{ ...resolved.sections[0], block: content }] } as typeof resolved;
}

describe("canonical prose recipe", () => {
  it("accepts ordered paragraphs with inline Writer text and links", () => {
    expect(validateSectionedViewDocument(authored())).toEqual([]);
  });

  it("uses paragraph-sized spacing and the prose measure in every frame layout", () => {
    for (const layout of ["stacked", "split-start", "split-end"] as const) {
      const input = authored();
      input.sections[0] = { ...input.sections[0]!, layout } as SectionedViewDocument["sections"][number];
      const resolved = resolveSectionedViewDocument(input, resolver);
      for (const View of [SectionedView, ServerSectionedView]) {
        const root = document.createElement("div");
        root.innerHTML = renderToStaticMarkup(<View document={resolved} />);
        expect(root.querySelector("[data-content-section]")?.hasAttribute("data-prose")).toBe(true);
        expect(root.querySelector("style")?.textContent).toContain("gap: var(--spacing-lg, 16px)");
        expect(root.querySelector("style")?.textContent).toContain("[data-content-section][data-prose] > [data-content-section-modules]");
        document.body.append(root);
        try {
          const modules = root.querySelector("[data-content-section-modules]")!;
          expect(getComputedStyle(modules).gap).toBe("var(--spacing-lg, 16px)");
        } finally { root.remove(); }
        for (const paragraph of root.querySelectorAll<HTMLElement>("p[data-prose-paragraph]")) {
          expect(paragraph.style.maxWidth).toBe("var(--ui-width-prose-max, 48rem)");
          expect(paragraph.parentElement?.hasAttribute("data-content-section-modules")).toBe(true);
        }
      }
    }
  });

  it("does not suggest a different treatment for repeated prose on one page", () => {
    const first = authored().sections[0]!;
    const second = { ...first, id: "reading-more" };
    for (const input of [{ id: "long-page", sections: [first, second] }, [authored(), { id: "more", sections: [second] }]]) {
      const findings = checkSectionVariety(input);
      expect(findings.filter(finding => finding.rule === "sectioned-view-variety-treatment")).toEqual([]);
      expect(findings.some(finding => finding.rule === "sectioned-view-variety-repeat")).toBe(true);
    }
  });

  it("caps all inline spans at 24 per paragraph at authored and resolved boundaries", () => {
    const atLimit = { type: "prose", paragraphs: [Array.from({ length: 24 }, () => plain())] };
    expect(validateSectionedViewDocument(authored(atLimit))).toEqual([]);
    const resolved = resolveSectionedViewDocument(authored(atLimit), resolver);
    for (const View of [SectionedView, ServerSectionedView]) expect(() => renderToStaticMarkup(<View document={resolved} />)).not.toThrow();
    const invalid = { type: "prose", paragraphs: [Array.from({ length: 25 }, () => plain())] };
    expect(validateSectionedViewDocument(authored(invalid))).toContainEqual(expect.objectContaining({ rule: "sectioned-view-content-count", path: "sections.0.block.paragraphs.0", severity: "error" }));
    const rendered = { type: "prose", paragraphs: [Array.from({ length: 25 }, () => ({ type: "text", text: "Text." }))] };
    for (const View of [SectionedView, ServerSectionedView]) expect(() => renderToStaticMarkup(<View document={resolvedWith(rendered)} />)).toThrow("sections.0.block.paragraphs.0 must hold 1-24 spans");
  });

  it("caps combined paragraph text at 1200 Unicode characters including link text and spaces", () => {
    const content = { type: "prose", paragraphs: [[plain("before"), link()]] };
    // A non-blank link label supplies the last two characters, including its leading space.
    const atLimit = createCopyResolver({ ...registry, entries: registry.entries.map(entry => ({ ...entry, text: entry.id === ref("before").id ? "😀".repeat(1198) : entry.id === ref("link").id ? " g" : entry.text })) });
    const resolved = resolveSectionedViewDocument(authored(content), atLimit);
    for (const View of [SectionedView, ServerSectionedView]) expect(() => renderToStaticMarkup(<View document={resolved} />)).not.toThrow();
    const tooLong = createCopyResolver({ ...registry, entries: registry.entries.map(entry => ({ ...entry, text: entry.id === ref("before").id ? "😀".repeat(1199) : entry.id === ref("link").id ? " g" : entry.text })) });
    expect(() => resolveSectionedViewDocument(authored(content), tooLong)).toThrow("sectioned-view-content-prose-text-length: sections.0.block.paragraphs.0 holds at most 1200 characters; it holds 1201.");
    const rendered = { type: "prose", paragraphs: [[{ type: "text", text: "😀".repeat(1199) }, { type: "link", text: " g", href: "/guide" }]] };
    for (const View of [SectionedView, ServerSectionedView]) expect(() => renderToStaticMarkup(<View document={resolvedWith(rendered)} />)).toThrow("sectioned-view-content-prose-text-length: sections.0.block.paragraphs.0");
  });

  it("shows the prose catalog witness with an inline link on the Explain page", () => {
    const fixture = CATALOG_FIXTURES.find(candidate => candidate.id === "recipes-prose");
    expect(fixture).toBeDefined();
    const resolved = resolveSectionedViewDocument({ id: "prose-catalog", sections: [fixture!.section] }, catalogCopyResolver);
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(<ServerSectionedView document={resolved} />);
    expect([...root.querySelectorAll("p[data-prose-paragraph]")].map(p => p.textContent)).toEqual([
      "Read the writing guide before preparing your next record.",
      "Keep source material beside the record so each review starts with context.",
    ]);
    expect(root.querySelector("p[data-prose-paragraph] a")?.getAttribute("href")).toBe("/guide");
    expect(buildCatalogFunctionPages({}).find(page => page.file === "catalog/explain.html")!.content).toContain('id="example-recipes-prose"');
  });

  it("renders paragraph order and inline placement identically through ordinary and server views", () => {
    const resolved = resolveSectionedViewDocument(authored(), resolver);
    const resolutions = resolved.resolutions;
    const before = JSON.stringify(resolved);
    expect(resolutions.map(entry => entry.ref.id)).toEqual(["heading", "before", "link", "after", "second"].map(key => ref(key).id));
    expect(resolutions.map(entry => entry.source)).toEqual(Array(5).fill(registry.source));
    resolutions.forEach(entry => { expect(entry.source).toBe(registry.source); expect(entry.revision).toBe("1"); expect(entry.locale).toBe("en"); });
    for (const ground of ["base", "sunken", "inverse"] as const) {
      const input = { ...resolved, viewGrounds: [], sections: resolved.sections.map(section => ({ ...section, ground })) };
      const ordinary = renderToStaticMarkup(<SectionedView document={input} />);
      expect(renderToStaticMarkup(<ServerSectionedView document={input} />)).toBe(ordinary);
      const root = document.createElement("div");
      root.innerHTML = ordinary;
      const paragraphs = [...root.querySelectorAll("#reading p[data-prose-paragraph]")];
      expect(paragraphs.map(p => p.textContent)).toEqual(["Read the guide before continuing.", copy.second]);
      expect(paragraphs[0]!.childNodes).toHaveLength(3);
      expect(paragraphs[0]!.childNodes[0]!.nodeType).toBe(Node.TEXT_NODE);
      expect(paragraphs[0]!.children[0]!.outerHTML).toContain('href="/guide"');
      expect(paragraphs[0]!.children[0]!.textContent).toBe(copy.link);
      expect(paragraphs[0]!.childNodes[2]!.textContent).toBe(copy.after);
      expect(paragraphs[0]!.parentElement?.hasAttribute("data-content-section-modules")).toBe(true);
      expect(paragraphs[1]!.parentElement).toBe(paragraphs[0]!.parentElement);
      expect(root.querySelectorAll("#reading p[data-prose-paragraph] span")).toHaveLength(0);
    }
    const landing = { ...resolved, sections: [{ id: "hero", kind: "hero" as const, ground: "inverse" as const, heading: "Start here" }, ...resolved.sections] };
    expect(renderToStaticMarkup(<SectionedView document={landing} />)).toBe(renderToStaticMarkup(<ServerSectionedView document={landing} />));
    expect(resolved.resolutions).toBe(resolutions);
    expect(JSON.stringify(resolved)).toBe(before);
  });

  it.each(["#reading", "/guide", "https://example.com/guide", "http://example.com/guide", "mailto:help@example.com"])("accepts sanctioned href %s", href => {
    expect(validateSectionedViewDocument(authored({ type: "prose", paragraphs: [[link(href)]] }))).toEqual([]);
  });

  it.each(["javascript:alert(1)", "JAVASCRIPT:alert(1)", "mailto:", "data:text/html,unsafe", "//example.com/guide", "/\\example.com", "https://user:pass@example.com", "tel:123", " /guide", "/guide\n"])("refuses unsafe or unsanctioned href %s at both boundaries", href => {
    expect(validateSectionedViewDocument(authored({ type: "prose", paragraphs: [[link(href)]] }))).toContainEqual(expect.objectContaining({ severity: "error", path: "sections.0.block.paragraphs.0.0.href" }));
    for (const View of [SectionedView, ServerSectionedView]) expect(() => renderToStaticMarkup(<View document={resolvedWith({ type: "prose", paragraphs: [[{ type: "link", text: copy.link, href }]] })} />)).toThrow(/invalid resolved document.*paragraphs\.0\.0\.href/);
  });

  it("enforces the eight-paragraph and six-links-per-paragraph budgets at both boundaries", () => {
    const atLimit = { type: "prose", paragraphs: Array.from({ length: 8 }, () => Array.from({ length: 6 }, () => link())) };
    expect(validateSectionedViewDocument(authored(atLimit))).toEqual([]);
    const valid = resolveSectionedViewDocument(authored(atLimit), resolver);
    for (const View of [SectionedView, ServerSectionedView]) expect(renderToStaticMarkup(<View document={valid} />).match(/data-prose-paragraph/g)).toHaveLength(8);
    for (const [paragraphs, path] of [
      [Array.from({ length: 9 }, () => [plain()]), "sections.0.block.paragraphs"],
      [[Array.from({ length: 7 }, () => link())], "sections.0.block.paragraphs.0"],
    ] as const) {
      const invalid = { type: "prose", paragraphs };
      expect(validateSectionedViewDocument(authored(invalid))).toContainEqual(expect.objectContaining({ rule: "sectioned-view-content-count", severity: "error", path }));
      const rendered = { type: "prose", paragraphs: paragraphs.map(p => p.map(span => ({ ...span, text: copy.second }))) };
      for (const View of [SectionedView, ServerSectionedView]) expect(() => renderToStaticMarkup(<View document={resolvedWith(rendered)} />)).toThrow(`${path}: ${path} must hold`);
    }
  });

  it("refuses closed-shape violations, empty or sparse paragraphs, raw text and executable data", () => {
    const getter = Object.defineProperty({ type: "text" }, "text", { enumerable: true, get: () => { throw new Error("Getter ran"); } });
    const invalid = [
      { ...block(), extra: true }, { type: "prose" }, { type: "prose", paragraphs: [] },
      { type: "prose", paragraphs: [[]] }, { type: "prose", paragraphs: [Array(1)] },
      { type: "prose", paragraphs: [[{ ...plain(), extra: true }]] },
      { type: "prose", paragraphs: [[{ ...plain(), href: "/guide" }]] },
      { type: "prose", paragraphs: [[{ type: "link", text: ref("link") }]] },
      { type: "prose", paragraphs: [[{ type: "html", text: ref("second") }]] },
      { type: "prose", paragraphs: [[{ type: "text", text: "Unregistered" }]] },
      { type: "prose", paragraphs: [[{ type: "text", text: { ...ref("second"), extra: true } }]] },
      { type: "prose", paragraphs: [[getter]] },
      { type: "prose", paragraphs: [[() => null]] },
    ];
    for (const content of invalid) {
      expect(validateSectionedViewDocument(authored(content))).toContainEqual(expect.objectContaining({ severity: "error" }));
      expect(() => resolveSectionedViewDocument(authored(content), resolver)).toThrow(/refused invalid document/);
    }
    for (const content of [
      { type: "prose", paragraphs: [[{ type: "text", text: "" }]] },
      { type: "prose", paragraphs: [[{ type: "text", text: ref("second") }]] },
      { type: "prose", paragraphs: [[{ type: "text", text: copy.second, href: "/guide" }]] },
      { type: "prose", paragraphs: [[]] }, { ...block(), render: () => null },
    ]) for (const View of [SectionedView, ServerSectionedView]) expect(() => renderToStaticMarkup(<View document={resolvedWith(content)} />)).toThrow(/invalid resolved document/);
  });

  it.each(["missing", "stale", "pending", "production-refused"] as const)("refuses %s text and link copy through the existing Writer path", state => {
    for (const key of ["before", "link"]) {
      const changed: CopyRegistry = structuredClone(registry);
      const entry = changed.entries.find(candidate => candidate.id === ref(key).id)!;
      if (state === "missing") changed.entries = changed.entries.filter(candidate => candidate !== entry);
      else if (state === "pending") entry.status = "draft";
      else {
        entry.approval = { approvedBy: "owner", approvedAt: "2026-10-01T00:00:00.000Z", textFingerprint: computeCopyFingerprint(state === "stale" ? "Old text" : entry.text), fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM };
        if (state === "production-refused") entry.approval = { ...entry.approval, approvedBy: "delegate", delegate: { id: "fixture-reviewer", scope: ["prose-test"] }, pendingOwnerReview: true };
      }
      const options = { target: "production" as const, now: new Date("2026-10-12T00:00:00.000Z") };
      const reason = { missing: "unknown-copy-id", stale: "approval-stale", pending: "copy-not-approved", "production-refused": "delegate-approval-refused" }[state];
      expect(resolveCopyRef(changed, ref(key), options).issues[0]?.reason).toBe(reason);
      expect(() => resolveSectionedViewDocument(authored(), createCopyResolver(changed, options))).toThrow(`resolveSectionedViewDocument could not resolve a CopyRef at sections.0.block.paragraphs.0.${key === "before" ? 0 : 1}.text.`);
    }
  });
});
