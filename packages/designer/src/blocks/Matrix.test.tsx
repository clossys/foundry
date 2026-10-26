import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Matrix, type MatrixProps, type MatrixSide } from "./Matrix.js";

const SIDES: readonly [MatrixSide, MatrixSide] = [
  { id: "first", label: "First option", heading: "A shared record", points: ["One source", "Clear dates"] },
  { id: "second", label: "Second option", heading: "A shared view", points: ["One view", "Clear owners"] },
];
const markup = (props: Partial<MatrixProps> = {}) => renderToStaticMarkup(<Matrix sides={SIDES} {...props} />);

describe("Matrix", () => {
  it("renders both sides on the same plate with primary ink and authored order", () => {
    const { container } = render(<Matrix sides={SIDES} />);
    const sides = container.querySelectorAll("[data-matrix-side]");
    expect([...sides].map(side => side.getAttribute("data-matrix-side"))).toEqual(["first", "second"]);
    for (const side of sides) {
      const plate = side.firstElementChild as HTMLElement;
      expect(plate).toHaveAttribute("data-variant", "plate");
      expect(plate).toHaveClass("bg-surface-sunken", "rounded-panel");
      expect(within(side as HTMLElement).getAllByRole("listitem")[0]).toHaveClass("text-ink-primary");
    }
    expect(screen.getByRole("heading", { name: "A shared record" }).tagName).toBe("H3");
    expect(screen.getByText("A shared record")).toHaveClass("text-h2", "text-ink-primary");
  });

  it("uses the required heading when labels are omitted, without adding empty or duplicate headings", () => {
    const sides: MatrixProps["sides"] = [
      { id: "first", heading: "A shared record", description: "Supporting lead.", points: ["One source", "Clear dates"] },
      { id: "second", heading: "A shared view", points: ["One view", "Clear owners"] },
    ];
    const { container } = render(<Matrix sides={sides} headingLevel={4} featured="second" />);
    expect(screen.getAllByRole("heading", { level: 4 }).map(node => node.textContent)).toEqual(["A shared record", "A shared view"]);
    for (const side of container.querySelectorAll<HTMLElement>("[data-matrix-side]")) {
      expect(within(side).getAllByRole("heading")).toHaveLength(1);
      expect(within(side).getByRole("heading", { level: 4 })).toHaveClass("text-h2", "text-ink-primary");
      expect(side.querySelectorAll("li")).toHaveLength(2);
    }
    expect(screen.getByText("Supporting lead.")).toHaveAttribute("data-matrix-description");
    expect(container.querySelector('[data-matrix-side="second"] > [data-featured="true"]')).not.toBeNull();
  });

  it.each(["points", "visual"] as const)("refuses mixed label presence on either %s side", form => {
    const sides: MatrixProps["sides"] = form === "points" ? SIDES : [
      { id: "first", label: "First option", heading: "A shared record", visual: <svg aria-label="First sample" /> },
      { id: "second", label: "Second option", heading: "A shared view", visual: <svg aria-label="Second sample" /> },
    ];
    for (const unlabeledSide of [0, 1]) {
      const mixed = sides.map((side, index) => index === unlabeledSide ? { ...side, label: undefined } : side) as unknown as MatrixProps["sides"];
      expect(() => markup({ sides: mixed })).toThrow(/both sides.*labels.*neither/);
    }
    expect(() => markup({ sides })).not.toThrow();
    const unlabeled = sides.map(side => ({ ...side, label: undefined })) as unknown as MatrixProps["sides"];
    expect(() => markup({ sides: unlabeled })).not.toThrow();
  });

  it("keeps supplied labels as captions and actual headings on both sides", () => {
    const { container } = render(<Matrix sides={SIDES} />);
    expect(screen.getAllByRole("heading", { level: 3 }).map(node => node.textContent)).toEqual(["A shared record", "A shared view"]);
    expect(screen.getByText("A shared record").tagName).toBe("H3");
    expect(container.querySelectorAll("h3")).toHaveLength(2);
    for (const side of SIDES) {
      const caption = screen.getByText(String(side.label));
      expect(caption.tagName).toBe("P");
      expect(caption).toHaveClass("text-body-s", "text-ink-secondary");
      const shell = container.querySelector(`[data-matrix-side="${side.id}"]`) as HTMLElement;
      expect(within(shell).getAllByRole("heading")).toHaveLength(1);
    }
  });

  it.each(["first", "second"])("features only the selected %s plate without reordering sides", featured => {
    const { container } = render(<Matrix sides={SIDES} featured={featured} />);
    const plates = container.querySelectorAll("[data-matrix-side] > [data-variant=plate]");
    expect([...plates].filter(plate => plate.getAttribute("data-featured") === "true")).toHaveLength(1);
    const plate = container.querySelector(`[data-matrix-side="${featured}"] > div`) as HTMLElement;
    expect(plate).toHaveAttribute("data-featured", "true");
    expect(plate).toHaveClass("border-t", "border-t-accent");
    expect(plate.style.borderBlockStartWidth).toBe("var(--ui-border-hairline, 1px)");
    expect([...container.querySelectorAll("[data-matrix-side]")].map(side => side.getAttribute("data-matrix-side"))).toEqual(["first", "second"]);
  });

  it("leaves both plates unfeatured when omitted", () => {
    const { container } = render(<Matrix sides={SIDES} />);
    expect(container.querySelector("[data-featured]")).toBeNull();
    for (const item of screen.getAllByRole("listitem")) expect(item.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("shares the two point-form rows across each shell and its plate", () => {
    const { container } = render(<Matrix sides={SIDES} />);
    expect(container.querySelector("[data-matrix]")).not.toHaveClass("items-start");
    for (const shell of container.querySelectorAll("[data-matrix-side]")) {
      expect(shell).toHaveClass("tablet:row-span-2", "tablet:grid", "tablet:grid-rows-subgrid");
      expect(shell.firstElementChild).toHaveClass("tablet:row-span-2", "tablet:grid", "tablet:grid-rows-subgrid");
    }
  });
  it("shares rows from tablet and keeps point order with optional descriptions", () => {
    const { container } = render(<Matrix sides={SIDES.map(side => ({ ...side, description: "Parallel supporting copy." })) as unknown as MatrixProps["sides"]} />);
    expect(container.querySelector("[data-matrix]")).toHaveClass("grid-cols-1", "tablet:grid-cols-2");
    expect(container.querySelector("[data-matrix]")).toHaveAttribute("data-matrix-rows", "3");
    for (const plate of container.querySelectorAll("[data-variant=plate]")) expect(plate).toHaveClass("tablet:row-span-3", "tablet:grid-rows-subgrid");
    expect(within(container.querySelector('[data-matrix-side="first"]') as HTMLElement).getAllByRole("listitem").map(item => item.textContent)).toEqual(["One source", "Clear dates"]);
  });

  it("uses tablet-lg for visual sides and aligns shared visual rows", () => {
    const sides = SIDES.map(side => ({ ...side, points: undefined, description: "Supporting copy.", visual: <div>Sample view</div> })) as unknown as MatrixProps["sides"];
    const { container } = render(<Matrix sides={sides} />);
    const root = container.querySelector("[data-matrix]") as HTMLElement;
    expect(root).toHaveClass("tablet-lg:grid-cols-2");
    expect(root.className).not.toMatch(/(^|\s)tablet:grid-cols-2/);
    for (const plate of container.querySelectorAll("[data-variant=plate]")) {
      expect(plate).toHaveClass("tablet-lg:row-span-3", "tablet-lg:grid-rows-subgrid");
      expect(plate.lastElementChild).toHaveAttribute("data-matrix-visual");
      expect(plate.lastElementChild).toHaveClass("w-full", "min-w-0", "pt-md");
      expect(plate.lastElementChild).not.toHaveClass("mt-auto");
    }
  });

  it("reserves the shared description row when only one points side has description", () => {
    const { container } = render(<Matrix sides={[{ ...SIDES[0], description: "Supporting copy" }, SIDES[1]]} />);
    const plates = container.querySelectorAll("[data-variant=plate]");
    expect(plates[0]!.children[1]).toHaveAttribute("data-matrix-description");
    expect(plates[1]!.children[1]).toHaveAttribute("data-matrix-empty-row", "description");
    expect(plates[1]!.children[1]).toHaveAttribute("aria-hidden", "true");
    expect(plates[1]!.children[1]).toHaveClass("hidden", "tablet:block");
    for (const plate of plates) expect(plate.children[2]?.tagName).toBe("UL");
  });

  it("preserves visible numeric zero in required slots and points", () => {
    render(<Matrix sides={[{ ...SIDES[0], label: 0, heading: 0, points: [0, "Second"] }, SIDES[1]]} />);
    expect(screen.getAllByText("0", { exact: true })).toHaveLength(3);
  });

  it("reserves the visual description slot at the wider breakpoint", () => {
    const { container } = render(<Matrix sides={[
      { ...SIDES[0], points: undefined, description: "Supporting copy", visual: <svg aria-label="First sample" /> },
      { ...SIDES[1], points: undefined, visual: <svg aria-label="Second sample" /> },
    ]} />);
    for (const shell of container.querySelectorAll("[data-matrix-side]")) {
      expect(shell).toHaveClass("tablet-lg:row-span-3", "tablet-lg:grid-rows-subgrid");
      const plate = shell.firstElementChild as HTMLElement;
      expect(plate).toHaveClass("tablet-lg:row-span-3", "tablet-lg:grid-rows-subgrid");
      expect(plate.children[2]).toHaveAttribute("data-matrix-visual");
    }
    expect(container.querySelector('[data-matrix-empty-row="description"]')).toHaveClass("hidden", "tablet-lg:block");
  });

  it.each(["base", "sunken", "inverse"] as const)("uses the %s ground's plate and featured accent tokens", ground => {
    const { container } = render(<Matrix sides={SIDES} ground={ground} featured="second" headingLevel={4} id="options" aria-label="Options" style={{ inlineSize: "100%" }} />);
    const fill = ground === "base" ? "bg-surface-sunken" : ground === "sunken" ? "bg-surface-raised" : "bg-surface-inverse-raised";
    for (const plate of container.querySelectorAll("[data-variant=plate]")) expect(plate).toHaveClass(fill);
    expect(container.querySelector('[data-featured="true"]')).toHaveClass(ground === "inverse" ? "border-t-accent-on-inverse" : "border-t-accent");
    expect(screen.getByRole("heading", { name: "A shared record" }).tagName).toBe("H4");
    expect(screen.getByLabelText("Options")).toHaveAttribute("id", "options");
    expect(screen.getByLabelText("Options")).toHaveStyle({ inlineSize: "100%" });
  });

  it.each([[], [SIDES[0]], [...SIDES, { ...SIDES[0], id: "third" }], Array(2)].map(sides => ({ sides })))("refuses side count or sparse array %j", ({ sides }) => {
    expect(() => markup({ sides: sides as unknown as MatrixProps["sides"] })).toThrow(/exactly two|dense/);
  });
  it.each(["", " ", "two words", "first"])("refuses blank, whitespace or duplicate side id %j", id => {
    expect(() => markup({ sides: [SIDES[0], { ...SIDES[1], id }] })).toThrow(/id/);
  });
  it("refuses an unknown featured id", () => expect(() => markup({ featured: "missing" })).toThrow(/featured/));
  it("refuses unequal point counts", () => expect(() => markup({ sides: [SIDES[0], { ...SIDES[1], points: ["One", "Two", "Three"] }] })).toThrow(/equal point/));
  it.each([[], ["One"], ["One", "Two", "Three", "Four", "Five"], Array(2)].map(points => ({ points })))("refuses unsupported point arrays %j", ({ points }) => {
    expect(() => markup({ sides: [{ ...SIDES[0], points }, { ...SIDES[1], points }] })).toThrow(/points|dense/);
  });
  it("refuses points alongside a visual or mixed primary forms", () => {
    expect(() => markup({ sides: [{ ...SIDES[0], visual: <div /> }, SIDES[1]] })).toThrow(/points.*visual/);
    expect(() => markup({ sides: [SIDES[0], { ...SIDES[1], points: undefined, visual: <div>Other form</div> }] })).toThrow(/same.*form/);
  });
  it.each(["label", "heading"] as const)("refuses nonempty-slot violations in supplied %s", field => {
    expect(() => markup({ sides: [{ ...SIDES[0], [field]: " " }, SIDES[1]] })).toThrow(/label|heading/);
    expect(() => markup({ sides: [{ ...SIDES[0], points: undefined }, { ...SIDES[1], points: undefined }] })).toThrow(/description|points|visual/);
  });
  it("refuses malformed sides and unsupported axes cleanly", () => {
    expect(() => markup({ sides: [null, SIDES[1]] as unknown as MatrixProps["sides"] })).toThrow(/side/);
    expect(() => markup({ ground: "other" as MatrixProps["ground"] })).toThrow(/ground/);
    expect(() => markup({ headingLevel: 1 as MatrixProps["headingLevel"] })).toThrow(/heading/);
  });
  it.each([undefined, "A complete paragraph.", <p key="lead">A complete paragraph.</p>].map(description => ({ description })))("requires points or a visual even with a description lead %j", ({ description }) => {
    expect(() => markup({ sides: SIDES.map(side => ({ ...side, points: undefined, description })) as unknown as MatrixProps["sides"] })).toThrow(/needs points or visual/);
  });

  it.each(["", " ", true, [], <span key="empty" />, <></>].map(description => ({ description })))("refuses empty description-only bodies %j", ({ description }) => {
    expect(() => markup({ sides: SIDES.map(side => ({ ...side, points: undefined, description })) as unknown as MatrixProps["sides"] })).toThrow(/description|points|visual/);
  });
  it.each([true, [], <span key="empty" />].map(visual => ({ visual })))("refuses empty visual-only bodies %j", ({ visual }) => {
    expect(() => markup({ sides: SIDES.map(side => ({ ...side, points: undefined, visual })) as unknown as MatrixProps["sides"] })).toThrow(/visual|description/);
  });
  it.each(["constructor", "toString", "__proto__", null, 1, true, Symbol("base"), ["base"], new String("base"), { [Symbol.toPrimitive]() { throw new Error("coercion must not run"); } }].map(ground => ({ ground })))("refuses malformed ground without coercing %j", ({ ground }) => {
    expect(() => markup({ ground: ground as MatrixProps["ground"] })).toThrow("Matrix: unknown ground.");
  });

  it("renders text-free visuals as a valid body form", () => {
    const visual: ReactNode = <svg aria-label="Sample diagram" />;
    expect(() => markup({ sides: SIDES.map(side => ({ ...side, points: undefined, visual })) as unknown as MatrixProps["sides"] })).not.toThrow();
  });
  it.each([2, 3, 4, 5, 6] as const)("retains the supplied h%s primary headings", headingLevel => {
    render(<Matrix sides={SIDES} headingLevel={headingLevel} />);
    for (const side of SIDES) expect(screen.getByRole("heading", { name: String(side.heading) }).tagName).toBe(`H${headingLevel}`);
  });
  it("retains description leads beside visual bodies in authored order without manufacturing points", () => {
    const sides: MatrixProps["sides"] = [
      { ...SIDES[0], points: undefined, description: "Work moves between inboxes.", visual: <svg role="img" aria-label="Inbox handoff diagram"><path d="M4 4h6v6H4zM14 14h6v6h-6zM10 7h7v7" /></svg> },
      { ...SIDES[1], points: undefined, description: "Work stays in one record.", visual: <svg role="img" aria-label="Shared record diagram"><path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h6" /></svg> },
    ];
    const { container } = render(<Matrix sides={sides} />);
    expect(screen.queryByRole("list")).toBeNull();
    expect([...container.querySelectorAll("[data-matrix-description]")].map(node => node.textContent)).toEqual(sides.map(side => side.description));
  });
  it.each(["base", "sunken", "inverse"] as const)("keeps both %s plates in primary body ink", ground => {
    const { container } = render(<Matrix sides={SIDES} featured="second" ground={ground} />);
    for (const side of container.querySelectorAll("[data-matrix-side]")) {
      expect(side.firstElementChild).toHaveAttribute("data-variant", "plate");
      for (const point of side.querySelectorAll("li")) {
        expect(point).toHaveClass(ground === "inverse" ? "text-ink-on-inverse" : "text-ink-primary");
        expect(point.firstElementChild).toHaveAttribute("aria-hidden", "true");
      }
    }
    expect(container.querySelector("[data-comparison-arrow]")).toBeNull();
  });
});

it("S4-6 preserves the sides root and host identity without an overall title or band", () => {
  let clicks = 0;
  const { container } = render(<Matrix sides={SIDES} id="matrix" dir="rtl" data-host="yes" className="gap-xl" style={{ marginTop: 7 }} onClick={() => clicks++} />);
  const root = container.firstElementChild as HTMLElement;
  expect(root.tagName).toBe("DIV");
  expect(root).toHaveAttribute("id", "matrix");
  expect(root).toHaveAttribute("dir", "rtl");
  expect(root).toHaveAttribute("data-host", "yes");
  expect(root).toHaveClass("gap-xl");
  expect(root.style.marginTop).toBe("7px");
  expect(root.querySelectorAll("h1,h2,h3,h4,h5,h6")).toHaveLength(2);
  expect(root.querySelectorAll("[data-designer-section-frame]")).toHaveLength(0);
  expect(root.querySelectorAll("#matrix")).toHaveLength(0);
  root.click(); expect(clicks).toBe(1);
});
