import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as ReactDOMServer from "react-dom/server";
import * as JSXRuntime from "react/jsx-runtime";
import * as JSXDevRuntime from "react/jsx-dev-runtime";
import { libraryHash } from "@clossys/designer/catalog";
import { expect, it } from "vitest";
import { prepareStudioSelection } from "./selection-defaults.js";
import { compileSelection, selectionRuntime } from "./selection.js";

it("imports the emitted native specimen runtime without replacing same-named glyph data with components", async () => {
  const root = fileURLToPath(new URL("../../../../node_modules/.cache/tmp/a258-publisher-outcome/runtime-import-regression/", import.meta.url));
  await mkdir(root, { recursive: true });
  const temporary = await mkdtemp(join(root, "case-"));
  const host = globalThis as typeof globalThis & { __studioDesignerRuntime?: Record<string, unknown> };
  const previous = host.__studioDesignerRuntime;
  host.__studioDesignerRuntime = { react: React, "react-dom": ReactDOM, "react-dom/client": ReactDOMClient, "react-dom/server": ReactDOMServer, "react/jsx-runtime": JSXRuntime, "react/jsx-dev-runtime": JSXDevRuntime };
  try {
    const prepared = await prepareStudioSelection();
    const selection = await compileSelection(temporary, prepared.input, prepared.leaves, libraryHash(prepared.input.library));
    const hash = new URL(selection.runtimeUrl!, "http://127.0.0.1").searchParams.get("hash")!;
    const code = selectionRuntime(hash)!;
    const target = join(temporary, "runtime.mjs");
    await writeFile(target, code);
    // Import runs the native catalog initializer, which structured-clones Lucide
    // Calendar/FileText/Folder path arrays. Component-name collisions must not
    // replace those arrays with React forwardRef values.
    const runtime = await import(pathToFileURL(target).href);
    expect(typeof runtime.surfaces.SpecimenPageViewports).toBe("function");
    const badge = ReactDOMServer.renderToStaticMarkup(React.createElement(runtime.components.Badge, null, "Selected"));
    expect(badge).toContain('data-ds-fill="shadcn@aria/components.badge"');
    expect(badge).toContain('data-slot="badge"');
  } finally {
    host.__studioDesignerRuntime = previous;
  }
}, 120_000);
