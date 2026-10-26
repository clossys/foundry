// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import componentSlots from "../catalog/slots/components.json" with { type: "json" };
import { checkComponentProfile } from "./check-components.js";
import type { ComponentCheckFill } from "./check-components.js";
import type { ComponentSlot } from "./types.js";
import { sha256 } from "./digest.js";
import { flatten } from "./model.js";
import { importShadcnAriaComponents, materializeShadcnComponent } from "../importers/shadcn-aria-components.js";

// Planner disposition: read-contract-reconcile.md 8e995c07, accepted U5c tree 17c48845.
// These are explicit approved deltas, never inferred from generator reads.
const additions: Record<string, string[]> = {
  "checkbox": [
    "action-color",
    "border-width",
    "control-size",
    "duration",
    "easing",
    "focus-color",
    "focus-outline"
  ],
  "radio-group": [
    "action-color",
    "border-width",
    "focus-color",
    "focus-outline"
  ],
  "switch": [
    "action-color",
    "border-width",
    "control-size",
    "duration",
    "easing",
    "focus-color",
    "focus-outline",
    "status-color"
  ],
  "slider": [
    "action-color",
    "border-width",
    "duration",
    "easing",
    "focus-color",
    "focus-outline",
    "spacing",
    "state-opacity"
  ],
  "toggle-button": [
    "action-color",
    "border-width",
    "control-size",
    "duration",
    "focus-color",
    "focus-outline",
    "font-size",
    "font-weight"
  ],
  "toggle-group": [
    "border-width"
  ],
  "avatar": [
    "action-color",
    "border-color",
    "border-width",
    "font-size",
    "spacing"
  ],
  "breadcrumbs": [
    "control-size",
    "duration",
    "easing",
    "font-size",
    "font-weight"
  ],
  "calendar": [
    "action-color",
    "control-radius",
    "focus-color",
    "font-size",
    "font-weight",
    "spacing",
    "state-opacity"
  ],
  "card": [
    "border-width",
    "font-size",
    "font-weight",
    "text-color"
  ],
  "combo-box": [
    "border-width",
    "control-size",
    "duration",
    "easing",
    "focus-color",
    "focus-outline",
    "font-weight",
    "shift-distance",
    "transition-easing"
  ],
  "dialog": [
    "border-width",
    "duration",
    "font-size",
    "font-weight",
    "transition-easing"
  ],
  "disclosure": [
    "border-width",
    "control-radius",
    "duration",
    "easing",
    "focus-color",
    "focus-outline",
    "font-size",
    "font-weight",
    "state-opacity"
  ],
  "keyboard": [
    "control-radius",
    "font-weight",
    "spacing",
    "surface-color",
    "text-color"
  ],
  "menu": [
    "duration",
    "font-size",
    "font-weight",
    "shift-distance",
    "state-opacity",
    "transition-easing"
  ],
  "popover": [
    "duration",
    "font-size",
    "font-weight",
    "shift-distance",
    "text-color",
    "transition-easing"
  ],
  "select": [
    "border-width",
    "control-size",
    "duration",
    "easing",
    "focus-color",
    "focus-outline",
    "font-weight",
    "shift-distance",
    "transition-easing"
  ],
  "tabs": [
    "border-width",
    "control-radius",
    "duration",
    "easing",
    "elevation",
    "focus-color",
    "focus-outline",
    "font-size",
    "font-weight",
    "surface-color"
  ],
  "tooltip": [
    "duration",
    "font-size",
    "shift-distance",
    "transition-easing",
    "behavior-timing"
  ]
};
const baseline: Record<string, string[]> = Object.fromEntries(Object.entries({
  "components.avatar": "tokens.body-size tokens.caption-size tokens.radius tokens.surface-color tokens.text-color tokens.typeface",
  "components.badge": "tokens.caption-size tokens.letter-spacing tokens.radius tokens.spacing tokens.status-color tokens.surface-color tokens.text-color tokens.typeface",
  "components.banner": "tokens.accent-color tokens.body-size tokens.control-radius tokens.radius tokens.spacing tokens.status-color tokens.surface-color tokens.typeface",
  "components.breadcrumbs": "tokens.body-size tokens.spacing tokens.text-color tokens.typeface",
  "components.button": "tokens.accent-color tokens.action-color tokens.body-size tokens.border-color tokens.control-color tokens.control-radius tokens.easing tokens.focus-color tokens.focus-outline tokens.focus-shadow tokens.radius tokens.spacing tokens.state-opacity tokens.status-color tokens.surface-color tokens.text-color tokens.typeface",
  "components.calendar": "tokens.accent-color tokens.surface-color tokens.text-color tokens.focus-shadow",
  "components.card": "tokens.border-color tokens.control-radius tokens.elevation tokens.spacing tokens.surface-color tokens.surface-radius",
  "components.chart-area": "tokens.border-color tokens.border-width tokens.categorical-color tokens.chart-color tokens.diverging-color tokens.radius tokens.sequential-color tokens.surface-color tokens.text-color tokens.typeface",
  "components.chart-bar": "tokens.border-color tokens.border-width tokens.categorical-color tokens.chart-color tokens.diverging-color tokens.radius tokens.sequential-color tokens.surface-color tokens.text-color tokens.typeface",
  "components.chart-heatmap": "tokens.border-color tokens.border-width tokens.categorical-color tokens.chart-color tokens.diverging-color tokens.radius tokens.sequential-color tokens.surface-color tokens.text-color tokens.typeface",
  "components.chart-line": "tokens.border-color tokens.border-width tokens.categorical-color tokens.chart-color tokens.diverging-color tokens.radius tokens.sequential-color tokens.surface-color tokens.text-color tokens.typeface",
  "components.chart-range": "tokens.border-color tokens.border-width tokens.categorical-color tokens.chart-color tokens.diverging-color tokens.radius tokens.sequential-color tokens.surface-color tokens.text-color tokens.typeface",
  "components.chart-scatter": "tokens.border-color tokens.border-width tokens.categorical-color tokens.chart-color tokens.diverging-color tokens.radius tokens.sequential-color tokens.surface-color tokens.text-color tokens.typeface",
  "components.chart-sparkline": "tokens.border-color tokens.border-width tokens.categorical-color tokens.chart-color tokens.diverging-color tokens.radius tokens.sequential-color tokens.surface-color tokens.text-color tokens.typeface",
  "components.chart-status-strip": "tokens.border-color tokens.border-width tokens.categorical-color tokens.chart-color tokens.diverging-color tokens.radius tokens.sequential-color tokens.surface-color tokens.text-color tokens.typeface",
  "components.chart-waterfall": "tokens.border-color tokens.border-width tokens.categorical-color tokens.chart-color tokens.diverging-color tokens.radius tokens.sequential-color tokens.surface-color tokens.text-color tokens.typeface",
  "components.checkbox": "tokens.accent-color tokens.body-size tokens.border-color tokens.focus-shadow tokens.radius tokens.spacing tokens.state-opacity tokens.status-color tokens.surface-color tokens.text-color",
  "components.color-picker": "tokens.body-size tokens.border-color tokens.caption-size tokens.control-radius tokens.control-size tokens.focus-shadow tokens.spacing tokens.state-opacity tokens.surface-color tokens.text-color tokens.touch-target tokens.typeface",
  "components.combo-box": "tokens.accent-color tokens.body-size tokens.border-color tokens.caption-size tokens.control-radius tokens.elevation tokens.focus-shadow tokens.radius tokens.spacing tokens.state-opacity tokens.status-color tokens.surface-color tokens.text-color tokens.typeface tokens.z-index",
  "components.date-field": "tokens.accent-color tokens.body-size tokens.border-color tokens.caption-size tokens.control-radius tokens.focus-shadow tokens.radius tokens.spacing tokens.state-opacity tokens.status-color tokens.surface-color tokens.text-color tokens.typeface",
  "components.date-picker": "",
  "components.dialog": "tokens.body-size tokens.border-color tokens.control-radius tokens.elevation tokens.heading-size tokens.scrim-color tokens.spacing tokens.surface-color tokens.text-color tokens.typeface tokens.z-index",
  "components.disclosure": "tokens.body-size tokens.radius tokens.spacing tokens.text-color",
  "components.field": "tokens.body-size tokens.caption-size tokens.spacing tokens.state-opacity tokens.status-color tokens.text-color tokens.typeface",
  "components.file-trigger": "",
  "components.form": "tokens.spacing",
  "components.grid-list": "tokens.accent-color tokens.body-size tokens.border-color tokens.focus-shadow tokens.spacing tokens.state-opacity tokens.surface-color tokens.text-color tokens.touch-target",
  "components.icon": "tokens.icon-size tokens.icon-stroke tokens.spacing",
  "components.keyboard": "tokens.code-size tokens.typeface tokens.border-color",
  "components.link": "tokens.accent-color tokens.action-color tokens.body-size tokens.border-color tokens.control-color tokens.control-radius tokens.easing tokens.focus-color tokens.focus-outline tokens.focus-shadow tokens.radius tokens.spacing tokens.state-opacity tokens.status-color tokens.surface-color tokens.text-color tokens.typeface",
  "components.logo": "tokens.accent-color tokens.text-color tokens.touch-target tokens.brandmark-size",
  "components.menu": "tokens.body-size tokens.border-color tokens.caption-size tokens.control-radius tokens.elevation tokens.radius tokens.spacing tokens.status-color tokens.surface-color tokens.text-color tokens.typeface tokens.z-index",
  "components.meter": "tokens.accent-color tokens.body-size tokens.border-color tokens.border-width tokens.heading-size tokens.line-height tokens.radius tokens.spacing tokens.status-color tokens.surface-color tokens.text-color tokens.typeface",
  "components.navigation-tree": "tokens.accent-color tokens.body-size tokens.border-color tokens.focus-shadow tokens.spacing tokens.state-opacity tokens.surface-color tokens.text-color tokens.touch-target",
  "components.number-field": "tokens.accent-color tokens.body-size tokens.border-color tokens.caption-size tokens.control-radius tokens.control-size tokens.focus-shadow tokens.spacing tokens.state-opacity tokens.status-color tokens.surface-color tokens.text-color tokens.touch-target tokens.typeface",
  "components.popover": "tokens.border-color tokens.control-radius tokens.elevation tokens.spacing tokens.surface-color tokens.z-index",
  "components.progress-bar": "tokens.accent-color tokens.body-size tokens.radius tokens.spacing tokens.surface-color tokens.text-color tokens.typeface",
  "components.radio-group": "tokens.accent-color tokens.body-size tokens.border-color tokens.caption-size tokens.focus-shadow tokens.radius tokens.spacing tokens.state-opacity tokens.status-color tokens.surface-color tokens.text-color tokens.typeface",
  "components.resize-handle": "tokens.accent-color tokens.border-color tokens.border-width tokens.touch-target",
  "components.search-field": "tokens.accent-color tokens.body-size tokens.border-color tokens.caption-size tokens.control-radius tokens.focus-shadow tokens.spacing tokens.state-opacity tokens.status-color tokens.surface-color tokens.text-color tokens.typeface",
  "components.select": "tokens.accent-color tokens.body-size tokens.border-color tokens.caption-size tokens.control-radius tokens.elevation tokens.focus-shadow tokens.radius tokens.spacing tokens.state-opacity tokens.status-color tokens.surface-color tokens.text-color tokens.typeface tokens.z-index",
  "components.separator": "tokens.border-color",
  "components.skeleton": "tokens.control-radius tokens.radius tokens.surface-color",
  "components.slider": "tokens.accent-color tokens.surface-color tokens.focus-shadow",
  "components.spinner": "tokens.text-color",
  "components.status-mark": "tokens.body-size tokens.spacing tokens.status-color tokens.text-color tokens.typeface",
  "components.switch": "tokens.accent-color tokens.body-size tokens.border-color tokens.focus-shadow tokens.radius tokens.spacing tokens.state-opacity tokens.surface-color tokens.text-color",
  "components.table": "tokens.accent-color tokens.body-size tokens.border-color tokens.focus-shadow tokens.spacing tokens.surface-color tokens.text-color tokens.typeface",
  "components.tabs": "tokens.accent-color tokens.body-size tokens.border-color tokens.focus-shadow tokens.spacing tokens.state-opacity tokens.text-color tokens.typeface",
  "components.tag-group": "tokens.accent-color tokens.caption-size tokens.focus-shadow tokens.letter-spacing tokens.radius tokens.spacing tokens.state-opacity tokens.surface-color tokens.text-color",
  "components.text-field": "tokens.accent-color tokens.body-size tokens.border-color tokens.caption-size tokens.control-radius tokens.control-size tokens.focus-shadow tokens.spacing tokens.state-opacity tokens.status-color tokens.surface-color tokens.text-color tokens.typeface",
  "components.toast": "",
  "components.toggle-button": "tokens.accent-color tokens.body-size tokens.border-color tokens.control-color tokens.control-radius tokens.easing tokens.focus-shadow tokens.radius tokens.spacing tokens.state-opacity tokens.status-color tokens.surface-color tokens.text-color tokens.typeface",
  "components.toggle-group": "tokens.accent-color tokens.body-size tokens.border-color tokens.control-color tokens.control-radius tokens.easing tokens.focus-shadow tokens.radius tokens.spacing tokens.state-opacity tokens.status-color tokens.surface-color tokens.text-color tokens.typeface",
  "components.toolbar": "tokens.spacing tokens.border-color",
  "components.tooltip": "tokens.border-color tokens.caption-size tokens.control-radius tokens.elevation tokens.spacing tokens.surface-color tokens.text-color tokens.z-index",
  "components.tree": "tokens.accent-color tokens.body-size tokens.border-color tokens.focus-shadow tokens.spacing tokens.state-opacity tokens.surface-color tokens.text-color tokens.touch-target",
}).map(([id, leaves]) => [id, leaves.split(" ").filter(Boolean)]));
const slots = componentSlots as ComponentSlot[];
const directory = resolve(import.meta.dirname, "../catalog/fills/shadcn@aria");
const names = readdirSync(directory).filter(name => /^components\..*\.json$/.test(name)).sort();
const documents = names.filter(name => name !== "components.coverage.json").map(name => JSON.parse(readFileSync(resolve(directory, name), "utf8")));
const descriptors = documents.map(doc => Object.values(doc.components)[0] as ComponentCheckFill);
// Resolution-only registry: real existing member IDs, synthetic values, no observations.
const tokenDirectory = resolve(import.meta.dirname, "../catalog/fills");
const tokens = Object.fromEntries(readdirSync(tokenDirectory).flatMap(source => readdirSync(resolve(tokenDirectory, source)).filter(name => /^tokens\..*\.json$/.test(name)).flatMap(name => Object.keys(flatten(JSON.parse(readFileSync(resolve(tokenDirectory, source, name), "utf8")))).map(id => [id, { property: `--fixture-${id.replaceAll(".", "-")}`, light: "#000000" }]))));
const profile = (contracts = slots, fills = descriptors) => ({ slots: contracts, fills, tokens, assets: [], observations: {}, installedRac: { version: "1.21.1", instance: "unobserved" } });
const tokenFindings = (contracts = slots, fills = descriptors) => checkComponentProfile(profile(contracts, fills)).findings.filter(f => f.code === "K3" && /(?:Token read|Read tokens\.)/.test(f.message));
const read = (name: string) => readFileSync(resolve(import.meta.dirname, "../importers/__fixtures__/shadcn-aria", name), "utf8");
const input = () => ({ items: readdirSync(resolve(import.meta.dirname, "../importers/__fixtures__/shadcn-aria")).filter(name => name.endsWith(".json")).map(name => JSON.parse(read(name))).filter(item => item.type === "registry:ui"), styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") }, notice: { path: "LICENSE.md", content: read("LICENSE.md") } });

describe("read-contract reconciliation at the accepted U5c source", () => {
  it("applies exactly the planner-selected role additions without broadening other contracts", () => {
    for (const slot of slots) {
      const leaves = (additions[slot.id.slice(11)] ?? []).map(leaf => `tokens.${leaf}`);
      expect(slot.contract.allowedReads.tokens, slot.id).toEqual([...baseline[slot.id]!, ...leaves]);
      expect(new Set(slot.contract.allowedReads.tokens).size, slot.id).toBe(slot.contract.allowedReads.tokens.length);
    }
    const unchanged = structuredClone(componentSlots); for (const slot of unchanged) slot.contract.allowedReads.tokens = [];
    // Accepted W2 adds DateField/DatePicker protocol surfaces; BF-B1 changes no contracts.
    expect(sha256(JSON.stringify(unchanged))).toBe("dde857e3c0fe81698fcd824698ad126d2170a849703341ef4dcfe539b6a8b4ff");
  });
  for (const [leaf, leaves] of Object.entries(additions)) it(`restores K3 when an approved ${leaf} role is removed`, () => {
    const descriptor = descriptors.find(fill => fill.slot === `components.${leaf}`)!;
    const current = tokenFindings(slots, [descriptor]);
    expect(current.filter(f => f.message.startsWith("Read "))).toEqual(leaf === "keyboard" ? [expect.objectContaining({ code: "K3", message: "Read tokens.font-size.xs is outside the contract" })] : []);
    expect(current.filter(f => f.message.startsWith("Token read "))).toEqual(["combo-box", "select", "tabs"].includes(leaf) ? [expect.objectContaining({ code: "K3", message: "Token read tokens.elevation.flat does not resolve" })] : []);
    for (const role of leaves.filter(role => role !== "behavior-timing")) {
      const changed = structuredClone(slots);
      const contract = changed.find(slot => slot.id === descriptor.slot)!.contract;
      contract.allowedReads.tokens = contract.allowedReads.tokens.filter(read => read !== `tokens.${role}`);
      const member = descriptor.reads.tokens.find(read => read.startsWith(`tokens.${role}.`))!;
      expect(member, role).toBeDefined();
      expect(tokenFindings(changed, [descriptor]), role).toContainEqual(expect.objectContaining({ subject: descriptor.slot, message: `Read ${member} is outside the contract` }));
    }
  });
  it("retains three unknown elevation.flat reads independently of leaf permission", () => {
    expect(Object.hasOwn(tokens, "tokens.elevation.flat")).toBe(false);
    const unknown = tokenFindings().filter(f => f.message === "Token read tokens.elevation.flat does not resolve");
    expect(unknown.map(f => f.subject).sort()).toEqual(["components.combo-box", "components.select", "components.tabs"]);
    for (const finding of unknown) {
      expect(slots.find(slot => slot.id === finding.subject)!.contract.allowedReads.tokens).toContain("tokens.elevation");
      expect(checkComponentProfile(profile(slots, descriptors.filter(fill => fill.slot === finding.subject))).ok).toBe(false);
    }
  });
  it("retains exact descriptor reads, output hashes, members and unavailable runtime evidence", () => {
    expect(descriptors).toHaveLength(26);
    // Canonical selected-source normalization changes only five output manifests.
    expect(sha256(names.map(name => `${name}\n${sha256(readFileSync(resolve(directory, name), "utf8"))}\n`).join(""))).toBe("8aea581d901fd2479246b65615f46edd772280d79365fcb7165e33af46d2638e");
    for (const doc of documents) {
      const fill = Object.values(doc.components)[0] as ComponentCheckFill;
      expect(fill.reads.tokens.every(read => /^tokens\.[^.]+\.[^.]+$/.test(read)), fill.slot).toBe(true);
      expect(doc.$extensions["com.clossys.fill"]).toMatchObject({ evidence: [], conforms: [], status: "draft" });
    }
    for (const leaf of ["badge", "banner", "button", "progress-bar", "table"]) expect(tokenFindings(slots, [descriptors.find(fill => fill.slot === `components.${leaf}`)!]).length, leaf).toBeGreaterThan(0);
    const toggle = descriptors.find(fill => fill.slot === "components.toggle-button")!;
    expect(toggle.reads.tokens).toContain("tokens.action-color.default");
    expect(toggle.reads.tokens).toEqual(expect.arrayContaining(["tokens.control-size.h-sm", "tokens.control-size.h-md", "tokens.control-size.h-lg"]));
    for (const member of ["state.pressed", "state.pending", "ground.inverse"]) expect(toggle.members).not.toContain(member);
    const switchSlot = slots.find(slot => slot.id === "components.switch")!;
    expect(switchSlot.contract.members.mode === "closed" && switchSlot.contract.members.names).not.toContain("state.invalid");
    const findings = checkComponentProfile(profile()).findings;
    for (const code of ["K1", "K4", "K5", "K6", "K7", "K10"]) expect(findings.some(f => f.code === code), code).toBe(true);
  });
  it("keeps keyboard typography, tooltip transport and breadcrumb DEC-A blocked", () => {
    const result = importShadcnAriaComponents(input());
    const keyboard = result.rewrites.kbd!;
    expect(slots.find(slot => slot.id === "components.keyboard")!.contract.allowedReads.tokens).toContain("tokens.code-size");
    expect(slots.find(slot => slot.id === "components.keyboard")!.contract.allowedReads.tokens).not.toContain("tokens.font-size");
    expect(keyboard.reads.tokens).toContain("tokens.font-size.xs");
    expect(keyboard.issues.some(issue => issue.code === "K4")).toBe(true);
    expect(slots.find(slot => slot.id === "components.tooltip")!.contract.allowedReads.tokens).toContain("tokens.behavior-timing");
    expect(result.rewrites.tooltip!.reads.tokens.some(read => read.startsWith("tokens.behavior-timing."))).toBe(false);
    const tooltipSource = result.rewrites.tooltip!.files.find(file => file.path === "components/tooltip/tooltip.tsx")!.content;
    expect(tooltipSource).toMatch(/delay\s*=\s*0/);
    expect(tooltipSource).not.toMatch(/closeDelay\s*=/);
    expect(result.rewrites.breadcrumb!.issues.filter(issue => issue.code === "K7")).toHaveLength(2);
    for (const item of ["kbd", "tooltip", "breadcrumb", "select", "combobox", "tabs", "calendar"]) expect(() => materializeShadcnComponent(result, item), item).toThrow(/unresolved/);
    const changed = structuredClone(result); const rewrite = changed.rewrites.collapsible!; rewrite.files[0]!.content += " ";
    expect(() => materializeShadcnComponent(changed, "collapsible")).toThrow(/output hash differs/);
  });
});
