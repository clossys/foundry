import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Hero } from "./Hero.js";
import { resolveHeroBackdrop } from "./hero/hero-backdrop.js";
import { checkBackdropElement } from "../backdrop/contract.js";

const reduced = () => vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })));
afterEach(() => vi.unstubAllGlobals());

describe("Hero interactive backdrop (foundry-build-0048 A4, U23)", () => {
  it("paints a descriptor through the adopted component behind its message, inert and scrimmed", () => {
    reduced();
    const { container } = render(<Hero heading="Heading" description="Support" composition="full-bleed" backdrop={{ kind: "interactive", backdrop: { component: "flickering-grid", params: { squareSize: 8 } } }} />);
    const section = container.querySelector("section")!;
    expect(section).toHaveAttribute("data-backdrop-kind", "interactive");
    const live = section.querySelector("[data-backdrop-live]")!;
    expect(live).not.toBeNull();
    expect(checkBackdropElement(live)).toMatchObject({ ok: true });
    const layer = live.querySelector('[data-interactive-backdrop="flickering-grid"]')!;
    expect(layer).not.toBeNull();
    expect(layer).toHaveAttribute("aria-hidden", "true");
    expect(live.querySelectorAll("[data-backdrop-live-scrim]").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading")).toHaveClass("text-neutral-50");
  });

  it("resolves the kind and drops an invalid descriptor: the hero renders without a backdrop", () => {
    expect(resolveHeroBackdrop({ kind: "interactive", backdrop: { component: "particles", params: {} } })).toMatchObject({ kind: "interactive", interactive: { component: "particles" } });
    for (const backdrop of [undefined, { component: "three-scene", params: {} }, { component: "particle-field", params: {} }, { component: "flickering-grid", params: { color: "https://example.com/x" } }, { component: "flickering-grid", params: {}, code: "x" }]) {
      expect(resolveHeroBackdrop({ kind: "interactive", backdrop }), JSON.stringify(backdrop)).toEqual({ kind: "none" });
      const { container, unmount } = render(<Hero heading="Heading" description="Support" backdrop={{ kind: "interactive", backdrop } as never} />);
      expect(container.querySelector("section"), JSON.stringify(backdrop)).toHaveAttribute("data-backdrop-kind", "none");
      expect(container.querySelector("[data-backdrop-live]"), JSON.stringify(backdrop)).toBeNull();
      unmount();
    }
    expect(() => resolveHeroBackdrop({ kind: "script" })).toThrow(/none, image, video, graphic or interactive/);
  });
});
