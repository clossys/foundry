import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { PricingTable, type PricingTableProps, type PricingTier } from "./PricingTable.js";

const TIERS: PricingTier[] = [
  {
    id: "starter",
    name: "Tier name one",
    price: "Price one",
    features: ["Feature one", "Feature two"],
    cta: <button type="button">CTA one</button>,
  },
  {
    id: "team",
    name: "Tier name two",
    price: "Price two",
    features: ["Feature three"],
    cta: <button type="button">CTA two</button>,
    isHighlighted: true,
    badge: "Badge text",
  },
];

describe("PricingTable", () => {
  it("renders an optional heading above the tier grid", () => {
    render(<PricingTable heading="Pricing heading" tiers={TIERS} />);
    expect(screen.getByRole("heading", { name: "Pricing heading" })).toBeInTheDocument();
  });

  it("defaults the heading to <h2>", () => {
    render(<PricingTable heading="Pricing heading" tiers={TIERS} />);
    expect(screen.getByRole("heading", { name: "Pricing heading" }).tagName).toBe("H2");
  });

  it("renders the heading at a custom level", () => {
    render(<PricingTable heading="Pricing heading" tiers={TIERS} headingLevel={3} />);
    expect(screen.getByRole("heading", { name: "Pricing heading" }).tagName).toBe("H3");
  });

  it("renders no heading region when heading/description are both omitted", () => {
    render(<PricingTable tiers={TIERS} />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("renders each tier's name, price, and feature list", () => {
    render(<PricingTable tiers={TIERS} />);
    expect(screen.getByText("Tier name one")).toBeInTheDocument();
    expect(screen.getByText("Price one")).toBeInTheDocument();
    expect(screen.getByText("Feature one")).toBeInTheDocument();
    expect(screen.getByText("Feature two")).toBeInTheDocument();
  });

  it("renders each tier's cta slot", () => {
    render(<PricingTable tiers={TIERS} />);
    expect(screen.getByRole("button", { name: "CTA one" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CTA two" })).toBeInTheDocument();
  });

  it("renders a tier's badge only when given one", () => {
    render(<PricingTable tiers={TIERS} />);
    expect(screen.getByText("Badge text")).toBeInTheDocument();
  });

  it("omits a tier's badge and description when neither is given", () => {
    render(
      <PricingTable
        tiers={[{ id: "free", name: "Tier name", price: "Price", features: [], cta: <button type="button">Go</button> }]}
      />,
    );
    expect(screen.queryByText("Badge text")).not.toBeInTheDocument();
  });

  it("tier names are NOT real heading elements — a homogeneous repeat, not named regions", () => {
    render(<PricingTable heading="Pricing heading" tiers={TIERS} />);
    // Only the table's own heading is a real <hN> — the tiers add none.
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  it("renders one tier per entry, as data", () => {
    render(<PricingTable tiers={TIERS} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("forwards className onto the root, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(<PricingTable tiers={TIERS} className="gap-2xl" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("gap-2xl");
  });

  it("forwards a consumer style prop onto the root", () => {
    const { container } = render(<PricingTable tiers={TIERS} style={{ marginTop: "8px" }} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.marginTop).toBe("8px");
  });
});

const INTERVAL_TIERS = TIERS.map(({ price: _price, ...tier }, index) => ({
  ...tier,
  priceByInterval: {
    a: { amount: `Amount a ${index}`, priceText: `Spoken a ${index}` },
    b: { amount: `Amount b ${index}`, priceText: `Spoken b ${index}`, ...(index === 0 ? { note: "Selected note" } : {}) },
  },
}));

function textGroup(id = "details") {
  return {
    id,
    label: `Group ${id}`,
    rows: ["first", "second"].map(row => ({
      id: row,
      label: `Row ${id} ${row}`,
      cells: {
        starter: { kind: "text" as const, text: `First ${row}` },
        team: { kind: "text" as const, text: `Second ${row}` },
      },
    })),
  };
}

function markGroup() {
  return {
    id: "entitlements",
    label: "Entitlement group",
    rows: ["first", "second"].map(row => ({
      id: row,
      label: `Entitlement ${row}`,
      cells: {
        starter: { kind: "mark" as const, included: false },
        team: { kind: "mark" as const, included: true },
      },
    })),
  };
}

const MARK_LABELS = ["Mark zero", "Mark one", "Mark two", "Mark three", "Mark four"] as const;
const TEXT_COMPARISON = { groups: [textGroup()], featuredLabel: "Featured tier" };
const MARK_COMPARISON = {
  groups: [markGroup()], featuredLabel: "Featured tier", markLabels: MARK_LABELS, keyLabel: "Mark key",
};

function markup(props: unknown) {
  return renderToStaticMarkup(<PricingTable {...props as PricingTableProps} />);
}

describe("PricingTable interval prices", () => {
  it("selects interval b without mounting interval a amounts (mutant: first-key-always)", () => {
    render(<PricingTable tiers={INTERVAL_TIERS} interval="b" />);
    INTERVAL_TIERS.forEach((_, index) => {
      expect(screen.getByText(`Amount b ${index}`)).toBeInTheDocument();
      expect(screen.queryByText(`Amount a ${index}`)).not.toBeInTheDocument();
      expect(screen.queryByText(`Spoken a ${index}`)).not.toBeInTheDocument();
    });
  });

  it("hides visible amounts and supplies spoken prices (mutants: drop-aria-hidden, drop-priceText)", () => {
    render(<PricingTable tiers={INTERVAL_TIERS} interval="b" />);
    const amount = screen.getByText("Amount b 0");
    const spoken = screen.getByText("Spoken b 0");
    expect(amount).toHaveAttribute("aria-hidden", "true");
    expect(spoken).toHaveClass("sr-only");
    expect(spoken.tagName).toBe("SPAN");
    expect(spoken.closest("[aria-hidden='true']")).toBeNull();
    expect(amount.parentElement).toBe(spoken.parentElement);
    expect(amount.parentElement?.tagName).toBe("P");
  });

  it("renders a selected note below its amount and omits absent notes (mutant: drop-note)", () => {
    render(<PricingTable tiers={INTERVAL_TIERS} interval="b" />);
    const amount = screen.getByText("Amount b 0").parentElement;
    const note = screen.getByText("Selected note");
    expect(note.tagName).toBe("P");
    expect(note).toHaveClass("text-body-s", "text-ink-secondary");
    expect(amount?.nextElementSibling).toBe(note);
    expect(screen.getAllByText("Selected note")).toHaveLength(1);
    expect(screen.getByText("Amount b 1").parentElement?.nextElementSibling?.tagName).toBe("UL");
  });

  const invalidPrices = [
    ["both price forms", { tiers: [{ ...TIERS[0], priceByInterval: INTERVAL_TIERS[0].priceByInterval }], interval: "b" }],
    ["neither price form", { tiers: [{ id: "empty", name: "Tier", features: [], cta: "Action" }] }],
    ["mismatched key sets", { tiers: [INTERVAL_TIERS[0], { ...INTERVAL_TIERS[1], priceByInterval: { b: INTERVAL_TIERS[1].priceByInterval.b } }], interval: "b" }],
    ["same-length different keys", { tiers: [INTERVAL_TIERS[0], { ...INTERVAL_TIERS[1], priceByInterval: { b: INTERVAL_TIERS[1].priceByInterval.b, c: INTERVAL_TIERS[1].priceByInterval.a } }], interval: "b" }],
    ["missing interval", { tiers: INTERVAL_TIERS }],
    ["unknown interval", { tiers: INTERVAL_TIERS, interval: "missing" }],
    ["unused interval", { tiers: TIERS, interval: "b" }],
    ["empty selected priceText", { tiers: [{ ...INTERVAL_TIERS[0], priceByInterval: { b: { amount: "Amount", priceText: "" } } }], interval: "b" }],
    ["empty unselected priceText", { tiers: [{ ...INTERVAL_TIERS[0], priceByInterval: { a: { amount: "Amount", priceText: "" }, b: INTERVAL_TIERS[0].priceByInterval.b } }], interval: "b" }],
  ] as const;

  it.each(invalidPrices)("rejects %s with a PricingTable TypeError (mutant: no-key-set-check)", (_name, props) => {
    expect(() => markup(props)).toThrow(TypeError);
    expect(() => markup(props)).toThrow(/^PricingTable:/);
  });

  it("allows fixed-price tiers beside interval-priced tiers", () => {
    render(<PricingTable tiers={[TIERS[0], INTERVAL_TIERS[1]]} interval="b" />);
    expect(screen.getByText("Price one")).toBeInTheDocument();
    expect(screen.getByText("Amount b 1")).toBeInTheDocument();
  });

  it("keeps fixed prices unwrapped with identical explicit base output (mutant: wrap-every-price)", () => {
    const { container } = render(<PricingTable heading="Heading" description="Description" tiers={TIERS} />);
    expect(screen.getByText("Price one").tagName).toBe("P");
    expect(screen.getByText("Price one").children).toHaveLength(0);
    expect(container.querySelector(".sr-only")).toBeNull();
    expect(markup({ heading: "Heading", description: "Description", tiers: TIERS }))
      .toBe(markup({ heading: "Heading", description: "Description", tiers: TIERS, ground: "base" }));
  });
});

describe("PricingTable comparison", () => {
  it("renders group tables with ordered tier headers and deeper row headings (mutants: same-heading-level, reorder-columns)", () => {
    render(<PricingTable heading="Heading" headingLevel={2} tiers={TIERS} comparison={{ ...TEXT_COMPARISON, groups: [textGroup("first"), textGroup("second")] }} />);
    expect(screen.getByRole("heading", { name: "Heading", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Group first", level: 3 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Group second", level: 3 })).toBeInTheDocument();
    const tables = screen.getAllByRole("table");
    expect(tables).toHaveLength(2);
    tables.forEach(table => {
      expect(within(table).getAllByRole("columnheader").map(header => header.textContent))
        .toEqual(["Tier name one", "Tier name twoFeatured tier"]);
      expect(within(table).getAllByRole("heading", { level: 4 })).toHaveLength(2);
    });
  });

  it.each([5, 6] as const)("caps comparison headings at h6 from h%s", headingLevel => {
    render(<PricingTable heading="Heading" headingLevel={headingLevel} tiers={TIERS} comparison={TEXT_COMPARISON} />);
    expect(screen.getByRole("heading", { name: "Group details", level: 6 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Row details first", level: 6 })).toBeInTheDocument();
  });

  it("features the highlighted tier's column (mutant: wrong-featured-column)", () => {
    render(<PricingTable tiers={TIERS} comparison={TEXT_COMPARISON} />);
    const headers = screen.getAllByRole("columnheader");
    expect(within(headers[0]).queryByText("Featured tier")).not.toBeInTheDocument();
    expect(within(headers[1]).getByText("Featured tier")).toBeInTheDocument();
  });

  it("rejects multiple highlighted tiers", () => {
    expect(() => markup({ tiers: TIERS.map(tier => ({ ...tier, isHighlighted: true })), comparison: TEXT_COMPARISON })).toThrow(/^PricingTable:/);
  });

  it("lets Matrix reject a highlighted tier without a featured label", () => {
    expect(() => markup({ tiers: TIERS, comparison: { groups: [textGroup()] } })).toThrow(/Matrix: featuredLabel/);
  });

  it("maps included and excluded marks to four and zero (mutant: swapped-mark-values)", () => {
    render(<PricingTable tiers={TIERS} comparison={MARK_COMPARISON} />);
    const row = screen.getAllByRole("rowheader")[0].parentElement!;
    const cells = within(row).getAllByRole("cell");
    expect(within(cells[0]).getByText("Mark zero")).toHaveClass("sr-only");
    expect(within(cells[1]).getByText("Mark four")).toHaveClass("sr-only");
    expect(screen.getByRole("heading", { name: "Mark key", level: 4 })).toBeInTheDocument();
  });

  it("lets Matrix reject mark cells missing a key label", () => {
    expect(() => markup({ tiers: TIERS, comparison: { ...MARK_COMPARISON, keyLabel: undefined } })).toThrow(/Matrix: keyLabel/);
  });

  it("lets Matrix reject mark cells missing mark labels", () => {
    expect(() => markup({ tiers: TIERS, comparison: { ...MARK_COMPARISON, markLabels: undefined } })).toThrow(/Matrix: markLabels/);
  });

  it("lets Matrix reject mark labels when the comparison contains only text", () => {
    expect(() => markup({ tiers: TIERS, comparison: { ...TEXT_COMPARISON, markLabels: MARK_LABELS } })).toThrow(/Matrix: markLabels/);
  });

  it("renders supplied text cells without a mark key (mutant: always-render-key)", () => {
    render(<PricingTable tiers={TIERS} comparison={TEXT_COMPARISON} />);
    expect(screen.getByText("First first")).toBeInTheDocument();
    expect(screen.getByText("Second second")).toBeInTheDocument();
    expect(screen.queryByText("Mark key")).not.toBeInTheDocument();
    expect(screen.getAllByRole("list")).toHaveLength(TIERS.length);
  });

  it("forwards mark labels only to the applicable groups in a mixed comparison", () => {
    render(<PricingTable tiers={TIERS} comparison={{ ...MARK_COMPARISON, groups: [markGroup(), textGroup()] }} />);
    expect(screen.getAllByRole("table")).toHaveLength(2);
    expect(screen.getAllByRole("heading", { name: "Mark key" })).toHaveLength(1);
    expect(screen.getByText("First first")).toBeInTheDocument();
  });

  it.each([
    ["empty", []],
    ["five groups", [textGroup("a"), textGroup("b"), textGroup("c"), textGroup("d"), textGroup("e")]],
    ["duplicate ids", [textGroup(), textGroup()]],
  ] as const)("rejects invalid groups: %s", (_name, groups) => {
    expect(() => markup({ tiers: TIERS, comparison: { ...TEXT_COMPARISON, groups } })).toThrow(/^PricingTable:/);
  });

  it("lets Matrix reject cells that omit a tier id", () => {
    const group = textGroup();
    const rows = group.rows.map(row => ({ ...row, cells: { starter: row.cells.starter } }));
    expect(() => markup({ tiers: TIERS, comparison: { ...TEXT_COMPARISON, groups: [{ ...group, rows }] } })).toThrow(/Matrix: row cells/);
  });
});

describe("PricingTable composition", () => {
  it("uses inverse inks for its heading region and comparison while retaining tier inks (mutant: ground-ignored)", () => {
    render(<PricingTable heading="Heading" description="Description" ground="inverse" tiers={TIERS} comparison={TEXT_COMPARISON} />);
    expect(screen.getByRole("heading", { name: "Heading" })).toHaveClass("text-ink-on-inverse");
    expect(screen.getByText("Description")).toHaveClass("text-ink-on-inverse-muted");
    expect(screen.getByRole("heading", { name: "Group details" })).toHaveClass("text-ink-on-inverse");
    expect(screen.getByRole("table")).toHaveClass("text-ink-on-inverse");
    expect(screen.getByText("Price one")).toHaveClass("text-ink-primary");
  });

  it("retains default heading region inks", () => {
    render(<PricingTable heading="Heading" description="Description" tiers={TIERS} />);
    expect(screen.getByRole("heading", { name: "Heading" })).toHaveClass("text-ink-primary");
    expect(screen.getByText("Description")).toHaveClass("text-ink-secondary");
  });

  it("places controls between the heading and tier grid (mutant: controls-after-grid)", () => {
    const { container } = render(<PricingTable heading="Heading" tiers={TIERS} controls={<button type="button">Interval control</button>} />);
    const root = container.firstElementChild!;
    expect(root.children).toHaveLength(3);
    expect(root.children[0]).toContainElement(screen.getByRole("heading", { name: "Heading" }));
    expect(root.children[1]).toContainElement(screen.getByRole("button", { name: "Interval control" }));
    expect(root.children[1]).toHaveClass("flex", "justify-center");
    expect(root.children[2]).toContainElement(screen.getByText("Price one"));
  });

  it("adds no controls or comparison wrapper when omitted", () => {
    const { container } = render(<PricingTable heading="Heading" tiers={TIERS} />);
    expect(container.firstElementChild?.children).toHaveLength(2);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

// Captured from the unchanged fixed-price component on main 4174ef0e.
const FIXED_HEADED_MARKUP = "<div id=\"tiers\" dir=\"rtl\" class=\"flex flex-col gap-lg\"><div class=\"flex flex-col gap-xs\"><h2 class=\"text-h2 font-display text-ink-primary\">Heading</h2><p class=\"text-body text-ink-secondary\">Description</p></div><div class=\"grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-3\"><div class=\"rounded-control bg-surface-raised p-lg flex h-full flex-col items-start gap-md\" style=\"box-shadow:var(--ui-elevation-raised, 0 1px 0 var(--color-line-base, oklch(0.8761 0 0)))\"><p class=\"text-body font-body font-medium text-ink-primary\">Tier name one</p><p class=\"text-h1 font-display text-ink-primary\">Price one</p><ul class=\"flex flex-1 flex-col gap-xs\"><li class=\"text-body-s text-ink-secondary\">Feature one</li><li class=\"text-body-s text-ink-secondary\">Feature two</li></ul><div class=\"w-full\"><button type=\"button\">CTA one</button></div></div><div class=\"rounded-control bg-surface-raised p-lg flex h-full flex-col items-start gap-md border-2 border-accent\" style=\"box-shadow:var(--ui-elevation-raised, 0 1px 0 var(--color-line-base, oklch(0.8761 0 0)))\"><span class=\"inline-flex items-center rounded-pill px-sm py-xs text-caption font-body tracking-meta bg-status-info-tint text-status-info-text\">Badge text</span><p class=\"text-body font-body font-medium text-ink-primary\">Tier name two</p><p class=\"text-h1 font-display text-ink-primary\">Price two</p><ul class=\"flex flex-1 flex-col gap-xs\"><li class=\"text-body-s text-ink-secondary\">Feature three</li></ul><div class=\"w-full\"><button type=\"button\">CTA two</button></div></div></div></div>";
const FIXED_BARE_MARKUP = "<div class=\"flex flex-col gap-lg\"><div class=\"grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-3\"><div class=\"rounded-control bg-surface-raised p-lg flex h-full flex-col items-start gap-md\" style=\"box-shadow:var(--ui-elevation-raised, 0 1px 0 var(--color-line-base, oklch(0.8761 0 0)))\"><p class=\"text-body font-body font-medium text-ink-primary\">Tier name one</p><p class=\"text-h1 font-display text-ink-primary\">Price one</p><ul class=\"flex flex-1 flex-col gap-xs\"><li class=\"text-body-s text-ink-secondary\">Feature one</li><li class=\"text-body-s text-ink-secondary\">Feature two</li></ul><div class=\"w-full\"><button type=\"button\">CTA one</button></div></div><div class=\"rounded-control bg-surface-raised p-lg flex h-full flex-col items-start gap-md border-2 border-accent\" style=\"box-shadow:var(--ui-elevation-raised, 0 1px 0 var(--color-line-base, oklch(0.8761 0 0)))\"><span class=\"inline-flex items-center rounded-pill px-sm py-xs text-caption font-body tracking-meta bg-status-info-tint text-status-info-text\">Badge text</span><p class=\"text-body font-body font-medium text-ink-primary\">Tier name two</p><p class=\"text-h1 font-display text-ink-primary\">Price two</p><ul class=\"flex flex-1 flex-col gap-xs\"><li class=\"text-body-s text-ink-secondary\">Feature three</li></ul><div class=\"w-full\"><button type=\"button\">CTA two</button></div></div></div></div>";

describe("PricingTable fixed-price byte preservation", () => {
  it("preserves the captured heading, description and native-attribute render bytes", () => {
    const props = { heading: "Heading", description: "Description", tiers: TIERS, id: "tiers", dir: "rtl" };
    expect(markup(props)).toBe(FIXED_HEADED_MARKUP);
    expect(markup({ ...props, ground: "base" })).toBe(FIXED_HEADED_MARKUP);
  });

  it("preserves the captured headingless render bytes without optional wrappers", () => {
    expect(markup({ tiers: TIERS })).toBe(FIXED_BARE_MARKUP);
  });
});


describe("PricingTable inherited price contracts", () => {
  it("accepts an inherited fixed price getter with the original fixed render", () => {
    const fixed = TIERS[0]!;
    const { price, ...tier } = fixed;
    const inherited = Object.assign(Object.create({ get price() { return price; } }), tier);
    expect(markup({ tiers: [inherited] })).toBe(markup({ tiers: [fixed] }));
  });

  it("rejects an inherited fixed price combined with interval prices", () => {
    const inherited = Object.assign(
      Object.create({ get price() { return "Inherited amount"; } }),
      INTERVAL_TIERS[0]!,
    );
    expect(() => markup({ tiers: [inherited], interval: "b" })).toThrow("PricingTable: each tier needs one price form.");
  });
});
