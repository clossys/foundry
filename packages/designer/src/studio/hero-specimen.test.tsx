import { Suspense } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Hero } from "../blocks/Hero.js";
import heroFill from "../catalog/fills/foundry/sections.hero.json" with { type: "json" };
import { checkConsumerArtContract } from "../backdrop/consumer-art.js";
import { checkBackdropElement } from "../backdrop/contract.js";
import userEvent from "@testing-library/user-event";
import { MarketingComponentProvider, marketingComponentSelection } from "./marketing-component-selection.js";
import { heroInputs } from "../runtime/sections/hero.js";
import { HeroSpecimen, HERO_MEMBER_SPECIMENS, HERO_SPECIMEN_BACKDROP, HERO_SPECIMEN_COPY } from "./hero-specimen.js";

describe("Hero specimen through the real selected-component provider", () => {
  it("provides an explicit fixture for all 10 registered members and checked inline artwork", () => {
    const members = HERO_MEMBER_SPECIMENS.map(row => row.member).sort();
    expect(members).toHaveLength(10);
    expect(members).toEqual([...heroInputs.members].sort());
    expect(members).toEqual(Object.keys(heroFill.sections.hero.propMap).sort());
    expect(checkConsumerArtContract(HERO_SPECIMEN_BACKDROP)).toMatchObject({ ok: true });
  });

  it("preserves the Hero caller heading level and root attributes through selected semantic content", async () => {
    let clicks = 0;
    const { container } = render(<MarketingComponentProvider><Suspense><Hero heading="ExampleCo. later section" headingLevel={2} id="example-hero" dir="rtl" data-host="example" style={{ marginTop: "var(--spacing-lg)" }} onClick={() => clicks++} /></Suspense></MarketingComponentProvider>);
    await screen.findByRole("heading", { level: 2, name: "ExampleCo. later section" });
    const root = container.querySelector("section")!;
    expect(root).toHaveAttribute("id", "example-hero");
    expect(root).toHaveAttribute("dir", "rtl");
    expect(root).toHaveAttribute("data-host", "example");
    expect(root.style.marginTop).toBe("var(--spacing-lg)");
    expect(root.querySelectorAll("h1")).toHaveLength(0);
    fireEvent.click(root);
    expect(clicks).toBe(1);
  });

  it("keeps both native LinkButton actions reachable by keyboard", async () => {
    const user = userEvent.setup();
    render(<MarketingComponentProvider><Suspense><HeroSpecimen /></Suspense></MarketingComponentProvider>);
    const primary = await screen.findByRole("link", { name: HERO_SPECIMEN_COPY["actions.primary.label"] });
    const secondary = await screen.findByRole("link", { name: HERO_SPECIMEN_COPY["actions.secondary.label"] });
    await user.tab();
    expect(primary).toHaveFocus();
    await user.tab();
    expect(secondary).toHaveFocus();
  });

  it.each(HERO_MEMBER_SPECIMENS)("renders $member with actual selected leaves and observable member behavior", async ({ member, members }) => {
    const selection = marketingComponentSelection();
    expect(selection.profile.components.components["components.button"]!.impl).toMatchObject({ kind: "source", export: "Button" });
    expect(selection.profile.components.components["components.button"]!.descriptor.secondaryExports).toContainEqual({ name: "LinkButton", export: "LinkButton" });
    const { container } = render(<MarketingComponentProvider><Suspense><HeroSpecimen members={members} /></Suspense></MarketingComponentProvider>);
    const heading = await screen.findByRole("heading", { level: 1, name: HERO_SPECIMEN_COPY["header.heading"] });
    const primary = await screen.findByRole("link", { name: HERO_SPECIMEN_COPY["actions.primary.label"] });
    const secondary = await screen.findByRole("link", { name: HERO_SPECIMEN_COPY["actions.secondary.label"] });
    expect(primary).toHaveAttribute("href", "#example-workspace");
    expect(primary).toHaveAttribute("data-slot", "button");
    expect(primary).toHaveAttribute("data-variant", "default");
    expect(primary).toHaveAttribute("data-size", "default");
    expect(secondary).toHaveAttribute("data-slot", "button");
    expect(secondary).toHaveAttribute("data-variant", "outline");
    expect(secondary).toHaveAttribute("href", "#example-guide");
    expect(screen.getByText(HERO_SPECIMEN_COPY["header.description"])).toBeInTheDocument();
    const root = container.querySelector('[data-ds-leaf="sections.hero"]')!;
    expect(root.tagName).toBe("SECTION");
    expect(root.querySelectorAll("h1")).toHaveLength(1);
    expect(root).toHaveAttribute("data-ds-fill", "foundry/sections.hero");
    expect(root.classList.contains("tablet:grid-cols-2")).toBe(members.some(value => value === "layout.split"));
    expect(root.classList.contains("w-full")).toBe(members.some(value => value === "layout.full-bleed"));
    expect(root.classList.contains("bg-surface-inverse")).toBe(members.some(value => value === "ground.inverse"));
    expect(heading.classList.contains("leading-heading")).toBe(member === "size.compact");
    expect(heading.classList.contains("leading-display")).toBe(member !== "size.compact");
    const backdrop = root.querySelector('[data-hero-backdrop]')!;
    expect(checkBackdropElement(backdrop)).toMatchObject({ ok: true });
    expect(backdrop.querySelector("path")).toHaveAttribute("fill", "var(--color-accent)");
    expect(root.querySelectorAll('[data-hero-scrim]')).toHaveLength(member === "backdrop.scrim.strong" ? 5 : 4);
    expect(root.querySelector('img[title]')).toHaveAttribute("title", HERO_SPECIMEN_COPY["media.title"]);
  });
});
