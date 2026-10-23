import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import tokenPlacement from "../catalog/ia/tokens.json" with { type: "json" };
import tokenSlots from "../catalog/slots/tokens.json" with { type: "json" };
import { TOKENS } from "../tokens/tokens.js";
import { importFoundry } from "../importers/foundry.js";
import { stableStringify } from "./stable.js";
import { loadCatalog } from "./index.js";
import type { Slot } from "./types.js";

const slots = tokenSlots as unknown as readonly Slot[];
const tokensCss = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../styles/tokens.css"), "utf8");

describe("Foundry fill documents", () => {
  it("matches every generated cell against its committed JSON file", async () => {
    const fills = importFoundry({ tokens: Object.values(TOKENS), tokensCss, slots });
    expect(fills).toHaveLength(49);
    for (const fill of fills) {
      const path = resolve(dirname(fileURLToPath(import.meta.url)), `../catalog/fills/foundry/${fill.$extensions["com.clossys.fill"].slot}.json`);
      await expect(stableStringify(fill)).toMatchFileSnapshot(path);
    }
  });
  it("loads exactly the committed fill files and registered data", () => {
    const expectedSlots = slots.filter(slot => Object.keys(slot.contract.emit ?? {}).length > 0).map(slot => slot.id);
    const directory = resolve(dirname(fileURLToPath(import.meta.url)), "../catalog/fills/foundry");
    expect(readdirSync(directory).sort()).toEqual(expectedSlots.map(id => id + ".json"));
    const catalog = loadCatalog();
    expect(catalog.slots).toEqual(slots);
    expect(catalog.standards.map(standard => standard.id).sort()).toEqual(["apg", "dtcg", "tailwind-v4-theme", "wcag-2.2", "web-app-manifest"]);
    expect(catalog.placements).toEqual([tokenPlacement]);
    expect(catalog.retired).toEqual([]);
    expect(catalog.sources.find(source => source.id === "foundry")).toEqual({ id: "foundry", kind: "base", author: "foundry", license: "MIT" });
    expect(catalog.fills.filter(fill => fill.$extensions["com.clossys.fill"].source === "foundry").map(fill => fill.$extensions["com.clossys.fill"].id)).toEqual(expectedSlots.map(id => "foundry/" + id));
  });
});
