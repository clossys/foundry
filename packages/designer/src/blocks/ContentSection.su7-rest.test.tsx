import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentSection } from "./ContentSection.js";
import { LogoHero, LogoMark } from "./LogoHero.js";
import { Timeline } from "./Timeline.js";

describe("remaining section composition", () => {
  it("renders aside summary pairs as a definition list", () => {
    const { container } = render(<ContentSection heading="Overview" aside={[{ id: "scope", label: "Scope", value: "Example Co." }]}>Body</ContentSection>);
    expect(container.querySelector("aside dl dt")?.textContent).toBe("Scope");
    expect(container.querySelector("aside dl dd")?.textContent).toBe("Example Co.");
    expect(container.querySelectorAll('[data-ds-leaf="sections.content"]')).toHaveLength(1);
  });
  it("omits the aside column when absent or empty", () => {
    const absent = renderToStaticMarkup(<ContentSection>Body</ContentSection>);
    expect(renderToStaticMarkup(<ContentSection aside={[]}>Body</ContentSection>)).toBe(absent);
    expect(absent).not.toContain("data-content-aside");
  });
  it("keeps logo-mark DOM identical to logo-hero mark-only", () => {
    const props = { mark: "/mark.svg", name: "Example Co." };
    expect(renderToStaticMarkup(<LogoMark {...props} />)).toBe(renderToStaticMarkup(<LogoHero {...props} member="brand.mark-only" />));
    expect(() => renderToStaticMarkup(<LogoHero mark="/mark.svg" member="brand.mark-only" />)).not.toThrow();
    expect(() => renderToStaticMarkup(<LogoHero mark="/mark.svg" />)).toThrow(/requires/);
  });
  it("uses shared item description and section header for timeline rows", () => {
    const { container } = render(<Timeline events={[{ id: "one", at: "2026", dateText: "2026", heading: "Started", description: "A first step." }]} />);
    expect(screen.getByRole("heading", { name: "Started", level: 3 })).toBeInTheDocument();
    expect(container.querySelector('[data-ds-leaf="sections.section-header"]')).not.toBeNull();
    expect(container.querySelector("time")).toHaveAttribute("datetime", "2026");
    expect(screen.getByText("A first step.")).toBeInTheDocument();
  });
});
