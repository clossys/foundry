// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * GATES-RED G3: every component or surface a Foundry frame or section actually composes, as the
 * generated source measurement resolves it (componentLeaf facades included), is declared in its
 * slot record: `composes` for a frame, `allowedComposes` (components) or `composes` (sections)
 * for a section. The consumer mirror under clossys/agents/designer declares the same set.
 */
const pkg = new URL("../../", import.meta.url);
const json = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, pkg), "utf8")) as T;
interface Contract { kind: string; composes?: string[]; allowedComposes?: string[]; parts?: string[] }
interface Slot { id: string; contract: Contract }
interface Measured { consumption: { scannedComposes: string[]; scannedReads: { components: string[] } } }
const measured = json<Record<string, Measured>>("src/catalog/surface-consumption.data.json");
const slots = new Map([...json<Slot[]>("src/catalog/slots/frames.json"), ...json<Slot[]>("src/catalog/slots/sections.json")].map(slot => [slot.id, slot]));
const declared = (contract: Contract) => new Set([...contract.composes ?? [], ...contract.allowedComposes ?? [], ...contract.parts ?? []]);
const observed = (row: Measured) => [...new Set([...row.consumption.scannedComposes, ...row.consumption.scannedReads.components])].sort();

describe("declared composes follow the real import graph", () => {
  it("resolves a componentLeaf facade to the component leaf it names", () => {
    expect(measured["frames.inspector"]!.consumption.scannedComposes).toContain("components.semantic-content");
    expect(measured["frames.app-shell"]!.consumption.scannedComposes).toEqual(expect.arrayContaining(["components.dialog", "components.popover", "components.semantic-content"]));
  });

  it("declares every measured compose in the package slot record and its consumer mirror", () => {
    const missing: string[] = [];
    for (const [id, row] of Object.entries(measured)) {
      const slot = slots.get(id);
      expect(slot, id).toBeDefined();
      const mirror = json<Slot>(`../../clossys/agents/designer/${id}/slot.json`);
      for (const compose of observed(row)) {
        if (!declared(slot!.contract).has(compose)) missing.push(`${id} ${compose}`);
        if (!declared(mirror.contract).has(compose)) missing.push(`${id} ${compose} (consumer mirror)`);
      }
    }
    expect(missing).toEqual([]);
  });
});
