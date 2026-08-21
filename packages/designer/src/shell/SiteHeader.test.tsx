import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteHeader } from "./SiteHeader.js";

describe("SiteHeader", () => {
  it("renders the brand, nav, and actions slots", () => {
    render(
      <SiteHeader
        brand={<span>Acme</span>}
        nav={<nav aria-label="Primary">Links</nav>}
        actions={<button type="button">Sign in</button>}
      />,
    );
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary" })).toHaveTextContent("Links");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("registers as the page's banner landmark", () => {
    render(<SiteHeader brand={<span>Acme</span>} />);
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  it("renders with only the required brand slot", () => {
    render(<SiteHeader brand={<span>Acme</span>} />);
    expect(screen.getByRole("banner")).toHaveTextContent("Acme");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("forwards className merged with its own built-in classes", () => {
    render(<SiteHeader brand={<span>Acme</span>} className="my-header" />);
    expect(screen.getByRole("banner").className).toContain("my-header");
  });
});
