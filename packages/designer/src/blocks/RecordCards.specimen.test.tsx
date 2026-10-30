import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecordCards } from "./RecordCards.js";
import sectionSlots from "../catalog/slots/sections.json" with { type: "json" };

describe("RecordCards specimen content ports", () => {
  it("keeps interactive specimen bodies out of prose and packs their declared spans", () => {
    const { container } = render(<RecordCards selectedId="page" records={[
      { id: "page", title: "Published page", span: "full", body: <button type="button">Tablet preview</button> },
      { id: "type", title: "Type scale", span: "half", body: <section aria-label="Type specimen">Scale</section> },
      { id: "color", title: "Color", span: "third", body: <section aria-label="Color specimen">Swatch</section> },
    ]} />);
    const page = container.querySelector('[data-record-id="page"]');
    expect(page).toHaveAttribute("data-selected", "true");
    expect(page).toHaveClass("tablet:col-span-12");
    expect(container.querySelector('[data-record-id="type"]')).toHaveClass("tablet:col-span-6");
    expect(container.querySelector('[data-record-id="color"]')).toHaveClass("tablet:col-span-4");
    const control = screen.getByRole("button", { name: "Tablet preview" });
    expect(control.closest("p")).toBeNull();
    expect(control.closest('[data-ds-leaf="sections.cards"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-selected="true"]')).toHaveLength(1);
  });

  it("retains legacy responsive cards when no specimen declares a span", () => {
    const { container } = render(<RecordCards records={[{ id: "a", title: "Alpha" }]} />);
    expect(container.querySelector('[data-record-id="a"]')).toHaveClass("tablet:col-span-6", "desktop:col-span-4");
    expect(container.querySelector('[data-selected]')).toBeNull();
  });

  it("declares the selected card's accent ground read and moves that treatment with selection", () => {
    const records = [{ id: "a", title: "Alpha" }, { id: "b", title: "Beta" }];
    const { container, rerender } = render(<RecordCards selectedId="a" records={records} />);
    const alpha = () => container.querySelector('[data-record-id="a"] [data-variant="outline"]');
    const beta = () => container.querySelector('[data-record-id="b"] [data-variant="outline"]');
    expect(alpha()).toHaveClass("border-accent");
    expect(beta()).not.toHaveClass("border-accent");
    expect(sectionSlots.find(slot => slot.id === "sections.cards")!.contract.allowedReads.tokens).toContain("tokens.accent-color");
    rerender(<RecordCards selectedId="b" records={records} />);
    expect(alpha()).not.toHaveClass("border-accent");
    expect(beta()).toHaveClass("border-accent");
  });
});
