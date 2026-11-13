import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { checkReferences, sha256, treeHash } from "../scripts/check-references.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const references = join(here, "../references");
const manifest = JSON.parse(readFileSync(join(here, "stock-frame-picks.json"), "utf8"));
const central = JSON.parse(readFileSync(join(references, "manifest.json"), "utf8"));

// These four modules are exact stock ports: no import, token, class, markup or
// behavior adaptations. The overlay is a native reference-manifest subset;
// it neither adds to the central catalogue nor grants an element approval.
const provenance = {
  sourceCommit: "79ffea953273ca6fe657049e45f000a720c7f162",
  upstream: "github.com/shadcn-ui/ui@b8d7baa15b1dca5716f13153e63795fc3d741f6b",
  version: "4.23.0",
  adaptations: [],
  exports: {
    button: ["Button", "buttonVariants"],
    popover: ["Popover", "PopoverAnchor", "PopoverContent", "PopoverDescription", "PopoverHeader", "PopoverTitle", "PopoverTrigger"],
    tooltip: ["Tooltip", "TooltipContent", "TooltipProvider", "TooltipTrigger"],
    resizable: ["ResizableHandle", "ResizablePanel", "ResizablePanelGroup"],
  },
  dependencies: { "radix-ui": "1.8.1", "react-resizable-panels": "4.16.0" },
};

function materializeSubset(root) {
  writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest));
  for (const file of [
    ...manifest.licenses.map(file => file.path),
    ...manifest.items.flatMap(item => item.files.map(file => `${item.dir}/${file.path}`)),
  ]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(join(references, file), join(root, file));
  }
}

test("stock picks use native items and tree hashes and match their exact upstream bytes", () => {
  assert.equal(manifest.schema, "clossys.references-manifest/1");
  assert.equal(manifest.hashAlgorithm, "sha256-tree/1");
  assert.equal(manifest.registries.shadcn.upstream, provenance.upstream);
  assert.deepEqual(manifest.items.map(item => item.name).sort(), Object.keys(provenance.exports).sort());
  const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
  for (const [name, version] of Object.entries(provenance.dependencies)) assert.equal(pkg.dependencies[name], version);
  for (const item of manifest.items) {
    assert.equal(item.version, provenance.version);
    assert.equal(item.hash, treeHash(item.files));
    assert.deepEqual(item, central.items.find(candidate => candidate.registry === item.registry && candidate.name === item.name));
    const file = item.files.find(file => file.path === `registry/radix-nova/ui/${item.name}.tsx`);
    assert.ok(file);
    const source = readFileSync(join(references, item.dir, file.path));
    const port = readFileSync(join(here, `src/components/radix/${item.name}.tsx`));
    assert.equal(sha256(source), file.sha256);
    assert.equal(source.length, file.bytes);
    assert.deepEqual(port, source, `${item.name}: unexpected source adaptation`);
    assert.notEqual(item.hash, `sha256:${file.sha256}`, "a file digest is not a reference tree hash");
  }
});

test("native checkReferences accepts the subset and rejects raw hashes or byte drift", () => {
  const root = mkdtempSync(join(tmpdir(), "stock-frame-picks-"));
  try {
    materializeSubset(root);
    assert.equal(checkReferences(root).ok, true);
    const changed = structuredClone(manifest);
    changed.items[0].hash = `sha256:${changed.items[0].files[0].sha256}`;
    writeFileSync(join(root, "manifest.json"), JSON.stringify(changed));
    assert.equal(checkReferences(root).ok, false);
    writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest));
    const item = manifest.items[0];
    const file = join(root, item.dir, item.files[0].path);
    writeFileSync(file, readFileSync(file, "utf8") + "\n");
    assert.equal(checkReferences(root).ok, false);
    copyFileSync(join(references, item.dir, item.files[0].path), file);
    assert.equal(checkReferences(root).ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("native stock APIs export and share one asChild button for tooltip and popover", async () => {
  const root = mkdtempSync(join(tmpdir(), "stock-frame-api-"));
  try {
    const modules = ["button", "popover", "tooltip", "resizable"].map(name =>
      `export * as ${name} from "./src/components/radix/${name}.tsx";`).join("\n");
    const outfile = join(root, "api.cjs");
    await build({ stdin: { contents: modules, resolveDir: here }, bundle: true, platform: "node", format: "cjs", outfile, logLevel: "silent" });
    const require = createRequire(import.meta.url);
    const api = require(outfile);
    for (const [name, exports] of Object.entries(provenance.exports)) {
      assert.deepEqual(Object.keys(api[name]).sort(), [...exports].sort());
    }
    const index = readFileSync(join(here, "src/index.ts"), "utf8");
    for (const name of ["RadixButton", "RadixPopover", "RadixPopoverTrigger", "RadixPopoverContent", "RadixTooltip", "RadixTooltipProvider", "RadixTooltipTrigger", "RadixTooltipContent", "ResizablePanelGroup", "ResizablePanel", "ResizableHandle"]) {
      assert.match(index, new RegExp(`\\b${name}\\b`));
    }
    const rendered = join(root, "composition.cjs");
    await build({ stdin: { resolveDir: here, loader: "tsx", contents: `
      import * as React from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { Button } from "./src/components/radix/button";
      import { Popover, PopoverTrigger, PopoverContent } from "./src/components/radix/popover";
      import { Tooltip, TooltipTrigger, TooltipProvider, TooltipContent } from "./src/components/radix/tooltip";
      export const html = renderToStaticMarkup(<TooltipProvider><Popover><Tooltip>
        <TooltipTrigger asChild><PopoverTrigger asChild><Button size="icon" aria-label="Open actions">+</Button></PopoverTrigger></TooltipTrigger>
        <TooltipContent>Open actions</TooltipContent>
        <PopoverContent>Actions</PopoverContent>
      </Tooltip></Popover></TooltipProvider>);
    ` }, bundle: true, platform: "node", format: "cjs", outfile: rendered, logLevel: "silent" });
    const { html } = require(rendered);
    assert.equal((html.match(/<button\b/g) ?? []).length, 1);
    assert.match(html, /aria-label="Open actions"/);
    assert.match(html, /aria-haspopup="dialog"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
