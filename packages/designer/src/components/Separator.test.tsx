import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Separator } from "./preview-runtime/components/separator/separator.js";

describe("Separator", () => {
  it("renders as a real <hr> with an implicit separator role by default (horizontal)", () => {
    const { container } = render(<Separator />);
    const hr = container.querySelector("hr");
    expect(hr).not.toBeNull();
    expect(screen.getByRole("separator")).toBe(hr);
  });

  it("vertical: renders role=separator with aria-orientation=vertical", () => {
    render(<Separator orientation="vertical" />);
    const separator = screen.getByRole("separator");
    expect(separator.tagName).not.toBe("HR");
    expect(separator).toHaveAttribute("aria-orientation", "vertical");
  });

  it("applies vertical vs horizontal sizing classes", () => {
    const { rerender, container } = render(<Separator />);
    expect((container.querySelector("hr") as HTMLElement).className).toContain("w-full");

    rerender(<Separator orientation="vertical" />);
    expect(screen.getByRole("separator").className).toContain("aria-[orientation=vertical]:self-stretch");
  });

  it("is not aria-hidden by default", () => {
    render(<Separator data-testid="sep" />);
    expect(screen.getByTestId("sep")).not.toHaveAttribute("aria-hidden");
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    render(<Separator data-testid="sep" className="bg-status-danger" />);
    const el = screen.getByTestId("sep");
    expect(el.className).toContain("bg-status-danger");
    expect(el.className).not.toContain("bg-border");
  });

  it("forwards a consumer style prop, merged rather than dropped", () => {
    render(<Separator data-testid="sep" style={{ marginTop: "8px" }} />);
    expect(screen.getByTestId("sep").style.marginTop).toBe("8px");
  });
});
