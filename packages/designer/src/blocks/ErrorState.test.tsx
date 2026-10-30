import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "../components/Button.js";
import { Link } from "../components/Link.js";
import { ErrorState, type ErrorStateKind } from "./ErrorState.js";

describe("ErrorState", () => {
  for (const kind of ["not-found", "failure", "forbidden", "offline"] satisfies ErrorStateKind[]) {
    it(`preserves the host-selected ${kind} state and labelled region`, () => {
      render(<ErrorState kind={kind} title="Content unavailable" description="Try again later." code="404" />);
      const region = screen.getByRole("region", { name: "Content unavailable" });
      expect(region.tagName).toBe("SECTION");
      expect(region).toHaveAttribute("data-error-kind", kind);
      expect(region).toHaveAttribute("data-ds-leaf", "sections.error-state");
      expect(within(region).getByRole("heading", { level: 2 })).toHaveTextContent("Content unavailable");
      expect(within(region).getByText("Try again later.").tagName).toBe("P");
      expect(within(region).getByText("404").tagName).toBe("P");
      expect(region).not.toHaveAttribute("aria-live");
      expect(within(region).queryByRole("button")).toBeNull();
    });
  }

  it("preserves host attributes, classes, heading rank and recovery action order", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onRetry = vi.fn();
    render(<ErrorState kind="failure" title="Could not load" headingLevel={3} id="failure" dir="rtl" data-host="error" style={{ marginTop: 9 }} className="p-xl gap-lg" onClick={onClick}
      retry={<Button onPress={onRetry}>Retry</Button>} report={<Link href="/help">Get help</Link>} />);
    const region = screen.getByRole("region", { name: "Could not load" });
    expect(region).toHaveAttribute("id", "failure");
    expect(region).toHaveAttribute("dir", "rtl");
    expect(region).toHaveAttribute("data-host", "error");
    expect(region).toHaveStyle({ marginTop: "9px" });
    expect(region).toHaveClass("p-xl", "gap-lg");
    expect(region).not.toHaveClass("p-2xl", "gap-sm");
    expect(within(region).getByRole("heading", { level: 3 })).toHaveTextContent("Could not load");
    expect(Array.from(region.querySelectorAll("button,a"), element => element.textContent)).toEqual(["Retry", "Get help"]);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await user.click(region);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("server-renders the supplied code and semantic heading without default copy", () => {
    const markup = renderToStaticMarkup(<ErrorState kind="not-found" title="Page missing" code="404" />);
    expect(markup).toContain("404</p>");
    expect(markup).toContain("<h2");
    expect(markup).toContain("Page missing</span></h2>");
  });

  it("declares neutral content through SemanticContent and retains the shared heading part", () => {
    const source = readFileSync(join(import.meta.dirname, "ErrorState.tsx"), "utf8");
    expect(source).toContain("<SectionHeader");
    expect(source).toContain("<SemanticContent");
    const parsed = ts.createSourceFile("ErrorState.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const nativeTags: string[] = [];
    function visit(node: ts.Node) {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName) && /^[a-z]/.test(node.tagName.text)) nativeTags.push(node.tagName.text);
      ts.forEachChild(node, visit);
    }
    visit(parsed);
    expect(nativeTags).toEqual([]);
  });
});
