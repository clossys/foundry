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
});
