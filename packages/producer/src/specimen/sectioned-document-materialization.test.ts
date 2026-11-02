import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadCatalog, loadComponentRegistry, runtimeHash, runtimeSnapshot, type CompositeCatalogData, type RuntimeJson } from "@clossys/designer/catalog";
import { foundrySurfaceCatalog, readSurfacePackageEvidence } from "@clossys/designer/catalog/server";
import { createCopyResolver, type CopyRegistry } from "@clossys/writer";
import { resolveSectionedViewDocument, type SectionedViewDocument } from "@clossys/publisher/core";
import { bindPage, resolvePage } from "@clossys/publisher/install";
import { designerIa, jsonBytes, pinFile, SLOT_SCHEMA, slotDir, slotFile, slotPositions } from "../records/slot-model/index.js";
import { listSlots, readCandidate } from "../records/slots.js";
import { libraryRecordSource } from "./library-source.js";
import { materializeCatalogCandidate, type CatalogCandidateInput } from "./catalog-materialization.js";

const slot = "sections.sectioned-document";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function resolvedFixture() {
  // Neutral preview copy only: the real Writer resolver preserves its draft status, without approval records.
  const words = { intro: "Example introduction", overview: "Overview", feature: "Example capability", process: "Process", ordinal: "1", step: "Start", facts: "Facts", label: "Example count", value: "12", detail: "Details", faq: "Questions", question: "How does the example work?", answer: "The example preserves authored content." };
  const registry: CopyRegistry = { id: "sectioned-document-fixture", locale: "en", revision: "1", source: { kind: "consumer", reference: "fixtures/sectioned-document" },
    entries: Object.entries(words).map(([key, text]) => ({ id: `fixture.${key}`, text, context: "neutral preview fixture", status: "draft" })),
  };
  const ref = (key: keyof typeof words) => ({ id: `fixture.${key}` });
  const authored: SectionedViewDocument = { id: "sectioned-document-fixture", sectionGroundRhythm: "base-then-sunken", sections: [
    { id: "intro", kind: "hero", heading: ref("intro") },
    { id: "overview", kind: "feature-grid", heading: ref("overview"), items: [{ id: "feature", heading: ref("feature") }] },
    { id: "process", kind: "ordered-step-sequence", heading: ref("process"), items: [{ id: "start", ordinal: ref("ordinal"), heading: ref("step") }] },
    { id: "facts", kind: "stat-grid", heading: ref("facts"), items: [{ id: "count", label: ref("label"), value: ref("value") }] },
    { id: "details", kind: "feature-grid", heading: ref("detail"), items: [{ id: "detail", heading: ref("feature") }] },
    { id: "questions", kind: "faq", heading: ref("faq"), items: ["one", "two", "three", "four", "five"].map(id => ({ id, question: ref("question"), answer: ref("answer") })) },
  ] };
  const resolved = resolveSectionedViewDocument(authored, createCopyResolver(registry, { target: "preview" }));
  // Standard JSON transport omits optional undefined fields; runtimeSnapshot validates the resulting JSON data.
  const json: RuntimeJson = JSON.parse(JSON.stringify(resolved));
  return { resolved, document: runtimeSnapshot(json) };
}
async function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sectioned-document-"))); roots.push(root);
  const surfaces = foundrySurfaceCatalog();
  const catalog: CompositeCatalogData = { values: loadCatalog(), components: { slots: loadComponentRegistry().slots, fills: [] }, surfaces };
  const native = designerIa(), positions = slotPositions("designer", native.ia);
  mkdirSync(join(root, "agents/designer"), { recursive: true });
  writeFileSync(join(root, "agents/designer/ia.json"), jsonBytes(native.ia));
  for (const id of ["frames.site-shell", slot]) {
    const position = positions.get(id), definition = native.slots.get(id);
    if (!position || !definition) throw new Error(`canonical Designer slot missing: ${id}`);
    const directory = slotDir(root, "designer", position, id);
    mkdirSync(directory, { recursive: true });
    writeFileSync(slotFile(directory), jsonBytes({ schema: SLOT_SCHEMA, id, agent: "designer", ia: position, kind: definition.kind, contract: definition.contract, inputs: definition.declaredInputs, uses: definition.declaredUses }));
  }
  const docs = surfaces.fills.filter(doc => ["frames.site-shell", slot].includes(doc.$extensions["com.clossys.fill"].slot));
  const packages = await readSurfacePackageEvidence(docs);
  const { resolved, document } = resolvedFixture();
  const input: CatalogCandidateInput = { root, slot, element: "sectioned-document", source: "foundry", catalog, packages, preview: { props: { document, landmark: "none" } } };
  return { root, input, resolved, document };
}

it("materializes the registered whole document through canonical records and page binding without granting approval", async () => {
  const { root, input, resolved, document } = await fixture();
  const result = await materializeCatalogCandidate(input);
  expect(result).toMatchObject({ status: "DRAFT", approved: false, candidate: "sectioned-document-v1.json", ports: { required: ["document"], supplied: ["document", "landmark"], unresolved: [], serverRequired: true } });
  const entry = listSlots(root, "designer").find(row => row.id === slot);
  if (!entry) throw new Error("canonical slot readback required");
  expect(entry.position).toMatchObject({ l0: "sections", l1: "sections.explain", l2: "explain-reading" });
  expect(existsSync(pinFile(entry.dir))).toBe(false);
  expect(readCandidate(root, "designer", slot, result.candidate).sha256).toBe(result.contentHash);
  const source = libraryRecordSource({ roots: [root] }), record = await source.read(result.id, result.version);
  expect(record).toMatchObject({ id: result.id, version: result.version, contentHash: result.contentHash, preview: { fixtures: { document, landmark: "none" } } });
  expect(record?.payload.files[0]?.content).toBe('export { SectionedView as SectionedDocument } from "@clossys/publisher/web";\n');
  expect(resolved.sections.map(section => section.id)).toEqual(["intro", "overview", "process", "facts", "details", "questions"]);
  expect(resolved.sections[0]).toMatchObject({ id: "intro", kind: "hero", heading: "Example introduction" });
  expect(resolved.sections.find(section => section.kind === "faq")).toMatchObject({ items: expect.any(Array) });
  const faq = resolved.sections.find(section => section.kind === "faq");
  if (!faq || faq.kind !== "faq") throw new Error("resolved FAQ required");
  expect(faq.items).toHaveLength(5);
  expect(resolved.resolutions.every(row => row.status === "draft" && row.approval === undefined)).toBe(true);

  const values: Record<string, RuntimeJson> = { "skip-link": "Skip to content", header: { brand: { label: "Example" } } };
  const reference = (key: string) => ({ kind: "copy", ref: `fixture:${key}` });
  const frame = await materializeCatalogCandidate({ ...input, slot: "frames.site-shell", element: "native-frame", preview: { props: {
    content: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { reference: reference(key), value, hash: runtimeHash(value) }])),
    selection: { leaf: "frames.site-shell", fill: "foundry/frames.site-shell", config: null, members: [], content: Object.fromEntries(Object.keys(values).map(key => [key, reference(key)])) }, locale: "en",
  } } });
  const page = { id: "sectioned-document-page", frame: "frames.site-shell", sections: [slot], copy: {} };
  const pageResolution = await resolvePage(page, { "frames.site-shell": { element: "native-frame", version: frame.version }, [slot]: { element: input.element, version: result.version } }, source);
  expect(pageResolution.findings).toEqual([]);
  const bound = bindPage({ page, slots: pageResolution.slots, copy: {} });
  expect(bound.findings).toEqual([]);
  expect(bound.page?.sections[0]?.props).toEqual({ document, landmark: "none" });
  // Rendering/provenance semantics remain the existing Publisher SectionedView tests' responsibility.
});

it("refuses missing native document/landmark, an extra main prop, main landmark and forged artifact evidence", async () => {
  const { root, input, document } = await fixture();
  const reject = async (change: Partial<CatalogCandidateInput>, message: RegExp) => {
    await expect(materializeCatalogCandidate({ ...input, ...change })).rejects.toThrow(message);
    expect(listSlots(root, "designer").find(row => row.id === slot)?.candidates).toEqual([]);
  };
  await reject({ preview: { props: { landmark: "none" } } }, /required native port/);
  // LOCAL mutation recipe: remove ',landmark' from the registered required slotMap.document;
  // this missing-landmark refusal must then fail rather than silently accepting the provider's main default.
  await reject({ preview: { props: { document } } }, /required native port/);
  await reject({ preview: { props: { document, landmark: "main" } } }, /native configuration value/);
  await reject({ preview: { props: { document, landmark: "none", main: "unexpected" } } }, /no native package binding/);
  await reject({ packages: input.packages.map(row => ({ ...row, artifactSha256: "0".repeat(64) })) }, /artifact evidence/);
});
