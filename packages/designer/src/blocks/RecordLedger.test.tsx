import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecordLedger, type LedgerGroupData } from "./RecordLedger.js";

const groups: LedgerGroupData[] = [
  { id: "checks", label: "Checks", rows: [{ id: "one", label: "Review", detail: "Due tomorrow", status: { tone: "warning", label: "Open" } }] },
  { id: "owner", label: "Owner", owner: { initials: "AB", name: "Reviewer", note: "Assigned" }, note: "Next check tomorrow." },
];
const retiredPairs = Array.from({ length: 3 }, (_, i) => ({ id: String(i), role: { eyebrow: "Function", heading: `Role ${i}`, description: "Checks the record." }, product: { kind: "Authored kind line", subject: `Record ${i}`, detail: "Ready for review", status: { tone: "info", label: "Received" } } }));

describe("RecordLedger", () => {
  it("names a real figure and labelled sections, with readable status and self-contained resets", () => {
    const { container } = render(<RecordLedger id="record" form="record" head={{ title: "Record title", meta: "Record metadata", status: { tone: "warning", label: "Open" } }} groups={groups} caption="Sample data." />);
    expect(screen.getByRole("figure", { name: "Record title" })).toHaveAttribute("aria-labelledby", "6:record:head");
    expect(screen.getByRole("region", { name: "Checks" })).toHaveAttribute("aria-labelledby", "6:record:group:6:checks");
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(container.querySelectorAll('[data-part="mark"][aria-hidden="true"]')).toHaveLength(2);
    expect(container.querySelector("figure")).toHaveClass("m-0");
    expect(container.querySelector("ul")).toHaveClass("m-0", "p-0", "list-none");
    for (const node of container.querySelectorAll("p,h3")) expect(node).toHaveClass("m-0");
    expect(screen.getByText("AB")).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps repeated identical content references distinct through caller instance ids", () => {
    const { container } = render(<><RecordLedger id="first" form="record" head={{ title: "Same title" }} groups={groups} caption="Sample data." /><RecordLedger id="second" form="record" head={{ title: "Same title" }} groups={groups} caption="Sample data." /></>);
    const ids = Array.from(container.querySelectorAll("[id]")).map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const region of container.querySelectorAll("[aria-labelledby]")) expect(container.querySelector(`[id="${region.getAttribute("aria-labelledby")}"]`)).not.toBeNull();
  });

  it("prevents root/head and cross-instance group suffix collisions", () => {
    for (const instances of [
      [{ id: "a", groupId: "b-group-c" }, { id: "a-group-b", groupId: "c" }],
      [{ id: "a", groupId: "b" }, { id: "a-head", groupId: "c" }],
    ]) {
      const { container, unmount } = render(<>{instances.map(({ id, groupId }, index) => <RecordLedger key={id} id={id} form="record" head={{ title: `Record ${index}` }} groups={[{ id: groupId, label: `Group ${index}`, rows: [{ id: "row", label: "Check" }] }]} caption="Sample data." />)}</>);
      const ids = [...container.querySelectorAll("[id]")].map(node => node.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const node of container.querySelectorAll("[aria-labelledby]")) {
        const reference = node.getAttribute("aria-labelledby");
        const targets = container.querySelectorAll(`[id="${reference}"]`);
        expect(targets).toHaveLength(1);
        expect(node).toHaveAccessibleName(targets[0]!.textContent!);
      }
      unmount();
    }
  });

  it("accepts one caller-labelled flag and rejects missing lead-ins and multiple flags across groups", () => {
    const flagged: LedgerGroupData = { id: "flags", label: "Flags", rows: [{ id: "f", label: "Review", flag: true }] };
    const { container } = render(<RecordLedger id="flag" form="record" head={{ title: "Record" }} groups={[flagged]} caption="Sample data." flagLabel="Attention:" />);
    expect(container.querySelector("[data-flag] .sr-only")).toHaveTextContent("Attention:");
    expect(() => render(<RecordLedger id="missing" form="record" head={{ title: "Record" }} groups={[flagged]} caption="Sample data." />)).toThrow(TypeError);
    expect(() => render(<RecordLedger id="double" form="record" head={{ title: "Record" }} groups={[flagged, { ...flagged, id: "other" }]} caption="Sample data." flagLabel="Attention:" />)).toThrow(TypeError);
  });

  it("enforces group budgets, column mapping and owner-last exclusive structure", () => {
    const record = (data: LedgerGroupData[], columns?: 1 | 2 | 3) => render(<RecordLedger id="budget" form="record" head={{ title: "Record" }} groups={data} columns={columns} caption="Sample data." />);
    expect(() => record([])).toThrow(RangeError);
    expect(() => record([groups[0]!, groups[0]!, groups[0]!, groups[0]!])).toThrow(RangeError);
    expect(() => record([groups[0]!], 2)).toThrow(RangeError);
    expect(() => record([{ ...groups[0]!, rows: [] }])).toThrow(RangeError);
    expect(() => record([{ ...groups[0]!, rows: Array.from({ length: 7 }, (_, i) => ({ id: String(i), label: "Row" })) }])).toThrow(RangeError);
    expect(() => record([groups[1]!, groups[0]!])).toThrow(TypeError);
    expect(() => record([{ ...groups[1]!, rows: groups[0]!.rows }])).toThrow(TypeError);
    expect(() => record([{ id: "empty", label: "Empty" }])).toThrow(TypeError);
    expect(() => record([{ ...groups[0]!, note: "Owner note" }])).toThrow(TypeError);
  });

  it("keeps status rows meaningful and validates stable unique identifiers", () => {
    expect(() => render(<RecordLedger id="mixed" form="record" head={{ title: "Record" }} groups={[{ ...groups[0]!, rows: [...groups[0]!.rows!, { id: "bare", label: "Missing data" }] }]} caption="Sample data." />)).toThrow(TypeError);
    expect(() => render(<RecordLedger id="" form="record" head={{ title: "Record" }} groups={groups} caption="Sample data." />)).toThrow(TypeError);
    expect(() => render(<RecordLedger id="duplicate" form="record" head={{ title: "Record" }} groups={[groups[0]!, groups[0]!]} caption="Sample data." />)).toThrow(TypeError);
  });

  it("refuses retired pair mode even when record fields are also supplied", () => {
    const stalePairProps = { form: "pairs", items: retiredPairs, productLabel: "Creates:", caption: "Sample data." };
    const staleMixedProps = { ...stalePairProps, id: "stale", head: { title: "Record title" }, groups };
    for (const props of [stalePairProps, staleMixedProps]) {
      expect(() => render(<RecordLedger {...props as unknown as Parameters<typeof RecordLedger>[0]} />)).toThrow(TypeError);
    }
  });
});


it("keeps a middle flag on the logical start edge and retains the row hairline color", () => {
  const { container } = render(<RecordLedger id="middle" form="record" ground="sunken" head={{ title: "Record" }} groups={[{ id: "rows", label: "Rows", rows: [{ id: "first", label: "First" }, { id: "flag", label: "Review", flag: true }] }]} caption="Sample data." flagLabel="Attention:" />);
  const row = container.querySelector("[data-flag]")!;
  expect(row).toHaveClass("border-t", "border-line-base", "border-s-accent");
  expect(row).not.toHaveClass("border-accent");
  expect(row).toHaveStyle({ borderBlockStartWidth: "var(--ui-border-hairline, 1px)", borderInlineStartWidth: "var(--ui-border-rule, 2px)" });
});


it("uses ledger-only inverse label ink while preserving the status glyph's tone and shape", () => {
  const { container } = render(<RecordLedger id="inverse" form="record" ground="inverse" head={{ title: "Record", status: { tone: "danger", label: "Overdue" } }} groups={[{ id: "rows", label: "Rows", rows: [{ id: "danger", label: "Check", status: { tone: "danger", label: "Needs review" } }] }]} caption="Sample data." />);
  for (const status of container.querySelectorAll('[data-tone="danger"]')) {
    expect(status).not.toHaveAttribute("style");
    expect(status).toHaveClass("text-status-danger-text");
    expect(status.querySelector(":scope > span > span")).toHaveClass("text-ink-on-inverse");
    expect(status.querySelector('[data-part="mark"]')).toHaveClass("fill-status-danger");
    expect(status.querySelector('[data-part="mark"]')).toHaveAttribute("data-shape", "diamond");
  }
  const ordinary = render(<RecordLedger id="ordinary" form="record" head={{ title: "Record", status: { tone: "danger", label: "Overdue" } }} groups={groups} caption="Sample data." />);
  expect(ordinary.container.querySelector('[data-tone="danger"]')).not.toHaveAttribute("style");
});

const blankLedgerNodes: ReactNode[] = [null, undefined, false, true, "", "  \n ", [], [null, false, [" ", []]]];
it("requires visible record title and caption while accepting zero and opaque components", () => {
  for (const blank of blankLedgerNodes) {
    expect(() => render(<RecordLedger id="title" form="record" head={{ title: blank }} groups={groups} caption="Sample data." />)).toThrow(TypeError);
    expect(() => render(<RecordLedger id="caption" form="record" head={{ title: "Record" }} groups={groups} caption={blank} />)).toThrow(TypeError);
  }
  const Authored = () => <span>Authored</span>;
  for (const content of [0, [null, [0]], <Authored />]) expect(() => render(<RecordLedger id="content" form="record" head={{ title: content }} groups={groups} caption={content} />)).not.toThrow();
});
it("retains portable ledger token fallbacks and responsive group border resets", () => {
  const recipes = readFileSync("styles/theme-keys.css", "utf8").split("@utility ledger-columns-two")[1]!;
  expect(recipes).not.toMatch(/var\(--(?:spacing-(?:2xl|xl)|ui-(?:border-hairline|icon-md))\)/);
  expect(recipes).toContain("var(--spacing-2xl, 32px)");
  expect(recipes).toContain("var(--spacing-xl, 24px)");
  expect(recipes).toContain("var(--ui-border-hairline, 1px)");
  expect(recipes).toContain("var(--ui-icon-md, var(--spacing-xl, 24px))");
  const twoColumns = recipes.split("@utility ledger-columns-three")[0]!;
  expect(twoColumns).toContain("@media (width >= 48rem) { grid-template-columns: repeat(2, minmax(0, 1fr))");
  expect(twoColumns).toContain("& > [data-ledger-group]:nth-child(2) { border-block-start-width: 0; }");
  expect(twoColumns).toContain("& > .ledger-group-divided { border-block-start-width: 0; border-inline-start-width: var(--ui-border-hairline, 1px); border-inline-start-style: solid; }");
});
