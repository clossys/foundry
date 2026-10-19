import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { AppNavigation } from "./AppNavigation.js";
import * as blocks from "./index.js";

describe("AppNavigation public and hydration contract", () => {
  it("hydrates duplicated navigation without collisions or route mismatch", async () => {
    const props = { tree: [{ id: "catalogs", label: "Catalogs", children: [{ id: "blocks", label: "Blocks", href: "#blocks" }] }], activeId: "blocks" };
    const tree = <><AppNavigation {...props} /><AppNavigation {...props} /></>;
    const host = document.createElement("div");
    host.innerHTML = renderToString(tree);
    document.body.append(host);
    const recover = vi.fn();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(2);
      const ids = [...host.querySelectorAll("[id]")].map(node => node.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const button of host.querySelectorAll("[aria-controls]")) expect(host.querySelector(`[id="${button.getAttribute("aria-controls")}"]`)).not.toBeNull();
      await act(async () => { root = hydrateRoot(host, tree, { onRecoverableError: recover }); });
      expect(recover).not.toHaveBeenCalled();
      expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(2);
    } finally { await act(async () => root?.unmount()); host.remove(); }
  });

  it("publishes the actual client component and source-backed unified Material", () => {
    expect((blocks as any).AppNavigation).toBe(AppNavigation);
    const material = blocks.APP_FRAME_MATERIALS.find(entry => entry.id === "app-navigation" as any);
    expect(material?.component).toBe(AppNavigation);
    for (const layer of ["atoms", "blocks", "shell"]) {
      expect(readFileSync(resolve(import.meta.dirname, `../${layer}/server.ts`), "utf8")).not.toMatch(/AppNavigation|app-navigation-tree/);
    }
  });

  it("accepts emitted two-level contracts and rejects grandchildren or ambiguous destinations", () => {
    const entry = resolve(import.meta.dirname, "../../dist/blocks/index.js");
    const filename = resolve(import.meta.dirname, "navigation-consumer.check.ts");
    const source = `import { AppNavigation, type AppNavigationNode } from ${JSON.stringify(entry)};
      const valid: AppNavigationNode[] = [{id:'a',label:'A',children:[{id:'b',label:'B',href:'/b'}]}];
      AppNavigation({tree:valid,activeId:'b',footer:'Host identity'});
      const deep: AppNavigationNode = {id:'a',label:'A',children:[{id:'b',label:'B',href:'/b',children:[]}]};
      const ambiguous: AppNavigationNode = {id:'a',label:'A',href:'/a',onAction:()=>{}};`;
    const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, source, language, true) : original(path, language, error, fresh);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host));
    expect(diagnostics.map(item => item.file?.getLineAndCharacterOfPosition(item.start!).line)).toEqual([3, 4]);
  });
});
