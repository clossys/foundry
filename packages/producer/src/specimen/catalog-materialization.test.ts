import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { importFoundryFrames, importFoundrySections, loadBuildCatalog, loadCatalog, loadComponentRegistry, runtimeHash, type CompositeCatalogData, type RuntimeJson, type SurfaceCandidateDocument, type SurfaceSlot } from "@clossys/designer/catalog";
import { readSurfacePackageEvidence } from "@clossys/designer/catalog/node";
import { recordStoreSource } from "@clossys/publisher/specimen";
import { bindPage, resolveNativeNextDraft, resolvePage } from "@clossys/publisher/install";
import { candidatesDir, designerIa, jsonBytes, pinFile, SLOT_SCHEMA, slotDir, slotFile, slotPositions } from "../records/slot-model/index.js";
import { listSlots, readCandidate } from "../records/slots.js";
import { sha256Hex } from "../records/hash.js";
import { libraryRecordStore } from "./library-source.js";
import { materializeCatalogCandidate, type CatalogCandidateInput } from "./catalog-materialization.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "catalog-candidate-"))); roots.push(root);
  const build = loadBuildCatalog(), frames = importFoundryFrames(), sections = importFoundrySections();
  const catalog: CompositeCatalogData = {
    values: loadCatalog(), components: { slots: loadComponentRegistry().slots, fills: [] },
    surfaces: { slots: build.slots.filter(slot => slot.layer === "frames" || slot.layer === "sections") as NonNullable<CompositeCatalogData["surfaces"]>["slots"], fills: [...frames.fills, ...sections.fills] as unknown as SurfaceCandidateDocument[], transforms: [], rules: [], materializations: [] },
  };
  const ia = designerIa().ia;
  mkdirSync(join(root, "agents/designer"), { recursive: true });
  writeFileSync(join(root, "agents/designer/ia.json"), jsonBytes(ia));
  for (const id of ["frames.site-shell", "sections.hero"] as const) {
    const position = slotPositions("designer", ia).get(id)!, dir = slotDir(root, "designer", position, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(slotFile(dir), jsonBytes({ schema: SLOT_SCHEMA, id, agent: "designer", ia: position, kind: "element", contract: build.slots.find(slot => slot.id === id)!.contract, inputs: [], uses: [] }));
  }
  const packages = await readSurfacePackageEvidence(catalog.surfaces!.fills);
  const reference = (key: string) => ({ kind: "copy" as const, ref: `fixture:${key}` });
  // Actual public neutral asset bytes, not an invented production mark.
  const svg = readFileSync(new URL("../../../designer/src/catalog-assets/image-default.svg", import.meta.url), "utf8");
  const values: Record<string, RuntimeJson> = { "skip-link": "Skip to content", header: { brand: { label: "Example", mark: { src: `data:image/svg+xml,${encodeURIComponent(svg)}`, width: 320, height: 180 } } } };
  const props = {
    content: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { reference: reference(key), value, hash: runtimeHash(value) }])),
    selection: { leaf: "frames.site-shell", fill: "foundry/frames.site-shell", config: null, members: ["footer-placement.flow"], content: Object.fromEntries(Object.keys(values).map(key => [key, reference(key)])) },
    locale: "en",
  };
  const input: CatalogCandidateInput = { root, slot: "frames.site-shell", element: "native-site", source: "foundry", catalog, packages, preview: { props } };
  return { root, catalog, input };
}

it("materializes real package providers through canonical records and page resolution, retaining draft identity and copyKeys transport", async () => {
  const { root, input } = await fixture();
  const first = await materializeCatalogCandidate(input), second = await materializeCatalogCandidate(input);
  expect(first).toMatchObject({ status: "DRAFT", approved: false, candidate: "native-site-v1.json", version: 1, ports: { serverRequired: true, unresolved: ["children/main"] } });
  expect(second.candidate).toBe("native-site-v2.json");
  const entry = listSlots(root, "designer").find(row => row.id === input.slot)!;
  expect(existsSync(pinFile(entry.dir))).toBe(false);
  const read = readCandidate(root, "designer", input.slot, first.candidate);
  expect(first.contentHash).toBe(read.sha256);
  expect(first.record).toEqual(await libraryRecordStore([root]).load(first.id, first.version));
  const item = JSON.parse(read.bytes);
  expect(item.meta.source).toMatchObject({ kind: "registry", ref: ["foundry/frames.site-shell", "@clossys/designer@0.12.0./frames#SiteFrame"] });
  expect(item.files[0].content).toContain("siteShellProps({ ...input");
  expect(item.files[0].content).not.toContain("Skip to content");
  expect(item.meta).not.toHaveProperty("adoptedAt");
  const hero = await materializeCatalogCandidate({ ...input, slot: "sections.hero", element: "native-hero", preview: { props: { heading: { $copy: "hero.heading" } } } });
  const source = recordStoreSource(libraryRecordStore([root]));
  const page = { id: "example", frame: input.slot, sections: ["sections.hero"], copy: { "hero.heading": "page.heading" } };
  const pins = { [input.slot]: { element: input.element, version: first.version }, "sections.hero": { element: "native-hero", version: hero.version } };
  const resolved = await resolvePage(page, pins, source);
  expect(resolved.findings).toEqual([]);
  expect(bindPage({ page, slots: resolved.slots, copy: { "page.heading": "An authored heading" } }).page?.sections[0]?.props.heading).toBe("An authored heading");

  // SYNTHETIC transport fixture, not package-provider qualification: this module
  // actually consumes copy, unlike package exports with individual text props.
  const payload = { name: "copy-section", type: "registry:block", files: [{ path: "copy-section.tsx", target: "components/copy-section.tsx", type: "registry:component", content: 'export const copyKeys = { heading: "hero.heading" }; export function CopySection({copy}) { return copy.heading; }' }] };
  const bytes = jsonBytes(payload);
  const copySource = recordStoreSource({ async load(id, version) { return id === "sections.hero/copy-section" ? { id, version: version!, kind: payload.type, files: [{ path: "copy-section.json", content: bytes }], preview: { fixtures: { file: "copy-section.tsx", export: "CopySection", copyKeys: "copyKeys", props: {} } }, contentHash: sha256Hex(bytes) } : libraryRecordStore([root]).load(id, version); } });
  const copied = await resolvePage(page, { ...pins, "sections.hero": { element: "copy-section", version: 1 } }, copySource);
  expect(copied.findings).toEqual([]);
  expect(copied.slots.find(slot => slot.slot === "sections.hero")?.copyKeys).toBe("copyKeys");

  writeFileSync(join(candidatesDir(entry.dir), first.candidate), read.bytes.replace("Skip to content", "Changed copy"));
  const draft = await resolveNativeNextDraft({ page, candidates: { [input.slot]: { ...pins[input.slot]!, contentHash: first.contentHash }, "sections.hero": { ...pins["sections.hero"], contentHash: hero.contentHash } }, source, copy: { "page.heading": "An authored heading" } });
  expect(draft.findings).toContainEqual(expect.objectContaining({ code: "hash-mismatch" }));
  expect(draft.module).toBeUndefined();
  expect(existsSync(pinFile(entry.dir))).toBe(false);
});

it("retains Hero optional authored copy through native candidate readback and page binding while heading remains required", async () => {
  const { root, input } = await fixture();
  const frame = await materializeCatalogCandidate(input);
  const heading = { $copy: "hero.heading" };
  const heroInput = { ...input, slot: "sections.hero" as const, element: "native-hero" };
  const headingOnly = await materializeCatalogCandidate({ ...heroInput, preview: { props: { heading } } });
  expect(headingOnly.record.preview).toMatchObject({ fixtures: { props: { heading } } });
  const props = { heading, eyebrow: { $copy: "hero.eyebrow" }, description: { $copy: "hero.description" } };
  const optional = await materializeCatalogCandidate({ ...heroInput, preview: { props } });
  expect(optional).toMatchObject({ status: "DRAFT", approved: false, version: 2 });
  const read = readCandidate(root, "designer", heroInput.slot, optional.candidate);
  const item = JSON.parse(read.bytes);
  expect(item.meta.preview.fixtures.props).toEqual(props);
  expect(optional.contentHash).toBe(read.sha256);
  expect(optional.record).toEqual(await libraryRecordStore([root]).load(optional.id, optional.version));
  const entry = listSlots(root, "designer").find(row => row.id === heroInput.slot)!;
  expect(existsSync(pinFile(entry.dir))).toBe(false);
  const source = recordStoreSource(libraryRecordStore([root]));
  const page = { id: "neutral-hero", frame: input.slot, sections: [heroInput.slot], copy: {
    "hero.heading": "page.heading", "hero.eyebrow": "page.eyebrow", "hero.description": "page.description",
  } };
  const copy = { "page.heading": "A neutral heading", "page.eyebrow": "  Authored eyebrow  ", "page.description": "A neutral authored description." };
  const resolve = async (version: number) => {
    const resolved = await resolvePage(page, { [input.slot]: { element: input.element, version: frame.version },
      [heroInput.slot]: { element: heroInput.element, version } }, source);
    expect(resolved.findings).toEqual([]);
    const bound = bindPage({ page, slots: resolved.slots, copy });
    expect(bound.findings).toEqual([]);
    return bound.page!.sections[0]!.props;
  };
  expect(await resolve(headingOnly.version)).toEqual({ heading: copy["page.heading"] });
  expect(await resolve(optional.version)).toEqual({ heading: copy["page.heading"], eyebrow: copy["page.eyebrow"], description: copy["page.description"] });
  const before = [...entry.candidates];
  await expect(materializeCatalogCandidate({ ...heroInput, preview: { props: { eyebrow: props.eyebrow, description: props.description } } })).rejects.toThrow(/required native port header is missing/);
  await expect(materializeCatalogCandidate({ ...heroInput, preview: { props: { ...props, invented: "Unmapped" } } })).rejects.toThrow(/no native package binding/);
  expect(listSlots(root, "designer").find(row => row.id === heroInput.slot)!.candidates).toEqual(before);
  expect(existsSync(pinFile(entry.dir))).toBe(false);
});

it("refuses native identity, evidence, port and canonical path mismatches before publishing a candidate", async () => {
  const { root, input } = await fixture();
  const entry = listSlots(root, "designer").find(row => row.id === input.slot)!;
  const originalSlot = readFileSync(slotFile(entry.dir), "utf8");
  const reject = async (change: Partial<CatalogCandidateInput>, message: RegExp) => {
    await expect(materializeCatalogCandidate({ ...input, ...change })).rejects.toThrow(message);
    expect(listSlots(root, "designer").find(row => row.id === input.slot)!.candidates).toEqual([]);
    expect(existsSync(pinFile(entry.dir))).toBe(false);
  };
  await reject({ slot: "frames.absent" as SurfaceSlot }, /candidate/);
  await reject({ element: "../escape" }, /element name/);
  await reject({ packages: input.packages.map(row => ({ ...row, version: "0.0.0" })) }, /evidence/);
  await reject({ packages: input.packages.map(row => ({ ...row, values: [] })) }, /evidence/);
  await reject({ packages: input.packages.map(row => ({ ...row, artifactSha256: "0".repeat(64) })) }, /artifact evidence/);
  await reject({ preview: { props: { ...input.preview.props, content: {} } } }, /required content/);
  await reject({ preview: { props: { ...input.preview.props, selection: { ...(input.preview.props.selection as object), config: "invented" } } } }, /selection/);
  await reject({ preview: { ...input.preview, copyKeys: { label: "site.label" } } }, /copyKeys adapter/);
  const badContent = structuredClone(input.preview.props) as any; badContent.content.header.hash = runtimeHash("different");
  await reject({ preview: { props: badContent } }, /content hash/);
  writeFileSync(slotFile(entry.dir), originalSlot.replace('"frames.site-shell"', '"frames.other"'));
  await reject({}, /target slot identity/);
  writeFileSync(slotFile(entry.dir), originalSlot);
  const external = realpathSync(mkdtempSync(join(tmpdir(), "catalog-outside-"))); roots.push(external);
  symlinkSync(external, candidatesDir(entry.dir), "dir");
  await expect(materializeCatalogCandidate(input)).rejects.toThrow(/ymbolic link/);
  rmSync(candidatesDir(entry.dir));
  const slotBackup = `${entry.dir}-original`;
  const { renameSync } = await import("node:fs");
  renameSync(entry.dir, slotBackup); symlinkSync(slotBackup, entry.dir, "dir");
  await expect(materializeCatalogCandidate(input)).rejects.toThrow(/ymbolic link/);
});
