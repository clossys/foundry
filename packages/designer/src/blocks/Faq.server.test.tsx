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

  it("hides summary's native marker and shows a Designer chevron that turns on open, reduced-motion safe", () => {
    const { container } = render(<Faq items={ITEMS} />);
    const details = container.querySelector("details") as HTMLElement;
    const summary = container.querySelector("details > summary") as HTMLElement;
    const chevron = summary.querySelector("svg") as SVGElement;

    expect(summary).toHaveClass("summary-marker-none");
    expect(chevron).toBeInstanceOf(SVGElement);
    expect(chevron).toHaveAttribute("aria-hidden", "true");
    expect(details).toHaveClass("group/faq");
    expect(chevron).toHaveClass("group-open/faq:rotate-180", "transition-transform", "motion-reduce:transition-none");
  });

  it("makes the whole row the hit area, the question at body-l, the answer at the prose measure", () => {
    const { container } = render(<Faq items={ITEMS} />);
    const summary = container.querySelector("details > summary") as HTMLElement;
    const answer = container.querySelector("details > div") as HTMLElement;

    expect(summary).toHaveClass("w-full", "py-lg", "tablet:py-xl", "text-body-l");
    expect(summary.textContent).toBe("Question one");
    expect(answer).toHaveClass("text-body");
    expect(answer.style.maxWidth).toContain("--ui-width-prose-max");
  });

  it("puts every question between ground-matched hairlines", () => {
    const { container } = render(<Faq items={[...ITEMS, { id: "two", question: "Question two", answer: "Answer two." }]} ground="inverse" />);
    const list = container.querySelector("details")?.parentElement as HTMLElement;

    expect(list).toHaveClass("border-t", "border-line-on-inverse");
    for (const details of container.querySelectorAll("details")) expect(details).toHaveClass("border-b", "border-line-on-inverse");
  });

  it.each([
    ["base", "", "text-ink-primary", "text-ink-secondary", "border-line-base"],
    ["sunken", "bg-surface-sunken", "text-ink-primary", "text-ink-secondary", "border-line-base"],
    ["inverse", "bg-surface-inverse", "text-ink-on-inverse", "text-ink-on-inverse-muted", "border-line-on-inverse"],
  ] as const)("selects the complete %s ground policy in the server implementation", (ground, surface, primary, secondary, border) => {
    const twoItems = [...ITEMS, { id: "two", question: "Question two", answer: "Answer two." }];
    const { container } = render(<Faq heading="FAQ" items={twoItems} ground={ground} />);
    const root = container.firstElementChild as HTMLElement;
    if (surface) expect(root).toHaveClass(surface);
    else expect(root.className).not.toMatch(/\bbg-surface-/);
    expect(container.querySelector("h2")).toHaveClass(primary);
    expect(container.querySelector("summary")).toHaveClass(primary);
    expect(container.querySelector("details > div")).toHaveClass(secondary);
    expect(container.querySelectorAll("details")[1]).toHaveClass(border);
  });
});

describe("Faq server-native eyebrow", () => {
  it("renders an optional eyebrow above the heading and none without one", () => {
    const region = render(<Faq eyebrow="Answers" heading="Questions" items={ITEMS} />).container.querySelector("h2")?.parentElement as HTMLElement;
    expect(region.children[0].tagName).toBe("P");
    expect(region.children[0].textContent).toBe("Answers");

    const without = render(<Faq heading="Questions" items={ITEMS} />).container.querySelector("h2")?.parentElement as HTMLElement;
    expect(without.children).toHaveLength(1);
  });
});
