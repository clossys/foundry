import { render } from "@testing-library/react";
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
