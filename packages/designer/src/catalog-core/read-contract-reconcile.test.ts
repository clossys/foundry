// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import componentSlots from "../catalog/slots/components.json" with { type: "json" };
import themeSlots from "../catalog/slots/themes.json" with { type: "json" };
import { checkComponentProfile } from "./check-components.js";
import type { ComponentCheckFill } from "./check-components.js";
import type { ComponentSlot } from "./types.js";
import { sha256 } from "./digest.js";
import { flatten } from "./model.js";
import { importShadcnAriaComponents, materializeShadcnComponent } from "../importers/shadcn-aria-components.js";

// THEMES-F: contracts grant shadcn themes leaves; the U5c per-role deltas over the retired tokens layer are migration history.
const themeLeaves = new Set((themeSlots as { id: string }[]).map(slot => slot.id));
const slots = componentSlots as ComponentSlot[];
const directory = resolve(import.meta.dirname, "../catalog/fills/shadcn@aria");
const names = readdirSync(directory).filter(name => /^components\..*\.json$/.test(name)).sort();
const documents = names.filter(name => name !== "components.coverage.json").map(name => JSON.parse(readFileSync(resolve(directory, name), "utf8")));
const descriptors = documents.map(doc => Object.values(doc.components)[0] as ComponentCheckFill);
// Resolution-only registry: real existing member IDs, synthetic values, no observations.
const tokenDirectory = resolve(import.meta.dirname, "../catalog/fills");
const tokens = Object.fromEntries(readdirSync(tokenDirectory).flatMap(source => readdirSync(resolve(tokenDirectory, source)).filter(name => /^themes\..*\.json$/.test(name)).flatMap(name => Object.keys(flatten(JSON.parse(readFileSync(resolve(tokenDirectory, source, name), "utf8")))).map(id => [id, { property: `--fixture-${id.replaceAll(".", "-")}`, light: "#000000" }]))));
const profile = (contracts = slots, fills = descriptors) => ({ slots: contracts, fills, tokens, assets: [], observations: {}, installedRac: { version: "1.21.1", instance: "unobserved" } });
const tokenFindings = (contracts = slots, fills = descriptors) => checkComponentProfile(profile(contracts, fills)).findings.filter(f => f.code === "K3" && /(?:Token read|Read themes\.)/.test(f.message));
const read = (name: string) => readFileSync(resolve(import.meta.dirname, "../importers/__fixtures__/shadcn-aria", name), "utf8");
const input = () => ({ items: readdirSync(resolve(import.meta.dirname, "../importers/__fixtures__/shadcn-aria")).filter(name => name.endsWith(".json")).map(name => JSON.parse(read(name))).filter(item => item.type === "registry:ui"), styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") }, notice: { path: "LICENSE.md", content: read("LICENSE.md") } });

describe("read-contract reconciliation at the accepted U5c source", () => {
  it("grants only registered themes leaves, once each, without changing other contract parts", () => {
    for (const slot of slots) {
      expect(slot.contract.allowedReads.themes.filter(leaf => !themeLeaves.has(leaf)), slot.id).toEqual([]);
      expect(new Set(slot.contract.allowedReads.themes).size, slot.id).toBe(slot.contract.allowedReads.themes.length);
    }
    const unchanged = structuredClone(componentSlots); for (const slot of unchanged) slot.contract.allowedReads.themes = [];
    // Accepted W2 adds DateField/DatePicker protocol surfaces; BF-B1 changes no contracts.
    expect(sha256(JSON.stringify(unchanged))).toBe("dde857e3c0fe81698fcd824698ad126d2170a849703341ef4dcfe539b6a8b4ff");
  });
  for (const descriptor of descriptors) it(`restores K3 when a granted ${descriptor.slot} read leaf is removed`, () => {
    expect(tokenFindings(slots, [descriptor])).toEqual([]);
    for (const leaf of [...new Set(descriptor.reads.themes.map(read => read.split(".").slice(0, 2).join(".")))]) {
      const changed = structuredClone(slots);
      const contract = changed.find(slot => slot.id === descriptor.slot)!.contract;
      contract.allowedReads.themes = contract.allowedReads.themes.filter(read => read !== leaf);
      const member = descriptor.reads.themes.find(read => read.startsWith(`${leaf}.`))!;
      expect(tokenFindings(changed, [descriptor]), leaf).toContainEqual(expect.objectContaining({ subject: descriptor.slot, message: `Read ${member} is outside the contract` }));
    }
  });
  it("resolves every descriptor read against a registered themes member", () => {
    expect(tokenFindings().filter(f => f.message.startsWith("Token read "))).toEqual([]);
  });
  it("retains exact descriptor reads, output hashes, members and unavailable runtime evidence", () => {
    expect(descriptors.filter(fill => !["command", "dropdown-menu", "empty", "item", "scroll-area", "sheet", "sidebar"].map(leaf => `components.${leaf}`).includes(fill.slot))).toHaveLength(26);
    // Canonical selected-source normalization changes only five output manifests.
    expect(sha256(names.map(name => `${name}\n${sha256(readFileSync(resolve(directory, name), "utf8"))}\n`).join(""))).toBe("8aea581d901fd2479246b65615f46edd772280d79365fcb7165e33af46d2638e");
    for (const doc of documents) {
      const fill = Object.values(doc.components)[0] as ComponentCheckFill;
      expect(fill.reads.themes.every(read => /^themes\.[^.]+\.[^.]+$/.test(read)), fill.slot).toBe(true);
      expect(doc.$extensions["com.clossys.fill"]).toMatchObject({ evidence: [], conforms: [], status: "draft" });
    }
    for (const leaf of ["badge", "banner", "button", "progress-bar", "table"]) expect(tokenFindings(slots, [descriptors.find(fill => fill.slot === `components.${leaf}`)!]).length, leaf).toBeGreaterThan(0);
    const toggle = descriptors.find(fill => fill.slot === "components.toggle-button")!;
    expect(toggle.reads.themes).toContain("themes.primary.default");
    expect(toggle.reads.themes).toContain("themes.spacing.default");
    for (const member of ["state.pressed", "state.pending", "ground.inverse"]) expect(toggle.members).not.toContain(member);
    const switchSlot = slots.find(slot => slot.id === "components.switch")!;
    expect(switchSlot.contract.members.mode === "closed" && switchSlot.contract.members.names).not.toContain("state.invalid");
    const findings = checkComponentProfile(profile()).findings;
    for (const code of ["K1", "K4", "K5", "K6", "K7", "K10"]) expect(findings.some(f => f.code === code), code).toBe(true);
  });
  it("keeps keyboard typography, tooltip transport and breadcrumb DEC-A blocked", () => {
    const result = importShadcnAriaComponents(input());
    const keyboard = result.rewrites.kbd!;
    expect(slots.find(slot => slot.id === "components.keyboard")!.contract.allowedReads.themes).toContain("themes.font-mono");
    expect(keyboard.reads.themes.every(read => /^themes\.[^.]+\.[^.]+$/.test(read))).toBe(true);
    expect(result.rewrites.tooltip!.reads.themes.some(read => read.startsWith("themes.animate-"))).toBe(false);
    const tooltipSource = result.rewrites.tooltip!.files.find(file => file.path === "components/tooltip/tooltip.tsx")!.content;
    expect(tooltipSource).toMatch(/delay\s*=\s*0/);
    expect(tooltipSource).not.toMatch(/closeDelay\s*=/);
    expect(result.rewrites.breadcrumb!.issues.filter(issue => issue.code === "K7")).toHaveLength(2);
    for (const item of ["kbd", "tooltip", "breadcrumb", "select", "combobox", "tabs", "calendar"]) expect(() => materializeShadcnComponent(result, item), item).toThrow(/unresolved/);
    const changed = structuredClone(result); const rewrite = changed.rewrites.collapsible!; rewrite.files[0]!.content += " ";
    expect(() => materializeShadcnComponent(changed, "collapsible")).toThrow(/output hash differs/);
  });
});
