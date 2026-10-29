import { readFileSync, existsSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";
import { loadWriterCatalog } from "../ia/index.js";
import { checkWriterLeafSets } from "../../catalog-core/leaf-freeze.js";

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

it("shares one existing opaque ID across all page Writer title bindings", () => {
  const pages = read("../records/admin-pages.r1.en.json");
  expect(pages.aliases["strings.admin.page.writer"]).toBe("st.m22sa9p9y4");
  expect(existsSync(new URL("../records/common-labels.r1.en.json", import.meta.url))).toBe(true);
  const common = read("../records/common-labels.r1.en.json");
  expect(common.records.find((record: { id: string }) => record.id === "st.m22sa9p9y4")).toMatchObject({ leaf: "strings.common", text: "Writer" });
  expect(common.usages.filter((usage: { recordId: string }) => usage.recordId === "st.m22sa9p9y4").length).toBeGreaterThan(1);
});

it("accepts only the explicit common-leaf amendment and refuses an undeclared addition", () => {
  const catalog = loadWriterCatalog();
  expect(checkWriterLeafSets(catalog.placements, catalog.slots, ["strings"])).toEqual([]);
  expect(checkWriterLeafSets(catalog.placements, catalog.slots, ["strings"], { amendments: [] })).toContainEqual(expect.objectContaining({ unexpected: ["strings.common"] }));
  const tampered = structuredClone(read("../ia/strings.leaf-amendments.json"));
  tampered[0].baseSignedHead = "a".repeat(40);
  expect(() => checkWriterLeafSets(catalog.placements, catalog.slots, ["strings"], { amendments: tampered })).toThrow("LEAF_FREEZE");
});

it("retains every catalog string ID and cross-reference in canonical records or the alias handoff", () => {
  const aliases = read("./common-label-aliases.r1.json").aliases as Record<string, string>;
  const records = new Set<string>(), references = new Set<string>();
  const collect = (value: unknown): void => {
    if (typeof value === "string" && /^st\.[0123456789abcdefghjkmnpqrstvwxyz]{10}$/.test(value)) references.add(value);
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") {
      const row = value as Record<string, unknown>;
      if (typeof row.id === "string" && typeof row.leaf === "string") records.add(row.id);
      for (const [key, child] of Object.entries(row)) if (key !== "ar") collect(child);
    }
  };
  const visit = (directory: URL): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(new URL(`${entry.name}/`, directory));
      else if (entry.name.endsWith(".json")) collect(JSON.parse(readFileSync(new URL(entry.name, directory), "utf8")));
    }
  };
  visit(new URL("../records/", import.meta.url));
  for (const id of references) expect(records.has(aliases[id] ?? id), id).toBe(true);
  for (const id of Object.keys(aliases)) expect(records.has(id), id).toBe(false);
});

it("keeps every legacy ID as a direct canonical alias and preserves all original per-use constraints", () => {
  expect(existsSync(new URL("./common-label-aliases.r1.json", import.meta.url))).toBe(true);
  const aliases = read("./common-label-aliases.r1.json").aliases as Record<string, string>;
  const common = read("../records/common-labels.r1.en.json");
  expect(Object.keys(aliases)).toHaveLength(267);
  expect(common.records).toHaveLength(177);
  expect(common.usages).toHaveLength(444);
  for (const [id, target] of Object.entries(aliases)) {
    expect(aliases).not.toHaveProperty(target);
    expect(common.records.some((record: { id: string }) => record.id === target), id).toBe(true);
  }
  for (const usage of common.usages) {
    const canonical = common.records.find((record: { id: string }) => record.id === usage.recordId)!;
    expect(canonical.status).toBe(usage.status);
    for (const [key, limit] of Object.entries(usage.limits)) expect(canonical.limits[key]).toBeLessThanOrEqual(limit as number);
  }
});
