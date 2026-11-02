// @vitest-environment node
import { expect, it } from "vitest";
import { emitSurfacePackageCandidate, loadSectionRegistry, sectionRegistryFindings } from "../catalog-core/index.js";
import { foundrySurfaceCatalog, readSurfacePackageEvidence } from "../catalog-core/server.js";
import { loadNativeCompositeCatalog } from "./native-catalog.js";

const slot = "sections.sectioned-document";
it("registers the whole resolved document once in the existing reading placement without additional copy", () => {
  const registry = loadSectionRegistry();
  expect(sectionRegistryFindings(registry)).toEqual([]);
  expect(registry.slots.filter(row => row.id === slot)).toHaveLength(1);
  expect(registry.slots.find(row => row.id === slot)?.contract).toEqual({
    kind: "section", root: "div", anatomy: { band: null, header: null },
    slots: [{ name: "document", type: "records", required: true }],
    members: { mode: "closed", names: ["landmark.none"] }, allowedComposes: [], parts: [],
    allowedReads: { themes: [], assets: [] }, data: "host-injected", surface: "site",
    passageSchema: "passages.sectioned-document", copy: { sourceLocale: "en", fields: [] },
  });
  const explain = registry.placement.nodes.find(node => node.id === "explain");
  if (!explain || !("children" in explain)) throw new Error("existing explain placement required");
  expect(explain.children.find(node => node.id === "explain-reading")).toMatchObject({ leaves: expect.arrayContaining([slot]) });
});

it("emits the authentic public Publisher package re-export using actual installed artifact evidence", async () => {
  const surfaces = foundrySurfaceCatalog();
  const docs = surfaces.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === slot);
  expect(docs).toHaveLength(1);
  const document = docs[0];
  if (!document) throw new Error("registered document provider required");
  expect(document.$extensions["com.clossys.fill"]).toMatchObject({
    id: "foundry/sections.sectioned-document", source: "foundry", status: "draft", evidence: [],
    pin: { package: "@clossys/publisher", version: "0.13.0", export: "./web#SectionedView" },
  });
  const emission = emitSurfacePackageCandidate({ catalog: loadNativeCompositeCatalog(), slot, source: "foundry", packages: await readSurfacePackageEvidence(docs) });
  expect(emission.file.contents).toBe('export { SectionedView as SectionedDocument } from "@clossys/publisher/web";\n');
  expect(emission).toMatchObject({ export: "SectionedDocument", adapter: "package", rendering: "server", descriptor: {
    slotMap: { document: "./web#SectionedView.document,landmark" },
    propMap: { "landmark.none": "./web#SectionedView.landmark=none" }, configs: {},
  } });
  expect(emission.package.module).toBe("@clossys/publisher/web");
  expect(emission.package.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
});
