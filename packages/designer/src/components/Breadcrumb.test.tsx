import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Breadcrumb } from "./Breadcrumb.js";

describe("Breadcrumb", () => {
  it("renders a nav landmark, labeled 'Breadcrumb' by default", () => {
    render(
      <Breadcrumb>
        <Breadcrumb.Item href="/">Home</Breadcrumb.Item>
        <Breadcrumb.Item>Prompts</Breadcrumb.Item>
      </Breadcrumb>,
    );
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
  });

  it("accepts a custom aria-label for the nav landmark", () => {
    render(
      <Breadcrumb aria-label="You are here">
        <Breadcrumb.Item href="/">Home</Breadcrumb.Item>
        <Breadcrumb.Item>Prompts</Breadcrumb.Item>
      </Breadcrumb>,
    );
    expect(screen.getByRole("navigation", { name: "You are here" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();
  });

  it("renders every item's content", () => {
    render(
      <Breadcrumb>
        <Breadcrumb.Item href="/">Home</Breadcrumb.Item>
        <Breadcrumb.Item href="/prompts">Prompts</Breadcrumb.Item>
        <Breadcrumb.Item>Untitled prompt</Breadcrumb.Item>
      </Breadcrumb>,
    );
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Prompts")).toBeInTheDocument();
    expect(screen.getByText("Untitled prompt")).toBeInTheDocument();
  });

  it("renders every non-last item as a real link with its href", () => {
    render(
      <Breadcrumb>
        <Breadcrumb.Item href="/">Home</Breadcrumb.Item>
        <Breadcrumb.Item href="/prompts">Prompts</Breadcrumb.Item>
        <Breadcrumb.Item>Untitled prompt</Breadcrumb.Item>
      </Breadcrumb>,
    );
    const home = screen.getByRole("link", { name: "Home" });
    expect(home.tagName).toBe("A");
    expect(home).toHaveAttribute("href", "/");

    const prompts = screen.getByRole("link", { name: "Prompts" });
    expect(prompts.tagName).toBe("A");
    expect(prompts).toHaveAttribute("href", "/prompts");
  });

  it("marks only the LAST item as current: aria-current='page', and it is not a link", () => {
    render(
      <Breadcrumb>
        <Breadcrumb.Item href="/">Home</Breadcrumb.Item>
        <Breadcrumb.Item href="/prompts">Prompts</Breadcrumb.Item>
        <Breadcrumb.Item>Untitled prompt</Breadcrumb.Item>
      </Breadcrumb>,
    );
    const current = screen.getByText("Untitled prompt");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current.tagName).not.toBe("A");

    // Only one item is current — earlier items must not also carry it.
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Prompts" })).not.toHaveAttribute("aria-current");
    expect(screen.getAllByText(/./, { selector: "[aria-current='page']" })).toHaveLength(1);
  });

  it("marks the last item as current even when it is given an href (position decides, not href presence)", () => {
    render(
      <Breadcrumb>
        <Breadcrumb.Item href="/">Home</Breadcrumb.Item>
        <Breadcrumb.Item href="/current">Current page</Breadcrumb.Item>
      </Breadcrumb>,
    );
    const current = screen.getByText("Current page");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current.tagName).not.toBe("A");
  });

  it("forwards className onto an item's rendered link, and the consumer's conflicting class wins the merge", () => {
    render(
      <Breadcrumb>
        <Breadcrumb.Item href="/" className="text-status-danger">
          Home
        </Breadcrumb.Item>
        <Breadcrumb.Item>Prompts</Breadcrumb.Item>
      </Breadcrumb>,
    );
    const home = screen.getByRole("link", { name: "Home" });
    expect(home.className).toContain("text-status-danger");
    expect(home.className).not.toContain("text-ink-link");
  });

  it("renders as an ordered list of items under the nav", () => {
    const { container } = render(
      <Breadcrumb>
        <Breadcrumb.Item href="/">Home</Breadcrumb.Item>
        <Breadcrumb.Item>Prompts</Breadcrumb.Item>
      </Breadcrumb>,
    );
    const nav = container.querySelector("nav");
    expect(nav?.querySelector("ol")).not.toBeNull();
    expect(nav?.querySelectorAll("li").length).toBe(2);
  });
});
