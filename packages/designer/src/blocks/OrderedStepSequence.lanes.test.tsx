import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderedStepSequence, type OrderedStepSequenceItem } from "./OrderedStepSequence.js";

const lanes = { a: "Team", b: "Service" };
const steps = (sequence: string): OrderedStepSequenceItem[] => [...sequence].map((lane, index) => ({ id: `step-${index}`, ordinal: index + 1, heading: `Step ${index + 1}`, lane: lane as "a" | "b" }));
const plain = steps("aba").map(({ lane: _lane, ...item }) => item);

describe("OrderedStepSequence lanes", () => {
  it("states each actor in text and labels the list by the real heading", () => {
    const { container } = render(<OrderedStepSequence lanes={lanes} items={steps("aba")} labelledBy="process-heading" />);
    expect(container.querySelector("ol")).toHaveAttribute("data-step-lanes");
    expect(container.querySelector("ol")).toHaveAttribute("aria-labelledby", "process-heading");
    expect([...container.querySelectorAll("li")].map((li) => li.getAttribute("data-lane"))).toEqual(["a", "b", "a"]);
    expect([...container.querySelectorAll("[data-step-lane-label]")].map((label) => label.textContent)).toEqual(["Team", "Service", "Team"]);
    for (const label of container.querySelectorAll("[data-step-lane-label]")) { expect(label).toHaveClass("absolute"); expect(label).not.toHaveClass("relative"); }
    expect(container.querySelector("section")).not.toHaveClass("gap-lg");
  });
  it.each([["aba", [null, "down", "up"]], ["abbaa", [null, "down", "same", "up", "same"]]] as const)("computes %s joins against the previous lane", (sequence, joins) => {
    const { container } = render(<OrderedStepSequence lanes={lanes} items={steps(sequence)} />);
    expect([...container.querySelectorAll("li")].map((li) => li.querySelector("[data-step-join]")?.getAttribute("data-step-join") ?? null)).toEqual(joins);
  });
  it("hides every decorative line, join and terminal marker", () => {
    const { container } = render(<OrderedStepSequence lanes={lanes} items={steps("aba")} />);
    expect(container.querySelectorAll("[data-step-connector]")).toHaveLength(3);
    expect(container.querySelectorAll("[data-step-join]")).toHaveLength(2);
    for (const mark of container.querySelectorAll("[data-step-connector], [data-step-join], [data-step-end]")) expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("li:last-child [data-step-connector]")).toHaveAttribute("data-end", "ends");
    expect(container.querySelector("[data-step-end]")).toHaveClass("rounded-pill");
  });
  it("uses tablet-lg for three and desktop for five, with logical rail indent and lane drop", () => {
    for (const [sequence, breakpoint] of [["aba", "tablet-lg"], ["abbaa", "desktop"]] as const) {
      const { container } = render(<OrderedStepSequence lanes={lanes} items={steps(sequence)} />);
      const list = container.querySelector("ol")!;
      expect(list).toHaveClass(`${breakpoint}:grid`, `${breakpoint}:grid-cols-${sequence.length}`, "gap-2xl");
      expect(list.className).not.toMatch(/(?:^|\s)tablet:/);
      if (sequence.length === 5) expect(list.className).not.toMatch(/(?:^|\s)tablet-lg:/);
      expect(container.querySelector('[data-lane="b"]')).toHaveClass("ms-xl", `${breakpoint}:ms-0`, `${breakpoint}:mt-4xl`);
      expect(container.querySelector('[data-step-join="down"]')?.className).toContain("--radius-control");
    }
  });
  it.each(["ab", "abba", "abbbbb"])("refuses lane count %s", (sequence) => expect(() => renderToStaticMarkup(<OrderedStepSequence lanes={lanes} items={steps(sequence)} />)).toThrow(RangeError));
  it("refuses conflicting labels, missing lanes, lane without block, first-b, unused actor and five visuals", () => {
    expect(() => renderToStaticMarkup(<OrderedStepSequence lanes={lanes} items={steps("aba").map((item) => ({ ...item, label: "Other" }))} />)).toThrow(TypeError);
    expect(() => renderToStaticMarkup(<OrderedStepSequence lanes={lanes} items={plain} />)).toThrow(TypeError);
    expect(() => renderToStaticMarkup(<OrderedStepSequence items={steps("aba")} />)).toThrow(TypeError);
    for (const sequence of ["baa", "aaa"]) expect(() => renderToStaticMarkup(<OrderedStepSequence lanes={lanes} items={steps(sequence)} />)).toThrow(TypeError);
    expect(() => renderToStaticMarkup(<OrderedStepSequence lanes={lanes} items={steps("abbaa").map((item) => ({ ...item, visual: <span>Panel</span> }))} />)).toThrow(RangeError);
  });
  it("renders visible end copy and caption outside the list; only visual steps take captions", () => {
    const items = steps("aba").map((item) => ({ ...item, visual: <span>Panel</span> }));
    const { container } = render(<OrderedStepSequence lanes={lanes} items={items} end="continues" endLabel="Repeats monthly" caption="Sample data." />);
    expect(container.querySelector("[data-step-end]")).toHaveAttribute("data-step-end", "continues");
    expect(container.querySelector("[data-step-end-label]")).toHaveTextContent("Repeats monthly");
    expect(container.querySelector("[data-step-end-label]")).not.toHaveAttribute("aria-hidden");
    const caption = container.querySelector("[data-step-caption]")!;
    expect(caption.previousElementSibling?.tagName).toBe("OL");
    expect(container.querySelector("ol [data-step-caption]")).toBeNull();
    expect(() => renderToStaticMarkup(<OrderedStepSequence items={plain} caption="Sample data." />)).toThrow(TypeError);
  });
  it("requires consumer continuation copy on opted-in arrows and renders it hidden", () => {
    expect(() => renderToStaticMarkup(<OrderedStepSequence items={plain} end="continues" />)).toThrow(TypeError);
    const { container } = render(<OrderedStepSequence items={plain} end="continues" continuesLabel="Consumer continuation" />);
    expect(container.querySelector("[data-step-end-label]")).toHaveClass("sr-only");
    expect(container.querySelector("[data-step-end-label]")).toHaveTextContent("Consumer continuation");
    expect(container.querySelector("[data-step-end] svg")).not.toBeNull();
    expect(container.querySelector("[data-step-end] svg")?.className.baseVal).toContain("rtl:");
    expect(container.querySelectorAll("[data-step-connector]")).toHaveLength(3);
  });
  it("preserves legacy ordinary SSR exactly with no new options", () => {
    expect(renderToStaticMarkup(<OrderedStepSequence items={plain} />)).toMatchInlineSnapshot(`"<section class="flex flex-col gap-lg"><ol data-step-layout="plain" class="flex flex-col tablet:flex-row tablet:gap-x-xl"><li class="flex min-w-0 flex-1 flex-row gap-md tablet:flex-col tablet:gap-lg"><div class="flex shrink-0 flex-col items-center tablet:flex-row"><span class="flex size-2xl shrink-0 items-center justify-center rounded-pill text-body font-body font-medium tabular-nums bg-accent-tint text-accent-text">1</span><span aria-hidden="true" data-step-connector="" class="my-sm w-px flex-1 tablet:my-0 tablet:ms-md tablet:-me-md tablet:h-px tablet:w-auto bg-line-strong"></span></div><div data-step-text="" class="flex min-w-0 flex-col gap-sm pb-2xl tablet:pb-0"><h3 class="text-body-l font-body font-medium text-ink-primary">Step 1</h3></div></li><li class="flex min-w-0 flex-1 flex-row gap-md tablet:flex-col tablet:gap-lg"><div class="flex shrink-0 flex-col items-center tablet:flex-row"><span class="flex size-2xl shrink-0 items-center justify-center rounded-pill text-body font-body font-medium tabular-nums bg-accent-tint text-accent-text">2</span><span aria-hidden="true" data-step-connector="" class="my-sm w-px flex-1 tablet:my-0 tablet:ms-md tablet:-me-md tablet:h-px tablet:w-auto bg-line-strong"></span></div><div data-step-text="" class="flex min-w-0 flex-col gap-sm pb-2xl tablet:pb-0"><h3 class="text-body-l font-body font-medium text-ink-primary">Step 2</h3></div></li><li class="flex min-w-0 flex-1 flex-row gap-md tablet:flex-col tablet:gap-lg"><div class="flex shrink-0 flex-col items-center tablet:flex-row"><span class="flex size-2xl shrink-0 items-center justify-center rounded-pill text-body font-body font-medium tabular-nums bg-accent-tint text-accent-text">3</span></div><div data-step-text="" class="flex min-w-0 flex-col gap-sm"><h3 class="text-body-l font-body font-medium text-ink-primary">Step 3</h3></div></li></ol></section>"`);
  });
});
