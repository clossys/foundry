import { render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UI_BORDER_HAIRLINE } from "../../atoms/internal/ui-vars.js";
import { Tree, type TreeNodeData, type TreeProps } from "./Tree.js";

const simple: TreeNodeData[] = [
  { id: "root", heading: "Organization", description: "The shared purpose." },
  { id: "one", parent: "root", heading: "Research" },
  { id: "two", parent: "root", heading: "Operations" },
];
const html = (nodes: readonly TreeNodeData[], props: Partial<TreeProps> = {}) => renderToStaticMarkup(<Tree nodes={nodes} {...props} />);
function branch(depth: number): TreeNodeData[] {
  const nodes: TreeNodeData[] = [{ id: "root", heading: "Root" }];
  let parent = "root";
  for (let level = 1; level <= depth; level++) {
    const id = `branch-${level}`;
    nodes.push({ id, parent, heading: id }, { id: `leaf-${level}`, parent, heading: `Leaf ${level}` });
    parent = id;
  }
  return nodes;
}
function fan(count: number): TreeNodeData[] {
  return [simple[0]!, ...Array.from({ length: count }, (_, index) => ({ id: `child-${index}`, parent: "root", heading: `Child ${index}` }))];
}

describe("Tree", () => {
  it("renders nested lists with an h3 root and h4 children", () => {
    const { container } = render(<Tree nodes={branch(2)} />);
    expect(container.querySelectorAll("ul")).toHaveLength(3);
    expect(container.querySelectorAll("li")).toHaveLength(5);
    expect(screen.getByRole("heading", { level: 3, name: "Root" })).toHaveAttribute("data-item-heading");
    expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(4);
    for (const row of container.querySelectorAll("li")) {
      expect(row.querySelector(":scope > [data-diagram-node] [data-item]")).not.toBeNull();
      expect(row.parentElement?.tagName).toBe("UL");
    }
    const child = screen.getByRole("heading", { name: "branch-2" }).closest("li")!;
    expect(child.parentElement?.parentElement).toBe(screen.getByRole("heading", { name: "branch-1" }).closest("li"));
  });

  it("preserves siblings' array order even when children precede the root", () => {
    render(<Tree nodes={[simple[2]!, simple[1]!, simple[0]!]} />);
    expect(screen.getAllByRole("heading").map(node => node.textContent)).toEqual(["Organization", "Operations", "Research"]);
  });

  it("puts the edge label before the child heading", () => {
    render(<Tree nodes={simple.map((node, index) => index === 0 ? node : { ...node, edgeLabel: <em>{`Relation ${index}`}</em> })} />);
    for (const [index, name] of ["Research", "Operations"].entries()) {
      const heading = screen.getByRole("heading", { name });
      const label = screen.getByText(`Relation ${index + 1}`);
      expect(label).toBeVisible();
      expect(label.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(heading.closest("li")).toContainElement(label);
    }
  });

  it.each([
    ["authored text", "Relation"], ["null", null], ["false", false], ["empty text", ""],
  ] as const)("refuses a defined root edge label (%s)", (_name, edgeLabel) => {
    expect(() => html([{ ...simple[0]!, edgeLabel }, ...simple.slice(1)])).toThrow(/root.*edge label/i);
  });

  it("keeps roots with omitted or undefined edge labels valid", () => {
    expect(() => html(simple)).not.toThrow();
    expect(() => html([{ ...simple[0]!, edgeLabel: undefined }, ...simple.slice(1)])).not.toThrow();
  });

  it("keeps passive block edge labels inside their wrapper through an SSR DOM roundtrip", () => {
    const serialized = html(simple.map((node, index) => index === 0 ? node : {
      ...node, edgeLabel: <div data-label-content="">{`Relation ${index}`}</div>,
    }));
    const parsed = document.createElement("div");
    parsed.innerHTML = serialized;
    const labels = parsed.querySelectorAll("[data-diagram-edge]");
    expect(labels).toHaveLength(2);
    for (const [index, label] of [...labels].entries()) {
      const content = parsed.querySelectorAll("[data-label-content]")[index]!;
      expect(label).toContainElement(content);
      expect(label.tagName).toBe("DIV");
      expect(content.textContent).toBe(`Relation ${index + 1}`);
      const heading = label.closest("[data-diagram-node]")!.querySelector("h4")!;
      expect(label.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(parsed.querySelectorAll("p:empty")).toHaveLength(0);
  });

  it("keeps label coverage local to siblings and preserves authored numeric zero", () => {
    const nodes = branch(2).map(node => node.parent === "root" ? { ...node, edgeLabel: 0 } : node);
    render(<Tree nodes={nodes} />);
    expect(screen.getAllByText("0")).toHaveLength(2);
    expect(() => html(simple.map((node, i) => i === 1 ? { ...node, edgeLabel: "Part of" } : node))).toThrow(/edge labels.*siblings/i);
    expect(() => html(simple.map((node, i) => i ? { ...node, edgeLabel: i === 1 ? <span /> : "Part of" } : node))).toThrow(/edge labels.*siblings/i);
  });

  it("uses MD1 figure and status slots through Item without demanding figures on unrelated nodes", () => {
    const nodes: TreeNodeData[] = simple.map((node, index) => index === 0 ? { ...node, figure: { value: "42", delta: "+6", trend: "up" }, status: { tone: "success", label: "Available" } } : index === 1 ? { ...node, badge: { label: "Review", tone: "info" }, meta: "Owner", eyebrow: "Team" } : node);
    const { container } = render(<Tree nodes={nodes} />);
    expect(container.querySelectorAll("[data-item]")).toHaveLength(3);
    expect(screen.getByText("42")).toHaveClass("text-h2", "font-display", "tabular-nums");
    expect(screen.getByText("+6")).toHaveClass("text-status-success-text");
    expect(screen.getByText("Available").closest("[data-item-meta]")).not.toBeNull();
    expect(screen.getByText("Review").closest("[data-item-meta]")).toHaveTextContent("TeamReviewOwner");
  });

  it("retains Item's figure and status guards", () => {
    for (const extra of [
      { figure: { value: "42", trend: "up" } },
      { status: { tone: "success", label: "" } },
      { status: { tone: "success", label: "Open" }, badge: { label: "Badge" } },
    ]) expect(() => html([{ ...simple[0]!, ...extra } as TreeNodeData, ...simple.slice(1)])).toThrow(TypeError);
  });

  it.each(["right", "down"] as const)("uses diagram classes only from tablet-lg, no role tree (%s)", orientation => {
    const { container } = render(<Tree nodes={branch(2)} orientation={orientation} />);
    expect(container.querySelector("[data-tree]")).toHaveAttribute("data-orientation", orientation);
    const strokes = [...container.querySelectorAll("[data-diagram-connector]")];
    for (const stroke of strokes) {
      expect(stroke).toHaveAttribute("aria-hidden", "true");
      expect(stroke).toHaveClass("hidden", "tablet-lg:block", "print:hidden", "tablet-lg:print:hidden");
      expect(stroke.parentElement?.tagName).not.toBe("UL");
    }
    const connectors = strokes.flatMap(node => [...node.classList].filter(value => value.includes("before:") || value.includes("after:")));
    expect(connectors.length).toBeGreaterThan(0);
    expect(connectors.every(value => value.startsWith("tablet-lg:"))).toBe(true);
    expect(container.querySelector('[role="tree"], [role="treeitem"], a, button, input, [tabindex]')).toBeNull();
    const children = container.querySelector("li > ul")!;
    expect(children).toHaveClass("border-s", "ps-lg");
    if (orientation === "right") expect(children).toHaveClass("tablet-lg:gap-x-2xl");
    expect((children as HTMLElement).style.borderInlineStartWidth).toBe(UI_BORDER_HAIRLINE);
    expect(children).toHaveClass("print:border-solid", "print:ps-lg");
  });

  it.each(["base", "sunken", "inverse"] as const)("selects existing ink, line and responsive plate tokens for %s", ground => {
    const { container } = render(<Tree nodes={simple} ground={ground} className="caller" />);
    expect(container.firstElementChild).toHaveClass("caller");
    const node = container.querySelector("[data-diagram-node]")!;
    expect(node).toHaveClass("tablet-lg:rounded-panel", "tablet-lg:p-lg", "print:rounded-none", "print:p-0");
    expect(node).toHaveClass(ground === "base" ? "tablet-lg:bg-surface-sunken" : ground === "sunken" ? "tablet-lg:bg-surface-raised" : "tablet-lg:bg-surface-inverse-raised");
    expect(screen.getByRole("heading", { level: 3 })).toHaveClass(ground === "inverse" ? "text-ink-on-inverse" : "text-ink-primary");
  });

  it("uses the supplied external label and generates no ids or English labels", () => {
    const { container } = render(<><h2 id="structure">Structure</h2><Tree nodes={simple} labelledBy="structure" /></>);
    expect(screen.getByRole("list", { name: "Structure" })).toHaveAttribute("data-tree");
    expect(container.querySelectorAll("[id]")).toHaveLength(1);
    expect(html(simple)).toBe(html(simple));
    expect(html(simple)).not.toContain("aria-label=");
  });

  it("throws on two roots, cycles, depth and child counts", () => {
    expect(() => html([simple[0]!, { ...simple[1]!, parent: undefined }, simple[2]!])).toThrow(/one root/i);
    const cycle = [
      ...simple,
      { id: "a", parent: "b", heading: "A" },
      { id: "b", parent: "a", heading: "B" },
      { id: "leaf-a", parent: "a", heading: "Leaf A" },
      { id: "leaf-b", parent: "b", heading: "Leaf B" },
    ];
    expect(() => html(cycle)).toThrow(/cycle/i);
    expect(() => html(branch(4))).toThrow(/depth/i);
    expect(() => html(branch(3), { orientation: "down" })).toThrow(/depth/i);
    expect(() => html([simple[0]!, simple[1]!, { id: "leaf", parent: "one", heading: "Leaf" }])).toThrow(/children/i);
    expect(() => html(fan(7))).toThrow(/children/i);
    expect(() => html([...simple, ...Array.from({ length: 5 }, (_, i) => ({ id: `leaf-${i}`, parent: "one", heading: "Leaf" }))])).toThrow(/children/i);
  });

  it("accepts exact depth, child-count and node-count bounds", () => {
    expect(() => html(branch(3))).not.toThrow();
    expect(() => html(branch(2), { orientation: "down" })).not.toThrow();
    expect(() => html(fan(6))).not.toThrow();
    const twelve = [...fan(3), ...[3, 3, 2].flatMap((count, index) => Array.from({ length: count }, (_, i) => ({ id: `leaf-${index}-${i}`, parent: `child-${index}`, heading: "Leaf" })))];
    expect(twelve).toHaveLength(12);
    expect(() => html(twelve)).not.toThrow();
  });

  it("enforces down level width and right leaf caps independently", () => {
    const wide = [...simple, ...["one", "two"].flatMap(parent => Array.from({ length: 4 }, (_, i) => ({ id: `${parent}-${i}`, parent, heading: "Leaf" })))];
    expect(() => html(wide)).not.toThrow();
    expect(() => html(wide, { orientation: "down" })).toThrow(/level.*six|level.*6/i);
    const leaves = [...fan(6), ...[3, 2].flatMap((count, index) => Array.from({ length: count }, (_, i) => ({ id: `leaf-${index}-${i}`, parent: `child-${index}`, heading: "Leaf" })))];
    expect(leaves).toHaveLength(12);
    expect(() => html(leaves)).toThrow(/leaves/i);
    expect(() => html(leaves, { orientation: "down" })).not.toThrow();
  });

  it("refuses bad node counts, missing parents, duplicate ids, sparse arrays and invalid axes", () => {
    for (const nodes of [simple.slice(0, 2), [...fan(6), ...fan(6)], [simple[0]!, simple[1]!, { ...simple[2]!, parent: "missing" }], [simple[0]!, simple[1]!, { ...simple[2]!, id: "one" }], [simple[0]!, , simple[2]!], simple.map(node => ({ ...node, parent: "one" }))]) expect(() => html(nodes as TreeNodeData[])).toThrow();
    expect(() => html(simple, { orientation: "up" } as unknown as TreeProps)).toThrow(/orientation/i);
    expect(() => html(simple, { ground: "raised" } as unknown as TreeProps)).toThrow(/ground/i);
    expect(() => html([{ ...simple[0]!, heading: " " }, ...simple.slice(1)])).toThrow(/heading/i);
  });

  it.each(["href", "visual", "icon", "featured"])("refuses unsupported Item field %s even outside TypeScript", field => {
    expect(() => html([{ ...simple[0]!, [field]: field === "featured" ? false : "Unsupported" }, ...simple.slice(1)])).toThrow(/unsupported|retired/i);
  });

  it.each([
    <button>Action</button>, <a href="/action">Action</a>, <input />, <audio controls />, <video controls />,
    <span tabIndex={0}>Focusable</span>, <span tabIndex={-1}>Focusable</span>, <span contentEditable suppressContentEditableWarning>Edit</span>,
    <span onClick={() => undefined}>Action</span>, <svg><use href="#mark" tabIndex={0} /></svg>,
  ])("refuses supplied focus targets in ReactNode slots", content => {
    for (const fields of [{ heading: content }, { description: content }, { eyebrow: content }, { meta: content }, { figure: { value: content } }, { figure: { value: "42", delta: content } }, { status: { tone: "info" as const, label: content } }, { badge: { label: content } }]) expect(() => html([{ ...simple[0]!, ...fields }, ...simple.slice(1)])).toThrow(/passive|focus|interactive/i);
    expect(() => html(simple.map((node, index) => index ? { ...node, edgeLabel: content } : node))).toThrow(/passive|focus|interactive/i);
  });

  it("allows passive SVG references and native inline markup", () => {
    const passive = <><strong>Research</strong><svg aria-hidden="true"><use href="#mark" /></svg></>;
    render(<Tree nodes={[simple[0]!, { ...simple[1]!, heading: passive }, simple[2]!]} />);
    expect(screen.getByRole("heading", { level: 4, name: "Research" })).toBeInTheDocument();
    expect(within(screen.getByRole("heading", { level: 3 })).queryByRole("link")).toBeNull();
  });
});
