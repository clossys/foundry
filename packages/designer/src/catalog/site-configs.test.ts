import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadSectionRegistry, sectionRegistryFindings } from "../catalog-core/sections-contract.js";
import { createCopyResolver, computeCopyFingerprint, COPY_FINGERPRINT_ALGORITHM } from "../../../writer/src/index.js";
import { resolveCopy } from "../../../publisher/src/content/composition.js";
import type { CopyRegistry, CopyRegistryEntry } from "../../../writer/src/types.js";

const json = (path: string) => JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), path), "utf8"));
describe("site reconstruction configs", () => {
  it("registers every config on an existing leaf and preserves its copy schema", () => {
    const registry = loadSectionRegistry();
    expect(sectionRegistryFindings(registry)).toEqual([]);
    const rows = json("../../../writer/src/catalog/__fixtures__/site-bindings.json");
    for (const row of rows) {
      const leaf = registry.slots.find(leaf => leaf.id === row.sectionId)!;
      expect(leaf, row.sectionId).toBeDefined();
      expect(row.configId).toMatch(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/);
      expect(leaf.contract.members.names, `${row.sectionId}:${row.configId}`).toContain(row.configId);
      expect(row.fields.map((field: { key: string }) => field.key).sort()).toEqual(leaf.contract.copy.fields.map(field => field.key).sort());
    }
    const frames = json("./slots/frames.json");
    expect(frames.find((row: { id: string }) => row.id === "frames.site-shell").contract.members.names).toContain("header-placement.overlay");
  });
  it("resolves every config CopyRef in en through the actual PB-COPYREF bridge", () => {
    const data = json("../../../writer/src/catalog/records/site.en.json");
    // Approval exists only in this synthetic runtime fixture, never in the shipped draft data.
    const entries: CopyRegistryEntry[] = data.records.filter((row: { id: string }) => row.id.startsWith("st.")).map((row: { id: string; text: string }) => ({
      id: row.id, text: row.text, context: "Synthetic site binding proof", placeholders: row.text.includes("{date,") ? ["date"] : [], status: "approved",
      approval: { approvedBy: "owner", approvedAt: "2026-09-01T00:00:00.000Z", textFingerprint: computeCopyFingerprint(row.text), fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM },
    }));
    const registry: CopyRegistry = { id: "site-fixture", locale: "en", revision: "r1", source: { kind: "consumer", reference: "site-fixture" }, entries };
    const resolver = createCopyResolver(registry, { now: new Date("2026-09-01T00:00:00.000Z") });
    const bindings = json("../../../writer/src/catalog/__fixtures__/site-bindings.json");
    for (const row of bindings) {
      for (const field of row.fields) { expect(field.source).toBe("writer"); expect(field).not.toHaveProperty("value"); }
      const result = resolveCopy({ composition: { frame: { frameId: "frames.site-shell", configId: "chrome.full" }, libraryVersion: "fixture", sections: [{ key: "content", sectionId: row.sectionId, configId: row.configId, intent: "continues", fields: row.fields }] } }, "en", { resolver });
      expect(result.findings, `${row.sectionId}:${row.configId}`).toEqual([]);
      expect(result.complete).toBe(true);
      expect(Object.keys(result.copy.content ?? {}).length).toBe(row.fields.length);
      const leaf = loadSectionRegistry().slots.find(leaf => leaf.id === row.sectionId)!;
      for (const field of leaf.contract.copy.fields) {
        const value = result.copy.content?.[field.key];
        expect(typeof value).toBe("string");
        expect([...(value ?? "")].length).toBeLessThanOrEqual(field.maxLength.en!);
      }
    }
  });
});
