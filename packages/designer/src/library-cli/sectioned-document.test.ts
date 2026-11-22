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
    members: { mode: "closed", names: ["landmark.none"] },
    // GATES-RED G3: the composes and reads measured from the real import graph are declared.
    // BR-RETIRE3 (owner 2026-11-20): components.link becomes components.button; components.status-mark leaves.
    allowedComposes: ["components.avatar", "components.badge", "components.card", "components.disclosure", "components.icon", "components.item", "components.button", "components.semantic-content"],
    parts: [],
    allowedReads: { themes: ["themes.accent", "themes.background", "themes.font-mono", "themes.primary", "themes.primary-foreground"], assets: [] },
    composes: ["sections.content", "sections.media", "sections.pricing", "sections.section-header"],
    data: "host-injected", surface: "site",
    passageSchema: "passages.sectioned-document", copy: { sourceLocale: "en", fields: [] },
  });
  // foundry-build-0018: the recut places the document under Sections > Reading.
  const root = registry.placement.nodes.find(node => node.id === "sections");
  if (!root || !("children" in root)) throw new Error("existing sections placement required");
  expect(root.children.find(node => node.id === "sections-reading")).toMatchObject({ leaves: expect.arrayContaining([slot]) });
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
