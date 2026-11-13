import { renderToStaticMarkup as renderS4Server } from "react-dom/server";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Faq } from "./Faq.server.js";

const ITEMS = [{ id: "one", question: "Question one", answer: "Answer one." }];

const TWO = [...ITEMS, { id: "two", question: "Question two", answer: "Answer two." }];
const answerOf = (trigger: HTMLElement) => document.getElementById(trigger.getAttribute("aria-controls")!)!;

describe("Faq server disclosure (stock accordion)", () => {
  it("keeps every answer in the document behind its named, collapsed trigger", () => {
    const view = render(<Faq items={TWO} />);
    for (const { question, answer } of TWO) {
      const trigger = view.getByRole("button", { name: question });
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(answerOf(trigger).textContent).toBe(answer);
    }
  });

  it("outlines each question as a heading and opens rows independently by pointer and keyboard", async () => {
    const user = userEvent.setup();
    const view = render(<Faq heading="FAQ" items={TWO} />);
    expect(view.getAllByRole("heading", { level: 3 }).map(heading => heading.textContent)).toEqual(["Question one", "Question two"]);
    const [one, two] = TWO.map(item => view.getByRole("button", { name: item.question }));
    await user.click(one!);
    two!.focus();
    await user.keyboard("{Enter}");
    expect([one, two].map(trigger => trigger!.getAttribute("aria-expanded"))).toEqual(["true", "true"]);
    expect(answerOf(one!)).not.toHaveAttribute("hidden");
  });

  it("keeps the answer at the prose measure", () => {
    const view = render(<Faq items={ITEMS} />);
    expect(view.getByText("Answer one.").style.maxWidth).toContain("--ui-width-prose-max");
  });

  it.each([
    ["base", "", "text-ink-primary", "text-ink-secondary"],
    ["sunken", "bg-surface-sunken", "text-ink-primary", "text-ink-secondary"],
    ["inverse", "bg-surface-inverse", "text-ink-on-inverse", "text-ink-on-inverse-muted"],
  ] as const)("selects the complete %s ground policy in the server implementation", (ground, surface, primary, secondary) => {
    const view = render(<Faq heading="FAQ" items={TWO} ground={ground} />);
    const root = view.container.firstElementChild as HTMLElement;
    if (surface) expect(root).toHaveClass(surface);
    else expect(root.className).not.toMatch(/\bbg-surface-/);
    expect(view.getByRole("heading", { level: 2 })).toHaveClass(primary);
    expect(view.getByRole("button", { name: "Question one" })).toHaveClass(primary);
    expect(view.getByText("Answer one.")).toHaveClass(secondary);
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

// S4-2/S4-4: preserve the owner's presence predicate and ground on the shared region.
it("S4 preserves absent, supporting-only and falsy title regions with original root attributes", () => {
  const view = render(<Faq items={[]} id="host" dir="rtl" data-host="yes" style={{ marginTop: 7 }} />);
  const root = view.container.firstElementChild as HTMLElement;
  expect(root.tagName).toBe("DIV");
  expect(root).toHaveAttribute("id", "host");
  expect(root).toHaveAttribute("dir", "rtl");
  expect(root).toHaveAttribute("data-host", "yes");
  expect(root.style.marginTop).toBe("7px");
  expect(root.children).toHaveLength(1);
  expect(root.querySelectorAll("#host")).toHaveLength(0);
  for (const heading of [0, "", null, false]) {
    view.rerender(<Faq items={[]} heading={heading} />);
    expect(view.container.firstElementChild?.firstElementChild).toHaveClass("gap-xs");
    expect(view.container.firstElementChild?.firstElementChild?.querySelector("h2")).toBeNull();
  }
  view.rerender(<Faq items={[]} description="Support" ground="inverse" />);
  expect(view.getByText("Support")).toHaveClass("text-ink-on-inverse-muted");
  view.rerender(<Faq items={[]} heading="Title" headingLevel={5} ground="inverse"  eyebrow="Label" />);
  expect(view.getByRole("heading", { name: "Title", level: 5 })).toHaveClass("text-h2", "text-ink-on-inverse");
});

it("S4 server-renders the supplied title through the real shared Header", () => {
  const markup = renderS4Server(<Faq heading="Title" items={ITEMS} />);
  expect(markup).toContain("<h2");
  expect(markup).toContain("Title</h2>");
});
