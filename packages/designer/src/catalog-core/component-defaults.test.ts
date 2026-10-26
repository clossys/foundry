/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { loadCatalogBundles } from "../catalog-bundles.js";
import { loadCatalog } from "./index.js";
import { applyLibraryChange, libraryHash, resolve } from "./api.js";
import { emittedTokenProperties } from "./emit.js";
import { loadComponentRegistry } from "./component-registry.js";
import { loadComponentCompositionRules } from "./component-compositions.js";
import { planComponentDefaults, type ComponentDefaultsInput } from "./component-defaults.js";
import { isLibraryDecisions } from "./library-decisions.js";
import { applyDecisions } from "../library-cli/apply-decisions.js";
import { componentOf, resolveComponents } from "./resolve-components.js";
import type { CompositeCatalogData, CompositeLibraryData, LibraryData } from "./types.js";

const PREFERENCE = ["shadcn@aria", "foundry", "rac-starter"];
/** C8–C11 owner picks; C12 is a binding inside the selected fills, not a pick. */
const PICKS = { "components.button": "foundry", "components.table": "foundry", "components.tooltip": "shadcn@aria", "components.card": "shadcn@aria" };
/** Planner decision DF1-1: these leaves take the whole Foundry component where the preferred candidates are ineligible. */
const FALLBACK = { source: "foundry", slots: ["checkbox", "dialog", "popover", "tabs", "toggle-button", "disclosure", "select", "chart-sparkline", "color-picker",
  "number-field", "tag-group", "tree", "calendar", "menu", "table", "card"].map(leaf => `components.${leaf}`) };

/** Value-source order for the test consumer: Foundry first, then the generic open-contract fills. */
const VALUE_ORDER = ["foundry", "tailwind-default"];
/** A real consumer: every token leaf and icon glyph adopts its first offer in `order`, else its first offer. */
function consumer(order: readonly string[] = VALUE_ORDER) {
  const values = loadCatalog();
  const offers = (slot: string) => values.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === slot && doc.$extensions["com.clossys.fill"].mode !== "reference").map(doc => doc.$extensions["com.clossys.fill"].source);
  const changes = values.slots.filter(slot => slot.layer === "tokens" || slot.id.startsWith("assets.icon-")).flatMap(slot => {
    const sources = offers(slot.id);
    const source = order.find(name => sources.includes(name)) ?? sources[0];
    return source ? [{ op: "adopt" as const, slot: slot.id, source }] : [];
  });
  let library: LibraryData = { source: { kind: "consumer", author: "consumer", id: "defaults-consumer" } as LibraryData["source"], fills: [], adoptedAt: "2026-10-26" };
  library = applyLibraryChange(values, library, { baseHash: libraryHash(library), changes });
  const profile = resolve({ catalog: values, library });
  const literal = (id: string, mode: "light" | "dark"): string => {
    let member = profile.members[id]!;
    while (member.alias[mode] ?? member.alias.light) member = profile.members[(member.alias[mode] ?? member.alias.light)!]!;
    return member.css[mode] ?? member.css.light;
  };
  const tokens = Object.fromEntries([...emittedTokenProperties(profile)].map(([id, output]) => [id, { property: output.property, light: literal(id, "light"), ...(profile.members[id]!.value.dark === undefined ? {} : { dark: literal(id, "dark") }) }]));
  const assets = [...new Set(Object.values(profile.members).filter(member => member.slot.startsWith("assets.")).map(member => member.slot))].sort();
  return { values, library, tokens, assets };
}

function setup(overrides: Partial<ComponentDefaultsInput> = {}, order?: readonly string[]) {
  const bundles = loadCatalogBundles();
  const registry = loadComponentRegistry();
  const { values, library, tokens, assets } = consumer(order);
  const catalog = { slots: registry.slots, fills: bundles.componentFills, rules: loadComponentCompositionRules() };
  const input: ComponentDefaultsInput = {
    catalog, slots: registry.slots.map(slot => slot.id), tokens, assets,
    installedRac: { version: "1.0.0", instance: "react-aria-components" }, bundles: bundles.sourceBundles,
    preference: PREFERENCE, picks: PICKS, fallback: FALLBACK, ...overrides,
  };
  return { input, bundles, values, library };
}
const ledger = (rows: ReturnType<typeof planComponentDefaults>["rows"]) => Object.fromEntries(rows.map(row => [row.slot.slice(11), row.status === "not-chosen" ? "-" : row.source ?? row.rule!]));

const EXPECTED_DEFAULTS = {
  avatar: "shadcn@aria", badge: "foundry", banner: "foundry", breadcrumbs: "shadcn@aria", button: "foundry", card: "foundry",
  "chart-area": "foundry", "chart-bar": "foundry", "chart-heatmap": "foundry", "chart-line": "foundry", "chart-range": "foundry",
  "chart-scatter": "foundry", "chart-status-strip": "foundry", "chart-waterfall": "foundry", checkbox: "foundry", "combo-box": "foundry",
  "date-field": "foundry", disclosure: "foundry", field: "foundry", "grid-list": "foundry", "file-trigger": "foundry", form: "foundry", icon: "foundry", keyboard: "shadcn@aria", link: "foundry", logo: "foundry",
  meter: "foundry", "native-action": "foundry", "navigation-tree": "foundry", "progress-bar": "foundry", "radio-group": "foundry",
  "resize-handle": "foundry", "search-field": "foundry", "semantic-content": "foundry", separator: "shadcn@aria", skeleton: "foundry",
  spinner: "foundry", "status-mark": "foundry", switch: "foundry", "text-field": "foundry", toast: "foundry", toolbar: "rac-starter",
  tooltip: "shadcn@aria",
};
const NOT_CHOSEN = ["calendar", "chart-sparkline", "color-picker", "date-picker", "dialog", "menu",
  "number-field", "popover", "select", "slider", "table", "tabs", "tag-group", "toggle-button", "toggle-group", "tree"];
const reasons = (plan: ReturnType<typeof planComponentDefaults>, leaf: string) => plan.rows.find(row => row.slot === `components.${leaf}`)!.reasons.join(" || ");

describe("component default fills", () => {
  it("defaults every eligible leaf by preference and owner pick, with a statically clean whole set", () => {
    const { input } = setup();
    const plan = planComponentDefaults(input);
    expect(plan.rows.map(row => row.slot)).toEqual(input.slots);
    expect(ledger(plan.rows)).toEqual({ ...EXPECTED_DEFAULTS, ...Object.fromEntries(NOT_CHOSEN.map(leaf => [leaf, "-"])) });
    expect(plan.findings).toEqual([]);
    expect(plan.rows.find(row => row.slot === "components.button")).toMatchObject({ status: "default", basis: "owner-pick", source: "foundry", fill: "foundry/components.button" });
    expect(plan.rows.find(row => row.slot === "components.avatar")).toMatchObject({ status: "default", basis: "preference" });
  });
  it("keeps every unchosen leaf visible with its precise reason, never a fallback", () => {
    const { input } = setup();
    const plan = planComponentDefaults(input);
    for (const leaf of NOT_CHOSEN) {
      const row = plan.rows.find(candidate => candidate.slot === `components.${leaf}`)!;
      expect(row.status, leaf).toBe("not-chosen");
      expect(row.source ?? row.rule, leaf).toBeUndefined();
      expect(row.reasons.length, leaf).toBeGreaterThan(0);
    }
    expect(reasons(plan, "table")).toContain("foundry: K1 Required member resize-columns is not mapped");
    expect(reasons(plan, "table")).toContain("owner pick foundry is not eligible");
    expect(reasons(plan, "slider")).toBe("controls coherence: one source per group, led by foundry; shadcn@aria would mix sources");
    expect(reasons(plan, "date-picker")).toContain("compose:date-picker@1: inputs not chosen components.calendar,components.popover");
    expect(reasons(plan, "tree")).toBe("foundry: blocked K5 || rac-starter: blocked K4");
  });
  it("emits decisions the existing apply path adopts, and the adopted graph resolves as a closed executable set", () => {
    const { input, values, bundles } = setup();
    const plan = planComponentDefaults(input);
    expect(isLibraryDecisions(plan.decisions)).toBe(true);
    expect(plan.decisions).toHaveLength(Object.keys(EXPECTED_DEFAULTS).length);
    const catalog: CompositeCatalogData = { values, components: input.catalog };
    const source = { kind: "consumer", author: "consumer", id: "defaults-consumer" } as CompositeLibraryData["source"];
    const empty: CompositeLibraryData = { source, adoptedAt: "2026-10-26", values: { fills: [] }, components: { fills: [], files: [] } };
    const adopted = applyDecisions(catalog, empty, plan.decisions, { bundles: bundles.sourceBundles });
    expect(adopted.components.fills.map(doc => componentOf(doc).slot).sort()).toEqual(plan.decisions.map(row => row.slot).sort());
    const seen = new Set<string>();
    for (const row of plan.decisions) {
      const fill = componentOf(input.catalog.fills.find(doc => doc.$extensions["com.clossys.fill"].id === (row as { fill: string }).fill)!);
      expect([...fill.composes, ...fill.reads.components].filter(id => !seen.has(id)), row.slot).toEqual([]);
      seen.add(row.slot);
    }
    const profile = resolveComponents({ catalog: input.catalog, library: { ...adopted.components, source, adoptedAt: "2026-10-26" }, values: { tokens: input.tokens, assets: input.assets }, evidence: { observations: {}, installedRac: input.installedRac } });
    expect(profile.check.findings.filter(finding => !finding.message.endsWith("Source and runtime observations are unavailable"))).toEqual([]);
  });
  it("fills the group-scope leaves from Foundry once Checkbox.Group and Disclosure.Group are mapped, and grid-list follows checkbox", () => {
    const { input } = setup();
    const plan = planComponentDefaults(input);
    for (const leaf of ["checkbox", "disclosure", "grid-list"]) {
      expect(plan.rows.find(row => row.slot === `components.${leaf}`), leaf).toMatchObject({ status: "default", basis: "preference", source: "foundry", fill: `foundry/components.${leaf}` });
    }
    const order = plan.decisions.map(row => row.slot);
    expect(order.indexOf("components.checkbox")).toBeLessThan(order.indexOf("components.grid-list"));
    expect(plan.findings).toEqual([]);
  });
  it("fills a listed leaf from the fallback source when its owner pick is ineligible, keeping why", () => {
    const { input } = setup();
    const plan = planComponentDefaults(input);
    expect(plan.rows.find(row => row.slot === "components.card")).toMatchObject({ status: "default", basis: "fallback", source: "foundry", fill: "foundry/components.card" });
    expect(reasons(plan, "card")).toMatch(/^shadcn@aria: .*K1 Required member variant\.raised is not mapped/);
    expect(reasons(plan, "card")).not.toContain("owner pick");
    expect(plan.decisions.find(row => row.slot === "components.card")).toMatchObject({ kind: "adopt", source: "foundry", note: "Default fill (fallback)" });
  });
  it("the fallback never bypasses the checker: a listed leaf whose Foundry candidate fails keeps the exact finding", () => {
    const { input } = setup();
    const plan = planComponentDefaults(input);
    expect(reasons(plan, "table")).toContain("foundry: K1 Required member resize-columns is not mapped");
    expect(reasons(plan, "tree")).toContain("foundry: blocked K5");
    expect(reasons(plan, "calendar")).toContain("foundry: no implementation candidate");
    expect(reasons(plan, "toggle-button")).toContain("foundry: no implementation candidate");
  });
  it("the fallback is scoped to its listed leaves", () => {
    const { input } = setup({ fallback: { source: "foundry", slots: FALLBACK.slots.filter(slot => slot !== "components.card") } });
    const plan = planComponentDefaults(input);
    expect(plan.rows.find(row => row.slot === "components.card")).toMatchObject({ status: "not-chosen" });
    expect(reasons(plan, "card")).toContain("owner pick shadcn@aria is not eligible");
    expect(reasons(plan, "card")).not.toContain("foundry:");
  });
  it("a choice stays exclusive on a fallback leaf", () => {
    const { input } = setup({ choices: { "components.card": "shadcn@aria" } });
    const plan = planComponentDefaults(input);
    expect(plan.rows.find(row => row.slot === "components.card")).toMatchObject({ status: "not-chosen" });
    expect(reasons(plan, "card")).not.toContain("foundry:");
  });
  it("the fallback also follows a preference that does not list its source", () => {
    const { input } = setup({ preference: ["shadcn@aria"], picks: {} });
    const plan = planComponentDefaults(input);
    expect(plan.rows.find(row => row.slot === "components.card")).toMatchObject({ status: "default", basis: "fallback", source: "foundry" });
    expect(plan.rows.find(row => row.slot === "components.badge")).toMatchObject({ status: "not-chosen" });
    expect(plan.findings).toEqual([]);
  });
  it("Choose overrides the owner pick and preference, exclusively", () => {
    const { input } = setup({ choices: { "components.table": "foundry", "components.avatar": "foundry", "components.card": "foundry" } });
    const plan = planComponentDefaults(input);
    expect(plan.rows.find(row => row.slot === "components.card")).toMatchObject({ status: "chosen", basis: "choose", source: "foundry" });
    expect(plan.rows.find(row => row.slot === "components.table")).toMatchObject({ status: "not-chosen" });
    expect(reasons(plan, "table")).not.toContain("owner pick");
    expect(plan.findings).toEqual([]);
  });
  it("a choice inside a coherence group leads the group", () => {
    const { input } = setup({ choices: { "components.slider": "shadcn@aria" } });
    const plan = planComponentDefaults(input);
    expect(plan.rows.find(row => row.slot === "components.slider")).toMatchObject({ status: "chosen", source: "shadcn@aria" });
    expect(reasons(plan, "field")).toBe("controls coherence: one source per group, led by shadcn@aria; foundry would mix sources");
    expect(plan.findings).toEqual([]);
  });
  it("without a pick the same leaf falls to preference; a source without a verified bundle is never defaulted", () => {
    const { input } = setup({ picks: {} });
    expect(planComponentDefaults(input).rows.find(row => row.slot === "components.card")).toMatchObject({ status: "default", basis: "preference", source: "foundry" });
    const unbundled = planComponentDefaults({ ...input, bundles: [] });
    expect(unbundled.rows.find(row => row.slot === "components.avatar")).toMatchObject({ status: "default", source: "foundry" });
    expect(reasons(unbundled, "keyboard")).toContain("shadcn@aria: no verified source bundle");
    expect(unbundled.findings).toEqual([]);
  });
  it("eligibility follows the consumer's own values: an unresolved token read keeps the owner pick unchosen", () => {
    const { input } = setup({}, ["foundry", "shadcn@aria"]);
    const plan = planComponentDefaults(input);
    expect(plan.rows.find(row => row.slot === "components.tooltip")).toMatchObject({ status: "not-chosen" });
    expect(reasons(plan, "tooltip")).toMatch(/^shadcn@aria: .*K3 Token read tokens\.radius\.subtle does not resolve.* \|\| owner pick shadcn@aria is not eligible/);
    expect(plan.findings).toEqual([]);
  });
});
