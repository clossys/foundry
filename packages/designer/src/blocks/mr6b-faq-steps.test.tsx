import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Faq as NativeFaq } from "./Faq.server.js";
import { OrderedStepSequence } from "./OrderedStepSequence.js";

describe("MR6b document FAQ and steps", () => {
  it("keeps steps on Designer content components without raw styled copy or controls", () => {
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "OrderedStepSequence.tsx"), "utf8");
    expect(source).toContain('import { SemanticContent } from "../components/SemanticContent.js"');
    expect(source).not.toMatch(/<(?:a|button|input)\b/);
    expect(source).not.toMatch(/<(?:p|span)\b[^>]*className=/);
    expect(source).not.toMatch(/[A-Za-z]+Label = "/);
  });

  it("preserves authored reading order, heading ranks and decorative connectors", () => {
    const view = render(<OrderedStepSequence heading="Sequence" headingLevel={4} items={[
      { id: "one", ordinal: "01", label: "First", heading: "Review", description: "Read the details." },
      { id: "two", ordinal: "02", heading: "Continue" },
    ]} />);
    expect(view.getByRole("heading", { name: "Sequence", level: 4 })).toBeInTheDocument();
    expect(view.getByRole("heading", { name: "Review", level: 5 })).toBeInTheDocument();
    const rows = view.container.querySelectorAll("ol > li");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("01FirstReviewRead the details.");
    expect(rows[1]).toHaveTextContent("02Continue");
    expect(rows[0]?.querySelector("[data-step-connector]")).toHaveAttribute("aria-hidden", "true");
    expect(rows[1]?.querySelector("[data-step-connector]")).toBeNull();
    expect(view.getByText("First").tagName).toBe("P");
    expect(view.getByText("Read the details.").tagName).toBe("P");
  });

  it("renders FAQ rows on the stock disclosure with caller-authored answers", () => {
    const view = render(<NativeFaq heading="Questions" items={[
      { id: "one", question: "What happens first?", answer: "Read the details." },
      { id: "two", question: "What follows?", answer: "Choose the next step." },
    ]} />);
    expect(view.container.querySelectorAll("details, summary")).toHaveLength(0);
    const triggers = [...view.container.querySelectorAll<HTMLButtonElement>('button[slot="trigger"][aria-controls]')];
    expect(triggers).toHaveLength(2);
    expect(triggers[0]).toHaveTextContent("What happens first?");
    expect(triggers[1]).toHaveTextContent("What follows?");
    const panels = triggers.map(trigger => view.container.querySelector<HTMLElement>(`[id="${trigger.getAttribute("aria-controls")}"]`));
    triggers.forEach((trigger, index) => {
      const panel = panels[index];
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(panel).toHaveAttribute("role", "group");
      expect(panel).toHaveAttribute("aria-labelledby", trigger.id);
      expect(panel).toHaveAttribute("hidden");
    });
    expect(panels[0]).toHaveTextContent("Read the details.");
    expect(panels[1]).toHaveTextContent("Choose the next step.");
  });
});
