import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteFooter } from "./SiteFooter.js";

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
