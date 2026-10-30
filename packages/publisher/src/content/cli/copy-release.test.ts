import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { computeCopyFingerprint } from "@clossys/writer";
import { applyLibraryChange, importFoundryComponents, importFoundryFrames, importFoundrySections, libraryHash, loadBuildCatalog, loadCatalog, loadComponentRegistry, loadSectionRegistry } from "@clossys/designer/catalog";
import { readSurfacePackageEvidence } from "@clossys/designer/catalog/node";
import { selectedPackageClosure } from "../../../../designer/src/catalog-core/__fixtures__/surface-engine/selected-package-closure.js";
import { libraryFiles } from "@clossys/designer/catalog/server";
import { publicationLibraryPins } from "../release/publication.js";
import { mainPublisherContent } from "./index.js";
import { loadContentStore, writeContentStore } from "../store/index.js";
import { at, designerFixture, emptyRegistry, slotInput, writerContent } from "./__fixtures__/workflow.js";

async function nativePublicationLibrary() {
  const ids = new Set(["frames.site-shell", "sections.section-header"]);
  const catalog = { values: loadCatalog(), components: { slots: loadComponentRegistry().slots, fills: importFoundryComponents().fills }, surfaces: {
    slots: [...loadSectionRegistry().slots.filter(row => ids.has(row.id)), ...loadBuildCatalog().slots.filter((row): row is import("@clossys/designer/catalog").FrameSlot => row.layer === "frames" && ids.has(row.id))],
    fills: [...importFoundryFrames().fills, ...importFoundrySections().fills].filter(row => ids.has(row.$extensions["com.clossys.fill"].slot)), transforms: [], rules: [], materializations: [],
  } };
  const { library } = selectedPackageClosure(catalog);
  const options = { packages: await readSurfacePackageEvidence(catalog.surfaces.fills), measurements: [] };
  return { catalog, options, library: applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: [...ids].map(slot => ({ portion: "surfaces" as const, change: { op: "adopt" as const, slot: slot as `frames.${string}`, source: "foundry" } })) }, { surfaceOptions: options }) };
}

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
it.each([false, true])("releases reviewed native CopyRefs with the current Writer and Designer context (publication: %s)", async withPublication => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "publisher-copy-release-"))); roots.push(parent);
  const root = join(parent, "publisher"), designer = join(parent, "designer");
  const adopted = withPublication ? await nativePublicationLibrary() : undefined;
  if (adopted) for (const [name, bytes] of libraryFiles(adopted.catalog, adopted.library, [])) {
    await mkdir(dirname(join(designer, name)), { recursive: true }); await writeFile(join(designer, name), bytes);
  }
  const { catalog, version } = adopted ? { catalog: adopted.catalog, version: libraryHash(adopted.library) } : await designerFixture(designer);
  const catalogFile = join(parent, "catalog.json"), inputFile = join(parent, "command.json"), writerFile = join(parent, "writer.json");
  await writeFile(catalogFile, JSON.stringify(catalog));
  const empty = emptyRegistry();
  await writeContentStore(root, { ...empty, workspace: { ...empty.workspace, consumerId: adopted?.library.source.id ?? empty.workspace.consumerId } });
  const texts = ["Welcome", "Home", "A native home page", "publication"];
  const writer = { registry: { id: "site", revision: "r1", locale: "en", source: { kind: "consumer", reference: "synthetic/site" },
    entries: texts.map((text, i) => ({ id: `site.${i}`, text, context: "Synthetic publication copy", status: "approved",
      approval: { approvedBy: "owner", approvedAt: at, fingerprintAlgorithm: "sha256", textFingerprint: computeCopyFingerprint(text) } })) } };
  await writeFile(writerFile, JSON.stringify(writer));
  async function run(command: string, input: unknown, withWriter = true) {
    await writeFile(inputFile, JSON.stringify(input));
    return mainPublisherContent([command, "--root", root, "--designer", designer, "--catalog", catalogFile, "--input", inputFile, "--at", at,
      ...(withWriter ? ["--writer", writerFile] : [])]);
  }
  expect(await run("slot-create", { slot: slotInput })).toMatchObject({ exitCode: 0, findings: [] });
  const load = () => loadContentStore(root, { designer: { root: designer, catalog } });
  const slot = (await load()).registry.slots[0]!;
  const content = writerContent(version);
  content.composition!.sections[0]!.fields = [{ key: "heading", locale: "en", source: "writer", ref: { id: "site.0" } }];
  content.pageMeta = ["title", "description"].map((key, i) => ({ key, locale: "en", source: "writer", ref: { id: `site.${i + 1}` } }));
  if (adopted) {
    const engine = { catalog: adopted.catalog, library: adopted.library, surfaceOptions: adopted.options };
    const pins = publicationLibraryPins(engine);
    const pin = (id: number) => ({ ref: { id: `site.${id}`, locale: "en" }, fingerprint: computeCopyFingerprint(texts[id]!) });
    content.typeSettings = { publication: {
      version: 1, libraryVersion: pins.version,
      configPins: [pins.configs.find(row => row.leaf === "sections.section-header" && row.config === "default")!],
      map: { version: 1, publicationId: "publication", format: "web.page.responsive", entries: [{ id: "home", order: 0, title: "Home", kind: "page", path: "/", pin: { nav: true }, source: { planItemId: "home" },
        constructs: { main: [{ section: "sections.section-header", config: "default", content: { heading: { kind: "copy", ref: "heading" } } }] }, manifest: { l0: [] } }] },
      bindings: { consumer: engine.library.source.id, channel: "site", brand: { homeRouteId: "home", label: "Home" }, completeRoutes: { home: { kind: "designer", entry: { file: "src/app/page.tsx", export: "default" }, loader: { file: "src/data/home.ts", export: "loadRoute" } } } },
      origin: "https://example.test", copyPins: { "map/publicationId": pin(3), "map/entries/0/title": pin(1), "bindings/brand/label": pin(1), heading: pin(0) },
    } };
  }
  expect((await run("candidate-add", { slotId: slot.id, content })).exitCode).toBe(0);
  const reviewed = await run("review", { candidateId: "c1" });
  expect(reviewed.findings).toEqual([]);
  const { report } = reviewed.data as any;
  expect((await run("approve", { candidateId: "c1", by: "owner", revision: report.revision, digest: report.digest })).exitCode).toBe(0);
  expect((await run("activate", { candidateId: "c1" })).exitCode).toBe(0);
  const released = await run("release", { candidateId: "c1", approvedBy: "owner" });
  expect(released.findings).toEqual([]);
  expect(released.exitCode).toBe(0);
  const prefix = join(root, "_releases", "public");
  const before = await readFile(join(prefix, "1.json"), "utf8");
  if (adopted) {
    const build = JSON.parse(await readFile(join(prefix, "1.build.json"), "utf8"));
    expect(Object.keys(build.publications[0].products)).toHaveLength(7);
    for (const product of Object.values(build.publications[0].products) as any[]) expect(product.releaseDigest).toBe(JSON.parse(before).digest);
  }
  expect(JSON.parse(before).entries[0]).toMatchObject({ candidateId: "c1", revision: report.revision, digest: report.digest });
  expect(JSON.parse(await readFile(join(prefix, "1.handover.json"), "utf8"))).toMatchObject({ matches: false, status: "pending", observedAt: null });
  for (const problem of ["missing", "unapproved", "stale"] as const) {
    const changed = structuredClone(writer);
    if (problem === "unapproved") changed.registry.entries[0]!.status = "draft";
    if (problem === "stale") changed.registry.entries[0]!.text += " changed";
    await writeFile(writerFile, JSON.stringify(changed));
    const refused = await run("release", { candidateId: "c1", approvedBy: "owner" }, problem !== "missing");
    expect(refused.exitCode).toBe(1);
    expect(refused.findings.length).toBeGreaterThan(0);
    expect((await readdir(prefix)).sort()).toEqual(["1.build.json", "1.handover.json", "1.json"]);
    expect(await readFile(join(prefix, "1.json"), "utf8")).toBe(before);
  }
  if (adopted) {
    await writeFile(writerFile, JSON.stringify(writer));
    const sourceFile = join(designer, "source.json");
    const source = JSON.parse(await readFile(sourceFile, "utf8"));
    await writeFile(sourceFile, JSON.stringify({ ...source, author: "different source" }));
    const refused = await run("release", { candidateId: "c1", approvedBy: "owner" });
    expect([1, 2]).toContain(refused.exitCode);
    expect(refused.findings.length).toBeGreaterThan(0);
    expect((await readdir(prefix)).sort()).toEqual(["1.build.json", "1.handover.json", "1.json"]);
    expect(await readFile(join(prefix, "1.json"), "utf8")).toBe(before);
  }
}, 120000);
