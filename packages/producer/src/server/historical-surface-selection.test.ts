import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyLibraryChange, libraryHash, loadCatalog, loadComponentRegistry, loadFoundrySurfaceHistory, resolve, type CompositeCatalogData, type CompositeLibraryData } from "@clossys/designer/catalog";
import { beforeAll, describe, expect, it } from "vitest";
import { agentModule, agentRoot } from "./cells.js";
import { studioSelection } from "./selection.js";
import { prepareStudioSelection } from "./selection-defaults.js";
import { readStudioDesignerLibrary } from "./theme.js";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const historicalHash = "sha256:e891cbf660bfd5461f23cbacd162bab907869c9883f1090a40e89b1d002ec6f6";
const historicalHolds = [
  ["frames.app-shell", "sha256:6e1d05c03a31919afbd1a644c8f6521672090321ba730195dc2fd7c85721270a"],
  ["sections.content", "sha256:ee0513e37e4e2e0a2fa5530a6bc24eedb959cf06da0eaad22528160cd33aaf02"],
  ["sections.empty-state", "sha256:3c920636372ee73fd262f1e75931d936ea4209075a87bc0ebbe25d58bac300b6"],
  ["sections.section-header", "sha256:ac0351dbd01506c7a97282a49e915189f2e6d54d0cfb9cbe12d78d35fa192054"],
  ["sections.hero", historicalHash],
] as const;

describe("historical package surfaces through native consumer operations", () => {
  let consumer: string;
  beforeAll(async () => {
    const directory = await mkdtemp(join(await realpath(tmpdir()), "producer-historical-surface-"));
    consumer = join(directory, "consumer");
    const registrations = new Map(historicalHolds.map(([slot, hash]) => [slot as string, loadFoundrySurfaceHistory()[hash]![0]!]));
    for (const [slot, registration] of registrations) expect(registration.contract.id).toBe(slot);
    const surfaceApi = await agentModule("designer", "library-cli/surface-catalog.js");
    const current = surfaceApi.foundrySurfaceCatalog() as NonNullable<CompositeCatalogData["surfaces"]>;
    // Adopt using the authentic prior source catalog, never a hand-edited held origin.
    const surfaces = { ...current,
      fills: current.fills.map(doc => registrations.get(doc.$extensions["com.clossys.fill"].slot)?.document as never ?? doc),
      slots: current.slots.map(slot => registrations.get(slot.id)?.contract ?? slot),
    };
    const catalog: CompositeCatalogData = { values: loadCatalog(), components: { slots: loadComponentRegistry().slots, fills: [] }, surfaces };
    const evidence = await agentModule("designer", "library-cli/surface-package-evidence.js");
    const surfaceOptions = { packages: await evidence.readSurfacePackageEvidence(surfaces.fills), measurements: [] };
    const empty: CompositeLibraryData = { source: { id: "example", kind: "consumer", author: "consumer", license: "MIT" }, adoptedAt: "2026-10-30", values: { fills: [] }, components: { fills: [], files: [] }, surfaces: { version: 1, fills: [], files: [] } };
    const library = applyLibraryChange(catalog, empty, { baseHash: libraryHash(empty), changes: [
      { portion: "values", change: { op: "adopt", slot: "tokens.accent-color", source: "foundry" } },
      ...historicalHolds.map(([slot]) => ({ portion: "surfaces" as const, change: { op: "adopt" as const, slot, source: "foundry" } })),
    ] }, { surfaceOptions });
    const reader = await agentModule("designer", "library-cli/fs-library.js");
    const source = join(directory, "library");
    for (const [name, contents] of reader.libraryFiles(catalog, library, [], undefined, surfaceOptions)) {
      const path = join(source, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, contents);
    }
    await mkdir(join(consumer, "clossys"), { recursive: true });
    await writeFile(join(consumer, "clossys/clossys.config.ts"), "export default {};\n");
    const cells = await agentModule("designer", "library-cli/cells.js");
    await cells.libraryToCells(source, agentRoot(consumer, "designer"), { catalog, date: "2026-10-30", surfaceOptions });
    await cells.compileLibraryCells(agentRoot(consumer, "designer"), join(agentRoot(consumer, "designer"), "compiled"), { catalog, surfaceOptions });
    const bin = join(consumer, "clossys/node_modules/.bin");
    await mkdir(bin, { recursive: true });
    const manifest = JSON.parse(await readFile(join(repository, "packages/designer/package.json"), "utf8"));
    await symlink(join(repository, "packages/designer", manifest.bin["designer-library"]), join(bin, "designer-library"));
    // Retain the canonical consumer fixture for diagnosis.
  }, 90_000);

  it("the exact asset reselect command reaches the asset verdict while retaining stale Hero provenance", () => {
    const result = spawnSync(process.execPath, ["node_modules/.bin/designer-library", "reselect", "--root", "agents/designer/compiled", "--leaf", "assets.image", "--source", "foundry", "--write", "--json"], { cwd: join(consumer, "clossys"), encoding: "utf8", timeout: 60_000 });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    // Other incomplete consumer seats and S8 evidence still prevent a successful write.
    expect(result.status).toBe(1);
    const verdict = JSON.parse(result.stderr);
    expect(verdict.findings).not.toContainEqual(expect.objectContaining({ code: "A1", severity: "error", subject: "assets.image.default" }));
    for (const [slot, hash] of historicalHolds) expect(verdict.findings).toContainEqual(expect.objectContaining({ code: "S2", severity: "notice", subject: slot, actualHash: hash, nextOperation: { op: "refresh", slot, source: "foundry" } }));
    expect(result.stderr).not.toContain("unique registered historical upstream required");
  }, 90_000);

  it("actual in-process Studio selection reads the historical hold and exposes later qualification findings", async () => {
    const stored = await readStudioDesignerLibrary(consumer);
    expect(stored).toBeDefined();
    const prepared = await prepareStudioSelection(stored);
    expect(resolve(prepared.input).surfaces!.check.findings).toContainEqual(expect.objectContaining({ code: "S2", severity: "notice", subject: "sections.hero", actualHash: historicalHash }));
    const held = prepared.input.library.surfaces!.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === "sections.hero")!;
    expect(Object.values(held.sections!)[0]!.origin).toMatchObject({ descriptorHash: historicalHash, fill: "foundry/sections.hero" });
    const selection = await studioSelection(consumer);
    expect(selection.leaves.length).toBeGreaterThan(0);
    expect(selection.leaves.find(row => row.leaf === "frames.app-shell")).toMatchObject({ fill: "foundry/frames.app-shell" });
    expect(selection.message ?? "").not.toContain("unique registered historical upstream required");
    // S8 qualification belongs to its own source unit and remains visible on this base.
    if (selection.message) expect(selection.message).toContain("S8");
  }, 90_000);
});
