import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderedStepSequence, type OrderedStepSequenceItem } from "./OrderedStepSequence.js";

const lanes = { a: "Team", b: "Service" };
const steps = (sequence: string): OrderedStepSequenceItem[] => [...sequence].map((lane, index) => ({ id: `step-${index}`, ordinal: index + 1, heading: `Step ${index + 1}`, lane: lane as "a" | "b" }));
const plain = steps("aba").map(({ lane: _lane, ...item }) => item);
const tokens = readFileSync(resolve(import.meta.dirname, "../../styles/tokens.css"), "utf8");
const pixels = (token: string) => Number(tokens.match(new RegExp(`${token}:\\s+(\\d+)px;`))![1]);

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
  it("keeps opted-in ordinary final connectors hairline at both row breakpoints", () => {
    for (const [visual, breakpoint] of [[false, "tablet"], [true, "tablet-lg"]] as const) {
      const items = plain.map((item) => ({ ...item, ...(visual ? { visual: <div>Panel</div> } : {}) }));
      const { container } = render(<OrderedStepSequence items={items} end="ends" />);
      const line = container.querySelector("li:last-child [data-step-connector]")!;
      expect(line.classList.contains(`${breakpoint}:h-px`) || line.classList.contains(`${breakpoint}:h-[length:var(--ui-border-hairline)]`)).toBe(true);
      // Any unreset minimum would clamp the requested horizontal thickness.
      expect([...line.classList].filter((name) => /(?:^|:)min-h-/.test(name))).toEqual([]);
    }
  });
  it("ties tall ordinary terminal rails and labels to content bottom plus xl", () => {
    for (const visual of [false, true]) {
      const items = plain.map((item, i) => ({ ...item, description: i === 2 ? <span>{Array.from({ length: 8 }, (_, n) => <span key={n} style={{ display: "block" }}>Tall copy {n}</span>)}</span> : undefined, ...(visual ? { visual: <div style={{ height: 200 }}>Tall panel</div> } : {}) }));
      const { container } = render(<OrderedStepSequence items={items} end="ends" endLabel="Complete" />);
      const last = container.querySelector("li:last-child")!;
      const line = last.querySelector("[data-step-connector]")!;
      const label = last.querySelector("[data-step-end-label]")!;
      expect(last).toHaveClass("relative", "pb-xl");
      expect(line).toHaveClass("absolute", "top-2xl", "bottom-0");
      expect(line).not.toHaveClass("relative", "my-sm", "flex-1");
      // The marker column has no positioning context; the line's bottom:0
      // is the li padding-box edge, one xl below either tall body.
      expect(line.parentElement).not.toHaveClass("relative", "absolute");
      expect(label).toHaveClass("bottom-0", "translate-y-1/2");
      expect(container.querySelector("li:first-child")).not.toHaveClass("pb-xl");
    }
  });
  it("keeps linked lane tracks outside the body overlay and its negative insets", () => {
    for (const [sequence, breakpoint] of [["aba", "tablet-lg"], ["abbaa", "desktop"]] as const) {
    const { container } = render(<OrderedStepSequence lanes={lanes} items={steps(sequence).map((item) => ({ ...item, href: `/steps/${item.id}` }))} />);
    for (const li of container.querySelectorAll("li")) {
      const anchor = li.querySelector("a")!;
      const hitContext = anchor.closest(".isolate")!;
      expect(hitContext).not.toBe(li);
      expect(li).not.toHaveClass("isolate");
      expect(hitContext).toHaveClass("relative", "mt-2xl", `${breakpoint}:mt-lg`);
      expect(hitContext).not.toHaveClass("pt-2xl", `${breakpoint}:pt-lg`);
      expect(anchor).toHaveClass("after:-inset-x-md", "after:-inset-y-md");
      // Derive the hit bounds from the shipped tokens, including the plain
      // overlay's negative md inset. They must stay beyond the track center.
      const disc = pixels("--spacing-2xl"), gap = pixels("--spacing-lg"), inset = pixels("--spacing-md");
      expect(disc + gap - inset).toBeGreaterThan(disc / 2); // rail inline bound
      expect(disc + gap - inset).toBeGreaterThan(disc / 2); // row block bound
      for (const track of li.querySelectorAll("[data-step-connector], [data-step-join], [data-step-end], [data-step-lane-label]")) expect(hitContext.contains(track)).toBe(false);
    }
    }
    expect(() => renderToStaticMarkup(<OrderedStepSequence lanes={lanes} items={steps("aba").map((item) => ({ ...item, href: "/next", visual: <button>Nested</button> }))} />)).toThrow(TypeError);
  });
  it("refuses invisible continuation labels and uses meaningful fallback copy", () => {
    const invisible = [undefined, null, false, "", "  ", [], [false, null, ""], new Set<null | false>([null, false]), <></>, <span />];
    for (const endLabel of invisible) {
      expect(() => renderToStaticMarkup(<OrderedStepSequence items={plain} end="continues" endLabel={endLabel} />)).toThrow(TypeError);
      const { container } = render(<OrderedStepSequence items={plain} end="continues" endLabel={endLabel} continuesLabel="Consumer continuation" />);
      expect(container.querySelector("[data-step-end-label]")).toHaveClass("sr-only");
      expect(container.querySelector("[data-step-end-label]")).toHaveTextContent("Consumer continuation");
    }
    for (const continuesLabel of invisible) expect(() => renderToStaticMarkup(<OrderedStepSequence items={plain} end="continues" continuesLabel={continuesLabel} />)).toThrow(TypeError);
  });
  it("accepts visible array and iterable continuation labels", () => {
    for (const endLabel of [["Repeats ", <span key="monthly">monthly</span>], new Set(["Repeats ", "monthly"])]) {
      const { container } = render(<OrderedStepSequence items={plain} end="continues" endLabel={endLabel} />);
      expect(container.querySelector("[data-step-end-label]")).toHaveTextContent("Repeats monthly");
      expect(container.querySelector("[data-step-end-label]")).not.toHaveClass("sr-only");
    }
    const { container } = render(<OrderedStepSequence items={plain} end="continues" continuesLabel={new Set(["Consumer ", "continuation"])} />);
    expect(container.querySelector("[data-step-end-label]")).toHaveTextContent("Consumer continuation");
  });
  it("preserves legacy ordinary SSR exactly with no new options", () => {
    expect(renderToStaticMarkup(<OrderedStepSequence items={plain} />)).toMatchInlineSnapshot(`"<section class="flex flex-col gap-lg"><ol data-step-layout="plain" class="flex flex-col tablet:flex-row tablet:gap-x-xl"><li class="flex min-w-0 flex-1 flex-row gap-md tablet:flex-col tablet:gap-lg"><div class="flex shrink-0 flex-col items-center tablet:flex-row"><span class="flex size-2xl shrink-0 items-center justify-center rounded-pill text-body font-body font-medium tabular-nums bg-accent-tint text-accent-text">1</span><span aria-hidden="true" data-step-connector="" class="my-sm w-px flex-1 tablet:my-0 tablet:ms-md tablet:-me-md tablet:h-px tablet:w-auto bg-line-strong"></span></div><div data-step-text="" class="flex min-w-0 flex-col gap-sm pb-2xl tablet:pb-0"><h3 class="text-body-l font-body font-medium text-ink-primary">Step 1</h3></div></li><li class="flex min-w-0 flex-1 flex-row gap-md tablet:flex-col tablet:gap-lg"><div class="flex shrink-0 flex-col items-center tablet:flex-row"><span class="flex size-2xl shrink-0 items-center justify-center rounded-pill text-body font-body font-medium tabular-nums bg-accent-tint text-accent-text">2</span><span aria-hidden="true" data-step-connector="" class="my-sm w-px flex-1 tablet:my-0 tablet:ms-md tablet:-me-md tablet:h-px tablet:w-auto bg-line-strong"></span></div><div data-step-text="" class="flex min-w-0 flex-col gap-sm pb-2xl tablet:pb-0"><h3 class="text-body-l font-body font-medium text-ink-primary">Step 2</h3></div></li><li class="flex min-w-0 flex-1 flex-row gap-md tablet:flex-col tablet:gap-lg"><div class="flex shrink-0 flex-col items-center tablet:flex-row"><span class="flex size-2xl shrink-0 items-center justify-center rounded-pill text-body font-body font-medium tabular-nums bg-accent-tint text-accent-text">3</span></div><div data-step-text="" class="flex min-w-0 flex-col gap-sm"><h3 class="text-body-l font-body font-medium text-ink-primary">Step 3</h3></div></li></ol></section>"`);
  });
});
