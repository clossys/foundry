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

  it("renders brand leading, nav centered, secondary then primary CTA trailing, with no className override", () => {
    render(
      <SiteHeader
        navPlacement="centered"
        brand={<span>Acme</span>}
        nav={<nav aria-label="Primary">Links</nav>}
        secondaryAction={<a href="/sign-in">Sign in</a>}
        actions={<button type="button">Get started</button>}
      />,
    );
    const row = screen.getByRole("banner").firstElementChild as HTMLElement;
    const [leading, center, trailing] = Array.from(row.children) as HTMLElement[];
    expect(row.children).toHaveLength(3);
    expect(leading).toContainElement(screen.getByText("Acme"));
    expect(center).toContainElement(screen.getByRole("navigation", { name: "Primary" }));
    const secondary = screen.getByRole("link", { name: "Sign in" });
    const primary = screen.getByRole("button", { name: "Get started" });
    expect(trailing).toContainElement(secondary);
    expect(trailing).toContainElement(primary);
    expect(secondary.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(leading.className).toContain("flex-1");
    expect(trailing.className).toContain("flex-1");
    expect(center.className).not.toContain("flex-1");
    expect(trailing.className).toContain("justify-end");
  });

  it("the centered layout has exactly one banner and one navigation landmark", () => {
    render(
      <SiteHeader
        navPlacement="centered"
        brand={<span>Acme</span>}
        nav={<nav aria-label="Primary">Links</nav>}
        secondaryAction={<a href="/sign-in">Sign in</a>}
        actions={<button type="button">Get started</button>}
      />,
    );
    expect(screen.getAllByRole("banner")).toHaveLength(1);
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
  });

  it("leading placement stays the default and takes the secondary action", () => {
    render(
      <SiteHeader
        brand={<span>Acme</span>}
        nav={<nav aria-label="Primary">Links</nav>}
        secondaryAction={<a href="/sign-in">Sign in</a>}
        actions={<button type="button">Get started</button>}
      />,
    );
    const row = screen.getByRole("banner").firstElementChild as HTMLElement;
    const brand = screen.getByText("Acme");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const secondary = screen.getByRole("link", { name: "Sign in" });
    const primary = screen.getByRole("button", { name: "Get started" });
    expect(brand.parentElement).toBe(nav.parentElement);
    expect(row.className).toContain("justify-between");
    expect(secondary.nextElementSibling).toBe(primary);
  });
});
