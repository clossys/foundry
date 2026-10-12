import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FeatureGrid } from "./FeatureGrid.js";
import { OrderedStepSequence } from "./OrderedStepSequence.js";
import { NavGrid } from "./NavGrid.js";

// Published collections keep their permissive counts and authored ordinals;
// the canonical Items validator owns the bounded catalog separately.
describe("published collection contracts after catalog cleanup", () => {
  it.each([0, 1, 7])("retains %s published feature items without catalog bounds", count => {
    const { container } = render(<FeatureGrid items={Array.from({ length: count }, (_, i) => ({ id: String(i), heading: `Feature ${i}`, description: `Support ${i}` }))} />);
    expect(container.querySelectorAll("p")).toHaveLength(count * 2);
    expect(screen.queryByRole("heading")).toBeNull();
  });
  it("retains authored sequence ordinals, labels and source order", () => {
    const { container } = render(<OrderedStepSequence items={[
      { id: "one", ordinal: "001", label: "First", heading: "Start" },
      { id: "two", ordinal: "C", heading: "Continue" },
      { id: "three", ordinal: 0, heading: "Finish" },
    ]} />);
    expect(container.querySelectorAll("ol > li")).toHaveLength(3);
    expect([...container.querySelectorAll("li")].map(li => li.textContent)).toEqual(["001FirstStart", "CContinue", "0Finish"]);
    expect([...container.querySelectorAll("ol [aria-hidden=true]")]).toHaveLength(2);
    expect(container.querySelector("[data-item-end], [data-step-end]")).toBeNull();
  });
  it.each([2, 3, 4, 5, 6] as const)("retains h%s block headings and the capped next item rank", headingLevel => {
    render(<OrderedStepSequence heading="Sequence" headingLevel={headingLevel} items={[{ id: "one", ordinal: "A", heading: "Step" }]} />);
    expect(screen.getByRole("heading", { name: "Sequence" }).tagName).toBe(`H${headingLevel}`);
    expect(screen.getByRole("heading", { name: "Step" }).tagName).toBe(`H${Math.min(headingLevel + 1, 6)}`);
  });
  it("retains authored root attributes on both published collections", () => {
    const { container } = render(<><FeatureGrid items={[]} aria-label="Features" data-example="feature" /><OrderedStepSequence items={[]} aria-label="Steps" data-example="sequence" /></>);
    expect(container.querySelector('[data-example="feature"]')).toHaveAttribute("aria-label", "Features");
    expect(container.querySelector('[data-example="sequence"]')).toHaveAttribute("aria-label", "Steps");
  });
  it.each([0, false, null, ""])("retains the present empty block-copy region for %s", heading => {
    const { container } = render(<><FeatureGrid items={[]} heading={heading} /><OrderedStepSequence items={[]} heading={heading} /></>);
    for (const root of container.children) {
      expect(root.children).toHaveLength(2);
      expect(root.firstElementChild?.children).toHaveLength(0);
      expect(root.firstElementChild?.textContent).toBe("");
    }
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
  });
  it("omits absent heading regions while retaining unconditional zero item headings", () => {
    const { container } = render(<><FeatureGrid items={[{ id: "one", heading: 0, icon: 0, description: 0 }]} /><OrderedStepSequence items={[{ id: "one", ordinal: 0, heading: 0, label: 0, description: 0 }]} /></>);
    for (const root of container.children) expect(root.children).toHaveLength(1);
    expect(container.children[0]?.querySelectorAll("p")).toHaveLength(1);
    expect(container.children[0]?.querySelector("p")).toHaveTextContent("0");
    expect(container.children[0]?.querySelector("[aria-hidden]")).toBeNull();
    expect(container.children[1]?.querySelectorAll("p")).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "0", level: 3 })).toBeInTheDocument();
  });
  it("retains truthy array slots even when their contents are empty", () => {
    const { container } = render(<><FeatureGrid heading={[0]} items={[{ id: "one", heading: null, icon: [], description: [] }]} /><OrderedStepSequence heading={[0]} items={[{ id: "one", ordinal: "", heading: null, label: [], description: [] }]} /></>);
    expect(screen.getAllByRole("heading", { level: 2, name: "0" })).toHaveLength(2);
    expect(container.children[0]?.querySelectorAll("p")).toHaveLength(2);
    expect(container.children[0]?.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
    expect(container.children[1]?.querySelectorAll("p")).toHaveLength(2);
    expect(screen.getByRole("heading", { level: 3 })).toBeEmptyDOMElement();
  });
  it.each([0, 1, 7])("keeps %s readonly steps and only adjacent decorations", count => {
    const items = Object.freeze(Array.from({ length: count }, (_, i) => Object.freeze({ id: String(i), ordinal: `S${i}`, heading: `Step ${i}` })));
    const { container } = render(<OrderedStepSequence items={items} />);
    expect(container.querySelectorAll("ol > li")).toHaveLength(count);
    expect(container.querySelectorAll('ol [aria-hidden="true"]')).toHaveLength(Math.max(0, count - 1));
    expect([...container.querySelectorAll("li")].map(node => node.textContent)).toEqual(items.map(item => `${item.ordinal}${item.heading}`));
  });
  it("forwards native events and authored styles on the published roots", () => {
    const events: string[] = [];
    const { container } = render(<><FeatureGrid items={[]} style={{ marginInlineStart: "2em" }} onClick={() => events.push("feature")} /><OrderedStepSequence items={[]} style={{ marginInlineStart: "3em" }} onClick={() => events.push("steps")} /></>);
    expect((container.children[0] as HTMLElement).style.marginInlineStart).toBe("2em");
    expect((container.children[1] as HTMLElement).style.marginInlineStart).toBe("3em");
    fireEvent.click(container.children[0]!); fireEvent.click(container.children[1]!);
    expect(events).toEqual(["feature", "steps"]);
  });
  it.each([2, 3, 4, 5, 6] as const)("keeps the published feature h%s block rank and paragraph items", headingLevel => {
    render(<FeatureGrid heading="Features" headingLevel={headingLevel} items={[{ id: "one", heading: "Feature" }]} />);
    expect(screen.getByRole("heading", { name: "Features" }).tagName).toBe(`H${headingLevel}`);
    expect(screen.getByText("Feature").tagName).toBe("P");
  });
  it("keeps authored native controls legal in published copy slots", () => {
    render(<><FeatureGrid heading={<button>Feature heading action</button>} items={[{ id: "one", heading: <a href="/feature">Feature title</a>, icon: <button>Feature icon action</button>, description: <button>Feature description action</button> }]} /><OrderedStepSequence heading={<button>Sequence heading action</button>} items={[{ id: "one", ordinal: "A", heading: <a href="/step">Step title</a>, label: <button>Step label action</button>, description: <button>Step description action</button> }]} /></>);
    expect(screen.getAllByRole("button")).toHaveLength(5);
    expect(document.querySelectorAll("button")).toHaveLength(6);
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });
  it("retains permissive readonly Nav copy and duplicate authored relative destinations", () => {
    const items = Object.freeze([0, false, null, <span key="empty" />].map((title, index) => Object.freeze({ id: String(index), title, href: "relative-path" })));
    const { container } = render(<NavGrid items={items} />);
    expect(container.querySelectorAll("li")).toHaveLength(4);
    expect([...container.querySelectorAll("li a")].map(anchor => anchor.getAttribute("href"))).toEqual(Array(4).fill("relative-path"));
    expect(container.querySelector("li p")?.textContent?.trim()).toBe("0");
    expect(container.querySelectorAll("li p")).toHaveLength(4);
  });
});
