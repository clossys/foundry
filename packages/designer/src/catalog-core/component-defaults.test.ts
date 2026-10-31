/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { loadCatalogBundles, installedHeadlessLibrary } from "../catalog-bundles.js";
import { loadCatalog } from "./index.js";
import { applyLibraryChange, libraryHash, resolve } from "./api.js";
import { emittedTokenProperties } from "./emit.js";
import { loadComponentRegistry } from "./component-registry.js";
import { loadComponentCompositionRules } from "./component-compositions.js";
import { planComponentDefaults, DEFAULT_COMPONENT_PREFERENCE, DEFAULT_COMPONENT_PICKS, DEFAULT_COMPONENT_FALLBACK, type ComponentDefaultsInput } from "./component-defaults.js";
import { isLibraryDecisions } from "./library-decisions.js";
import { applyDecisions } from "../library-cli/apply-decisions.js";
import { componentDescriptorHash, componentOf, resolveComponents } from "./resolve-components.js";
import type { CompositeCatalogData, CompositeLibraryData, LibraryData } from "./types.js";

const PREFERENCE = DEFAULT_COMPONENT_PREFERENCE;
const PICKS = DEFAULT_COMPONENT_PICKS;
const FALLBACK = DEFAULT_COMPONENT_FALLBACK;

/** Value-source order for the test consumer: Foundry first, then the generic open-contract fills. */
const VALUE_ORDER = ["foundry", "tailwind-default"];
/** A real consumer: every token leaf and icon glyph adopts its first offer in `order`, else its first offer. */
function consumer(order: readonly string[] = VALUE_ORDER) {
  const values = loadCatalog();
  const offers = (slot: string) => values.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === slot && doc.$extensions["com.clossys.fill"].mode !== "reference").map(doc => doc.$extensions["com.clossys.fill"].source);
  const changes = values.slots.filter(slot => slot.layer === "themes" || slot.id.startsWith("assets.icon-")).flatMap(slot => {
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
/** Synthetic unresolved read: production Card is eligible, while fallback refusal remains exercised. */
function ineligibleCard(overrides: Partial<ComponentDefaultsInput> = {}) {
  const result = setup(overrides);
  const target = result.input.catalog.fills.find(doc => doc.$extensions["com.clossys.fill"].id === "shadcn@aria/components.card")!;
  const fill = componentOf(target);
  const unavailable = { ...target, components: { card: { ...fill, reads: { ...fill.reads, themes: fill.reads.themes.map(id => id === "themes.radius.default" ? "themes.radius.subtle" : id) } } } } as typeof target;
  result.input.catalog = { ...result.input.catalog, fills: result.input.catalog.fills.map(doc => doc === target ? unavailable : doc) };
  result.input.bundles = result.input.bundles.map(bundle => bundle.slot === fill.slot && bundle.descriptorHash === componentDescriptorHash(fill)
    ? { ...bundle, descriptorHash: componentDescriptorHash(componentOf(unavailable)) } : bundle);
  return result;
}

const ledger = (rows: ReturnType<typeof planComponentDefaults>["rows"]) => Object.fromEntries(rows.map(row => [row.slot.slice(11), row.status === "not-chosen" ? "-" : row.source ?? row.rule!]));

const EXPECTED_DEFAULTS = {
  sidebar: "shadcn@aria", command: "shadcn@aria", sheet: "shadcn@aria", empty: "shadcn@aria", item: "shadcn@aria", "scroll-area": "shadcn@aria", "dropdown-menu": "shadcn@aria",
  avatar: "shadcn@aria", badge: "shadcn@aria", banner: "shadcn@aria", breadcrumbs: "shadcn@aria", button: "shadcn@aria", calendar: "shadcn@aria", card: "shadcn@aria",
  "chart-area": "foundry", "chart-bar": "foundry", "chart-heatmap": "foundry", "chart-line": "foundry", "chart-range": "foundry",
  "chart-scatter": "foundry", "chart-sparkline": "foundry", "chart-status-strip": "foundry", "chart-waterfall": "foundry", checkbox: "shadcn@aria", "color-picker": "foundry", "combo-box": "shadcn@aria",
  "date-field": "foundry", "date-picker": "compose:date-picker@1", dialog: "shadcn@aria", disclosure: "shadcn@aria", field: "foundry", "grid-list": "foundry", "file-trigger": "compose:file-trigger@1", form: "foundry", icon: "foundry", keyboard: "shadcn@aria", link: "foundry", logo: "foundry",
  menu: "shadcn@aria", meter: "foundry", "native-action": "foundry", "navigation-tree": "foundry", "number-field": "foundry", popover: "shadcn@aria", "progress-bar": "shadcn@aria", "radio-group": "shadcn@aria",
  "resize-handle": "foundry", "search-field": "foundry", select: "shadcn@aria", "semantic-content": "foundry", separator: "shadcn@aria", skeleton: "shadcn@aria", slider: "shadcn@aria",
  spinner: "foundry", "status-mark": "foundry", switch: "shadcn@aria", table: "shadcn@aria", tabs: "shadcn@aria", "tag-group": "foundry", "text-field": "foundry", toast: "foundry", "toggle-button": "shadcn@aria", "toggle-group": "shadcn@aria",
  toolbar: "foundry", tooltip: "shadcn@aria", tree: "foundry",
};
/** rac-starter is not a selectable component source (owner rule 2026-10-26); Toolbar, TagGroup and Tree are Foundry's since their measured K5 craft comparison passes. */
const NOT_CHOSEN: string[] = [];
const reasons = (plan: ReturnType<typeof planComponentDefaults>, leaf: string) => plan.rows.find(row => row.slot === `components.${leaf}`)!.reasons.join(" || ");

describe("component default fills", () => {
  it('selects the honest Custom SemanticContent default without inventing an upstream item',()=>{
    const {input,bundles}=setup({slots:['components.semantic-content'],preference:['shadcn@aria','foundry'],installedRac:installedHeadlessLibrary()});
    const plan=planComponentDefaults(input);
    expect(plan.rows).toEqual([expect.objectContaining({slot:'components.semantic-content',status:'default',source:'foundry',fill:'foundry/components.semantic-content'})]);
    const fill=bundles.componentFills.find(doc=>doc.$extensions['com.clossys.fill'].slot==='components.semantic-content')!;
    expect(fill.$extensions).toHaveProperty(['com.clossys.default'],{tier:'Custom',reason:'no shadcn@aria item'});
  });
  it("defaults every eligible leaf by preference and owner pick, with a statically clean whole set", () => {
    const { input } = setup();
    const plan = planComponentDefaults(input);
    expect(plan.rows.map(row => row.slot)).toEqual(input.slots);
    expect(ledger(plan.rows)).toEqual({ ...EXPECTED_DEFAULTS, ...Object.fromEntries(NOT_CHOSEN.map(leaf => [leaf, "-"])) });
    expect(plan.findings).toEqual([]);
    expect(plan.rows.find(row => row.slot === "components.button")).toMatchObject({ status: "default", basis: "owner-pick", source: "shadcn@aria", fill: "shadcn@aria/components.button" });
    expect(plan.rows.find(row => row.slot === "components.avatar")).toMatchObject({ status: "default", basis: "preference" });
  });
  it("selects consumed button, table, card and menu with their faithful registered typography reads", () => {
    const { input } = setup();
    const plan = planComponentDefaults(input);
    for (const leaf of ["button", "table", "card", "menu"]) {
      expect(plan.rows.find(row => row.slot === `components.${leaf}`), leaf).toMatchObject({ status: "default", source: "shadcn@aria", fill: `shadcn@aria/components.${leaf}`, reasons: [] });
    }
    for (const [leaf, member] of [["card", "themes.card.default"], ["menu", "themes.tracking-tight.default"]]) {
      const fill = componentOf(input.catalog.fills.find(doc => doc.$extensions["com.clossys.fill"].id === `shadcn@aria/components.${leaf}`)!);
      expect(fill.reads.themes).toContain(member);
      expect(input.tokens[member]).toBeDefined();
    }
    expect(plan.findings).toEqual([]);
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
    // The consumed table follows the approved shadcn owner pick with its complete public API.
    expect(plan.rows.find(row => row.slot === "components.table")).toMatchObject({ status: "default", basis: "owner-pick", source: "shadcn@aria", fill: "shadcn@aria/components.table", reasons: [] });
    // With K11 at 0 a mixed controls group is coherent, so the slider takes the preferred shadcn@aria fill.
    expect(plan.rows.find(row => row.slot === "components.slider")).toMatchObject({ status: "default", source: "shadcn@aria", fill: "shadcn@aria/components.slider" });
    expect(plan.rows.find(row => row.slot === "components.date-picker")).toMatchObject({ status: "default", basis: "rule", rule: "compose:date-picker@1", reasons: [] });
    for (const leaf of ["tag-group", "tree"]) expect(plan.rows.find(row => row.slot === `components.${leaf}`), leaf).toMatchObject({ status: "default", basis: "preference", source: "foundry", fill: `foundry/components.${leaf}`, reasons: [] });
    expect(plan.rows.find(row => row.slot === "components.toolbar")).toMatchObject({ status: "default", basis: "preference", source: "foundry", fill: "foundry/components.toolbar", reasons: [] });
  });
  it("never offers or defaults a rac-starter fill, whether preferred, owner-picked or chosen (real catalog)", () => {
    const { input } = setup();
    const starterSlots = input.catalog.fills.filter(doc => doc.$extensions["com.clossys.fill"].source === "rac-starter").map(doc => doc.$extensions["com.clossys.fill"].slot);
    expect(starterSlots.length).toBeGreaterThan(0);
    const plan = planComponentDefaults(input);
    expect(plan.rows.filter(row => row.source === "rac-starter")).toEqual([]);
    // 52 after vf15 (toolbar unchosen) + toggle-group (vf19) + color-picker and number-field (vf22) + toolbar (vf21) + slider (vf23) + tag-group and tree (vf30) = 59.
    expect(plan.rows.filter(row => row.status !== "not-chosen")).toHaveLength(66);
    expect(plan.rows).toHaveLength(66);
    const forced = Object.fromEntries(starterSlots.map(slot => [slot, "rac-starter"]));
    for (const plan of [planComponentDefaults({ ...input, picks: forced }), planComponentDefaults({ ...input, choices: forced })]) {
      for (const slot of starterSlots) {
        const row = plan.rows.find(candidate => candidate.slot === slot)!;
        expect(row.source, slot).not.toBe("rac-starter");
        expect(row.reasons.join(" || "), slot).toContain("rac-starter: not a selectable component source");
      }
      expect(plan.decisions.filter(row => row.kind === "adopt" && row.source === "rac-starter")).toEqual([]);
    }
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
      // A registered composition (date-picker) is adopted by rule and reads its inputs directly; a fill reads its own graph.
      const reads = row.kind === "compose" ? row.reads : (() => {
        const fill = componentOf(input.catalog.fills.find(doc => doc.$extensions["com.clossys.fill"].id === (row as { fill: string }).fill)!);
        return [...fill.composes, ...fill.reads.components];
      })();
      expect(reads.filter(id => !seen.has(id)), row.slot).toEqual([]);
      seen.add(row.slot);
    }
    const profile = resolveComponents({ catalog: input.catalog, library: { ...adopted.components, source, adoptedAt: "2026-10-26" }, values: { tokens: input.tokens, assets: input.assets }, evidence: { observations: {}, installedRac: input.installedRac } });
    expect(profile.check.findings.filter(finding => !finding.message.endsWith("Source and runtime observations are unavailable"))).toEqual([]);
    // The chosen set's whole-graph check: no K11 beyond the pending observations notice.
    expect(profile.check.findings.filter(finding => finding.code === "K11" && (finding.severity === "error" || !finding.message.endsWith("Source and runtime observations are unavailable")))).toEqual([]);
  });
  it("fills the group-scope leaves (checkbox from Foundry in the controls group, disclosure from shadcn@aria, which holds its seat), and grid-list follows checkbox", () => {
    const { input } = setup();
    const plan = planComponentDefaults(input);
    expect(plan.rows.find(row => row.slot === "components.disclosure")).toMatchObject({ status: "default", basis: "preference", source: "shadcn@aria", fill: "shadcn@aria/components.disclosure" });
    expect(plan.rows.find(row => row.slot === "components.checkbox")).toMatchObject({ status: "default", basis: "preference", source: "shadcn@aria", fill: "shadcn@aria/components.checkbox" });
    expect(plan.rows.find(row => row.slot === "components.grid-list")).toMatchObject({ status: "default", basis: "preference", source: "foundry", fill: "foundry/components.grid-list" });
    const order = plan.decisions.map(row => row.slot);
    expect(order.indexOf("components.checkbox")).toBeLessThan(order.indexOf("components.grid-list"));
    expect(plan.findings).toEqual([]);
  });
  it("fills tabs from shadcn@aria (its seat, no Foundry-only size members) and select from Foundry by preference, keeping the controls group coherent", () => {
    const { input } = setup();
    const plan = planComponentDefaults(input);
    expect(plan.rows.find(row => row.slot === "components.tabs")).toMatchObject({ status: "default", basis: "preference", source: "shadcn@aria", fill: "shadcn@aria/components.tabs", reasons: [] });
    expect(plan.rows.find(row => row.slot === "components.select")).toMatchObject({ status: "default", basis: "preference", source: "shadcn@aria", fill: "shadcn@aria/components.select", reasons: [] });
    expect(plan.findings).toEqual([]);
  });
  it("fills a listed leaf from the fallback source when its owner pick is ineligible, keeping why", () => {
    const { input } = ineligibleCard();
    const plan = planComponentDefaults(input);
    expect(plan.rows.find(row => row.slot === "components.card")).toMatchObject({ status: "default", basis: "fallback", source: "foundry", fill: "foundry/components.card" });
    expect(reasons(plan, "card")).toMatch(/^shadcn@aria: .*K3 Token read themes\.radius\.subtle/);
    expect(reasons(plan, "card")).not.toContain("owner pick");
    expect(plan.decisions.find(row => row.slot === "components.card")).toMatchObject({ kind: "adopt", source: "foundry", note: "Default fill (fallback)" });
  });
  it("the fallback never bypasses the checker: a listed leaf whose Foundry candidate is blocked keeps the exact finding", () => {
    const { input } = ineligibleCard();
    /** Injects an offer blocker into the Foundry candidate of one leaf, re-hashing its bundle so only the blocker can exclude it. */
    const blocked = (leaf: string, code: string) => {
      const target = input.catalog.fills.find(doc => doc.$extensions["com.clossys.fill"].id === `foundry/components.${leaf}`)!;
      const [key, fill] = Object.entries(target.components)[0]!;
      const withBlocker = { ...target, components: { [key]: { ...fill, blockers: [{ code, message: `synthetic ${code}` }] } } } as typeof target;
      const bundle = input.bundles.find(row => row.slot === `components.${leaf}`);
      const bundles = bundle ? [...input.bundles.filter(row => row !== bundle), { ...bundle, descriptorHash: componentDescriptorHash(componentOf(withBlocker)) }] : input.bundles;
      return planComponentDefaults({ ...input, catalog: { ...input.catalog, fills: input.catalog.fills.map(doc => doc === target ? withBlocker : doc) }, bundles });
    };
    const clean = planComponentDefaults(input);
    // A real, unblocked Foundry candidate is chosen on a fallback leaf (number-field) and on a preference leaf (calendar).
    expect(clean.rows.find(row => row.slot === "components.number-field")).toMatchObject({ status: "default", source: "foundry" });
    expect(reasons(clean, "number-field")).not.toContain("blocked");
    // The same leaf with a synthetic K11 blocker stays unchosen: listing it as a fallback leaf does not lift the finding.
    const k11 = blocked("number-field", "K11");
    expect(k11.rows.find(row => row.slot === "components.number-field")).toMatchObject({ status: "not-chosen" });
    expect(reasons(k11, "number-field")).toContain("foundry: blocked K11");
    expect(k11.decisions.some(row => row.slot === "components.number-field")).toBe(false);
    // A different offer blocker on a leaf chosen only through the fallback (card) behaves the same way, and other leaves are untouched.
    const k5 = blocked("card", "K5");
    expect(k5.rows.find(row => row.slot === "components.card")).toMatchObject({ status: "not-chosen" });
    expect(reasons(k5, "card")).toContain("foundry: blocked K5");
    expect(k5.rows.find(row => row.slot === "components.calendar")).toMatchObject({ status: "default", basis: "preference", source: "shadcn@aria", fill: "shadcn@aria/components.calendar" });
    expect(k5.rows.find(row => row.slot === "components.toggle-button")).toMatchObject({ status: "default", basis: "preference", source: "shadcn@aria", fill: "shadcn@aria/components.toggle-button" });
  });
  it("fills the Foundry candidates whose members are now implemented, under the unchanged checker", () => {
    const { input } = setup();
    const plan = planComponentDefaults(input);
    const row = (leaf: string) => plan.rows.find(candidate => candidate.slot === `components.${leaf}`)!;
    expect(row("popover")).toMatchObject({ status: "default", source: "shadcn@aria", fill: "shadcn@aria/components.popover" });
    expect(row("dialog")).toMatchObject({ status: "default", source: "shadcn@aria", fill: "shadcn@aria/components.dialog" });
    expect(reasons(plan, "table")).not.toContain("K1");
    expect(row("menu")).toMatchObject({ status: "default", source: "shadcn@aria", fill: "shadcn@aria/components.menu", reasons: [] });
    expect(row("chart-sparkline")).toMatchObject({ status: "default", source: "foundry", fill: "foundry/components.chart-sparkline" });
    expect(row("date-picker")).toMatchObject({ status: "default", basis: "rule", rule: "compose:date-picker@1" });
  });
  it("seats the composed shadcn@aria file-trigger by preference and by choice, ahead of the Foundry fill", () => {
    const { input } = setup();
    const rule = input.catalog.rules!.find(candidate => candidate.slot === "components.file-trigger")!;
    expect(rule).toMatchObject({ id: "compose:file-trigger@1", kind: "compose", inputs: ["components.button"] });
    expect(rule.template.source).toBe("shadcn@aria");
    const plan = planComponentDefaults(input);
    expect(plan.rows.find(row => row.slot === "components.file-trigger")).toMatchObject({ status: "default", basis: "rule", rule: "compose:file-trigger@1", reasons: [] });
    expect(plan.findings.filter(finding => finding.subject === "components.file-trigger")).toEqual([]);
    const chosen = planComponentDefaults({ ...input, choices: { "components.file-trigger": "shadcn@aria" } });
    expect(chosen.rows.find(row => row.slot === "components.file-trigger")).toMatchObject({ basis: "rule", rule: "compose:file-trigger@1" });
    const foundry = planComponentDefaults({ ...input, choices: { "components.file-trigger": "foundry" } });
    expect(foundry.rows.find(row => row.slot === "components.file-trigger")).toMatchObject({ source: "foundry", fill: "foundry/components.file-trigger" });
  });
  it("sets aside only the pin-provenance K8 on a registered composition, never another finding or another slot", () => {
    const { input } = setup();
    const plan = planComponentDefaults(input);
    expect(plan.rows.find(row => row.slot === "components.date-picker")).toMatchObject({ status: "default", basis: "rule" });
    expect(plan.findings.filter(finding => finding.subject === "components.date-picker")).toEqual([]);
    // Any other finding on the composed template is still reported.
    const rules = input.catalog.rules!.map(rule => rule.slot === "components.date-picker" ? { ...rule, template: { ...rule.template, license: "UNLICENSED" } } : rule);
    const unlicensed = planComponentDefaults({ ...input, catalog: { ...input.catalog, rules } });
    expect(unlicensed.findings).toContainEqual(expect.objectContaining({ code: "K8", subject: "components.date-picker", message: "Fill and every dependency require an allowed SPDX licence" }));
    // A non-composed source fill without its pin still fails K8, even with a matching bundle.
    const avatar = input.catalog.fills.find(doc => doc.$extensions["com.clossys.fill"].id === "shadcn@aria/components.avatar")!;
    const [key, fill] = Object.entries(avatar.components)[0]!;
    const unpinned = { ...avatar, components: { [key]: { ...fill, pin: { ...fill.pin, commit: undefined } } } } as typeof avatar;
    const fills = input.catalog.fills.map(doc => doc === avatar ? unpinned : doc);
    const bundle = input.bundles.find(row => row.slot === "components.avatar")!;
    const bundles = [...input.bundles.filter(row => row !== bundle), { ...bundle, descriptorHash: componentDescriptorHash(componentOf(unpinned)) }];
    const pinless = planComponentDefaults({ ...input, catalog: { ...input.catalog, fills }, bundles, preference: ["shadcn@aria"], picks: {}, fallback: undefined });
    expect(pinless.rows.find(row => row.slot === "components.avatar")!.status).toBe("not-chosen");
    expect(reasons(pinless, "avatar")).toContain("shadcn@aria: K8 Source fill requires commit, file hashes and licence notice");
  });
  it("the fallback is scoped to its listed leaves", () => {
    const { input } = ineligibleCard({ fallback: { source: "foundry", slots: FALLBACK.slots.filter(slot => slot !== "components.card") } });
    const plan = planComponentDefaults(input);
    expect(plan.rows.find(row => row.slot === "components.card")).toMatchObject({ status: "not-chosen" });
    expect(reasons(plan, "card")).toContain("owner pick shadcn@aria is not eligible");
    expect(reasons(plan, "card")).not.toContain("foundry:");
  });
  it("a choice stays exclusive on a fallback leaf", () => {
    const { input } = ineligibleCard({ choices: { "components.card": "shadcn@aria" } });
    const plan = planComponentDefaults(input);
    expect(plan.rows.find(row => row.slot === "components.card")).toMatchObject({ status: "not-chosen" });
    expect(reasons(plan, "card")).not.toContain("foundry:");
  });
  it("the fallback also follows a preference that does not list its source", () => {
    const { input } = ineligibleCard({ preference: ["shadcn@aria"], picks: {} });
    const plan = planComponentDefaults(input);
    expect(plan.rows.find(row => row.slot === "components.card")).toMatchObject({ status: "default", basis: "fallback", source: "foundry" });
    expect(plan.rows.find(row => row.slot === "components.meter")).toMatchObject({ status: "not-chosen" });
    expect(plan.findings).toEqual([]);
  });
  it("Choose overrides the owner pick and preference, exclusively", () => {
    const { input } = setup({ choices: { "components.table": "foundry", "components.avatar": "foundry", "components.card": "foundry" } });
    const plan = planComponentDefaults(input);
    expect(plan.rows.find(row => row.slot === "components.card")).toMatchObject({ status: "chosen", basis: "choose", source: "foundry" });
    expect(plan.rows.find(row => row.slot === "components.table")).toMatchObject({ status: "chosen", basis: "choose", source: "foundry" });
    expect(reasons(plan, "table")).not.toContain("owner pick");
    expect(plan.findings).toEqual([]);
  });
  it("a choice inside a coherence group leads the group", () => {
    const { input } = setup({ choices: { "components.slider": "shadcn@aria" } });
    const plan = planComponentDefaults(input);
    expect(plan.rows.find(row => row.slot === "components.slider")).toMatchObject({ status: "chosen", source: "shadcn@aria" });
    // The checker accepts this mixed controls set (K11 0), so the group is not forced to one source.
    expect(plan.rows.find(row => row.slot === "components.date-field")).toMatchObject({ status: "default", source: "foundry" });
    expect(reasons(plan, "date-field")).not.toContain("controls coherence");
    // field is a label/description/error wrapper, not a controls-group member, so the group's lead does not constrain it.
    expect(reasons(plan, "field")).not.toContain("controls coherence");
    expect(plan.findings).toEqual([]);
  });
  it("without a pick the same leaf falls to preference; a source without a verified bundle is never defaulted", () => {
    const { input } = setup({ picks: {} });
    expect(planComponentDefaults(input).rows.find(row => row.slot === "components.card")).toMatchObject({ status: "default", basis: "preference", source: "shadcn@aria", reasons: [] });
    const unbundled = planComponentDefaults({ ...input, bundles: [] });
    expect(unbundled.rows.find(row => row.slot === "components.avatar")).toMatchObject({ status: "default", source: "foundry" });
    expect(reasons(unbundled, "keyboard")).toContain("shadcn@aria: no verified source bundle");
    expect(unbundled.findings).toEqual([]);
  });
  it("eligibility follows the consumer's own values: an unresolved token read keeps the owner pick unchosen", () => {
    const { input } = setup({}, ["foundry", "shadcn@aria"]);
    const plan = planComponentDefaults(input);
    expect(plan.rows.find(row => row.slot === "components.tooltip")).toMatchObject({ status: "not-chosen" });
    expect(reasons(plan, "tooltip")).toMatch(/^shadcn@aria: .*K3 Token read themes\.radius\.subtle does not resolve.* \|\| owner pick shadcn@aria is not eligible/);
    expect(plan.findings).toEqual([]);
  });
});
