import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Spinner } from "./Spinner.js";

describe("Spinner", () => {
  it("exposes an accessible name via role='status' when a label is given", () => {
    render(<Spinner label="Loading prompts" />);
    const status = screen.getByRole("status", { name: "Loading prompts" });
    // SVG elements report a lowercase tagName, unlike HTML elements.
    expect(status.tagName).toBe("svg");
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
