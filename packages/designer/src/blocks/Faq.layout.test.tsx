import { renderToStaticMarkup } from "react-dom/server";
import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Faq, type FaqItem } from "./Faq.js";
import { Faq as ServerFaq } from "./Faq.server.js";

const ITEMS: FaqItem[] = [
  { id: "one", question: "Question one", answer: "Answer one." },
  { id: "two", question: "Question two", answer: "Answer two." },
  { id: "three", question: "Question three", answer: "Answer three." },
];

describe.each([
  ["React Aria", Faq, "button"],
  ["server-native", ServerFaq, "summary"],
] as const)("Faq layout (%s)", (_name, Block, triggerSelector) => {
  it("keeps the default list byte-identical whether layout is omitted or list", () => {
    const omitted = renderToStaticMarkup(<Block heading="FAQ" items={ITEMS} ground="inverse" />);
    expect(renderToStaticMarkup(<Block heading="FAQ" items={ITEMS} ground="inverse" layout="list" />)).toBe(omitted);
    expect(omitted).not.toContain("tablet:grid-cols-2");
  });

  it("two-column splits the questions into two hairlined columns, first column first", () => {
    const { container } = render(<Block heading="FAQ" items={ITEMS} ground="inverse" layout="two-column" />);
    const columns = container.querySelector("[data-faq-columns]") as HTMLElement;
    expect(columns).not.toBeNull();
    expect(columns).toHaveClass("grid", "grid-cols-1", "tablet:grid-cols-2");
    const lists = Array.from(columns.children) as HTMLElement[];
    expect(lists).toHaveLength(2);
    const questions = lists.map(list => Array.from(list.querySelectorAll(triggerSelector)).map(trigger => trigger.textContent));
    expect(questions).toEqual([["Question one", "Question two"], ["Question three"]]);
    // The first column keeps the hairline above its first question at every width; the second adds one only
    // where the columns sit side by side, so stacked columns never draw a doubled rule.
    expect(lists[0]).toHaveClass("border-t", "border-line-on-inverse");
    expect(lists[1]).toHaveClass("tablet:border-t", "border-line-on-inverse");
    expect(lists[1]!.className.split(/\s+/)).not.toContain("border-t");
    expect(within(container).getAllByText(/Question/)).toHaveLength(3);
  });

  it("each layout value changes the rendered structure", () => {
    const list = renderToStaticMarkup(<Block items={ITEMS} layout="list" />);
    const twoColumn = renderToStaticMarkup(<Block items={ITEMS} layout="two-column" />);
    expect(twoColumn).not.toBe(list);
    expect(list).not.toContain("data-faq-columns");
  });
});
