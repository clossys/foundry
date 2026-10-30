import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadSectionRegistry, sectionRegistryFindings } from "../catalog-core/sections-contract.js";
import { createCopyResolver, computeCopyFingerprint, COPY_FINGERPRINT_ALGORITHM } from "../../../writer/src/index.js";
import { resolveCopy } from "../../../publisher/src/content/composition.js";
import type { CopyRegistry, CopyRegistryEntry } from "../../../writer/src/types.js";
import { writerPassageSchemaDigest } from "../../../writer/src/checks/closed-world.js";

const json = (path: string) => JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), path), "utf8"));
describe("site reconstruction configs", () => {
  it("registers every config on an existing leaf and preserves its copy schema", () => {
    const registry = loadSectionRegistry();
    expect(sectionRegistryFindings(registry)).toEqual([]);
    const rows = json("../../../writer/src/catalog/__fixtures__/site-bindings.json");
    for (const row of rows) {
      if (row.sectionId === "sections.error-message") {
        expect(registry.aliases).toContainEqual({ id: row.sectionId, target: "sections.error-state" });
        expect(registry.slots.some(leaf => leaf.id === row.sectionId)).toBe(false);
        const data = json("../../../writer/src/catalog/records/site.en.json");
        const passage = data.records.find((record: { id: string }) => record.id === data.aliases[row.passageAlias]);
        const leaf = registry.slots.find(leaf => leaf.id === "sections.error-state")!;
        expect(passage).toMatchObject({ id: "ps.000000002q", leaf: "passages.error-state", schema: "passages.error-state", status: "draft" });
        expect(leaf.contract.members.names).toContain("kind.failure");
        const keys = { status: "code", title: "header.heading", description: "header.description", "actions[].label": "retry.label", reference: "report.label" } as const;
        expect(row.fields.map((field: { key: string }) => field.key).sort()).toEqual(Object.keys(keys).sort());
        const expected = Object.fromEntries(Object.entries(keys).map(([old, current]) => [current, { ref: "string", id: data.aliases[`${row.passageAlias}.${old.replace("[]", ".item")}`] }]));
        expect(passage.fields).toEqual(expected);
        for (const key of Object.values(keys)) expect(leaf.contract.copy.fields.some(field => field.key === key), key).toBe(true);
        const schema = json("../../../writer/src/catalog/slots/passages.json").find((slot: { id: string }) => slot.id === passage.schema)!;
        expect(schema.contract.copy).toEqual(leaf.contract.copy);
        expect(passage.schemaDigest).toBe(writerPassageSchemaDigest(schema.contract));
        continue;
      }
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
