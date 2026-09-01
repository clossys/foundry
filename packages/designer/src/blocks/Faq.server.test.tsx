import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Faq } from "./Faq.server.js";

const ITEMS = [{ id: "one", question: "Question one", answer: "Answer one." }];

describe("Faq server-native disclosure", () => {
  it("uses the package-standard focus-visible outline without poisoning its compiled style", () => {
    const { container } = render(<Faq items={ITEMS} />);
    const summary = container.querySelector("details > summary");

    expect(summary).toBeInstanceOf(HTMLElement);
    expect(summary).not.toHaveClass("outline-none");
    expect(summary).toHaveClass(
      "focus-visible:outline-2",
      "focus-visible:outline-offset-2",
      "focus-visible:outline-accent",
    );
  });

  it("keeps summary's native list-item display and disclosure marker", () => {
    const { container } = render(<Faq items={ITEMS} />);
    const summary = container.querySelector("details > summary");

    expect(summary).toBeInstanceOf(HTMLElement);
    expect(summary?.className).not.toMatch(/\b(?:flex|inline-flex|block|list-none)\b/);
  });

  it.each([
    ["base", "bg-surface-base", "text-ink-primary", "text-ink-secondary", "border-line-base"],
    ["sunken", "bg-surface-sunken", "text-ink-primary", "text-ink-secondary", "border-line-base"],
    ["inverse", "bg-surface-inverse", "text-ink-on-inverse", "text-ink-on-inverse-muted", "border-line-on-inverse"],
  ] as const)("selects the complete %s ground policy in the server implementation", (ground, surface, primary, secondary, border) => {
    const twoItems = [...ITEMS, { id: "two", question: "Question two", answer: "Answer two." }];
    const { container } = render(<Faq heading="FAQ" items={twoItems} ground={ground} />);
    expect(container.firstElementChild).toHaveClass(surface);
    expect(container.querySelector("h2")).toHaveClass(primary);
    expect(container.querySelector("summary")).toHaveClass(primary);
    expect(container.querySelector("details > div")).toHaveClass(secondary);
    expect(container.querySelectorAll("details")[1]).toHaveClass(border);
  });
});
