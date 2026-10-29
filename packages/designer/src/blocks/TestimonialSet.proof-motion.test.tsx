import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestimonialSet } from "./TestimonialSet.js";

const items = Array.from({ length: 3 }, (_, index) => ({ id: String(index), quote: `A useful shared foundation ${index}.`, attributorName: "Example Co." }));
const labels = { previous: "Previous quote", next: "Next quote" };
let reduced = false;
const scrollBy = vi.fn();
beforeEach(() => {
  reduced = false;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  Element.prototype.scrollBy = scrollBy;
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("TestimonialSet proof layouts", () => {
  it("lays wall quotes in staggered columns", () => {
    const { container } = render(<TestimonialSet items={items} layout="wall" />);
    expect(container.querySelector("ul")).toHaveClass("desktop:columns-3");
    expect(container.querySelectorAll("li")[1]).toHaveStyle({ marginBlockStart: "var(--spacing-lg)" });
    expect(screen.getAllByRole("blockquote")).toHaveLength(3);
  });
  it("uses a shared scroll area and manual snap controls", () => {
    const { container } = render(<TestimonialSet items={items} layout="carousel" carouselLabels={labels} />);
    expect(container.querySelector('[data-slot="scroll-area"]')).toHaveClass("snap-x", "snap-mandatory");
    expect(container.querySelector("li")).toHaveClass("snap-start");
    expect(scrollBy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: labels.next }));
    expect(scrollBy).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "smooth" }));
    fireEvent.click(screen.getByRole("button", { name: labels.previous }));
    expect(scrollBy).toHaveBeenCalledTimes(2);
  });
  it("reduced motion scrolls instantly on an explicit control only", () => {
    reduced = true;
    render(<TestimonialSet items={items} layout="carousel" carouselLabels={labels} />);
    expect(scrollBy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: labels.next }));
    expect(scrollBy).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "instant" }));
  });
});
