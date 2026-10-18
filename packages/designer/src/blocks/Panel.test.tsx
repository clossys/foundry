import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as blocks from "./index.js";

const Panel = (blocks as any).Panel ?? (() => null);

describe("Panel", () => {
  it("exports a real Material with named Card regions", () => {
    expect((blocks as any).Panel).toBeTypeOf("function");
    const { container } = render(<Panel header="Heading" footer="Footer">Content</Panel>);
    const panel = container.querySelector("[data-panel]")!;
    expect(panel).toHaveAttribute("data-variant", "outline");
    expect([...panel.children].map(node => node.getAttribute("data-panel-region"))).toEqual(["header", "content", "footer"]);
    expect(panel).toHaveTextContent("HeadingContentFooter");
    expect(panel).toHaveStyle({ borderWidth: "var(--ui-border-panel, var(--ui-border-hairline, 1px))" });
    expect(panel.className).not.toMatch(/transition|animate|forced-color-adjust-none/);
  });

  it("omits absent optional regions while preserving caller semantics", () => {
    render(<Panel role="region" aria-label="Workspace panel">Content</Panel>);
    const panel = screen.getByRole("region", { name: "Workspace panel" });
    expect(panel.querySelectorAll("[data-panel-region]")).toHaveLength(1);
  });

  it("omits a false optional region and preserves zero content", () => {
    const { container } = render(<Panel header={false} footer={0}>Content</Panel>);
    expect(container.querySelector('[data-panel-region="header"]')).toBeNull();
    expect(container.querySelector('[data-panel-region="footer"]')).toHaveTextContent("0");
  });

  it("renders and hydrates all named regions without a mismatch", async () => {
    const tree = <Panel header="Heading" footer="Footer">Content</Panel>;
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree);
    document.body.append(container);
    const before = container.innerHTML, recover = vi.fn();
    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => { root = hydrateRoot(container, tree, { onRecoverableError: recover }); });
    expect(container.innerHTML).toBe(before);
    expect(recover).not.toHaveBeenCalled();
    await act(async () => root!.unmount());
    container.remove();
  });
});
