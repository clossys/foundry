import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton } from "./Skeleton.js";

describe("Skeleton", () => {
  it("defaults to the text shape and is hidden from assistive tech when unlabeled", () => {
    const { container } = render(<Skeleton />);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).not.toHaveAttribute("role");
    expect(el).not.toHaveAttribute("aria-busy");
    expect(el.className).toContain("h-4");
    expect(el.className).toContain("bg-skeleton-fill");
  });

  it("renders the block shape's classes", () => {
    const { container } = render(<Skeleton shape="block" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("h-full");
    expect(el.className).toContain("w-full");
    expect(el.className).toContain("rounded-control");
  });

  it("renders the circle shape's classes", () => {
    const { container } = render(<Skeleton shape="circle" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("aspect-square");
    expect(el.className).toContain("rounded-pill");
  });

  it("with an aria-label: becomes the accessible loading signal instead of decorative", () => {
    const { getByRole } = render(<Skeleton aria-label="Loading prompt title" />);
    const el = getByRole("status", { name: "Loading prompt title" });
    expect(el).toHaveAttribute("aria-busy", "true");
    expect(el).not.toHaveAttribute("aria-hidden");
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(<Skeleton className="h-10" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("h-10");
    expect(el.className).not.toContain("h-4");
  });
});
