import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { LedgerTile } from "./LedgerTile.js";
import type { LedgerRowData } from "./RecordLedger.js";
const rows: LedgerRowData[] = Array.from({ length: 5 }, (_, i) => ({ id: String(i), label: `Row ${i}`, detail: "Detail", status: { tone: "neutral", label: "Received" } }));

describe("LedgerTile", () => {
  it("hides capped rows only below tablet, and leaves every row uncapped otherwise", () => {
    const { container } = render(<LedgerTile caption="Record" rows={rows} mobileRows={3} />);
    const items = Array.from(container.querySelectorAll("li"));
    expect(items).toHaveLength(5);
    for (const [index, item] of items.entries()) {
      if (index >= 3) expect(item).toHaveClass("max-tablet:hidden");
      else expect(item).not.toHaveClass("max-tablet:hidden");
      expect(item).not.toHaveClass("hidden");
    }
    const uncapped = render(<LedgerTile caption="Record" rows={rows} />);
    expect(uncapped.container.querySelectorAll(".hidden")).toHaveLength(0);
    for (const item of uncapped.container.querySelectorAll("li")) expect(item).not.toHaveClass("max-tablet:hidden");
    expect(container.querySelector("figure")).toHaveClass("m-0");
    expect(container.querySelector("ul")).toHaveClass("m-0", "p-0", "list-none");
  });
  it("enforces two-to-five rows, the closed cap and caller-labelled single flag", () => {
    for (const count of [0, 1, 6]) expect(() => render(<LedgerTile caption="Record" rows={Array.from({ length: count }, (_, i) => ({ id: String(i), label: "Row" }))} />)).toThrow(RangeError);
    expect(() => render(<LedgerTile caption="Record" rows={rows} mobileRows={2 as 3} />)).toThrow(RangeError);
    expect(() => render(<LedgerTile caption="Record" rows={[{ ...rows[0]!, flag: true }, rows[1]!]} />)).toThrow(TypeError);
    const { container } = render(<LedgerTile caption="Record" rows={[{ ...rows[0]!, flag: true }, rows[1]!]} flagLabel="Attention:" />);
    expect(container.querySelector("[data-flag] .sr-only")).toHaveTextContent("Attention:");
    expect(() => render(<LedgerTile caption="Record" rows={[{ ...rows[0]!, flag: true }, { ...rows[1]!, flag: true }]} flagLabel="Attention:" />)).toThrow(TypeError);
  });
  it("inspects its own opaque caption, label, detail and status nodes for nested controls", () => {
    const button = <button>Control</button>;
    expect(() => render(<LedgerTile caption={button} rows={rows} />)).toThrow(TypeError);
    for (const key of ["label", "detail"] as const) expect(() => render(<LedgerTile caption="Record" rows={[{ ...rows[0]!, [key]: button }, rows[1]!]} />)).toThrow(TypeError);
    expect(() => render(<LedgerTile caption="Record" rows={[{ ...rows[0]!, status: { tone: "info", label: button } }, rows[1]!]} />)).toThrow(TypeError);
  });
});


it("applies the narrow inverse status label policy inside a tile plate", () => {
  const { container } = render(<LedgerTile ground="inverse" caption="Record" rows={rows} />);
  for (const status of container.querySelectorAll("[data-tone]")) expect(status).toHaveStyle({ color: "var(--color-ink-on-inverse, oklch(0.9702 0 0))" });
});

it("requires a visible tile caption and retains visible zero and opaque components", () => {
  const blanks: ReactNode[] = [null, undefined, false, true, "", "  \n ", [], [null, false, [" ", []]]];
  for (const caption of blanks) expect(() => render(<LedgerTile caption={caption} rows={rows} />)).toThrow(TypeError);
  const Authored = () => <span>Authored</span>;
  for (const caption of [0, [null, [0]], <Authored />]) expect(() => render(<LedgerTile caption={caption} rows={rows} />)).not.toThrow();
});
