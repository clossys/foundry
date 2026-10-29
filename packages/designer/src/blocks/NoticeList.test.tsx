import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ShellCopyProvider } from "../components/Banner.copy-context.js";
import { SHELL_COPY_REFS, type ShellCopyRef } from "../components/Banner.copy.js";
import { Link } from "../components/Link.js";
import { NoticeList } from "./NoticeList.js";

describe("NoticeList", () => {
  it("preserves labelled list semantics, severity and inline reading order", () => {
    render(<NoticeList label="Account notices" id="notices" dir="rtl" data-host="notices" style={{ marginTop: 9 }} className="gap-lg" notices={[
      { id: "warning", tone: "danger", title: "Payment needed", message: "Update billing.", action: <Link href="/billing">Review billing</Link> },
      { id: "news", message: "Export ready." },
    ]} />);
    const region = screen.getByRole("region", { name: "Account notices" });
    expect(region.tagName).toBe("SECTION");
    expect(region).toHaveAttribute("id", "notices");
    expect(region).toHaveAttribute("dir", "rtl");
    expect(region).toHaveAttribute("data-host", "notices");
    expect(region).toHaveAttribute("data-ds-leaf", "sections.notices");
    expect(region).toHaveStyle({ marginTop: "9px" });
    expect(region).toHaveClass("gap-lg");
    expect(within(region).getAllByRole("listitem")).toHaveLength(2);
    const alert = within(region).getByRole("alert");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert).toHaveTextContent("Payment neededUpdate billing.Review billing");
    expect(within(alert).getByText("Payment needed").tagName).toBe("STRONG");
    expect(within(alert).getByText("Payment needed")).toHaveClass("font-medium");
    expect(within(alert).getByText("Update billing.").tagName).toBe("SPAN");
    expect(within(region).getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(within(region).queryByRole("button")).toBeNull();
  });

  it("uses the existing shell CopyRef for a dismiss control and leaves removal to the host", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const resolver = vi.fn((ref: ShellCopyRef) => ({ ref, text: "Fermer cet avis" }));
    render(<ShellCopyProvider resolver={resolver}><NoticeList label="Avis" onDismiss={onDismiss} notices={[
      { id: "first", message: "Ready" },
      { id: "fixed", message: "Required", dismissible: false },
    ]} /></ShellCopyProvider>);
    const dismiss = screen.getByRole("button", { name: "Fermer cet avis" });
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(resolver).toHaveBeenCalledWith(SHELL_COPY_REFS.banner.dismiss);
    await user.tab();
    expect(dismiss).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith("first");
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("accepts an explicit dismiss label without a resolver", () => {
    render(<NoticeList label="Notices" dismissLabel="Close notice" onDismiss={() => {}} notices={[{ id: "first", message: "Ready" }]} />);
    expect(screen.getByRole("button", { name: "Close notice" })).toBeInTheDocument();
  });

  it("keeps unresolved dismiss copy refused", () => {
    expect(() => render(<NoticeList label="Notices" onDismiss={() => {}} notices={[{ id: "first", message: "Ready" }]} />))
      .toThrow("Designer shell copy requires a host resolver or explicit host labels");
  });

  it("renders an empty labelled list without inventing notice copy", () => {
    render(<NoticeList label="Notices" notices={[]} />);
    expect(screen.getByRole("list")).toBeEmptyDOMElement();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("declares neutral content through SemanticContent and retains Banner severity behavior", () => {
    const source = readFileSync(join(import.meta.dirname, "NoticeList.tsx"), "utf8");
    expect(source).toContain("<Banner");
    expect(source).toContain("<SemanticContent");
    const parsed = ts.createSourceFile("NoticeList.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const nativeTags: string[] = [];
    function visit(node: ts.Node) {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName) && /^[a-z]/.test(node.tagName.text)) nativeTags.push(node.tagName.text);
      ts.forEachChild(node, visit);
    }
    visit(parsed);
    expect(nativeTags).toEqual([]);
    expect(source).not.toContain('dismissLabel = "Dismiss"');
  });
});
