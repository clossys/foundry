import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "./index.js";
import { parseFill } from "./cell.js";

const catalog = loadCatalog();
const fillsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../catalog/fills");
const slotById = new Map(catalog.slots.map(slot => [slot.id, slot]));
const external = catalog.fills.filter(fill => fill.$extensions["com.clossys.fill"].source !== "foundry");

function memberPaths(node: unknown, prefix: string[], found: string[] = []): string[] {
  if (node === null || typeof node !== "object") return found;
  const record = node as Record<string, unknown>;
  if (Object.hasOwn(record, "$value")) found.push(prefix.join("."));
  else for (const [key, child] of Object.entries(record)) memberPaths(child, [...prefix, key], found);
  return found;
}

describe("external fills in the loaded catalog", () => {
  it("registers the two external sources with a pin and a licence, after foundry", () => {
    expect(catalog.sources.map(source => source.id)).toEqual(["foundry", "shadcn@aria", "tailwind-default"]);
    for (const source of catalog.sources.filter(source => source.kind === "external")) {
      expect(source.license).toBe("MIT");
      expect(source.author).toBe("third-party");
      expect(source.pin?.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
  it("holds 21 external cells, one per source and slot, with the directory and file names matching the id", () => {
    expect(external).toHaveLength(21);
    for (const sourceId of ["shadcn@aria", "tailwind-default"]) {
      const files = readdirSync(resolve(fillsDirectory, sourceId)).sort();
      expect(external.filter(fill => fill.$extensions["com.clossys.fill"].source === sourceId).map(fill => fill.$extensions["com.clossys.fill"].slot + ".json").sort()).toEqual(files);
    }
    expect(new Set(catalog.fills.map(fill => fill.$extensions["com.clossys.fill"].id)).size).toBe(catalog.fills.length);
  });
  it("keeps each cell inside its slot: registered source, members in the contract, requirements conformed with evidence", () => {
    const sourceIds = new Set(catalog.sources.map(source => source.id));
    for (const fill of external) {
      const meta = fill.$extensions["com.clossys.fill"];
      const slot = slotById.get(meta.slot)!;
      expect(slot, meta.id).toBeDefined();
      expect(sourceIds.has(meta.source), meta.id).toBe(true);
      expect(meta.id).toBe(`${meta.source}/${meta.slot}`);
      expect(parseFill(fill).findings, meta.id).toEqual([]);
      const leaf = meta.slot.split(".")[1]!;
      const members = memberPaths((fill.tokens as Record<string, unknown>)[leaf], []);
      expect(members.length, meta.id).toBeGreaterThan(0);
      const contract = slot.contract.members;
      for (const member of members) {
        if (contract.mode === "closed") expect(contract.names, `${meta.id}.${member}`).toContain(member);
        else expect(new RegExp(contract.pattern).test(member), `${meta.id}.${member}`).toBe(true);
      }
      if (contract.mode === "open" && meta.relation !== "subset") expect(members, meta.id).toEqual(expect.arrayContaining([...(contract.required ?? [])]));
      for (const clause of slot.requires) {
        expect(meta.conforms, `${meta.id} ${clause}`).toContain(clause);
        expect(meta.evidence.some(entry => entry.clause === clause), `${meta.id} ${clause}`).toBe(true);
      }
      expect(meta.conforms.filter(clause => !meta.evidence.some(entry => entry.clause === clause)), meta.id).toEqual([]);
    }
  });
});
