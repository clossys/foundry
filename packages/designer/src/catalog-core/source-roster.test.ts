import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const catalog = resolve(dirname(fileURLToPath(import.meta.url)), "../catalog");
interface SlotRow { id: string; layer: string; contract: { members: { mode: string; names?: string[] }; allowedReads: { tokens: string[]; assets: string[] } } }
interface FillRow { members?: string[]; propMap?: Record<string, string>; reads?: { tokens?: string[]; assets?: string[] } }
const slots = new Map((JSON.parse(readFileSync(resolve(catalog, "slots/components.json"), "utf8")) as SlotRow[]).map(slot => [slot.id, slot]));
const shadcnFills = new Map(readdirSync(resolve(catalog, "fills/shadcn@aria")).filter(name => /^components\.[a-z-]+\.json$/.test(name) && name !== "components.coverage.json").map(name => {
  const document = JSON.parse(readFileSync(resolve(catalog, "fills/shadcn@aria", name), "utf8")) as { components: Record<string, FillRow> };
  return [name.slice(0, -".json".length), Object.values(document.components)[0]!] as const;
}));

/**
 * Shadcn-held slots whose shadcn@aria fill maps no member the slot names yet. Their member lists stay as they are
 * until the shadcn@aria style rewrite maps the upstream variants; each row says why it is not a dropped Foundry-only member.
 */
const PENDING_IMPORTER_MAPPING: Readonly<Record<string, string>> = {
  "components.badge": "upstream ships variants; the importer maps none to tone.*",
  "components.banner": "upstream alert ships variants; the importer maps none to tone.*",
  "components.button": "Foundry-picked by consumers today; tonal/quiet/pressed/pending/ground.inverse drop with the button reads in one change",
  "components.progress-bar": "the importer maps neither determinate nor indeterminate",
  "components.skeleton": "the importer maps no shape",
  "components.table": "the importer maps none of selection/sort/resize-columns",
};

const unmapped = (slot: string, fill: FillRow): string[] => (slots.get(slot)!.contract.members.names ?? []).filter(member => !(fill.members ?? []).includes(member) || !(member in (fill.propMap ?? {})));

describe("shadcn-first member contracts", () => {
  it("every slot shadcn@aria holds names only members shadcn@aria ships (no Foundry-only member forces a Foundry pick)", () => {
    const offenders = [...shadcnFills].filter(([slot]) => !(slot in PENDING_IMPORTER_MAPPING)).flatMap(([slot, fill]) => unmapped(slot, fill).map(member => `${slot}.${member}`));
    expect(offenders).toEqual([]);
  });
  it("every pending row is still pending (a mapped slot leaves the list)", () => {
    for (const slot of Object.keys(PENDING_IMPORTER_MAPPING)) expect(unmapped(slot, shadcnFills.get(slot)!).length, slot).toBeGreaterThan(0);
  });
  it("the shadcn-held slot contracts allow every read shadcn@aria makes", () => {
    const offenders = [...shadcnFills].filter(([slot]) => !(slot in PENDING_IMPORTER_MAPPING)).flatMap(([slot, fill]) => {
      const reads = slots.get(slot)!.contract.allowedReads;
      return [...(fill.reads?.tokens ?? []).filter(read => !reads.tokens.includes(read.split(".").slice(0, 2).join("."))), ...(fill.reads?.assets ?? []).filter(read => !reads.assets.includes(read))].map(read => `${slot} ${read}`);
    });
    expect(offenders).toEqual([]);
  });
  it("records the dropped Foundry-only members (receipt)", () => {
    const dropped: Readonly<Record<string, readonly string[]>> = {
      "components.card": ["variant.raised", "variant.plate", "variant.outline"],
      "components.checkbox": ["scope.group"],
      "components.dialog": ["role.alert"],
      "components.disclosure": ["scope.single"],
      "components.popover": ["arrow"],
      "components.tabs": ["size.sm", "size.md", "size.lg"],
      "components.toggle-button": ["variant.primary", "variant.secondary", "variant.danger", "variant.tonal", "variant.quiet", "state.pressed", "state.pending", "shape.text", "shape.icon-only", "ground.base", "ground.inverse"],
    };
    for (const [slot, members] of Object.entries(dropped)) for (const member of members) expect(slots.get(slot)!.contract.members.names, `${slot}.${member}`).not.toContain(member);
  });
});
