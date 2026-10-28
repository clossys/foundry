import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  generateSelection, importFoundryFrames, importFoundrySections, libraryHash,
  loadBuildCatalog, loadSectionRegistry, stableStringify,
  type CompositeCatalogData, type CompositeLibraryData, type FrameSlot, type SurfaceCandidateDocument, type SurfaceDocument,
} from "@clossys/designer/catalog";
import { readLibrary } from "@clossys/designer/catalog/node";
import type { CandidateContent, ContentRegistry } from "../../model.js";

export const at = "2026-10-28T10:00:00Z";

/** Consumer-owned package leaves, read through Designer's public filesystem API.
 * No rendered-conformance or release evidence is invented by this fixture.
 */
export async function designerFixture(root: string): Promise<{ catalog: CompositeCatalogData; version: string }> {
  const section = loadSectionRegistry().slots.find(slot => slot.id === "sections.section-header")!;
  const frame = loadBuildCatalog().slots.find((slot): slot is FrameSlot => slot.id === "frames.site-shell" && slot.layer === "frames")!;
  const candidates = [
    ...importFoundryFrames().fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === frame.id),
    ...importFoundrySections().fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === section.id),
  ];
  // Publisher selects owned config IDs, so the fixture explicitly owns one.
  for (const candidate of candidates) if ("sections" in candidate) {
    const descriptor = candidate.sections["section-header"]!;
    candidate.sections = { "section-header": { ...descriptor, configs: { default: "./blocks#SectionHeader" } } };
  }
  const catalog: CompositeCatalogData = {
    values: { slots: [], standards: [], sources: [], fills: [], placements: [], retired: [] },
    components: { slots: [], fills: [] },
    surfaces: { slots: [frame, section], fills: candidates as unknown as SurfaceCandidateDocument[], transforms: [], rules: [], materializations: [] },
  };
  const source = { id: "sample", kind: "consumer", author: "consumer", license: "MIT" } as const;
  await mkdir(join(root, "fills"), { recursive: true });
  const selection = generateSelection({ source, fills: [] });
  await writeFile(join(root, "source.json"), stableStringify(source));
  await writeFile(join(root, "metadata.json"), stableStringify({ format: "composite-v1", values: {}, components: {}, files: [], adoptedAt: "2026-10-28", surfaces: { version: 1, files: [] } }));
  await writeFile(join(root, "selection.json"), stableStringify(selection));
  const selected: { slot: string; fill: string; originKind: "package"; source: string }[] = [];
  for (const candidate of candidates) {
    const meta = candidate.$extensions["com.clossys.fill"];
    const layer = meta.slot.startsWith("frames.") ? "frames" : "sections";
    const leaf = meta.slot.slice(layer.length + 1);
    const entries = (candidate as unknown as Record<string, Record<string, unknown>>)[layer]!;
    const descriptor = entries[leaf]!;
    const origin = {
      kind: "package", source: meta.source, fill: meta.id, pin: meta.pin, license: meta.license,
      descriptorHash: `sha256:${createHash("sha256").update(stableStringify(descriptor)).digest("hex")}`, adoptedAt: "2026-10-28",
    };
    const owned = {
      $extensions: { "com.clossys.fill": {
        id: `sample/${meta.slot}`, slot: meta.slot, source: source.id, mode: "implementation",
        sourceAddress: `fills/${meta.slot}.json`, relation: "same-contract", builtOn: [], conforms: [], evidence: [],
        author: "consumer", trust: "consumer", license: meta.license, status: "draft", originKinds: ["package"],
      } },
      [layer]: { [leaf]: { ...(descriptor as object), origin } },
    } as unknown as SurfaceDocument;
    await writeFile(join(root, "fills", `${meta.slot}.json`), stableStringify(owned));
    selected.push({ slot: meta.slot, fill: `sample/${meta.slot}`, originKind: "package", source: meta.source });
  }
  await writeFile(join(root, "surface-selection.json"), stableStringify({ version: 1, consumer: source.id, slots: selected.sort((a, b) => a.slot.localeCompare(b.slot)) }));
  const library: CompositeLibraryData = await readLibrary(root, catalog);
  return { catalog, version: libraryHash(library) };
}

export function emptyRegistry(): ContentRegistry {
  return {
    workspace: { consumerId: "sample", defaultLocale: "en", locales: ["en"], deployTargets: [{ id: "public", repo: "sample", app: "site" }], destinations: [] },
    slots: [], candidates: [],
  };
}

export const slotInput = {
  aliases: ["websites/site/home"], locales: ["en"], l1: "websites", l2: "site",
  position: { order: 0, name: "home" }, name: "Home", kind: "content", route: "/", deployTarget: "public", devOnly: false, tags: [],
} as const;

export function writerContent(version: string, heading = "Welcome"): CandidateContent {
  return {
    name: "Home", brief: { audience: "Readers", goal: "Inform", keyMessage: "Welcome", callToAction: "Continue", tone: "Clear", constraints: [], sourceAnswers: [], version: 1 },
    composition: { libraryVersion: version, frame: { frameId: "frames.site-shell", configId: "default" }, sections: [{
      key: "intro", sectionId: "sections.section-header", configId: "default", intent: "continues",
      fields: [{ key: "heading", locale: "en", value: heading, source: "writer" }],
    }] },
    pageMeta: [{ key: "title", locale: "en", value: "Home", source: "writer" }, { key: "description", locale: "en", value: "Consumer owned home page", source: "writer" }],
    links: [], typeSettings: {}, openQuestions: [],
  };
}
