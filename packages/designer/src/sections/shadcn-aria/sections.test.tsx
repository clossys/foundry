import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "../../components/Button.js";
import { SemanticContent } from "../../components/SemanticContent.js";
import { SectionHeader } from "./SectionHeader.js";
import { Content } from "./Content.js";
import { EmptyState } from "./EmptyState.js";

afterEach(cleanup);

describe("shadcn section ports", () => {
  it.each([1, 2, 3, 4, 5, 6] as const)("keeps semantic heading rank %s independent of visual density", level => {
    for (const density of ["compact", "standard", "display"] as const) {
      const view = render(<SectionHeader title="Section title" level={level} density={density} />);
      expect(screen.getByRole("heading", { level, name: "Section title" })).toBeInTheDocument();
      expect(view.container.querySelectorAll("h1,h2,h3,h4,h5,h6")).toHaveLength(1);
      expect(view.container.firstElementChild).toHaveAttribute("data-ds-fill", "shadcn@aria/sections.section-header");
      expect(screen.queryByRole("banner")).toBeNull();
      view.unmount();
    }
  });

  it("retains CardHeader copy/actions/stats and caller attributes without inventing labels", () => {
    const view = render(<SectionHeader id="section-title" eyebrow="Category" title="Title" description="Description" actions={<Button>Continue</Button>} stats={<SemanticContent as="span">Ready</SemanticContent>} ground="inverse" className="gap-2xl" titleClassName="text-h1" style={{ opacity: 1 }} />);
    expect(screen.getByText("Category")).toBeInTheDocument();
    expect(screen.getByText("Description")).toHaveClass("text-ink-on-inverse-muted");
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(view.container.firstElementChild).toHaveAttribute("id", "section-title");
    expect(view.container.firstElementChild).toHaveClass("gap-2xl");
    expect(view.container.firstElementChild).not.toHaveClass("gap-md");
    expect(screen.getByRole("heading")).toHaveClass("text-h1");
    expect(screen.getByRole("heading")).not.toHaveClass("text-h3");
  });

  it("keeps explicit empty headings, but emits no fallback text or empty actions", () => {
    const view = render(<SectionHeader title="" />);
    expect(view.container.querySelector("h2")).toBeInTheDocument();
    expect(view.container.textContent).toBe("");
    expect(view.container.querySelector('[data-slot="card-action"]')).toBeNull();
  });

  it.each(["stacked", "split-start", "split-end"] as const)("keeps content slots and reading order for %s", layout => {
    const view = render(<Content layout={layout} heading="Title" headingLevel={3} description="Description" media={<SemanticContent as="div">Media</SemanticContent>} footnote="Footnote" source="Attribution" takeaway="Conclusion"><SemanticContent as="p">Body</SemanticContent></Content>);
    expect(screen.getByRole("heading", { level: 3, name: "Title" })).toBeInTheDocument();
    expect(view.container.firstElementChild).toHaveAttribute("data-layout", layout);
    expect(view.container.firstElementChild).toHaveAttribute("data-ds-fill", "shadcn@aria/sections.content");
    for (const text of ["Description", "Body", "Media", "Footnote", "Attribution", "Conclusion"]) expect(screen.getByText(text)).toBeInTheDocument();
    const body = screen.getByText("Body"), media = screen.getByText("Media");
    expect(body.compareDocumentPosition(media) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("supports a genuine replaceable header region", () => {
    render(<Content header={<SectionHeader title="Provided heading" level={4} />}><SemanticContent as="p">Body</SemanticContent></Content>);
    expect(screen.getByRole("heading", { level: 4, name: "Provided heading" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  it("uses Empty anatomy with a semantic heading and preserves supplied recovery controls", () => {
    const view = render(<EmptyState title="No records" description="Add the first record." icon={<SemanticContent as="span" aria-hidden="true">◇</SemanticContent>} action={<Button>Create record</Button>} aria-live="polite" />);
    expect(view.container.firstElementChild).toHaveAttribute("data-slot", "empty");
    expect(view.container.firstElementChild).toHaveAttribute("data-ds-fill", "shadcn@aria/sections.empty-state");
    expect(view.container.firstElementChild).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("heading", { level: 2, name: "No records" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create record" })).toBeInTheDocument();
  });

  it("renders the empty-state title without fabricated illustration, description or action", () => {
    const view = render(<EmptyState title="No records" />);
    expect(view.container.textContent).toBe("No records");
    expect(view.container.querySelector('[data-slot="empty-icon"]')).toBeNull();
    expect(view.container.querySelector('[data-slot="empty-content"]')).toBeNull();
  });

  it("builds layout from design-system components and introduces no animation policy", () => {
    for (const name of ["SectionHeader", "Content", "EmptyState"]) {
      const source = readFileSync(resolve("src/sections/shadcn-aria", `${name}.tsx`), "utf8");
      const file = ts.createSourceFile(`${name}.tsx`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const raw: string[] = [];
      const visit = (node: ts.Node) => {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && /^[a-z]/.test(node.tagName.getText(file))) raw.push(node.tagName.getText(file));
        ts.forEachChild(node, visit);
      };
      visit(file);
      expect(raw, name).toEqual([]);
      expect(source).not.toMatch(/(?:animate-|animation:|requestAnimationFrame|setInterval)/);
    }
  });
});
