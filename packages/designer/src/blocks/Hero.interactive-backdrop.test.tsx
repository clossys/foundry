import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Hero } from "./Hero.js";
import { resolveHeroBackdrop } from "./hero/hero-backdrop.js";
import { checkBackdropElement } from "../backdrop/contract.js";

const reduced = () => vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })));
afterEach(() => vi.unstubAllGlobals());

describe("Hero interactive backdrop (foundry-build-0048 A4)", () => {
  it("paints a descriptor through the Foundry component behind its message, inert and scrimmed", () => {
    reduced();
    const { container } = render(<Hero heading="Heading" description="Support" composition="full-bleed" backdrop={{ kind: "interactive", backdrop: { component: "grid-glow", params: { cell: 32 } } }} />);
    const section = container.querySelector("section")!;
    expect(section).toHaveAttribute("data-hero-backdrop-kind", "interactive");
    const live = section.querySelector("[data-hero-live-backdrop]")!;
    expect(live).not.toBeNull();
    expect(checkBackdropElement(live)).toMatchObject({ ok: true });
    const layer = live.querySelector('[data-interactive-backdrop="grid-glow"]')!;
    expect(layer).not.toBeNull();
    expect(layer).toHaveAttribute("aria-hidden", "true");
    expect(live.querySelectorAll("[data-hero-live-scrim]").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading")).toHaveClass("text-neutral-50");
  });

  it("resolves the kind and refuses an invalid descriptor before painting it", () => {
    expect(resolveHeroBackdrop({ kind: "interactive", backdrop: { component: "particle-field", params: {} } })).toMatchObject({ kind: "interactive", interactive: { component: "particle-field" } });
    for (const backdrop of [undefined, { component: "three-scene", params: {} }, { component: "grid-glow", params: { glow: "https://example.com/x" } }, { component: "grid-glow", params: {}, code: "x" }]) {
      expect(() => resolveHeroBackdrop({ kind: "interactive", backdrop }), JSON.stringify(backdrop)).toThrow(/Hero interactive backdrop: /);
    }
    expect(() => resolveHeroBackdrop({ kind: "script" })).toThrow(/none, image, video, graphic or interactive/);
  });
});
