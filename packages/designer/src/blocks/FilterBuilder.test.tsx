import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FilterBuilder, type FilterBuilderLabels, type FilterBuilderProps } from "./FilterBuilder.js";
import { filterRows, parseTableModel, type TableFilter, type TableFilterNode, type TableModel } from "./table-model/index.js";
import { sampleColumnLabels, sampleFormatValue, sampleLabels, sampleModel, sampleRows } from "./filter-builder/sample.js";

const text = (value: string): TableFilter => ({ column: "name", kind: "text", op: "contains", value });
const group = (op: "and" | "or", items: readonly TableFilterNode[]): TableFilterNode => ({ kind: "group", op, items });
const base: TableModel = { ...sampleModel, version: 1, filters: [] };
const props = { columnLabels: sampleColumnLabels, labels: sampleLabels, facets: filterRows(sampleRows, sampleModel).facets, formatValue: sampleFormatValue };
function Harness({ model: initial = sampleModel, changed = vi.fn(), ...rest }: Partial<FilterBuilderProps> & { changed?: (model: TableModel) => void }) {
  const [model, setModel] = useState(initial);
  return <FilterBuilder {...props} {...rest} model={model} onChange={next => { changed(next); setModel(next); }} />;
}
const chip = (value: string) => `Project contains ${value}`;
async function advanced(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Advanced", exact: true }));
  return screen.findByRole("dialog", { name: "Advanced" });
}
afterEach(() => vi.useRealTimers());
/** Every id is unique in the document, and every IDREF token resolves to exactly one element. */
function expectUniqueReferences() {
  const ids = [...document.querySelectorAll("[id]")].map(el => el.id);
  expect(ids.filter((id, index) => ids.indexOf(id) !== index), "duplicate ids").toEqual([]);
  const references = [...document.querySelectorAll("[aria-labelledby],[aria-describedby]")];
  expect(references.length).toBeGreaterThan(0);
  for (const el of references) for (const attribute of ["aria-labelledby", "aria-describedby"]) {
    for (const token of (el.getAttribute(attribute) ?? "").split(/\s+/).filter(Boolean)) {
      expect(document.querySelectorAll(`[id=${JSON.stringify(token)}]`), `${attribute} ${token}`).toHaveLength(1);
    }
  }
}

describe("FilterBuilder draft bar", () => {
  it("names chip bodies with the entire describe sentence and host formatted values", () => {
    render(<Harness />);
    expect(screen.getByRole("group", { name: "Filters" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Status is any of Active, Planned", exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Status is any of Active, Planned" })).toBeInTheDocument();
    expect(screen.getByText("Any of 2 conditions")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Any of 2 conditions", exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });
  it.each(["{Delete}", "{Backspace}"])("removes a chip with %s and focuses next then previous then Add filter", async key => {
    const user = userEvent.setup(); const changed = vi.fn();
    render(<Harness model={{ ...base, filters: [text("one"), text("two"), text("three")] }} changed={changed} />);
    screen.getByRole("button", { name: chip("two"), exact: true }).focus(); await user.keyboard(key);
    expect(changed.mock.lastCall![0].filters).toEqual([text("one"), text("three")]);
    expect(screen.getByRole("button", { name: chip("three"), exact: true })).toHaveFocus();
    await user.keyboard(key); expect(screen.getByRole("button", { name: chip("one"), exact: true })).toHaveFocus();
    await user.keyboard(key); expect(screen.getByRole("button", { name: "Add filter", exact: true })).toHaveFocus();
  });
  it("removal controls and Clear all follow the same focus policy", async () => {
    const user = userEvent.setup(); render(<Harness model={{ ...base, filters: [text("one"), text("two"), text("three")] }} />);
    await user.click(screen.getByRole("button", { name: `Remove ${chip("one")}` }));
    expect(screen.getByRole("button", { name: chip("two"), exact: true })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(screen.getByRole("button", { name: "Add filter", exact: true })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
  });
  it("keeps incomplete edits local, applies valid edits live, and discards them on close", async () => {
    const user = userEvent.setup(); const changed = vi.fn();
    render(<Harness model={{ ...base, filters: [text("guide")] }} changed={changed} />);
    await user.click(screen.getByRole("button", { name: chip("guide"), exact: true }));
    let dialog = await screen.findByRole("dialog");
    await user.clear(within(dialog).getByRole("textbox", { name: "Value", exact: true }));
    expect(changed).not.toHaveBeenCalled(); expect(within(dialog).getByText("Enter a value.")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: chip("guide"), exact: true })); dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: "Value", exact: true })).toHaveValue("guide");
    await user.clear(within(dialog).getByRole("textbox", { name: "Value", exact: true }));
    await user.type(within(dialog).getByRole("textbox", { name: "Value", exact: true }), "R");
    expect(changed).toHaveBeenLastCalledWith({ ...base, filters: [text("R")] });
  });
  it("adds a draft from the column menu in host label order without emitting incomplete values", async () => {
    const user = userEvent.setup(); const changed = vi.fn(); render(<Harness model={base} changed={changed} />);
    await user.click(screen.getByRole("button", { name: "Add filter", exact: true }));
    expect((await screen.findAllByRole("menuitem")).map(el => el.textContent)).toEqual(Object.values(sampleColumnLabels));
    await user.click(screen.getByRole("menuitem", { name: "Project" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Enter a value.")).toBeInTheDocument(); expect(changed).not.toHaveBeenCalled();
    await user.keyboard("{Escape}"); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Project contains", exact: true })).not.toBeInTheDocument();
  });
  it("selects all kind-specific operators, hides empty values, and preserves unrelated model fields", async () => {
    const user = userEvent.setup(); const changed = vi.fn();
    const model = { ...base, search: "report", measures: [{ id: "count", op: "count" }] as const, filters: [text("guide")] };
    render(<Harness model={model} changed={changed} />);
    await user.click(screen.getByRole("button", { name: chip("guide"), exact: true })); const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Condition/ }));
    expect((await screen.findAllByRole("option")).map(el => el.textContent?.replace("✓", ""))).toEqual(["contains", "is", "is not", "is empty", "is not empty"]);
    await user.click(screen.getByRole("option", { name: "is empty", exact: true }));
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    expect(changed).toHaveBeenLastCalledWith({ ...model, version: 2, filters: [{ column: "name", kind: "text", op: "empty" }] });
  });
});

describe("FilterBuilder advanced draft", () => {
  it("uses a horizontal root RadioGroup and serializes Any as one v2 OR group", async () => {
    const user = userEvent.setup(); const changed = vi.fn(); const initial = { ...base, filters: [text("guide"), text("report")] };
    render(<Harness model={initial} changed={changed} maxDepth={2} />); const dialog = await advanced(user);
    expect(within(dialog).getByRole("radiogroup", { name: "Match" })).toHaveAttribute("aria-orientation", "horizontal");
    await user.click(within(dialog).getByRole("radio", { name: "Any of" }));
    expect(changed).not.toHaveBeenCalled(); await user.click(within(dialog).getByRole("button", { name: "Apply", exact: true }));
    expect(changed).toHaveBeenCalledTimes(1); expect(changed).toHaveBeenLastCalledWith({ ...initial, version: 2, filters: [group("or", initial.filters)] });
    expect(parseTableModel(changed.mock.lastCall![0])).toEqual(changed.mock.lastCall![0]);
  });
  it.each(["and", "or"] as const)("round trips representable mixed-operator %s roots without flattening", async op => {
    const user = userEvent.setup(); const changed = vi.fn();
    const items = [text("report"), group("and", [text("guide"), group("or", [text("library"), text("catalogue")])])];
    const filters = op === "and" ? items : [group("or", [text("report"), group("and", [text("guide"), text("catalogue")])])];
    const model = { ...base, version: 2 as const, filters };
    render(<Harness model={model} changed={changed} maxDepth={2} />); const dialog = await advanced(user);
    await user.click(within(dialog).getByRole("button", { name: "Apply", exact: true }));
    expect(changed).toHaveBeenLastCalledWith(model); expect(parseTableModel(changed.mock.lastCall![0])).toEqual(model);
  });
  it("refuses switching a deep All tree to Any with visible host reason", async () => {
    const user = userEvent.setup(); const changed = vi.fn();
    const filters = [text("report"), group("and", [text("guide"), group("or", [text("library"), text("catalogue")])])];
    render(<Harness model={{ ...base, version: 2, filters }} changed={changed} maxDepth={2} />); const dialog = await advanced(user);
    const any = within(dialog).getByRole("radio", { name: "Any of" }); expect(any).toBeDisabled();
    expect(within(dialog).getByText("Simplify nested groups first.")).toBeVisible();
    await user.click(any); await user.click(within(dialog).getByRole("button", { name: "Apply", exact: true }));
    expect(changed.mock.lastCall![0].filters).toEqual(filters); expect(parseTableModel(changed.mock.lastCall![0]).filters).toEqual(filters);
  });
  it("offers no Add group at All depth two and disables it below the Any wrapper limit with a visible reason", async () => {
    const user = userEvent.setup();
    const filters = [group("and", [group("or", [text("guide")])])];
    const rendered = render(<Harness model={{ ...base, version: 2, filters }} maxDepth={2} />); let dialog = await advanced(user);
    const groups = within(dialog).getAllByRole("group");
    const deepest = groups.find(el => within(el).queryAllByRole("group").length === 0)!;
    expect(within(deepest).queryByRole("button", { name: "Add group", exact: true })).not.toBeInTheDocument();
    await user.keyboard("{Escape}"); rendered.unmount();
    render(<Harness model={{ ...base, version: 2, filters: [group("or", [group("and", [text("guide")])])] }} maxDepth={2} />); dialog = await advanced(user);
    const child = within(dialog).getAllByRole("group").find(el => within(el).queryAllByRole("group").length === 0)!;
    expect(within(child).getByRole("button", { name: "Add group", exact: true })).toBeDisabled();
    expect(within(child).getByText("The maximum nesting depth is reached.")).toBeVisible();
  });
  it("pins each nested group's own host text and resolves every IDREF to exactly one element", async () => {
    const user = userEvent.setup();
    const filters = [text("report"), group("and", [text("guide"), group("or", [text("library"), text("catalogue")])]), group("or", [text("spring")])];
    render(<Harness model={{ ...base, version: 2, filters }} maxDepth={2} />); const dialog = await advanced(user);
    const groups = within(dialog).getAllByRole("group");
    expect(groups).toHaveLength(3);
    // DOM order: the All group, the Any group nested inside it, then the sibling Any group.
    const expected = ["All of", "Any of", "Any of"];
    const hosts = groups.map((el, index) => {
      const tokens = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
      expect(tokens, `group ${index} names itself`).toHaveLength(1);
      const matches = document.querySelectorAll(`[id=${JSON.stringify(tokens[0])}]`);
      expect(matches, `group ${index} host id resolves once`).toHaveLength(1);
      const host = matches[0]!;
      expect(host.textContent).toBe(expected[index]);
      expect(el).toHaveAccessibleName(expected[index]!);
      // The host is the group's own header: inside this group and outside every nested group.
      expect(el.contains(host)).toBe(true);
      for (const nested of within(el).queryAllByRole("group")) expect(nested.contains(host)).toBe(false);
      return host;
    });
    expect(new Set(groups.map(el => el.getAttribute("aria-labelledby"))).size).toBe(3);
    expect(new Set(hosts).size).toBe(3);
    expectUniqueReferences();
    // The nested Any group is a different element from the sibling Any group, so its text alone cannot prove routing.
    expect(groups[1]).not.toBe(groups[2]); expect(hosts[1]).not.toBe(hosts[2]);
    expect(groups[0]!.contains(groups[1]!)).toBe(true); expect(groups[0]!.contains(groups[2]!)).toBe(false);
  });
  it("resolves the depth-limit and simplify descriptions to exactly one visible element each", async () => {
    const user = userEvent.setup();
    const rendered = render(<Harness model={{ ...base, version: 2, filters: [group("or", [group("and", [text("guide")])])] }} maxDepth={2} />); let dialog = await advanced(user);
    const disabled = within(dialog).getAllByRole("button", { name: "Add group", exact: true }).filter(button => (button as HTMLButtonElement).disabled);
    expect(disabled).toHaveLength(1); const add = disabled[0]!;
    expect(add).toHaveAccessibleDescription("The maximum nesting depth is reached.");
    expect(add.getAttribute("aria-describedby")).toMatch(/\S/);
    expectUniqueReferences(); await user.keyboard("{Escape}"); rendered.unmount();
    const deep = [text("report"), group("and", [text("guide"), group("or", [text("library"), text("catalogue")])])];
    render(<Harness model={{ ...base, version: 2, filters: deep }} maxDepth={2} />); dialog = await advanced(user);
    const any = within(dialog).getByRole("radio", { name: "Any of" });
    expect(any).toHaveAccessibleDescription("Simplify nested groups first."); expectUniqueReferences();
  });
  it("validates Apply, names removal by condition sentence, and Cancel discards edits", async () => {
    const user = userEvent.setup(); const changed = vi.fn(); render(<Harness model={base} changed={changed} maxDepth={2} />);
    let dialog = await advanced(user); await user.click(within(dialog).getByRole("button", { name: "Add condition", exact: true }));
    expect(within(dialog).getByRole("button", { name: "Remove Project contains" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Apply", exact: true }));
    expect(within(dialog).getByText("Enter a value.")).toBeInTheDocument(); expect(changed).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel", exact: true }));
    dialog = await advanced(user); expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
  });
});

it("debounces resultCount until 500ms after the last applied change", () => {
  vi.useFakeTimers(); const resultCount = vi.fn((n: number) => `${n} projects`); const labels = { ...sampleLabels, resultCount };
  const rendered = render(<FilterBuilder {...props} labels={labels} model={base} onChange={vi.fn()} />);
  const status = screen.getByRole("status"); expect(status).toBeEmptyDOMElement();
  for (const [value, count] of [["a", 3], ["ab", 2], ["abc", 1]] as const) {
    rendered.rerender(<FilterBuilder {...props} labels={labels} model={{ ...base, filters: [text(value)] }} resultCount={count} onChange={vi.fn()} />);
    act(() => vi.advanceTimersByTime(100)); expect(status).toBeEmptyDOMElement();
  }
  act(() => vi.advanceTimersByTime(399)); expect(resultCount).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1)); expect(status).toHaveTextContent("1 projects"); expect(resultCount).toHaveBeenCalledTimes(1);
  rendered.rerender(<FilterBuilder {...props} labels={labels} model={base} onChange={vi.fn()} />);
  expect(screen.getByRole("status")).toBe(status); expect(status).toBeEmptyDOMElement();
});

function pseudo(): FilterBuilderLabels {
  const convert = (value: unknown): unknown => typeof value === "string" ? `§${value}` : typeof value === "function" ? (...args: unknown[]) => `§${value(...args)}` : Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, convert(v)]));
  return convert(sampleLabels) as FilterBuilderLabels;
}
it.each(["text", "number", "date", "enum", "tags", "boolean"])("passes every editor message explicitly in pseudo-locale for %s", async kind => {
  const user = userEvent.setup(); const labels = pseudo();
  const filters: Record<string, TableFilter> = { text: text("guide"), number: { column: "budget", kind: "number", op: "range", min: 1 }, date: { column: "due", kind: "date", op: "range", max: "2026-12-31" }, enum: { column: "status", kind: "enum", op: "in", values: ["active"] }, tags: { column: "labels", kind: "tags", op: "any", values: ["Launch"] }, boolean: { column: "archived", kind: "boolean", op: "equals", value: true } };
  render(<Harness model={{ ...base, filters: [filters[kind]!] }} labels={labels} facets={{}} formatValue={(_col, value) => `§${String(value)}`} />);
  await user.click(screen.getAllByRole("button").find(el => el.textContent?.startsWith("§") && el.textContent !== "§Add filter")!);
  const dialog = await screen.findByRole("dialog");
  for (const control of within(dialog).queryAllByRole("textbox")) expect(control).toHaveAccessibleName(/^§/);
  expect(within(dialog).getByRole("button", { name: /§Condition/ })).toBeInTheDocument();
  const content = dialog.textContent ?? "";
  expect(content).not.toMatch(/UTC:|Minimum |Maximum |Apply .* range|No values in the current data|Contains|Equals/);
  if (kind === "date") expect(within(dialog).getByText("§Use YYYY-MM-DD.")).toBeInTheDocument();
  if (kind === "number" || kind === "date") expect(within(dialog).getByRole("button", { name: "§Apply", exact: true })).toBeInTheDocument();
  if (kind === "boolean") expect(within(dialog).getByRole("checkbox", { name: "§Yes" })).toBeInTheDocument();
});

it("opens the advanced editor from a group chip body only when advanced is enabled", async () => {
  const user = userEvent.setup(); render(<Harness maxDepth={2} />);
  await user.click(screen.getByRole("button", { name: "Any of 2 conditions", exact: true }));
  expect(await screen.findByRole("dialog", { name: "Advanced" })).toBeInTheDocument();
});

it.each(["notEquals", "notIn"] as const)("edits v2 %s values through pseudo-locale controls", async op => {
  const user = userEvent.setup(); const changed = vi.fn(); const labels = pseudo();
  const filter: TableFilter = op === "notEquals" ? { column: "name", kind: "text", op, value: "guide" } : { column: "status", kind: "enum", op, values: ["active"] };
  render(<Harness model={{ ...base, version: 2, filters: [filter] }} changed={changed} labels={labels} formatValue={(_column, value) => `§${value}`} />);
  await user.click(screen.getAllByRole("button").find(button => button.textContent?.startsWith("§") && button.textContent !== "§Add filter")!);
  const dialog = await screen.findByRole("dialog");
  if (op === "notEquals") { await user.type(within(dialog).getByRole("textbox", { name: "§Value" }), "x"); expect(changed.mock.lastCall![0].filters[0]).toEqual({ ...filter, value: "guidex" }); }
  else { await user.click(within(dialog).getByRole("checkbox", { name: "§planned" })); expect(changed.mock.lastCall![0].filters[0]).toEqual({ ...filter, values: ["active", "planned"] }); }
  expect(dialog.textContent).not.toMatch(/comparison|matching|No values in the current data/);
});

it("retains invalid drafts when switching value operators without emitting them", async () => {
  const user = userEvent.setup(); const changed = vi.fn(); render(<Harness model={{ ...base, filters: [text("guide")] }} changed={changed} />);
  await user.click(screen.getByRole("button", { name: chip("guide"), exact: true })); const dialog = await screen.findByRole("dialog");
  await user.clear(within(dialog).getByRole("textbox", { name: "Value", exact: true }));
  await user.click(within(dialog).getByRole("button", { name: /Condition/ })); await user.click(await screen.findByRole("option", { name: "is not", exact: true }));
  expect(changed).not.toHaveBeenCalled(); expect(within(dialog).getByRole("textbox", { name: "Value", exact: true })).toHaveValue("");
  within(dialog).getByRole("textbox", { name: "Value", exact: true }).focus();
  await user.keyboard("{Escape}"); await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: chip("guide"), exact: true })).toBeInTheDocument();
});

it("uses host empty-facet and inverted-range copy in pseudo-locale", async () => {
  const user = userEvent.setup(); const labels = pseudo(); const changed = vi.fn();
  const rendered = render(<Harness labels={labels} facets={{}} model={{ ...base, filters: [{ column: "status", kind: "enum", op: "in", values: [] }] }} />);
  await user.click(screen.getByRole("button", { name: "§Status is any of", exact: true }));
  expect(await screen.findByText("§No values to choose from.")).toBeInTheDocument(); await user.keyboard("{Escape}"); rendered.unmount();
  render(<Harness labels={labels} changed={changed} model={{ ...base, filters: [{ column: "budget", kind: "number", op: "range", min: 30 }] }} />);
  await user.click(screen.getAllByRole("button").find(button => button.textContent?.startsWith("§") && button.textContent !== "§Add filter")!);
  const dialog = await screen.findByRole("dialog"); await user.type(within(dialog).getByRole("textbox", { name: "§To" }), "10");
  await user.click(within(dialog).getByRole("button", { name: "§Apply", exact: true }));
  expect(within(dialog).getAllByText("§Enter a start that is not after the end.")).toHaveLength(2); expect(changed).not.toHaveBeenCalled();
});

it.each([{ items: [] }, { items: [text("guide")] }])("round trips empty or single-condition root Any and preserves incoming v2", async ({ items }) => {
  const user = userEvent.setup(); const changed = vi.fn(); const model = { ...base, version: 2 as const, filters: [group("or", items)] };
  render(<Harness model={model} changed={changed} maxDepth={2} />); const dialog = await advanced(user);
  await user.click(within(dialog).getByRole("button", { name: "Apply", exact: true })); expect(changed).toHaveBeenLastCalledWith(model);
});

it("skips remove-only groups when moving focus between mixed root chip bodies", async () => {
  const user = userEvent.setup(); const filters = [text("one"), group("or", [text("two")]), text("three")];
  render(<Harness model={{ ...base, version: 2, filters }} />);
  screen.getByRole("button", { name: chip("one"), exact: true }).focus(); await user.keyboard("{Delete}");
  expect(screen.getByRole("button", { name: chip("three"), exact: true })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Remove Any of 1 conditions" }));
  expect(screen.getByRole("button", { name: chip("three"), exact: true })).toHaveFocus();
  await user.keyboard("{Delete}"); expect(screen.getByRole("button", { name: "Add filter", exact: true })).toHaveFocus();
});

it("opens a valid boolean draft and applies its default before live Yes/No changes", async () => {
  const user = userEvent.setup(); const changed = vi.fn(); render(<Harness model={base} changed={changed} />);
  await user.click(screen.getByRole("button", { name: "Add filter", exact: true })); await user.click(await screen.findByRole("menuitem", { name: "Archived" }));
  const dialog = await screen.findByRole("dialog");
  expect(changed).toHaveBeenLastCalledWith({ ...base, filters: [{ column: "archived", kind: "boolean", op: "equals", value: true }] });
  await user.click(within(dialog).getByRole("checkbox", { name: "Yes" }));
  expect(within(dialog).getByRole("checkbox", { name: "No" })).not.toBeChecked();
  expect(changed).toHaveBeenLastCalledWith({ ...base, filters: [{ column: "archived", kind: "boolean", op: "equals", value: false }] });
});

// Decodes the four entities Chromium's --dump-dom writes into text, in a single pass so a literal "&lt;" (dumped as "&amp;lt;") is not decoded twice.
const dumpedEntities = { quot: '"', amp: "&", lt: "<", gt: ">" } as const;
function decodeDumpedText(dumped: string): string {
  return dumped.replace(/&(quot|amp|lt|gt);/g, (_match, entity: keyof typeof dumpedEntities) => dumpedEntities[entity]);
}

describe("decoding dumped geometry text", () => {
  it("decodes each entity once, so an escaped ampersand stays a literal entity", () => {
    expect(decodeDumpedText("&quot;a&quot; &amp; &lt;b&gt;")).toBe('"a" & <b>');
    expect(decodeDumpedText("&amp;lt;")).toBe("&lt;");
    expect(decodeDumpedText("&amp;quot;&amp;amp;&amp;gt;")).toBe("&quot;&amp;&gt;");
  });
});

describe("FilterBuilder measured geometry", () => {
  type Frame = {
    viewport: number; scrollWidth: number; theme: string; ink: string; surface: string; offenders: string[];
    region: { left: number; right: number }; rows: number; longBody: { height: number; right: number } | null; lineHeight: number;
  };
  const widths = [320, 1280] as const; const themes = ["light", "dark"] as const;
  const longValue = "Harbour library signage and the spring catalogue for the onboarding guide of the field survey app";
  const cases = themes.flatMap(theme => widths.flatMap(width => (["sample", "long"] as const).map(kind => ({
    key: `${theme}-${width}-${kind}`, theme, width,
    markup: renderToStaticMarkup(<FilterBuilder {...props} maxDepth={2} onChange={() => undefined}
      model={kind === "sample" ? sampleModel : { ...base, filters: [text(longValue), text("report"), text("guide")] }} />),
  }))));
  let frames: Record<string, Frame>;
  beforeAll(() => {
    const browser = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      .find(name => spawnSync(name, ["--version"], { stdio: "ignore" }).status === 0);
    if (!browser) throw new Error("FilterBuilder geometry tests require Chromium or Google Chrome on PATH.");
    const css = ["tokens.css", "compiled.css"].map(name => readFileSync(join(import.meta.dirname, "../../styles", name), "utf8")).join("\n");
    // Each case lives in an iframe of the exact width, so media queries and page scroll are real layout, not jsdom.
    function measure(cases: { key: string; theme: string; width: number; markup: string }[], css: string) {
      const frames = cases.map(({ key, theme, width, markup }) => {
        const frame = document.createElement("iframe");
        frame.setAttribute("data-case", key); frame.width = String(width); frame.height = "700"; frame.style.border = "0"; frame.style.display = "block";
        frame.srcdoc = `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><style>${css}</style></head><body style="margin:0;background:var(--color-surface-base, canvas)">${markup}</body></html>`;
        document.body.append(frame);
        return new Promise<HTMLIFrameElement>(resolve => frame.addEventListener("load", () => resolve(frame)));
      });
      Promise.all(frames).then(list => {
        const result: Record<string, unknown> = {};
        for (const frame of list) {
          const doc = frame.contentDocument!, view = frame.contentWindow!, root = doc.documentElement;
          const region = doc.querySelector<HTMLElement>('[role="group"]')!.getBoundingClientRect();
          const width = root.clientWidth;
          const offenders = [...doc.body.querySelectorAll("*")].flatMap(el => {
            const box = el.getBoundingClientRect();
            // Visually hidden (clipped) text, such as the result announcement, never creates scroll.
            return !el.closest(".sr-only") && box.width > 0 && (box.right > width + 0.5 || box.left < -0.5) ? [`${el.tagName.toLowerCase()}.${el.className}|${Math.round(box.left)}..${Math.round(box.right)}`] : [];
          });
          const bodies = [...doc.querySelectorAll<HTMLElement>('[role="group"] button')];
          const long = bodies.find(el => (el.textContent ?? "").includes("Harbour library signage and"));
          const style = view.getComputedStyle(root);
          result[frame.getAttribute("data-case")!] = {
            viewport: view.innerWidth, scrollWidth: root.scrollWidth, theme: root.getAttribute("data-theme"),
            ink: style.getPropertyValue("--color-ink-primary").trim(), surface: style.getPropertyValue("--color-surface-base").trim(),
            offenders, region: { left: region.left, right: region.right },
            rows: new Set(bodies.map(el => Math.round(el.getBoundingClientRect().top))).size,
            longBody: long ? { height: long.getBoundingClientRect().height, right: long.getBoundingClientRect().right } : null,
            lineHeight: Math.min(...bodies.map(el => el.getBoundingClientRect().height)),
          };
        }
        const out = document.createElement("pre"); out.id = "geometry"; out.textContent = JSON.stringify(result); document.body.append(out);
      });
    }
    const directory = mkdtempSync(join(tmpdir(), "filter-builder-geometry-"));
    try {
      const html = join(directory, "fixture.html");
      const data = JSON.stringify({ cases, css }).replaceAll("<", "\\u003c");
      writeFileSync(html, `<!doctype html><meta charset="utf-8"><body style="margin:0"><script>const data=${data};(${measure.toString()})(data.cases,data.css)</script>`);
      const launch = () => execFileSync(browser, ["--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--allow-file-access-from-files",
        `--user-data-dir=${join(directory, "profile")}`, "--virtual-time-budget=10000", "--dump-dom", `file://${html}`],
      { encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
      // A busy machine can make a headless launch fail transiently; a real layout failure still fails the assertions below.
      let dom = ""; let failure: unknown;
      for (let attempt = 0; attempt < 3 && !dom; attempt++) { try { dom = launch(); } catch (error) { failure = error; } }
      if (!dom) throw failure;
      const match = /<pre id="geometry">([\s\S]*?)<\/pre>/.exec(dom);
      if (!match) throw new Error("Chromium did not produce FilterBuilder layout measurements.");
      frames = JSON.parse(decodeDumpedText(match[1]!));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 180000);

  it.each(cases.map(({ key, theme, width }) => [key, theme, width] as const))("%s has no page scroll and nothing outside the viewport", (key, theme, width) => {
    const frame = frames[key]!;
    expect(frame.viewport).toBe(width); expect(frame.theme).toBe(theme);
    expect(frame.scrollWidth).toBeLessThanOrEqual(width);
    expect(frame.offenders).toEqual([]);
    expect(frame.region.left).toBeGreaterThanOrEqual(0); expect(frame.region.right).toBeLessThanOrEqual(width);
  });
  it("applies the light and dark token sets, so each theme is really measured", () => {
    for (const width of widths) for (const kind of ["sample", "long"]) {
      expect(frames[`light-${width}-${kind}`]!.ink).not.toBe(frames[`dark-${width}-${kind}`]!.ink);
      expect(frames[`light-${width}-${kind}`]!.surface).not.toBe(frames[`dark-${width}-${kind}`]!.surface);
    }
  });
  it.each(themes)("wraps chips onto more rows at 320 than at 1280 in %s", theme => {
    expect(frames[`${theme}-320-sample`]!.rows).toBeGreaterThan(1);
    expect(frames[`${theme}-320-sample`]!.rows).toBeGreaterThan(frames[`${theme}-1280-sample`]!.rows);
  });
  it.each(themes)("wraps a long chip sentence inside the 320 px viewport instead of widening it in %s", theme => {
    const frame = frames[`${theme}-320-long`]!;
    expect(frame.longBody!.right).toBeLessThanOrEqual(320);
    expect(frame.longBody!.height).toBeGreaterThan(frame.lineHeight * 1.5);
  });
});
