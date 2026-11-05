import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "../components/Button.js";
import { GridList } from "../components/GridList.js";
import { TagGroup } from "../components/TagGroup.js";
import { Toolbar } from "../components/Toolbar.js";
import { Tree } from "../components/Tree.js";
import { stableStringify } from "../catalog-core/stable.js";
import { importFoundryComponents } from "./foundry-components.js";
import { CRAFT_COMPARED_LEAVES, craftBlockers, craftFindings, type CraftComparison, type CraftPart } from "./foundry-craft.js";

const here = dirname(fileURLToPath(import.meta.url));
const recordPath = resolve(here, "foundry-craft.json");
afterEach(cleanup);

/** The treatment one rendered element actually carries; nothing here is authored per component. */
const PAINT = ["color", "background", "background-color", "border-color", "box-shadow", "outline", "outline-color", "fill", "stroke"];
const declarations = (style: string | null): [string, string][] => (style ?? "").split(";").map(entry => entry.trim()).filter(Boolean).map(entry => {
  const at = entry.indexOf(":");
  return [entry.slice(0, at).trim(), entry.slice(at + 1).trim()];
});
const classes = (element: Element): string[] => (element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
const tokenRead = (value: string): boolean => /^(?:inset\s+)?var\(--[a-z0-9-]+/.test(value);
function focusOf(element: HTMLElement): string | null {
  if (element.style.boxShadow) return element.style.boxShadow.replace(/^inset\s+/, "");
  if (element.style.outlineStyle && element.style.outlineStyle !== "none" || element.style.outline) return element.style.outline;
  return classes(element).find(name => name.startsWith("focus-visible:")) ?? null;
}
function targetOf(element: Element): string | null {
  const own = (candidate: Element): string | null => (candidate as HTMLElement).style?.minBlockSize || classes(candidate).find(name => /^control-h-(?:sm|md|lg)$/.test(name)) || null;
  if (own(element)) return own(element);
  // A row's activation target is the row; its floor may sit on the row's own content box.
  return element.getAttribute("role") === "row" ? [...element.querySelectorAll("*")].map(own).find(Boolean) ?? null : null;
}
function paintOf(element: Element): string[] {
  const literal = declarations(element.getAttribute("style")).filter(([property, value]) => PAINT.includes(property) && !tokenRead(value)).map(([property, value]) => `${property}: ${value}`);
  return [...literal, ...classes(element).filter(name => name.includes("[") || /#[0-9a-f]{3,8}\b/i.test(name))];
}
const spacingOf = (element: Element): string[] => classes(element).filter(name => /^-?(?:gap|gap-x|gap-y|p|px|py|ps|pe|pt|pb|m|mx|my|ms|me|mt|mb|space-x|space-y)-/.test(name)).sort();
/** Server markup keeps the disabled render-prop value that jsdom's CSSOM cannot parse (`opacity: var(...)`). */
function disabledOf(ui: ReactElement, selector: string): string | null {
  const document = new DOMParser().parseFromString(renderToStaticMarkup(ui), "text/html");
  const element = document.querySelector(selector);
  if (!element) throw new Error(`craft probe: no server element ${selector}`);
  return declarations(element.getAttribute("style")).find(([property]) => property === "opacity")?.[1] ?? null;
}
function part(scenario: string, name: string, element: HTMLElement, reading: { keyboard: boolean; pressable: boolean; inDisabledState?: boolean; focus?: string | null; disabled?: string | null }): CraftPart {
  const focus = reading.focus === undefined ? null : reading.focus;
  const outline = focus !== null && /\bsolid\b/.test(focus) && !focus.startsWith("focus-visible:");
  return {
    scenario, part: name, keyboard: reading.keyboard, pressable: reading.pressable, inDisabledState: reading.inDisabledState ?? false,
    focus, disabled: reading.disabled ?? null, target: reading.pressable ? targetOf(element) : null,
    forcedColors: outline || classes(element).some(entry => /^forced-colors:outline(?:-solid|-2)?$/.test(entry)),
    literalPaint: paintOf(element), spacing: spacingOf(element),
  };
}

async function measure(): Promise<CraftComparison> {
  const user = userEvent.setup();
  const benchmark = { focus: new Set<string>(), disabled: new Set<string>(), target: new Set<string>() };
  // Benchmark 1: the chosen Foundry Button (controls).
  const button = (disabled: boolean) => <Button isDisabled={disabled}>Benchmark</Button>;
  render(button(false));
  await user.keyboard("{Tab}");
  const control = screen.getByRole("button", { name: "Benchmark" });
  benchmark.focus.add(focusOf(control)!); benchmark.target.add(targetOf(control)!);
  benchmark.disabled.add(disabledOf(button(true), "button")!);
  cleanup();
  // Benchmark 2: the chosen Foundry GridList row (collections).
  const grid = <GridList aria-label="Benchmark" disabledKeys={["b"]}><GridList.Item id="a" textValue="A">A</GridList.Item><GridList.Item id="b" textValue="B">B</GridList.Item></GridList>;
  render(grid);
  await user.keyboard("{Tab}");
  const row = screen.getAllByRole("row")[0]!;
  benchmark.focus.add(focusOf(row)!); benchmark.target.add(targetOf(row)!);
  benchmark.disabled.add(disabledOf(grid, '[role="row"][aria-disabled="true"]')!);
  cleanup();

  const slots: Record<string, { scenarios: string[]; parts: CraftPart[] }> = {};
  // Toolbar: joint density, focus and disabled controls across both orientations.
  slots.toolbar = { scenarios: ["orientation=horizontal", "orientation=vertical"], parts: [] };
  for (const orientation of ["horizontal", "vertical"] as const) {
    const scenario = `orientation=${orientation}`;
    const ui = <Toolbar aria-label="Edit" orientation={orientation}><Button>First</Button><Button isDisabled>Unavailable</Button><Button>Last</Button></Toolbar>;
    render(ui);
    const toolbar = screen.getByRole("toolbar", { name: "Edit" });
    slots.toolbar.parts.push(part(scenario, "strip", toolbar, { keyboard: false, pressable: false }));
    await user.keyboard("{Tab}");
    const first = screen.getByRole("button", { name: "First" });
    slots.toolbar.parts.push(part(scenario, "control", first, { keyboard: document.activeElement === first, pressable: true, focus: document.activeElement === first ? focusOf(first) : null }));
    await user.keyboard(orientation === "horizontal" ? "{ArrowRight}" : "{ArrowDown}");
    const disabled = screen.getByRole("button", { name: "Unavailable" });
    const reachedDisabled = document.activeElement === disabled;
    slots.toolbar.parts.push(part(scenario, "control-disabled", disabled, { keyboard: reachedDisabled, pressable: true, inDisabledState: true, focus: reachedDisabled ? focusOf(disabled) : null, disabled: disabledOf(ui, "button[disabled]") }));
    const last = screen.getByRole("button", { name: "Last" });
    slots.toolbar.parts.push(part(scenario, "control-arrowed", last, { keyboard: document.activeElement === last, pressable: true, focus: document.activeElement === last ? focusOf(last) : null }));
    cleanup();
  }
  // TagGroup: tag and remove targets, focus and disabled state.
  {
    const scenario = "removable+disabled";
    const ui = <TagGroup label="Filters" disabledKeys={["two"]} onRemove={() => {}}><TagGroup.List><TagGroup.Item id="one" textValue="Design" removeLabel="Remove Design">Design</TagGroup.Item><TagGroup.Item id="two" textValue="Code" removeLabel="Remove Code">Code</TagGroup.Item></TagGroup.List></TagGroup>;
    render(ui);
    slots["tag-group"] = { scenarios: [scenario], parts: [] };
    await user.keyboard("{Tab}");
    const tag = screen.getByRole("row", { name: /Design/ });
    slots["tag-group"].parts.push(part(scenario, "tag", tag, { keyboard: document.activeElement === tag, pressable: true, focus: document.activeElement === tag ? focusOf(tag) : null }));
    await user.keyboard("{Tab}");
    const remove = screen.getByRole("button", { name: "Remove Design" });
    slots["tag-group"].parts.push(part(scenario, "remove", remove, { keyboard: document.activeElement === remove, pressable: true, focus: document.activeElement === remove ? focusOf(remove) : null }));
    const off = screen.getByRole("row", { name: /Code/ });
    slots["tag-group"].parts.push(part(scenario, "tag-disabled", off, { keyboard: false, pressable: true, inDisabledState: true, disabled: disabledOf(ui, '[role="row"][aria-disabled="true"]') }));
    cleanup();
  }
  // Tree: nested focus, disabled rows and the expansion target. With selection on, a row press selects,
  // so the chevron is the only pointer expansion target and must carry its own floor.
  {
    const scenario = "nested+disabled+selection=single";
    const ui = <Tree aria-label="Documents" selectionMode="single" disabledKeys={["locked"]} defaultExpandedKeys={["folder"]}><Tree.Node id="folder" textValue="Folder" label="Folder" expandLabel="Toggle Folder"><Tree.Node id="child" textValue="Notes" label="Notes" expandLabel="Toggle Notes" /></Tree.Node><Tree.Node id="locked" textValue="Locked" label="Locked" expandLabel="Toggle Locked" /></Tree>;
    render(ui);
    slots.tree = { scenarios: [scenario], parts: [] };
    await user.keyboard("{Tab}");
    const folder = screen.getByRole("row", { name: /Folder/ });
    slots.tree.parts.push(part(scenario, "row", folder, { keyboard: document.activeElement === folder, pressable: true, focus: document.activeElement === folder ? focusOf(folder) : null }));
    await user.keyboard("{ArrowDown}");
    const child = screen.getByRole("row", { name: /Notes/ });
    slots.tree.parts.push(part(scenario, "row-nested", child, { keyboard: document.activeElement === child, pressable: true, focus: document.activeElement === child ? focusOf(child) : null }));
    const chevron = screen.getByRole("button", { name: "Toggle Folder", hidden: true });
    act(() => folder.focus());
    await user.keyboard("{Tab}");
    const chevronKeyboard = document.activeElement === chevron;
    slots.tree.parts.push(part(scenario, "chevron", chevron, { keyboard: chevronKeyboard, pressable: true, focus: chevronKeyboard ? focusOf(chevron) : null }));
    const locked = screen.getByRole("row", { name: /Locked/ });
    slots.tree.parts.push(part(scenario, "row-disabled", locked, { keyboard: false, pressable: true, inDisabledState: true, disabled: disabledOf(ui, '[role="row"][aria-disabled="true"]') }));
    cleanup();
  }
  const sorted = (values: Set<string>) => [...values].sort();
  return { benchmark: { focus: sorted(benchmark.focus), disabled: sorted(benchmark.disabled), target: sorted(benchmark.target) }, slots };
}

describe("Foundry K5 craft comparison (measured)", () => {
  it("records exactly what the candidates and the benchmark render", async () => {
    const measured = await measure();
    // Explicit local regeneration only; the committed record must equal a fresh measurement.
    if (process.env.UPDATE_FOUNDRY_CRAFT === "1") writeFileSync(recordPath, stableStringify(measured));
    expect(JSON.parse(readFileSync(recordPath, "utf8"))).toEqual(measured);
    expect(Object.keys(measured.slots).sort()).toEqual([...CRAFT_COMPARED_LEAVES]);
    expect(measured.benchmark.focus).toHaveLength(2);
    expect(measured.benchmark.disabled).toHaveLength(1);
    expect(measured.benchmark.target).toHaveLength(2);
  });

  it("lifts K5 only where the fresh measurement matches the benchmark", async () => {
    const measured = await measure();
    expect(craftFindings("toolbar", measured)).toEqual([]);
    expect(craftFindings("tree", measured)).toEqual(EXPECTED_FINDINGS.tree);
    expect(craftFindings("tag-group", measured)).toEqual(EXPECTED_FINDINGS["tag-group"]);
  });

  it("derives the offer blockers from the committed record, so the catalog follows the measurement", () => {
    const blocked = Object.fromEntries(importFoundryComponents().fills.map(doc => [Object.keys(doc.components)[0]!, Object.values(doc.components)[0]!.blockers ?? []]));
    for (const leaf of CRAFT_COMPARED_LEAVES) expect(blocked[leaf], leaf).toEqual(craftBlockers(leaf) ?? []);
    expect(blocked.toolbar).toEqual([]);
    expect(blocked.tree!.map(blocker => blocker.code)).toEqual(EXPECTED_FINDINGS.tree.length ? ["K5"] : []);
    expect(blocked["tag-group"]!.map(blocker => blocker.code)).toEqual(EXPECTED_FINDINGS["tag-group"].length ? ["K5"] : []);
  });
});

describe("craft comparison rule", () => {
  const benchmark = { focus: ["ring", "outline solid"], disabled: ["0.5"], target: ["44px"] };
  const good: CraftPart = { scenario: "s", part: "row", keyboard: true, pressable: true, inDisabledState: false, focus: "ring", disabled: null, target: "44px", forcedColors: true, literalPaint: [], spacing: ["gap-sm", "px-md"] };
  const comparison = (change: Partial<CraftPart>, scenarios = ["s"]): CraftComparison => ({ benchmark, slots: { toolbar: { scenarios, parts: [{ ...good, ...change }] } } });
  it("accepts a part matching the benchmark", () => expect(craftFindings("toolbar", comparison({}))).toEqual([]));
  it.each([
    ["focus absent", { focus: null }, "focus-visible indicator absent"],
    ["focus off-benchmark", { focus: "focus-visible:underline" }, "focus-visible indicator focus-visible:underline differs"],
    ["disabled absent", { inDisabledState: true, keyboard: false, disabled: null }, "disabled treatment absent"],
    ["disabled off-benchmark", { inDisabledState: true, keyboard: false, disabled: "0.3" }, "disabled treatment 0.3 differs"],
    ["target absent", { target: null }, "target floor absent"],
    ["forced colours absent", { forcedColors: false }, "no forced-colours focus treatment"],
    ["literal paint", { literalPaint: ["color: #fff"] }, "literal paint color: #fff"],
    ["off-scale density", { spacing: ["gap-[7px]"] }, "spacing gap-[7px] is off the spacing scale"],
  ] as const)("rejects %s", (_name, change, message) => {
    expect(craftFindings("toolbar", comparison(change)).join("; ")).toContain(message);
    expect(craftBlockers("toolbar", comparison(change))).toEqual([expect.objectContaining({ code: "K5" })]);
  });
  it("rejects an unmeasured scenario or leaf", () => {
    expect(craftFindings("toolbar", comparison({}, ["s", "orientation=vertical"]))).toEqual(["toolbar: scenario orientation=vertical was not measured"]);
    expect(craftFindings("tree", comparison({}))).toEqual(["tree: no measured craft comparison"]);
  });
});

/** The measured deficits that keep these offers blocked; a component fix changes the measurement, not this rule. */
const EXPECTED_FINDINGS: Record<"tree" | "tag-group", string[]> = {
  // Tree.tsx: the chevron carries control-h-md (vf30), so selection-mode rows keep a benchmark expand target.
  tree: [],
  // TagGroup.tsx: tags and the remove button carry control-h-md; remove renders the Button focus outline (vf30).
  "tag-group": [],
};
