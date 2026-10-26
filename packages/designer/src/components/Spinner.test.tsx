import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Spinner } from "./Spinner.js";

describe("Spinner", () => {
  it("exposes an accessible name via an indeterminate role='progressbar' when a label is given", () => {
    const { container } = render(<Spinner label="Loading prompts" />);
    const bar = screen.getByRole("progressbar", { name: "Loading prompts" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    // An unknown value must not claim one.
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar).not.toHaveAttribute("aria-valuetext");
    // The ring is the progress bar's only child, and it still carries the classes.
    expect(bar.children).toHaveLength(1);
    // SVG elements report a lowercase tagName, unlike HTML elements.
    expect(bar.firstElementChild?.tagName).toBe("svg");
    expect(container.firstElementChild).toBe(bar);
  });

  it("is react-aria-components' ProgressBar when labelled: the wrapper carries its data-rac marker", () => {
    const { container } = render(<Spinner label="Loading prompts" />);
    expect(container.firstElementChild).toHaveAttribute("data-rac");
    // An explicit class, not react-aria-components' default one, which has no rule in compiled.css.
    expect(container.firstElementChild?.getAttribute("class")).toBe("inline-block");
    expect(container.querySelector("svg")).not.toHaveAttribute("role");
  });

  it("renders the decorative form as the bare hidden svg, with no progress bar and no wrapper", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = render(<Spinner />);
    expect(container.firstElementChild?.tagName).toBe("svg");
    expect(container.querySelector("[data-rac], [role]")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("puts a consumer's className and svg attributes on the ring, as before", () => {
    const { container } = render(<Spinner label="Loading" className="ms-2" data-testid="ring" />);
    const ring = screen.getByTestId("ring");
    expect(ring.tagName).toBe("svg");
    expect(ring.getAttribute("class")).toContain("ms-2");
    expect(container.firstElementChild).not.toBe(ring);
  });

  it("keeps the progress bar inline: it is inline-block, not block, so it needs no CSS reset", () => {
    const { container } = render(<Spinner label="Loading" />);
    expect(container.firstElementChild).toHaveClass("inline-block");
    expect(container.firstElementChild).not.toHaveClass("block");
  });

  it("puts relationship attributes on the named progress bar and visual ones on the ring", () => {
    render(
      <>
        <p id="why">Fetching your prompts</p>
        <Spinner label="Loading" aria-describedby="why" aria-details="why" className="ms-2" data-testid="ring" />
      </>,
    );
    const bar = screen.getByRole("progressbar", { name: "Loading" });
    const ring = screen.getByTestId("ring");
    expect(bar).toHaveAttribute("aria-describedby", "why");
    expect(bar).toHaveAttribute("aria-details", "why");
    expect(bar).toHaveAccessibleDescription("Fetching your prompts");
    expect(ring).not.toHaveAttribute("aria-describedby");
    expect(ring).not.toHaveAttribute("aria-details");
    expect(ring.getAttribute("class")).toContain("ms-2");
    expect(bar).not.toHaveAttribute("data-testid");
    expect(bar.getAttribute("class")).toBe("inline-block");
  });

  it("names the progress bar from aria-labelledby when given, not from the ring", () => {
    render(
      <>
        <h2 id="heading">Prompt library</h2>
        <Spinner label="Loading" aria-labelledby="heading" data-testid="ring" />
      </>,
    );
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-labelledby")).toContain("heading");
    expect(screen.getByTestId("ring")).not.toHaveAttribute("aria-labelledby");
  });

  it("names the progress bar by label and keeps a passed aria-label off the ring", () => {
    render(<Spinner label="Loading" aria-label="Other" data-testid="ring" />);
    expect(screen.getByRole("progressbar", { name: "Loading" })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: "Other" })).toBeNull();
    expect(screen.getByTestId("ring")).not.toHaveAttribute("aria-label");
  });

  it("is hidden from assistive tech and carries no role when purely decorative", () => {
    const { container } = render(<Spinner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(<Spinner className="text-status-danger" />);
    const svg = container.querySelector("svg");
    expect(svg?.className.baseVal).toContain("text-status-danger");
    expect(svg?.className.baseVal).not.toContain("text-ink-secondary");
  });

  it("supports all three sizes without throwing and applies distinct classes", () => {
    const { container, rerender } = render(<Spinner size="sm" />);
    const smClass = container.querySelector("svg")?.className.baseVal;
    rerender(<Spinner size="md" />);
    const mdClass = container.querySelector("svg")?.className.baseVal;
    rerender(<Spinner size="lg" />);
    const lgClass = container.querySelector("svg")?.className.baseVal;
    expect(new Set([smClass, mdClass, lgClass]).size).toBe(3);
  });
});
