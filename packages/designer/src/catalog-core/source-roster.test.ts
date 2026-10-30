import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {rosterOffers,rosterRow,sourceRoster} from './token-contract.js';

const catalog = resolve(dirname(fileURLToPath(import.meta.url)), "../catalog");
interface SlotRow { id: string; layer: string; contract: { members: { mode: string; names?: string[] }; allowedReads: { tokens: string[]; assets: string[] } } }
interface FillRow { members?: string[]; propMap?: Record<string, string>; reads?: { tokens?: string[]; assets?: string[] } }
const slots = new Map((JSON.parse(readFileSync(resolve(catalog, "slots/components.json"), "utf8")) as SlotRow[]).map(slot => [slot.id, slot]));
const shadcnFills = new Map(readdirSync(resolve(catalog, "fills/shadcn@aria")).filter(name => /^components\.[a-z-]+\.json$/.test(name) && name !== "components.coverage.json").map(name => {
  const document = JSON.parse(readFileSync(resolve(catalog, "fills/shadcn@aria", name), "utf8")) as { components: Record<string, FillRow> };
  return [name.slice(0, -".json".length), Object.values(document.components)[0]!] as const;
}));

const unmapped = (slot: string, fill: FillRow): string[] => (slots.get(slot)!.contract.members.names ?? []).filter(member => !(fill.members ?? []).includes(member) || !(member in (fill.propMap ?? {})));

describe("shadcn-first member contracts", () => {
  it("offers Custom-owned defaults only for the three existing leaves with no shadcn@aria item",()=>{
    for(const id of ['assets.image','assets.video','components.semantic-content']){
      expect(rosterOffers(sourceRoster,id)).toEqual(['foundry','custom']);
      expect(rosterRow(sourceRoster,id)?.offers).toContainEqual(expect.objectContaining({source:'foundry',reason:'no external covers'}));
    }
  });
  it("every slot shadcn@aria holds names only members shadcn@aria ships (no Foundry-only member forces a Foundry pick)", () => {
    const offenders = [...shadcnFills].flatMap(([slot, fill]) => unmapped(slot, fill).map(member => `${slot}.${member}`));
    expect(offenders).toEqual([]);
  });
  it("the shadcn-held slot contracts allow every read shadcn@aria makes", () => {
    const offenders = [...shadcnFills].flatMap(([slot, fill]) => {
      const reads = slots.get(slot)!.contract.allowedReads;
      return [...(fill.reads?.tokens ?? []).filter(read => !reads.tokens.includes(read.split(".").slice(0, 2).join("."))), ...(fill.reads?.assets ?? []).filter(read => !reads.assets.includes(read))].map(read => `${slot} ${read}`);
    });
    expect(offenders).toEqual([]);
  });
  it("records the dropped Foundry-only members (receipt)", () => {
    const dropped: Readonly<Record<string, readonly string[]>> = {
      "components.badge": ["tone.success", "tone.warning", "tone.info"],
      "components.banner": ["tone.success", "tone.warning", "dismissible"],
      "components.button": ["variant.tonal", "variant.quiet", "state.pressed", "state.pending", "ground.inverse"],
      "components.card": ["variant.raised", "variant.plate", "variant.outline"],
      "components.checkbox": ["scope.group"],
      "components.dialog": ["role.alert"],
      "components.disclosure": ["scope.single"],
      "components.popover": ["arrow"],
      "components.skeleton": ["shape.text", "shape.circle"],
      "components.table": ["resize-columns"],
      "components.tabs": ["size.sm", "size.md", "size.lg"],
      "components.toggle-button": ["variant.primary", "variant.secondary", "variant.danger", "variant.tonal", "variant.quiet", "state.pressed", "state.pending", "shape.text", "shape.icon-only", "ground.base", "ground.inverse"],
    };
    for (const [slot, members] of Object.entries(dropped)) for (const member of members) expect(slots.get(slot)!.contract.members.names, `${slot}.${member}`).not.toContain(member);
  });
});
