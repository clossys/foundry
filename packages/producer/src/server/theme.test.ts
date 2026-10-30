import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyLibraryChange, emit, libraryHash, loadCatalog, resolve, type LibraryData } from "@clossys/designer/catalog";
import { agentModule, agentRoot } from "./cells.js";
import { defaultStudioTheme, studioTheme, themeHash } from "./theme.js";
import { startProducerServer } from "./index.js";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "producer-theme-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function adoptedDefaults(): LibraryData {
  const catalog = loadCatalog();
  const empty: LibraryData = { source: { id: "example", kind: "consumer", author: "consumer", license: "UNLICENSED" }, fills: [], adoptedAt: "2026-10-29" };
  return applyLibraryChange(catalog, empty, { baseHash: libraryHash(empty), changes: catalog.fills.filter(fill => {
    const meta = fill.$extensions["com.clossys.fill"];
    return meta.source === "foundry" && meta.slot.startsWith("tokens.");
  }).map(fill => ({ op: "adopt", slot: fill.$extensions["com.clossys.fill"].slot, source: "foundry" })) });
}

async function brandedCells(composite = false, authored = true, consumerRoot = root, hue = 250): Promise<LibraryData> {
  const catalog = loadCatalog();
  let library = adoptedDefaults();
  if (authored) library = applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: [{ op: "author", slot: "tokens.accent-color", tokens: { default: { $type: "color", $value: `oklch(0.65 0.2 ${hue})`, $extensions: { "com.clossys.modes": { dark: `oklch(0.75 0.15 ${hue})` } } } } }] });
  const api = await agentModule("designer", "library-cli/fs-library.js");
  const source = join(consumerRoot, "library");
  for (const [name, contents] of api.libraryFiles(catalog, library, [])) {
    const path = join(source, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, contents);
  }
  const cells = await agentModule("designer", "library-cli/cells.js");
  await cells.libraryToCells(source, agentRoot(consumerRoot, "designer"), { catalog, date: "2026-10-29" });
  if (composite) {
    // A valid composite token library does not require adopted components.
    const treePath = join(agentRoot(consumerRoot, "designer"), "tree.json");
    const tree = JSON.parse(await readFile(treePath, "utf8"));
    const { adoptedAt, ...values } = tree.meta.metadata;
    tree.meta.metadata = { format: "composite-v1", adoptedAt, values, components: {}, files: [] };
    await writeFile(treePath, JSON.stringify(tree));
  }
  return library;
}

describe("Studio compiled theme", () => {
  it("binds the official Foundry catalog default when there are no consumer cells", async () => {
    const theme = await studioTheme(root);
    expect(theme).toEqual(defaultStudioTheme());
    expect(theme.source).toBe("foundry");
    expect(theme.css).toContain(":root[data-brand-bound]");
    const official = emit(resolve({ catalog: loadCatalog(), library: adoptedDefaults() }), ["css-brand", "css-scales"], { full: true, header: false }).map(file => file.contents).join("\n");
    expect(theme.css).toBe(official);
    expect(theme.hash).toBe(themeHash(official));
    expect(theme.css).toContain('[data-theme="dark"]');
    expect(theme.message).toBeUndefined();
  });

  it.each([false, true])("compiles actual active token cells (composite=%s) without writing a consumer projection", async composite => {
    const library = await brandedCells(composite);
    const theme = await studioTheme(root);
    const expected = emit(resolve({ catalog: loadCatalog(), library }), ["css-brand", "css-scales"], { full: true, header: false }).map(file => file.contents).join("\n");
    expect(theme).toEqual({ source: "consumer", css: expected, hash: themeHash(expected) });
    expect(theme.css).toContain("oklch(0.65 0.2 250)");
    expect(theme.css).toContain("oklch(0.75 0.15 250)");
    expect(await readdir(agentRoot(root, "designer"))).toEqual(expect.arrayContaining(["cells", "tree.json", "compile.json"]));
    expect(await readdir(agentRoot(root, "designer"))).not.toContain("compiled");
  });

  it("has exact CSS hash parity when a consumer adopts Foundry defaults", async () => {
    await brandedCells(false, false);
    const theme = await studioTheme(root), foundry = defaultStudioTheme();
    expect(theme.source).toBe("consumer");
    expect(theme.css).toBe(foundry.css);
    expect(theme.hash).toBe(foundry.hash);
    expect(theme.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("preserves authored consumer overrides instead of substituting Foundry defaults", async () => {
    await brandedCells();
    const theme = await studioTheme(root);
    expect(theme.source).toBe("consumer");
    expect(theme.hash).toBe(themeHash(theme.css));
    expect(theme.hash).not.toBe(defaultStudioTheme().hash);
  });

  it("compiles two different consumer brands with independent valid CSS hashes", async () => {
    const secondRoot = join(root, "second-consumer");
    await brandedCells(false, true, root, 250);
    await brandedCells(false, true, secondRoot, 320);
    const first = await studioTheme(root), second = await studioTheme(secondRoot);
    for (const theme of [first, second]) {
      expect(theme.source).toBe("consumer");
      expect(theme.message).toBeUndefined();
      expect(theme.hash).toBe(themeHash(theme.css));
    }
    expect(first.css).not.toBe(second.css);
    expect(first.hash).not.toBe(second.hash);
    expect(second.css).toContain("oklch(0.65 0.2 320)");
  });

  it("distinguishes a corrupt consumer theme from an uninitialized theme", async () => {
    await brandedCells();
    await writeFile(join(agentRoot(root, "designer"), "cells/tokens.accent-color/v1.md"), "invalid");
    expect(await studioTheme(root)).toEqual({ ...defaultStudioTheme(), message: "Consumer theme could not be compiled; using the Foundry theme" });
  });

  it("includes the compiled consumer theme in the read-only config response", async () => {
    await brandedCells();
    const server = await startProducerServer({ root, port: 0, studioEntry: fileURLToPath(new URL("./__fixtures__/studio-child.mjs", import.meta.url)), handleSignals: false });
    try {
      const response = await fetch(`${server.url}/api/config`);
      const config = await response.json() as { readOnly: boolean; theme: { source: string; css: string } };
      expect(response.status).toBe(200);
      expect(config.readOnly).toBe(true);
      expect(config.theme.source).toBe("consumer");
      expect(config.theme.css).toContain("oklch(0.65 0.2 250)");
      expect(await readdir(agentRoot(root, "designer"))).not.toContain("compiled");
    } finally { await server.close(); }
  }, 20_000);

  it("provides consumer config to the supervised Studio before child readiness", async () => {
    await brandedCells();
    const entry = join(root, "ssr-child.mjs");
    await writeFile(entry, `import { createServer } from "node:http";
const response = await fetch(process.env.CLOSSYS_PRODUCER_ORIGIN + "/api/config");
const { theme } = await response.json();
const server = createServer((request, response) => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ theme })); });
server.listen(Number(process.env.PORT), process.env.HOSTNAME);
process.once("SIGTERM", () => server.close(() => process.exit(0)));
`);
    const server = await startProducerServer({ root, port: 0, studioEntry: entry, handleSignals: false });
    try {
      const applied = await (await fetch(server.url)).json() as { theme: { source: string; css: string; hash: string } };
      expect(applied.theme).toEqual(await studioTheme(root));
      expect(applied.theme.source).toBe("consumer");
    } finally { await server.close(); }
  }, 20_000);

  it("refuses a symlinked consumer root and does not expose target paths", async () => {
    await brandedCells();
    const cells = agentRoot(root, "designer");
    const outside = join(root, "outside");
    const { rename } = await import("node:fs/promises");
    await rename(cells, outside); await symlink(outside, cells);
    const theme = await studioTheme(root);
    expect(theme.source).toBe("foundry");
    expect(theme.message).toBe("Consumer theme could not be compiled; using the Foundry theme");
    expect(JSON.stringify(theme)).not.toContain(outside);
  });
});
