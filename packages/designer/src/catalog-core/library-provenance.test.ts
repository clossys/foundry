/** @vitest-environment node */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { componentLibraryColumns, libraryItemProvenance, libraryRoster } from "./library-roster.js";
import { loadBuildCatalog, loadCatalog } from "./index.js";
import type { ComponentCandidateDocument } from "./resolve-components.js";

const catalog = loadCatalog();
const directory = new URL("../catalog/fills/shadcn@aria/", import.meta.url);
const documents = readdirSync(directory).filter(name => name !== "components.coverage.json").map(name =>
  JSON.parse(readFileSync(new URL(name, directory), "utf8")) as ComponentCandidateDocument);
const slots = loadBuildCatalog().slots.filter(slot => slot.layer === "components").map(slot => slot.id);
const commit = "daaf156ee00ed91cc7e6bdd937c1b4973152d141";
const columns = () => componentLibraryColumns(catalog.sources, documents, slots, "preview");

describe("item-specific library provenance", () => {
  it("projects exactly 26 real drafts across 57 signed slots and one unqualified local draft", () => {
    expect(slots).toHaveLength(59);
    expect(columns().flatMap(column => column.candidates).some(candidate => candidate.fill.slot === "components.semantic-content")).toBe(false);
    expect(documents).toHaveLength(26);
    const result = columns();
    expect(result).toHaveLength(1);
    const column = result[0]!;
    expect(column.id).toBe("shadcn@aria");
    expect(column.role).toBe("candidate-source");
    expect(column.referenceOnly).toBe(false);
    expect(column.license).toBe("MIT");
    expect(column.candidates).toHaveLength(26);
    expect(new Set(column.candidates.map(candidate => candidate.fill.slot)).size).toBe(26);
    expect(column.candidates.filter(candidate => candidate.fill.relation === "subset")).toHaveLength(0);
    expect(column.candidates.filter(candidate => candidate.fill.relation === "same-contract")).toHaveLength(26);
    for (const candidate of column.candidates) {
      const original = documents.find(doc => doc.$extensions["com.clossys.fill"].id === candidate.fill.id)!;
      expect(candidate.fill).toEqual(original.$extensions["com.clossys.fill"]);
      expect(candidate.implementation).toEqual(Object.values(original.components)[0]);
      expect(candidate.layer).toBe("components");
      expect(candidate.fill.status).toBe("draft");
      expect(candidate.qualification).toBe("unassessed");
      expect(candidate.fill.license).toBe("MIT");
      expect(candidate.sourceLicense).toBe("MIT");
      expect(candidate.fill.pin?.commit).toBe(commit);
      expect(candidate.fill.pin?.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(candidate.fill.sourceAddress).toContain(`/blob/${commit}/apps/v4/registry/bases/aria/ui/`);
      expect(candidate.fill.sourceAddress).not.toContain("themes.ts");
      expect(candidate.implementation.pin?.commit).toBe(commit);
      expect(candidate.implementation.pin?.files).toContainEqual({
        path: candidate.fill.sourceAddress.split(`/blob/${commit}/`)[1], sha256: candidate.fill.pin!.sha256,
      });
      expect(candidate.implementation.pin?.files).toEqual(expect.arrayContaining([
        { path: "apps/v4/registry/styles/style-nova.css", sha256: "fd9803ec398290c306b377a46a769cad0c7ff024bf6a626993c113cacc20f16e" },
        { path: "LICENSE.md", sha256: "1564074e13439397221ffd522e2e504d56561994a23d371aa5e3ad43e4f5423f" },
      ]));
      expect(candidate.implementation.notice).toBeTruthy();
      if (candidate.fill.relation === "same-contract") expect(candidate.fill.unmapped ?? []).toEqual([]);
      if (candidate.fill.relation === "subset") expect(candidate.fill.unmapped!.length).toBeGreaterThan(0);
    }
  });

  it("maps every button member (no gaps) and preserves item hashes alongside separate token-theme context", () => {
    const button = columns()[0]!.candidates.find(candidate => candidate.fill.slot === "components.button")!;
    expect(button.fill.unmapped).toEqual([]);
    expect(button.fill.pin?.sha256).toBe("8bcff6f70522e6e6cb0ff67f050830ea1a93596403d2d9b035f3b543c7a42e2c");
    expect(button.sourceRecordPin?.file).toBe("apps/v4/registry/themes.ts#neutral");
    expect(button.fill.pin).not.toEqual(button.sourceRecordPin);
    const token = catalog.fills.find(doc => doc.$extensions["com.clossys.fill"].source === "shadcn@aria")!;
    const meta = token.$extensions["com.clossys.fill"];
    const evidence = libraryItemProvenance(catalog.sources, meta);
    expect(evidence.layer).toBe("tokens");
    expect(evidence.fill).toEqual(meta);
    expect(evidence.sourceRecordPin?.file).toBe("apps/v4/registry/themes.ts#neutral");
    const missingPin = { ...button.fill };
    delete missingPin.pin;
    expect(libraryItemProvenance(catalog.sources, missingPin).fill.pin).toBeUndefined();
  });

  it("hides unsupported and empty columns without aliasing reference identities", () => {
    for (const slot of slots.filter(slot => !documents.some(doc => doc.$extensions["com.clossys.fill"].slot === slot))) {
      expect(componentLibraryColumns(catalog.sources, documents, [slot], "preview")).toEqual([]);
    }
    expect(componentLibraryColumns(catalog.sources, [], slots, "preview")).toEqual([]);
    for (const id of ["shadcn-ui", "base-ui", "radix-themes"]) {
      expect(libraryRoster("components", "components.button").find(entry => entry.id === id)?.role).toBe("reference");
    }
    const reference = structuredClone(documents.find(doc => doc.$extensions["com.clossys.fill"].slot === "components.button")!);
    reference.$extensions["com.clossys.fill"].source = "shadcn-ui";
    Object.values(reference.components)[0]!.source = "shadcn-ui";
    const projected = componentLibraryColumns(catalog.sources, [reference], ["components.button"], "preview");
    expect(projected[0]?.id).toBe("shadcn-ui");
    expect(projected[0]?.referenceOnly).toBe(true);
  });

  it("returns detached evidence without changing sources, fills or engine metadata", () => {
    const before = structuredClone({ catalog, documents });
    const result = columns();
    result[0]!.candidates[0]!.fill.status = "stable";
    expect({ catalog, documents }).toEqual(before);
  });
});
