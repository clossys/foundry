import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Items } from "./Items.js";
import { Items as NativeItems } from "./Items.server.js";
import type { ItemsProps } from "./types.js";

const data = (count: number) => Array.from({ length: count }, (_, i) => ({ id: String(i), heading: `Step ${i}`, description: "Support" }));
describe("Items review regressions", () => {
  it("suppresses preflight borders on base decoration while retaining inverse ordinal outlines", () => {
    for (const ground of ["base", "sunken", "inverse"] as const) for (const end of ["ends", "continues"] as const) {
      const tree = render(<Items arrangement="columns" order="connected" ground={ground} end={end} items={data(3)} />);
      for (const node of tree.container.querySelectorAll("[data-item-segment],[data-item-end=ends],[data-item-connector]:not([data-item-transition])")) expect(node).toHaveClass("border-none", "forced-colors:border-solid");
      expect(tree.container.querySelector("[data-item-end]")).toHaveClass("border-none");
      for (const ordinal of tree.container.querySelectorAll("[data-item-ordinal]")) expect(ordinal).toHaveClass(ground === "inverse" ? "border-solid" : "border-none");
      tree.unmount();
    }
  });
  it.each([3, 5])("reserves authored multiline lane labels in flow until the %s-step row breakpoint", count => {
    const { container } = render(<Items arrangement="stacked" order="connected" lanes={[{ id: "a", label: <span>First<br />actor</span> }, { id: "b", label: <span>Second<br />actor</span> }]} items={data(count).map((item, i) => ({ ...item, lane: i % 2 ? "b" : "a" }))} />);
    for (const label of container.querySelectorAll("[data-item-lane-label]")) {
      expect(label).toHaveClass("relative", "block", count === 3 ? "tablet-lg:absolute" : "desktop:absolute");
      expect(label).not.toHaveClass("absolute");
    }
  });
  it.each(["rule", "plate", "featured", "visual"] as const)("fills the numbered %s item body without shrinking to its copy", kind => {
    const { container } = render(<Items arrangement="columns" order="numbered" treatment={kind === "rule" || kind === "plate" ? kind : "plain"} items={data(3).map((item, i) => ({ ...item, featured: kind === "featured" && i === 0 ? true : undefined, visual: kind === "visual" ? <div>Visual</div> : undefined }))} />);
    for (const li of container.querySelectorAll("li")) {
      expect(li.querySelector("[data-item]")).toHaveClass("min-w-0", "flex-1");
      expect(li.querySelector("[data-item-ordinal]")).toHaveClass("shrink-0");
      if (kind === "visual") expect(li.querySelector("[data-item-visual]")).toHaveClass("w-full");
    }
  });
  it("reserves a label track only in the final visual row at each effective column count", () => {
    const { container } = render(<Items arrangement="columns" columns={3} order="connected" endLabel="Next" items={data(5).map((item, i) => ({ ...item, visual: i === 1 ? <div>Visual</div> : undefined }))} />);
    const cells = [...container.querySelectorAll("li")];
    expect(cells.map(li => li.classList.contains("tablet:row-span-3"))).toEqual([false, false, false, false, true]);
    expect(cells.map(li => li.classList.contains("tablet-lg:row-span-3"))).toEqual([false, false, false, true, true]);
    expect(cells[4]).toHaveTextContent("Next");
  });
  it.each([Items, NativeItems])("names the actual connected ordered list from an external h2", Component => {
    render(<><h2 id="sequence-heading">Sequence heading</h2><Component arrangement="columns" order="connected" aria-labelledby="sequence-heading" caption="Process support" items={data(3).map((item, i) => ({ ...item, visual: i === 1 ? <span>Visual</span> : undefined }))} /></>);
    const list = screen.getByRole("list", { name: "Sequence heading" });
    expect(list.tagName).toBe("OL"); expect(list).toHaveAttribute("aria-labelledby", "sequence-heading");
    expect(list.parentElement).not.toHaveAttribute("aria-labelledby");
    expect(list.closest('[aria-labelledby="sequence-heading"]')).toBe(list);
  });
  it.each([Items, NativeItems])("names each actual grouped list and keeps group labels distinct", Component => {
    render(<><h2 id="collection-heading">Collection heading</h2><Component arrangement="rows" order="numbered" aria-labelledby="collection-heading" items={data(4)} groups={[{ id: "a", label: "First", items: ["0", "1"] }, { id: "b", label: "Second", items: ["2", "3"] }]} /></>);
    expect(screen.queryByRole("list", { name: "Collection heading" })).toBeNull();
    for (const label of ["First", "Second"]) {
      const list = screen.getByRole("list", { name: label });
      const group = screen.getByRole("group", { name: label });
      expect(group).toContainElement(list);
      expect(list).toHaveAttribute("aria-labelledby", group.querySelector("p")!.id);
    }
    expect(screen.getByRole("group", { name: "First" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Second" })).toBeInTheDocument();
  });
  it.each([Items, NativeItems])("keeps same-named grouped list references local across two instances", Component => {
    const groups = [{ id: "a", label: "Actor", items: ["0", "1"] }, { id: "b", label: "Actor", items: ["2", "3"] }];
    const { container } = render(<><Component arrangement="rows" items={data(4)} groups={groups} /><Component arrangement="rows" order="numbered" reveal="disclose" items={data(4)} groups={groups} /></>);
    const ids = new Set<string>();
    for (const list of container.querySelectorAll('[role="group"] > ul, [role="group"] > ol')) {
      const label = list.parentElement!.querySelector("p")!;
      expect(list).toHaveAccessibleName("Actor");
      expect(list).toHaveAttribute("aria-labelledby", label.id);
      expect(document.getElementById(label.id)).toBe(label);
      expect(ids.has(label.id)).toBe(false); ids.add(label.id);
    }
    expect(ids.size).toBe(4);
  });
  it.each([Items, NativeItems])("renders an authored iterable final label in the actual terminal track", Component => {
    const { container } = render(<Component arrangement="columns" order="connected" items={data(3)} end="continues" endLabel={new Set(["Repeats ", "monthly"])} />);
    expect(container.querySelector("[data-item-end-label]")).toHaveTextContent("Repeats monthly");
    expect(container.querySelectorAll("[data-item-end-label]")).toHaveLength(1);
  });
  it.each([Items, NativeItems])("leaves omitted list naming byte-identical to explicit undefined", Component => {
    const props: ItemsProps = { arrangement: "columns", items: data(3) };
    const omitted = renderToStaticMarkup(<Component {...props} />);
    expect(renderToStaticMarkup(<Component {...props} aria-labelledby={undefined} />)).toBe(omitted);
    expect(omitted).not.toContain("aria-labelledby");
  });
});
