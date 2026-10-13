import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { SpecimenPanel } from "./SpecimenPanel.js";
import type { SpecimenStatusRowsPart } from "./parts.js";
import { Item } from "../items/Item.js";

const part: SpecimenStatusRowsPart = { id: "checks", type: "status-rows", label: "Record", items: Array.from({ length: 5 }, (_, i) => ({ id: String(i), label: `Row ${i}`, detail: "Detail", status: { tone: "neutral", label: "Received" } })) };
describe("status-row successors to retired tile assertions", () => {
  it("retains all five authored rows and caps only later mobile rows", () => {
    const { container, rerender } = render(<SpecimenPanel parts={[{ ...part, mobileRows: 3 }]} />);
    const rows = [...container.querySelectorAll("li")]; expect(rows).toHaveLength(5);
    rows.forEach((row, index) => {
      expect(row).toHaveTextContent(`Row ${index}`); expect(row).toHaveTextContent("Detail"); expect(row).toHaveTextContent("Received");
      if (index >= 3) expect(row).toHaveClass("max-tablet:hidden"); else expect(row).not.toHaveClass("max-tablet:hidden");
      expect(row).not.toHaveClass("hidden");
    });
    rerender(<SpecimenPanel parts={[part]} />);
    for (const row of container.querySelectorAll("li")) expect(row).not.toHaveClass("max-tablet:hidden");
  });
  it.each(["part", "label", "detail", "status"] as const)("inspects its own %s slot directly and inside an opaque linked visual", slot => {
    const control = <span>Read <a href="/nested">more</a></span>;
    const unsafe: SpecimenStatusRowsPart = slot === "part" ? { ...part, label: control } : { ...part, items: part.items.map((row, index) => index !== 0 ? row : slot === "status" ? { ...row, status: { ...row.status, label: control } } : { ...row, [slot]: control }) };
    expect(() => render(<SpecimenPanel parts={[unsafe]} />)).toThrow(TypeError);
    expect(() => render(<Item id="one" heading="Title" href="/one" visual={<SpecimenPanel parts={[unsafe]} />} treatment="plain" size="standard" ground="base" />)).toThrow(TypeError);
  });
  it("retains authored inert emphasis and builds no native controls", () => {
    const inert = { ...part, label: <strong>Record</strong>, items: part.items.map(row => ({ ...row, label: <strong>{row.label}</strong> })) };
    const { container } = render(<SpecimenPanel parts={[inert]} />);
    expect(container.querySelectorAll("strong")).toHaveLength(6);
    expect(container.querySelector("a,button,input,select,textarea,[tabindex]")).toBeNull();
  });
});

const sprite = <svg aria-hidden="true"><use href="#mark" /><image href="/mark.svg" /></svg>;
function inSlot(slot: "part" | "label" | "detail" | "status", node: ReactNode): SpecimenStatusRowsPart {
  const content = <>Supporting copy{node}</>;
  return slot === "part" ? { ...part, label: content } : {
    ...part, items: part.items.map((row, index) => index !== 0 ? row : slot === "status"
      ? { ...row, status: { ...row.status, label: content } }
      : { ...row, [slot]: content }),
  };
}
function mount(part: SpecimenStatusRowsPart, linked: boolean) {
  const panel = <SpecimenPanel parts={[part]} />;
  return linked ? <Item id="one" heading="Title" href="/one" visual={panel} treatment="plain" size="standard" ground="base" /> : panel;
}

describe("status-row SVG resources", () => {
  it.each(["part", "label", "detail", "status"].flatMap(slot => [false, true].map(linked => ({ slot: slot as "part" | "label" | "detail" | "status", linked }))))("retains passive use/image and copy in $slot (linked=$linked)", ({ slot, linked }) => {
    const { container } = render(mount(inSlot(slot, sprite), linked));
    expect(screen.getByText("Supporting copy")).toBeInTheDocument();
    expect(container.querySelectorAll("li")).toHaveLength(5);
    expect(container.querySelectorAll('use[href="#mark"]')).toHaveLength(1);
    expect(container.querySelectorAll('image[href="/mark.svg"]')).toHaveLength(1);
    expect(container.querySelector("button,input,select,textarea,[tabindex],[contenteditable]")).toBeNull();
    if (linked) {
      const link = screen.getByRole("link", { name: "Title" });
      expect(link).toHaveAttribute("href", "/one");
      expect(link).toHaveAttribute("data-card-link");
      expect(link).not.toHaveTextContent("Supporting copy");
      expect(container.querySelectorAll("a")).toHaveLength(1);
    } else expect(container.querySelector("a")).toBeNull();
    expect(screen.getAllByText("Received")).toHaveLength(slot === "status" ? 4 : 5);
  });

  it("accepts SVG re-entry inside foreignObject in an actual status row", () => {
    const graphic = <svg><foreignObject><svg><use href="#mark" /><image href="/mark.svg" /></svg></foreignObject></svg>;
    const { container } = render(mount(inSlot("detail", graphic), false));
    expect(container.querySelectorAll('use[href="#mark"],image[href="/mark.svg"]')).toHaveLength(2);
    expect(container.querySelector("a,button,[tabindex]")).toBeNull();
  });

  it("refuses opaque href components without inspecting their rendered status-row output", () => {
    let calls = 0;
    const SpriteIcon = (_props: { href: string }) => { calls++; return sprite; };
    const graphic = <SpriteIcon href="#mark" />;
    for (const linked of [false, true]) expect(() => renderToStaticMarkup(mount(inSlot("detail", graphic), linked))).toThrow(TypeError);
    expect(calls).toBe(0);
  });

  it.each([
    { name: "resource click", node: <svg><use href="#mark" onClick={() => undefined} /></svg> },
    { name: "resource press", node: <svg><image href="/mark.svg" {...{ onPress: () => undefined }} /></svg> },
    { name: "resource focus", node: <svg><use href="#mark" tabIndex={-1} /></svg> },
    { name: "resource editing", node: <svg><image href="/mark.svg" contentEditable /></svg> },
    { name: "resource descendant", node: <svg><use href="#mark"><button>Details</button></use></svg> },
    { name: "SVG link", node: <svg><a href="/nested">More</a></svg> },
    { name: "foreignObject control", node: <svg><foreignObject><button>Details</button></foreignObject></svg> },
    { name: "foreignObject HTML reference", node: <svg><foreignObject><use href="#mark" /></foreignObject></svg> },
  ])("refuses $name in direct and linked status-row mounts", ({ node }) => {
    for (const linked of [false, true]) expect(() => renderToStaticMarkup(mount(inSlot("detail", node), linked))).toThrow(TypeError);
  });
});
