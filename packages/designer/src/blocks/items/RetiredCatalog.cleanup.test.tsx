import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FeatureGrid } from "../FeatureGrid.js";
import { NavGrid } from "../NavGrid.js";
import { ContentSection } from "../ContentSection.js";
import { Items } from "./Items.js";
import type { ItemData, ItemsProps } from "./types.js";
import legacy from "./legacy-ssr.test.json";
import catalog from "./legacy-catalog-ssr.test.json";
import headless from "./legacy-headless-catalog-ssr.test.json";
import { withoutDsAttrs } from "../../catalog-core/provenance-attrs.js";

interface FrozenCase { name: string; block: string; props: Record<string, unknown>; html?: string; error?: string }
function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (typeof record.$tag === "string") return createElement(record.$tag, record.props as object, decode(record.children) as ReactNode);
  return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, key === "onSelect" ? () => {} : decode(child)]));
}
const frozen = [...legacy, ...catalog, ...headless] as unknown as FrozenCase[];
const retainedBlocks = { FeatureGrid, NavGrid, ContentSection };
const retained = frozen.filter(fixture => Object.hasOwn(retainedBlocks, fixture.block) && legacy.some(entry => entry.name === fixture.name));
const retired = frozen.filter(fixture => !retained.includes(fixture));

// The old bytes stay frozen; only their applicable contract assertions migrate.
describe("retained published and frame literals", () => {
  it("accounts for all 58 retained cases and all 49 retiring cases", () => {
    expect(retained).toHaveLength(58);
    expect(Object.fromEntries(Object.keys(retainedBlocks).map(block => [block, retained.filter(fixture => fixture.block === block).length]))).toEqual({ FeatureGrid: 36, NavGrid: 16, ContentSection: 6 });
    expect(retired).toHaveLength(49);
  });
  it.each(retained)("keeps the original bytes of $name", fixture => {
    const Component = retainedBlocks[fixture.block as keyof typeof retainedBlocks];
    const render = () => renderToStaticMarkup(createElement(Component as unknown as (props: object) => ReactNode, decode(fixture.props) as object));
    if (fixture.error !== undefined) expect(render).toThrow(fixture.error);
    else expect(withoutDsAttrs(render())).toBe(fixture.html);
  });
});

type Disposition = "rows" | "bento" | "columns" | "columns-refusal" | "statement-refusal" | "groups-refusal";
const migration: readonly [string, Disposition][] = [
  ...["base", "sunken", "inverse"].flatMap(ground => ["plate", "rule"].flatMap(treatment => [2, 3, 5, 6].map(count => [`links-${ground}-${treatment}-${count}`, "rows"] as const))),
  ...["base", "sunken", "inverse"].flatMap(ground => ["plate", "rule"].map(treatment => [`cards-${ground}-${treatment}`, "bento"] as const)),
  ...["base", "sunken", "inverse"].flatMap(ground => [[`topics-flat-${ground}-1`, "rows"], [`topics-flat-${ground}-2`, "columns-refusal"]] as const),
  ["topics-groups-twelve", "groups-refusal"],
  ["catalog-four-rule", "columns-refusal"],
  ["catalog-three-two-plate", "columns-refusal"],
  ["catalog-two-three-plain", "columns-refusal"],
  ["catalog-three-four-icons", "columns-refusal"],
  ["catalog-statement-icons", "statement-refusal"],
  ["catalog-statement-eyebrows", "statement-refusal"],
  ["catalog-statement-links-refusal", "statement-refusal"],
  ["catalog-offcount-linked-plate", "columns-refusal"],
  ["headless-three-plate-icons-eyebrows", "columns"],
  ["headless-two-rule-icons", "columns"],
  ["headless-three-statements", "columns"],
  ["headless-three-blank-heading", "columns"],
];
interface DecodedCatalog {
  items?: readonly (ItemData & { title?: ReactNode })[];
  groups?: readonly { id: string; label: ReactNode; items: readonly ItemData[] }[];
  ground?: ItemsProps["ground"]; surface?: ItemsProps["treatment"];
  treatment?: ItemsProps["treatment"]; columns?: ItemsProps["columns"];
  emphasis?: ItemsProps["scale"]; headingLevel?: ItemsProps["headingLevel"];
}
function migrate(fixture: FrozenCase, disposition: Disposition): ItemsProps {
  const input = decode(fixture.props) as DecodedCatalog;
  const source = input.items ?? input.groups?.flatMap(group => group.items) ?? [];
  const items = source.map(item => ({ ...item, heading: item.heading ?? item.title }));
  return {
    items, ground: input.ground, treatment: input.treatment ?? input.surface ?? (fixture.block === "TopicList" ? "rule" : "plain"),
    headingLevel: input.headingLevel ?? 3, scale: input.emphasis,
    arrangement: disposition === "bento" ? "bento" : disposition === "columns" || disposition === "statement-refusal" || fixture.block === "FeatureGrid" && disposition === "columns-refusal" ? "columns" : "rows",
    columns: disposition === "bento" ? undefined : disposition === "rows" || disposition === "groups-refusal" ? 1 : input.columns,
    groups: input.groups?.map(group => ({ id: group.id, label: group.label, items: group.items.map(item => item.id) })),
  };
}
function markup(props: ItemsProps): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = renderToStaticMarkup(<Items {...props} />);
  return element;
}
function expectAuthoredItems(root: HTMLElement, items: readonly ItemData[], level: 3 | 4) {
  expect(root.querySelectorAll("li")).toHaveLength(items.length);
  const headings = [...root.querySelectorAll("[data-item-heading]")];
  expect(headings).toHaveLength(items.length);
  expect(headings.every(node => node.tagName === `H${level}`)).toBe(true);
  headings.forEach((node, index) => expect(node).toHaveAccessibleName(String(items[index]!.heading)));
  for (const [index, item] of items.entries()) {
    const cell = root.querySelectorAll("li")[index]!;
    expect(cell.querySelector("[data-item-description]")?.textContent).toBe(item.description);
    if (item.href !== undefined) {
      const anchor = cell.querySelector("a")!;
      expect(cell.querySelectorAll("a")).toHaveLength(1);
      expect(anchor.getAttribute("href")).toBe(item.href);
      expect(anchor).toHaveAccessibleName(String(item.heading));
      expect(anchor.querySelector("[data-item-description], [data-item-visual]")).toBeNull();
      if (item.icon !== undefined) expect(cell.querySelector('[aria-hidden="true"] svg')?.closest("a")).toBeNull();
    }
    if (item.visual !== undefined) {
      const visual = cell.querySelector("[data-item-visual]")!;
      expect(visual).toHaveClass("mt-auto", "w-full", "min-w-0");
      expect(visual.closest("[data-item]")).not.toBeNull();
    }
  }
}
describe("explicit migration of 49 retired catalog cases", () => {
  it("removes the temporary catalog fallback rather than leaving a disconnected renderer", () => {
    const source = readFileSync("src/blocks/items/compat-features.tsx", "utf8");
    expect(source).not.toMatch(/\b(?:refusesCanonicalCatalog|LegacyCatalogGrid|headlessCatalog)\b/);
  });
  it("names every retiring literal exactly once", () => {
    expect(migration).toHaveLength(49);
    expect(new Set(migration.map(([name]) => name)).size).toBe(49);
    expect(migration.map(([name]) => name).sort()).toEqual(retired.map(fixture => fixture.name).sort());
  });
  it.each(migration)("moves %s to its canonical %s contract", (name, disposition) => {
    const fixture = retired.find(entry => entry.name === name)!;
    const props = migrate(fixture, disposition);
    if (disposition === "groups-refusal") {
      expect(() => markup(props)).toThrow(RangeError);
      // The old twelve-item budget retires; valid groups retain names and membership.
      const items = props.items.filter((_, index) => index % 4 < 2);
      const groups = props.groups!.map(group => ({ ...group, items: group.items.slice(0, 2) }));
      const root = markup({ ...props, items, groups });
      expect(root.querySelectorAll('[role="group"]')).toHaveLength(3);
      expect([...root.querySelectorAll('[role="group"] > p')].map(node => node.textContent)).toEqual(["Group 0", "Group 1", "Group 2"]);
      expectAuthoredItems(root, items, 4);
    } else if (disposition === "columns-refusal") {
      expect(() => markup(props)).toThrow(RangeError);
      // No implicit fill/fallback: the same authored entries have a valid rows recipe.
      expectAuthoredItems(markup({ ...props, arrangement: "rows", columns: 1 }), props.items, props.headingLevel!);
    } else if (disposition === "statement-refusal") {
      expect(() => markup(props)).toThrow(TypeError);
      expectAuthoredItems(markup({ ...props, scale: "item" }), props.items, props.headingLevel!);
    } else {
      const root = markup(props);
      expectAuthoredItems(root, props.items, props.headingLevel!);
      expect(root.querySelector("[data-items]")).toHaveAttribute("data-treatment", props.treatment);
      if (disposition === "bento") expect([...root.querySelectorAll("[data-item]")].map(node => node.getAttribute("data-span"))).toEqual(props.items.map(item => item.span));
      if (props.scale === "statement") for (const heading of root.querySelectorAll("[data-item-heading]")) expect(heading).toHaveClass("text-h0");
      if (name === "headless-three-blank-heading") expect(root.querySelectorAll("h3")).toHaveLength(3);
    }
  });
});
