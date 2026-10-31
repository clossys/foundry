// @vitest-environment node
import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { propose } from "@clossys/strategist/cell-format";
import { generateSelection, libraryHash, loadCatalog, stableStringify, type LibraryData } from "../catalog-core/index.js";
import { adoptedComponentIntegration } from "../catalog-core/__fixtures__/component-integration.js";
import { compositeLibraryHash } from "../catalog-core/library-components.js";
import { packageSurfaceLibrary } from "./__fixtures__/package-surface-library.js";
import { compileLibraryCells, libraryToCells, parseLibraryCell, resolveDesignerCellRoot, runCellsCli } from "./cells.js";
import { libraryFiles, readLibrary, readLibraryFromCells } from "./fs-library.js";

const fixture = fileURLToPath(new URL("./__fixtures__/agent-receipted/", import.meta.url));
const catalog = loadCatalog();
let temporary: string, input: string, cells: string, output: string;
beforeEach(async () => {
  temporary = await fs.mkdtemp(join(tmpdir(), "designer-cells-"));
  input = join(temporary, "input"); cells = join(temporary, "cells"); output = join(temporary, "output");
  await fs.cp(fixture, input, { recursive: true });
});
afterEach(async () => { await fs.rm(temporary, { recursive: true, force: true }); });

const json = async (root: string, path: string): Promise<any> => JSON.parse(await fs.readFile(join(root, path), "utf8"));
async function writeJson(root: string, path: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(join(root, path)), { recursive: true });
  await fs.writeFile(join(root, path), stableStringify(value));
}
async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function walk(path: string): Promise<void> {
    for (const entry of await fs.readdir(join(root, path), { withFileTypes: true })) {
      const name = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(name);
      else result[name] = await fs.readFile(join(root, name), "utf8");
    }
  }
  await walk(""); return result;
}
async function addRationale(): Promise<string> {
  const rationale = "Chosen for the interface hierarchy.\nKeep the authored contrast decision.";
  const metadata = await json(input, "metadata.json");
  metadata.rationale = { "themes.primary": rationale };
  await writeJson(input, "metadata.json", metadata);
  const library = { ...metadata, source: await json(input, "source.json"), fills: await Promise.all((await fs.readdir(join(input, "fills"))).sort().map(name => json(input, `fills/${name}`))) } as LibraryData;
  await writeJson(input, "selection.json", generateSelection(library));
  return rationale;
}
async function migrate(): Promise<void> { await libraryToCells(input, cells, { catalog, date: "2026-10-29" }); }
async function firstCell(): Promise<{ id: string; path: string; text: string }> {
  const id = Object.keys((await json(cells, "tree.json")).active).sort()[0]!;
  const path = `cells/${id}/v1.md`;
  return { id, path, text: await fs.readFile(join(cells, path), "utf8") };
}

describe("Designer cell migration and compile", () => {
  it("round trips all 103 slot documents, selection, source, metadata and the library hash", async () => {
    await migrate();
    expect((await fs.readdir(join(cells, "cells"))).length).toBe(103);
    const tree = await json(cells, "tree.json");
    expect(Object.values(tree.active)).toEqual(Array(103).fill(1));
    for (const id of Object.keys(tree.active)) {
      expect(id).toMatch(/^(themes|assets|components|sections|frames)\.[a-z][a-z0-9-]*$/);
      expect(await fs.readdir(join(cells, "cells", id))).toEqual(["v1.md"]);
      const text = await fs.readFile(join(cells, "cells", id, "v1.md"), "utf8");
      expect(text).toContain("confirmed: migration:2026-10-29");
      expect(text).toContain("links: []");
    }
    expect((await compileLibraryCells(cells, output, { catalog })).ok).toBe(true);
    for (const name of ["source.json", "metadata.json", "selection.json", ...(await fs.readdir(join(input, "fills"))).map(name => `fills/${name}`)]) {
      expect(await json(output, name), name).toEqual(await json(input, name));
    }
    expect(await fs.readFile(join(output, "index.ts"), "utf8")).toBe(await fs.readFile(join(input, "index.ts"), "utf8"));
    const before = await readLibrary(input, catalog), after = await readLibrary(output, catalog);
    expect(after).toEqual(before);
    expect(libraryHash(after)).toBe(libraryHash(before));
  });

  it("preserves nonempty multi-line rationale through the cell body and generated selection", async () => {
    const rationale = await addRationale(); await migrate();
    const text = await fs.readFile(join(cells, "cells/themes.primary/v1.md"), "utf8");
    expect(text).toContain("- Chosen for the interface hierarchy.");
    await compileLibraryCells(cells, output, { catalog });
    expect((await json(output, "selection.json")).slots.find((slot: { slot: string }) => slot.slot === "themes.primary").rationale).toBe(rationale);
    expect(await readLibrary(output, catalog)).toEqual(await readLibrary(input, catalog));
  });

  it("reads the same runtime library directly from cells without changing authored files", async () => {
    await migrate(); const before = await snapshot(cells);
    expect(await readLibraryFromCells(cells, catalog)).toEqual(await readLibrary(input, catalog));
    expect(await snapshot(cells)).toEqual(before);
  });

  it("regroups exclusively through tree.json without changing cells or compiled output", async () => {
    await migrate(); await compileLibraryCells(cells, output, { catalog });
    const beforeCells = await snapshot(join(cells, "cells")), beforeOutput = await snapshot(output);
    const tree = await json(cells, "tree.json"), ids = Object.keys(tree.active).sort();
    tree.tree = [{ id: "custom", name: "Custom", children: [
      { id: "first", name: "First", cells: ids.filter((_, i) => i % 2 === 0) },
      { id: "second", name: "Second", cells: ids.filter((_, i) => i % 2 === 1) },
    ] }];
    await writeJson(cells, "tree.json", tree);
    await compileLibraryCells(cells, output, { catalog });
    expect(await snapshot(join(cells, "cells"))).toEqual(beforeCells);
    expect(await snapshot(output)).toEqual(beforeOutput);
  });

  it("compiles only active pointers while a newer draft remains invisible", async () => {
    await migrate(); await compileLibraryCells(cells, output, { catalog });
    const before = await snapshot(output), cell = await firstCell();
    const proposed = await propose(cells, cell.id);
    expect(proposed.version).toBe(2);
    await fs.writeFile(join(cells, proposed.path), proposed.source.replace("## Rationale\n", "## Rationale\n- Unconfirmed draft decision.\n"));
    await compileLibraryCells(cells, output, { catalog });
    expect(await snapshot(output)).toEqual(before);
  });

  it("check mode detects edited outputs and never writes them", async () => {
    await migrate(); await compileLibraryCells(cells, output, { catalog });
    expect(await compileLibraryCells(cells, output, { catalog, check: true })).toMatchObject({ ok: true, drift: [] });
    await fs.appendFile(join(output, "index.ts"), "// hand edit\n");
    const fillPath = "fills/themes.primary.json";
    const fill = await json(output, fillPath); fill.$extensions["com.clossys.fill"].source = "edited";
    await writeJson(output, fillPath, fill);
    const before = await snapshot(output), result = await compileLibraryCells(cells, output, { catalog, check: true });
    expect(result.ok).toBe(false);
    expect(result.drift).toEqual(expect.arrayContaining(["index.ts", fillPath]));
    expect(await snapshot(output)).toEqual(before);
  });

  it("detects and removes a generated fill when its cell is retired", async () => {
    await migrate(); await compileLibraryCells(cells, output, { catalog });
    const cell = await firstCell(), tree = await json(cells, "tree.json");
    tree.active[cell.id] = null; tree.retired = [cell.id];
    await writeJson(cells, "tree.json", tree);
    await fs.writeFile(join(cells, cell.path), cell.text.replace("status: active", "status: retired"));
    const result = await compileLibraryCells(cells, output, { catalog, check: true });
    expect(result.ok).toBe(false); expect(result.drift).toContain(`fills/${cell.id}.json`);
    await compileLibraryCells(cells, output, { catalog });
    await expect(fs.access(join(output, "fills", `${cell.id}.json`))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readLibrary(output, catalog)).fills).toHaveLength(102);
  });

  it("runs migration, compile and the failure-producing check through the CLI dispatcher", async () => {
    const messages: string[] = [], io = { out: (text: string) => messages.push(text), error: (text: string) => messages.push(text) };
    expect(await runCellsCli(["migrate", "--from", input, "--to", cells], io)).toBe(0);
    expect(await runCellsCli(["compile", "--root", cells, "--out", output], io)).toBe(0);
    expect(await runCellsCli(["compile", "--check", "--root", cells, "--out", output], io)).toBe(0);
    await fs.appendFile(join(output, "index.ts"), "// drift\n");
    expect(await runCellsCli(["check", "--root", cells, "--out", output], io)).toBe(1);
  });

  it("preserves composite component fills, owned files and runtime hash", async () => {
    const integration = adoptedComponentIntegration();
    await fs.rm(input, { recursive: true }); await fs.mkdir(input);
    for (const [path, content] of libraryFiles(integration.catalog, integration.library, [], integration.componentOptions)) {
      await fs.mkdir(dirname(join(input, path)), { recursive: true }); await fs.writeFile(join(input, path), content);
    }
    await libraryToCells(input, cells, { catalog: integration.catalog, componentOptions: integration.componentOptions, date: "2026-10-29" });
    await compileLibraryCells(cells, output, { catalog: integration.catalog });
    const before = await readLibrary(input, integration.catalog), after = await readLibrary(output, integration.catalog);
    expect(after).toEqual(before); expect(libraryHash(after)).toBe(libraryHash(before));
  });

  it("preserves opted-in surface metadata, selection and runtime hash", async () => {
    const integration = await packageSurfaceLibrary();
    await fs.rm(input, { recursive: true }); await fs.mkdir(input);
    for (const [path, content] of libraryFiles(integration.catalog, integration.library, [], undefined, integration.options)) {
      await fs.mkdir(dirname(join(input, path)), { recursive: true }); await fs.writeFile(join(input, path), content);
    }
    const source = await json(input, "source.json"), metadata = await json(input, "metadata.json"), selection = await json(input, "surface-selection.json");
    await libraryToCells(input, cells, { catalog: integration.catalog, date: "2026-10-29" });
    expect((await json(cells, "tree.json")).meta).toMatchObject({ source, metadata, surfaceSelection: selection });
    await compileLibraryCells(cells, output, { catalog: integration.catalog, surfaceOptions: integration.options });
    expect(await json(output, "source.json")).toEqual(source);
    expect(await json(output, "metadata.json")).toEqual(metadata);
    expect(await json(output, "surface-selection.json")).toEqual(selection);
    const before = await readLibrary(input, integration.catalog), after = await readLibrary(output, integration.catalog);
    expect(compositeLibraryHash(after)).toBe(compositeLibraryHash(before));
    expect(compositeLibraryHash(await readLibraryFromCells(cells, integration.catalog))).toBe(compositeLibraryHash(before));
  }, 120_000);

  it("refuses symlinked output roots and fills without writing outside the output boundary", async () => {
    await migrate();
    const outside = join(temporary, "outside"); await fs.mkdir(outside);
    await fs.writeFile(join(outside, "sentinel.txt"), "preserve\n");
    await fs.symlink(outside, output);
    await expect(compileLibraryCells(cells, output, { catalog })).rejects.toThrow(/symbolic|symlink/i);
    expect(await snapshot(outside)).toEqual({ "sentinel.txt": "preserve\n" });
    await fs.unlink(output); await fs.mkdir(output); await fs.symlink(outside, join(output, "fills"));
    await expect(compileLibraryCells(cells, output, { catalog })).rejects.toThrow(/symbolic|symlink/i);
    expect(await snapshot(outside)).toEqual({ "sentinel.txt": "preserve\n" });
  });

  it("refuses CLI activation without a confirmation and preserves the active generation", async () => {
    await migrate(); const cell = await firstCell();
    const messages: string[] = [], io = { out: (text: string) => messages.push(text), error: (text: string) => messages.push(text) };
    expect(await runCellsCli(["propose", cell.id, "--root", cells], io)).toBe(0);
    const before = await snapshot(cells);
    expect(await runCellsCli(["activate", `${cell.id}@2`, "--root", cells], io)).toBe(2);
    expect(await snapshot(cells)).toEqual(before);
  });
});

describe("Designer cell profile parser", () => {
  it("refuses a fill whose slot differs from the permanent cell id", async () => {
    await migrate(); const cell = await firstCell();
    const bad = cell.text.replace(/("slot"\s*:\s*")[^"]+("\s*)/, "$1tokens.mismatched$2");
    expect(bad).not.toBe(cell.text);
    expect(() => parseLibraryCell(bad, cell.path)).toThrow(/slot|id/i);
  });

  it("refuses unknown frontmatter keys and paragraphs outside the fixed body grammar", async () => {
    await migrate(); const cell = await firstCell();
    expect(() => parseLibraryCell(cell.text.replace("\n---\n", "\nunknown: value\n---\n"), cell.path)).toThrow(/unknown|frontmatter|key/i);
    expect(() => parseLibraryCell(cell.text.replace("## Rationale", "Unstructured prose\n\n## Rationale"), cell.path)).toThrow(/body|prose|bullet|unexpected/i);
  });

  it("refuses frontmatter that disagrees with either path id or version", async () => {
    await migrate(); const cell = await firstCell();
    expect(() => parseLibraryCell(cell.text, "cells/tokens.other/v1.md")).toThrow(/path|id/i);
    expect(() => parseLibraryCell(cell.text, `cells/${cell.id}/v2.md`)).toThrow(/path|version/i);
  });
});

describe("Designer repository cell root", () => {
  it("finds the nearest repository root from a nested app and uses clossys/agents/designer", async () => {
    const repository = join(temporary, "repository"), nested = join(repository, "apps/admin/src");
    await fs.mkdir(join(repository, ".git"), { recursive: true });
    await fs.mkdir(nested, { recursive: true });
    expect(await resolveDesignerCellRoot(undefined, nested)).toBe(join(repository, "clossys/agents/designer"));
    const subrepository = join(repository, "apps/admin");
    await fs.writeFile(join(subrepository, ".git"), "gitdir: ignored-worktree-metadata\n");
    expect(await resolveDesignerCellRoot(undefined, nested)).toBe(join(subrepository, "clossys/agents/designer"));
  });

  it("falls back to cwd outside a repository and resolves explicit overrides from cwd", async () => {
    const cwd = join(temporary, "unversioned"); await fs.mkdir(cwd);
    expect(await resolveDesignerCellRoot(undefined, cwd)).toBe(join(cwd, "clossys/agents/designer"));
    expect(await resolveDesignerCellRoot("../custom-cells", cwd)).toBe(join(temporary, "custom-cells"));
    expect(await resolveDesignerCellRoot(cells, cwd)).toBe(cells);
  });

  it("migrates and compiles through the CLI with the repository root default", async () => {
    const repository = join(temporary, "repository"), nested = join(repository, "apps/admin");
    await fs.mkdir(join(repository, ".git"), { recursive: true }); await fs.mkdir(nested, { recursive: true });
    const root = join(repository, "clossys/agents/designer");
    const messages: string[] = [], io = { out: (text: string) => messages.push(text), error: (text: string) => messages.push(text) };
    expect(await runCellsCli(["migrate", "--from", input], io, nested), messages.join("\n")).toBe(0);
    expect(Object.keys((await json(root, "tree.json")).active)).toHaveLength(103);
    expect(await runCellsCli(["compile", "--out", output], io, nested), messages.join("\n")).toBe(0);
    expect(await readLibrary(output, catalog)).toEqual(await readLibrary(input, catalog));
    expect(await runCellsCli(["check", "--out", output], io, nested), messages.join("\n")).toBe(0);
  });
});
