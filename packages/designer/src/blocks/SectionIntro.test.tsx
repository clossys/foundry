import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { buttonLinkClassName, iconButtonLinkClassName } from "../components/button-classes.js";
import { SectionIntro } from "./SectionIntro.js";

describe("SectionIntro", () => {
  it("renders eyebrow, heading, description and actions in that order, the heading at h2 by default", () => {
    const { container } = render(
      <SectionIntro eyebrow="Eyebrow" heading="Heading" description="Description" actions={<a href="/x">Action</a>} />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute("data-section-intro", "section");
    expect(Array.from(root.children).map((child) => child.tagName)).toEqual(["P", "H2", "P", "DIV"]);
    expect(screen.getByRole("heading", { name: "Heading" }).tagName).toBe("H2");
  });

  it("takes the heading element from headingLevel, independent of emphasis", () => {
    render(<SectionIntro heading="Opening" headingLevel={1} emphasis="display" />);
    expect(screen.getByRole("heading", { name: "Opening" }).tagName).toBe("H1");
  });

  it("gives the display emphasis the display step (display-m on a phone, display-l from tablet) and display leading", () => {
    render(<SectionIntro heading="Opening" emphasis="display" />);
    expect(screen.getByRole("heading")).toHaveClass("text-display-m", "tablet:text-display-l", "font-display", "leading-display", "text-balance");
  });

  it("gives the section emphasis the section-title step and heading leading, never display-l", () => {
    render(<SectionIntro heading="Section" />);
    const heading = screen.getByRole("heading");
    expect(heading).toHaveClass("text-h1", "tablet:text-h0", "tablet-lg:text-display-m", "font-display", "leading-heading", "text-balance");
    expect(heading).not.toHaveClass("text-display-l");
    expect(heading.className).not.toMatch(/(^|\s|:)text-display-l\b/);
  });

  it.each([
    ["display", "mt-sm", "mt-2xl", "mt-3xl"],
    ["section", "mt-sm", "mt-xl", "mt-2xl"],
  ] as const)("spaces the %s lockup small, larger, larger again", (emphasis, headingGap, descriptionGap, actionsGap) => {
    const { container } = render(
      <SectionIntro emphasis={emphasis} eyebrow="Eyebrow" heading="Heading" description="Description" actions={<a href="/x">Action</a>} />,
    );
    const [eyebrow, heading, description, actions] = Array.from((container.firstElementChild as HTMLElement).children);
    expect(eyebrow.className).not.toMatch(/\bmt-/);
    expect(heading).toHaveClass(headingGap);
    expect(description).toHaveClass(descriptionGap);
    expect(actions).toHaveClass(actionsGap);
  });

  it("adds no leading margin to the first rendered line", () => {
    const { container } = render(<SectionIntro description="Only a description" actions={<a href="/x">Action</a>} />);
    const [description, actions] = Array.from((container.firstElementChild as HTMLElement).children);
    expect(description.className).not.toMatch(/\bmt-/);
    expect(actions).toHaveClass("mt-2xl");
  });

  it("renders without an eyebrow (optional by type, expected by convention)", () => {
    const { container } = render(<SectionIntro heading="Heading" description="Description" />);
    const [heading, description] = Array.from((container.firstElementChild as HTMLElement).children);
    expect(heading.tagName).toBe("H2");
    expect(heading.className).not.toMatch(/\bmt-/);
    expect(description).toHaveClass("mt-xl");
  });

  it("holds every line to the prose measure and centres them when align is center", () => {
    const { container } = render(<SectionIntro heading="Heading" description="Description" actions={<a href="/x">Action</a>} align="center" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.maxWidth).toBe("var(--ui-width-prose-max, 48rem)");
    expect(root).toHaveClass("mx-auto", "items-center", "text-center");
    expect(screen.getByRole("link").parentElement).toHaveClass("justify-center");
    expect(screen.getByText("Description")).toHaveClass("text-body-l", "text-pretty");
  });

  it.each([
    ["base", "text-ink-primary", "text-ink-secondary", "text-accent-text"],
    ["inverse", "text-ink-on-inverse", "text-ink-on-inverse-muted", "text-accent-on-inverse"],
  ] as const)("takes its ink from the %s ground and paints no surface", (ground, primary, secondary, eyebrowInk) => {
    const { container } = render(<SectionIntro ground={ground} eyebrow="Eyebrow" heading="Heading" description="Description" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toMatch(/\bbg-/);
    expect(screen.getByText("Eyebrow")).toHaveClass(eyebrowInk, "text-body-s", "font-medium", "uppercase", "tracking-label");
    expect(screen.getByRole("heading")).toHaveClass(primary);
    expect(screen.getByText("Description")).toHaveClass(secondary);
  });
});

describe("buttonLinkClassName", () => {
  it("gives an anchor the Button look with a focus-visible outline, without the button-only classes", () => {
    const look = buttonLinkClassName("primary", "lg").split(" ");
    expect(look).toEqual(expect.arrayContaining(["bg-action", "text-ink-on-action", "hover:bg-action-hover", "data-pressed:bg-action-pressed", "focus-visible:outline-2", "focus-visible:outline-offset-2", "focus-visible:outline-focus-ring"]));
    for (const oldClass of ["bg-accent", "text-ink-on-accent", "focus-visible:outline-accent"]) expect(look).not.toContain(oldClass);
    expect(look).not.toContain("outline-none");
    expect(look).not.toContain("disabled:cursor-not-allowed");
  });
});

describe("buttonLinkClassName outline", () => {
  it("draws the primary box with no fill and an inset edge in the surrounding ink", () => {
    const sizeOf = (look: string[]) => look.filter((token) => /^(px|py|text-body|rounded|inline-flex|items-center|justify-center|gap)-?/.test(token) && !token.startsWith("text-ink"));
    const primary = buttonLinkClassName("primary", "lg").split(" ");
    const outline = buttonLinkClassName("outline", "lg").split(" ");
    expect(sizeOf(outline)).toEqual(sizeOf(primary));
    expect(outline).toEqual(
      expect.arrayContaining([
        "bg-transparent",
        "ring-inset",
        "ring-current",
        "ring-1",
        "hover:ring-2",
        "focus-visible:outline-2",
        "focus-visible:outline-focus-ring",
      ]),
    );
    // No border (it would grow the box past primary's) and no ink of its own (it takes the ground's).
    expect(outline.filter((token) => token === "border" || token.startsWith("border-"))).toEqual([]);
    expect(outline.filter((token) => token.startsWith("text-ink-"))).toEqual([]);
    expect(outline).not.toContain("outline-none");
    expect(outline).not.toContain("focus-visible:outline-accent");
  });

  it("takes the ground's primary ink from the actions row, so the edge reads on light and dark grounds", () => {
    const { container, rerender } = render(<SectionIntro heading="Heading" actions={<a href="/go" className={buttonLinkClassName("outline", "lg")}>Go</a>} />);
    expect(container.querySelector("[data-section-intro-actions]")).toHaveClass("text-ink-primary");
    rerender(<SectionIntro ground="inverse" heading="Heading" actions={<a href="/go" className={buttonLinkClassName("outline", "lg")}>Go</a>} />);
    const row = container.querySelector("[data-section-intro-actions]") as HTMLElement;
    expect(row).toHaveClass("text-ink-on-inverse");
    expect(row).not.toHaveClass("text-ink-primary");
  });
});

describe("iconButtonLinkClassName", () => {
  it("draws a 44px circle with a hairline edge, ground-aware colours, every state and the standard focus outline", () => {
    const base = iconButtonLinkClassName().split(" ");
    expect(base).toEqual(iconButtonLinkClassName("base").split(" "));
    expect(base).toEqual(
      expect.arrayContaining([
        "icon-control-md",
        "rounded-pill",
        "border",
        "bg-surface-raised",
        "text-ink-primary",
        "border-line-base",
        "hover:bg-surface-sunken",
        "active:border-ink-primary",
        "focus-visible:outline-2",
        "focus-visible:outline-offset-2",
        "focus-visible:outline-focus-ring",
        "focus-visible:ring-2",
        "focus-visible:ring-surface-raised",
        "motion-reduce:transition-none",
      ]),
    );
    const inverse = iconButtonLinkClassName("inverse").split(" ");
    expect(inverse).toEqual(expect.arrayContaining(["bg-surface-inverse-raised", "text-ink-on-inverse", "border-line-on-inverse", "active:border-ink-on-inverse"]));
    expect(inverse).not.toContain("bg-surface-raised");
    expect(base).not.toContain("outline-none");
    expect(base).not.toContain("focus-visible:outline-accent");
  });
});
