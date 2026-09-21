import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Shell } from "./Shell.js";
import { SiteFooter } from "./SiteFooter.js";
import { SiteHeader } from "./SiteHeader.js";

describe("shell ground plates (#1057)", () => {
  it("paints SiteFooter inverse without host className escapes", () => {
    render(
      <SiteFooter
        ground="inverse"
        columns={
          <SiteFooter.Column heading="Product">
            <a href="/features">Features</a>
          </SiteFooter.Column>
        }
        secondary={<span>Legal</span>}
      />,
    );
    const footer = screen.getByRole("contentinfo");
    expect(footer.className).toContain("bg-surface-inverse");
    expect(footer.className).not.toContain("bg-surface-raised");
    expect(footer.className).toContain("text-ink-on-inverse");
    const heading = screen.getByRole("heading", { name: "Product" });
    expect(heading.className).not.toContain("text-ink-primary");
    expect(heading.className).not.toContain("text-ink-on-inverse");
  });

  it("paints SiteHeader inverse plate tokens", () => {
    render(<SiteHeader brand={<span>Brand</span>} ground="inverse" />);
    const header = screen.getByRole("banner");
    expect(header.className).toContain("bg-surface-inverse");
  });

  it("paints Shell.Footer inverse plate tokens", () => {
    render(
      <Shell>
        <Shell.Main>Content</Shell.Main>
        <Shell.Footer ground="inverse">Footer</Shell.Footer>
      </Shell>,
    );
    const footer = screen.getByRole("contentinfo");
    expect(footer.className).toContain("bg-surface-inverse");
  });
});
