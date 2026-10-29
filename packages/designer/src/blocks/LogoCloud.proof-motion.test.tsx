import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogoCloud } from "./LogoCloud.js";

const items = Array.from({ length: 3 }, (_, i) => ({ id: String(i), name: "Example Co.", href: "#example", logo: <svg aria-hidden="true" /> }));
const labels = { pause: "Pause motion", resume: "Resume motion" };
let reduced = false;
const play = vi.fn(), pause = vi.fn(), cancel = vi.fn();
const animate = vi.fn(() => ({ play, pause, cancel }));
beforeEach(() => {
  reduced = false;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  Element.prototype.animate = animate as unknown as typeof Element.prototype.animate;
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("LogoCloud proof motion", () => {
  it("renders a final static grid on the server", () => {
    const html = renderToStaticMarkup(<LogoCloud items={items} motion="marquee" motionLabels={labels} />);
    expect(html).toContain("grid-cols-3");
    expect(html).not.toContain("data-logo-cloud-track");
  });
  it("duplicates an inert hidden track and pauses on request and hover", () => {
    const { container } = render(<LogoCloud items={items} motion="marquee" motionLabels={labels} />);
    const duplicate = container.querySelector("[data-logo-cloud-duplicate]")!;
    expect(duplicate).toHaveAttribute("aria-hidden", "true");
    expect(duplicate).toHaveAttribute("inert");
    expect(duplicate.querySelector("a")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(animate).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ duration: 20000, iterations: Infinity }));
    fireEvent.click(screen.getByRole("button", { name: labels.pause }));
    expect(screen.getByRole("button", { name: labels.resume })).toHaveAttribute("aria-pressed", "true");
    expect(pause).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: labels.resume }));
    fireEvent.mouseEnter(container.querySelector("[data-logo-cloud-motion]")!);
    expect(pause).toHaveBeenCalledTimes(2);
    fireEvent.mouseLeave(container.querySelector("[data-logo-cloud-motion]")!);
    expect(play).toHaveBeenCalled();
  });
  it("reduced motion keeps a static grid without duplicate or animation", () => {
    reduced = true;
    const { container } = render(<LogoCloud items={items} motion="marquee" motionLabels={labels} />);
    expect(container.querySelector("[data-logo-cloud-track]")).toBeNull();
    expect(container.querySelector("ul")).toHaveClass("grid");
    expect(screen.queryByRole("button")).toBeNull();
    expect(animate).not.toHaveBeenCalled();
  });
});
