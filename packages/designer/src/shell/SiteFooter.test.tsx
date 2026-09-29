import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SiteFooter, type SiteFooterLegalProps } from "./SiteFooter.js";

describe("SiteFooter", () => {
  it("renders grouped link columns and a secondary row", () => {
    render(
      <SiteFooter
        columns={
          <>
            <SiteFooter.Column heading="Product">
              <a href="/features">Features</a>
              <a href="/pricing">Pricing</a>
            </SiteFooter.Column>
            <SiteFooter.Column heading="Company">
              <a href="/about">About</a>
            </SiteFooter.Column>
          </>
        }
        secondary={<span>© 2026 Acme</span>}
      />,
    );
    expect(screen.getByRole("heading", { name: "Product" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Company" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Features" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "About" })).toBeInTheDocument();
    expect(screen.getByText("© 2026 Acme")).toBeInTheDocument();
  });

  it("registers as the page's contentinfo landmark", () => {
    render(<SiteFooter secondary={<span>© 2026 Acme</span>} />);
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("renders with only columns, or only secondary", () => {
    const { rerender } = render(
      <SiteFooter columns={<SiteFooter.Column heading="Product"><a href="/x">X</a></SiteFooter.Column>} />,
    );
    expect(screen.getByRole("heading", { name: "Product" })).toBeInTheDocument();

    rerender(<SiteFooter secondary={<span>Legal</span>} />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByText("Legal")).toBeInTheDocument();
  });

  it("forwards className merged with its own built-in classes", () => {
    render(<SiteFooter secondary={<span>Legal</span>} className="my-footer" />);
    expect(screen.getByRole("contentinfo").className).toContain("my-footer");
  });
});

describe("SiteFooter.Legal", () => {
  const links = [
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
  ] as const;

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderLegal(props: Partial<SiteFooterLegalProps> = {}) {
    return render(
      <SiteFooter secondary={<SiteFooter.Legal entity="Acme Studio" links={links} {...props} />} />,
    );
  }

  it("renders one copyright string with the current year and the entity", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-06-15T12:00:00Z"));
    const { container } = renderLegal();
    expect(container.querySelector("p")?.textContent).toBe("© 2031 Acme Studio");
    expect(screen.getByText("© 2031 Acme Studio")).toBeInTheDocument();
  });

  it("recomputes the year at render when the clock moves", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-06-15T12:00:00Z"));
    const first = renderLegal();
    expect(first.container.querySelector("p")?.textContent).toBe("© 2031 Acme Studio");
    first.unmount();

    vi.setSystemTime(new Date("2044-03-02T12:00:00Z"));
    const second = renderLegal();
    expect(second.container.querySelector("p")?.textContent).toBe("© 2044 Acme Studio");
  });

  it("places the links before the copyright in DOM order", () => {
    const { container } = renderLegal();
    const list = container.querySelector("ul");
    const copyright = container.querySelector("p");
    expect(list).not.toBeNull();
    expect(copyright).not.toBeNull();
    expect(list!.compareDocumentPosition(copyright!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("owns a centred mobile stack and a one-line desktop row, copyright left and links right", () => {
    const { container } = renderLegal();
    const root = container.querySelector("ul")!.closest("div.w-full") as HTMLElement;
    for (const cls of [
      "w-full",
      "flex",
      "flex-col",
      "items-center",
      "text-center",
      "desktop:flex-row-reverse",
      "desktop:flex-nowrap",
      "desktop:items-center",
      "desktop:justify-between",
    ]) {
      expect(root.classList.contains(cls), cls).toBe(true);
    }
    expect(container.querySelector("ul")!.classList.contains("desktop:flex-nowrap")).toBe(true);
    expect(container.querySelector("p")!.classList.contains("desktop:whitespace-nowrap")).toBe(true);
  });

  it("renders every link as a real anchor with a 44px minimum tap target", () => {
    renderLegal();
    for (const { label, href } of links) {
      const link = screen.getByRole("link", { name: label });
      expect(link.tagName).toBe("A");
      expect(link).toHaveAttribute("href", href);
      expect(link.classList.contains("min-h-[44px]")).toBe(true);
      expect(link.classList.contains("min-w-[44px]")).toBe(true);
      expect(link.className).toContain("focus-visible:outline-2");
    }
  });

  it("wraps the links in a labelled nav only when linksLabel is given", () => {
    const { unmount } = renderLegal({ linksLabel: "Legal links" });
    const nav = screen.getByRole("navigation", { name: "Legal links" });
    expect(within(nav).getAllByRole("link")).toHaveLength(2);
    unmount();

    renderLegal();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("never renders children or a disclaimer forced past the type system", () => {
    // The compile-time half lives in internal/site-footer-legal-contract.check.tsx.
    const forced = {
      entity: "Acme Studio",
      links,
      children: <span>stray child</span>,
      disclaimer: "stray disclaimer",
      className: "stray-class",
      style: { color: "red" },
      "data-stray": "yes",
    } as unknown as SiteFooterLegalProps;
    const { container } = render(<SiteFooter secondary={<SiteFooter.Legal {...forced} />} />);
    expect(screen.queryByText("stray child")).not.toBeInTheDocument();
    expect(screen.queryByText("stray disclaimer")).not.toBeInTheDocument();
    expect(container.querySelector(".stray-class")).toBeNull();
    expect(container.querySelector("[data-stray]")).toBeNull();
    expect(container.querySelector("[style*='red']")).toBeNull();
  });

  it("composes inside the unchanged secondary slot", () => {
    render(
      <SiteFooter
        columns={<SiteFooter.Column heading="Product"><a href="/x">X</a></SiteFooter.Column>}
        secondary={<SiteFooter.Legal entity="Acme Studio" links={links} />}
      />,
    );
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Privacy" })).toBeInTheDocument();
    expect(within(footer).getByRole("heading", { name: "Product" })).toBeInTheDocument();
  });
});
