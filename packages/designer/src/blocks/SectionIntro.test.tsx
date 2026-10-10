import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { buttonLinkClassName, iconButtonLinkClassName } from "../atoms/button-classes.js";
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
    expect(look).toEqual(expect.arrayContaining(["bg-accent", "text-ink-on-accent", "focus-visible:outline-2", "focus-visible:outline-offset-2", "focus-visible:outline-accent"]));
    expect(look).not.toContain("outline-none");
    expect(look).not.toContain("disabled:cursor-not-allowed");
  });
});

describe("iconButtonLinkClassName", () => {
  it("draws a 44px circle with a hairline edge, ground-aware colours, every state and the standard focus outline", () => {
    const base = iconButtonLinkClassName().split(" ");
    expect(base).toEqual(iconButtonLinkClassName("base").split(" "));
    expect(base).toEqual(
      expect.arrayContaining([
        "size-[var(--ui-layout-tap-target)]",
        "rounded-pill",
        "border",
        "bg-surface-raised",
        "text-ink-primary",
        "border-line-base",
        "hover:bg-surface-sunken",
        "active:border-ink-primary",
        "focus-visible:outline-2",
        "focus-visible:outline-offset-2",
        "focus-visible:outline-accent",
        "focus-visible:ring-2",
        "focus-visible:ring-surface-raised",
        "duration-[var(--ui-duration-fast)]",
        "motion-reduce:transition-none",
      ]),
    );
    const inverse = iconButtonLinkClassName("inverse").split(" ");
    expect(inverse).toEqual(expect.arrayContaining(["bg-surface-inverse-raised", "text-ink-on-inverse", "border-line-on-inverse", "active:border-ink-on-inverse"]));
    expect(inverse).not.toContain("bg-surface-raised");
    expect(base).not.toContain("outline-none");
  });
});
