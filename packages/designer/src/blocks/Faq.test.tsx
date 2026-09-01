import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Faq, type FaqItem } from "./Faq.js";

const ITEMS: FaqItem[] = [
  { id: "one", question: "Question one text", answer: "Answer one text." },
  { id: "two", question: "Question two text", answer: "Answer two text." },
];

describe("Faq", () => {
  it("renders an optional heading above the question list", () => {
    render(<Faq heading="FAQ heading" items={ITEMS} />);
    expect(screen.getByRole("heading", { name: "FAQ heading" })).toBeInTheDocument();
  });

  it("defaults the heading to <h2>", () => {
    render(<Faq heading="FAQ heading" items={ITEMS} />);
    expect(screen.getByRole("heading", { name: "FAQ heading" }).tagName).toBe("H2");
  });

  it("renders the heading at a custom level", () => {
    render(<Faq heading="FAQ heading" items={ITEMS} headingLevel={3} />);
    expect(screen.getByRole("heading", { name: "FAQ heading" }).tagName).toBe("H3");
  });

  it("renders no heading region when heading/description are both omitted", () => {
    render(<Faq items={ITEMS} />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("renders one question trigger per item", () => {
    render(<Faq items={ITEMS} />);
    expect(screen.getByRole("button", { name: "Question one text" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Question two text" })).toBeInTheDocument();
  });

  it("every question starts collapsed: aria-expanded=false, answer text not present", () => {
    render(<Faq items={ITEMS} />);
    const trigger = screen.getByRole("button", { name: "Question one text" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Answer one text.")).not.toBeVisible();
  });

  it("clicking a question expands it: aria-expanded flips to true and the answer becomes visible", async () => {
    const user = userEvent.setup();
    render(<Faq items={ITEMS} />);
    const trigger = screen.getByRole("button", { name: "Question one text" });

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Answer one text.")).toBeVisible();
  });

  it("clicking an expanded question collapses it again", async () => {
    const user = userEvent.setup();
    render(<Faq items={ITEMS} />);
    const trigger = screen.getByRole("button", { name: "Question one text" });

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("is keyboard-operable: Enter toggles the focused question", async () => {
    const user = userEvent.setup();
    render(<Faq items={ITEMS} />);
    const trigger = screen.getByRole("button", { name: "Question one text" });

    trigger.focus();
    await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("is keyboard-operable: Space toggles the focused question", async () => {
    const user = userEvent.setup();
    render(<Faq items={ITEMS} />);
    const trigger = screen.getByRole("button", { name: "Question one text" });

    trigger.focus();
    await user.keyboard(" ");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("questions expand independently — not an accordion, opening one never closes another", async () => {
    const user = userEvent.setup();
    render(<Faq items={ITEMS} />);
    const first = screen.getByRole("button", { name: "Question one text" });
    const second = screen.getByRole("button", { name: "Question two text" });

    await user.click(first);
    await user.click(second);

    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(second).toHaveAttribute("aria-expanded", "true");
  });

  it("aria-controls on the trigger points at the answer panel's own id", () => {
    render(<Faq items={ITEMS} />);
    const trigger = screen.getByRole("button", { name: "Question one text" });
    const controlsId = trigger.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();
    expect(document.getElementById(controlsId as string)).toHaveTextContent("Answer one text.");
  });

  it("forwards className onto the root, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(<Faq items={ITEMS} className="gap-2xl" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("gap-2xl");
  });

  it.each([
    ["base", "", "text-ink-primary", "text-ink-secondary", "border-line-base"],
    ["sunken", "bg-surface-sunken", "text-ink-primary", "text-ink-secondary", "border-line-base"],
    ["inverse", "bg-surface-inverse", "text-ink-on-inverse", "text-ink-on-inverse-muted", "border-line-on-inverse"],
  ] as const)("selects the complete %s ground policy", (ground, surface, primary, secondary, border) => {
    const { container } = render(<Faq heading="FAQ heading" items={ITEMS} ground={ground} />);
    const root = container.firstElementChild as HTMLElement;
    if (surface) expect(root).toHaveClass(surface);
    else expect(root.className).not.toMatch(/\bbg-surface-/);
    expect(screen.getByRole("heading")).toHaveClass(primary);
    const firstTrigger = screen.getByRole("button", { name: "Question one text" });
    const secondTrigger = screen.getByRole("button", { name: "Question two text" });
    expect(firstTrigger).toHaveClass(primary);
    expect(document.getElementById(firstTrigger.getAttribute("aria-controls") as string)).toHaveClass(secondary);
    expect(secondTrigger.parentElement).toHaveClass(border);
  });
});

describe("Faq eyebrow", () => {
  it("renders an optional eyebrow above the heading", () => {
    const { container } = render(<Faq eyebrow="Section label" heading="Process" items={ITEMS} />);
    const region = container.querySelector("h2")?.parentElement as HTMLElement;
    expect(region.children[0].tagName).toBe("P");
    expect(region.children[0].textContent).toBe("Section label");
    expect(region.children[1].tagName).toBe("H2");
  });

  it("renders no eyebrow element, and no heading region at all, when none is supplied", () => {
    const withHeading = render(<Faq heading="Process" items={ITEMS} />).container;
    expect(withHeading.querySelector("h2")?.parentElement?.children).toHaveLength(1);
    const bare = render(<Faq items={ITEMS} />).container;
    expect(bare.querySelectorAll("p")).toHaveLength(0);
  });
});
