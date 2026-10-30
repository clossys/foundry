import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChromeBrowser } from "./ChromeBrowser.js";

describe("ChromeBrowser", () => {
  it("keeps the screenshot accessible without adding fake browser controls", () => {
    const { container } = render(
      <ChromeBrowser label="example.test/workspace">
        <img src="/product.png" width={1440} height={900} alt="A sample project workspace" />
      </ChromeBrowser>,
    );
    expect(screen.getByRole("img", { name: "A sample project workspace" })).toHaveAttribute("src", "/product.png");
    expect(screen.getByText("example.test/workspace")).toBeVisible();
    expect(container.querySelectorAll("button, input, a, [tabindex]")).toHaveLength(0);
    expect(container.querySelector('[aria-hidden="true"]')).not.toHaveTextContent(/\S/);
  });

  it("has no default visible copy and does not change decorative image semantics", () => {
    const { container } = render(<ChromeBrowser><img src="/detail.png" alt="" /></ChromeBrowser>);
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });

  it.each(["base", "sunken", "inverse"] as const)("server-renders static, width-constrained chrome on %s", ground => {
    const markup = renderToStaticMarkup(
      <ChromeBrowser ground={ground} id="product-preview" style={{ maxWidth: "100%" }} label="example.test">
        <img src="/detail.png" width={1440} height={900} alt="Product detail" />
      </ChromeBrowser>,
    );
    const host = document.createElement("div");
    host.innerHTML = markup;
    const frame = host.querySelector("#product-preview")!;
    expect(frame).toHaveClass("w-full", "min-w-0", "overflow-hidden");
    expect(frame).toHaveStyle({ maxWidth: "100%" });
    expect(frame.className).not.toMatch(/animate|transition/);
    expect(frame.querySelector('[data-screenshot-chrome-bar]')).toHaveClass(
      ground === "inverse" ? "bg-surface-inverse-raised" : "bg-surface-sunken",
      ground === "inverse" ? "text-ink-on-inverse-muted" : "text-ink-muted",
    );
  });
});
