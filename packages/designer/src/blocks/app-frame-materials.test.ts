import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { createElement, type ComponentProps } from "react";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "../atoms/Button.js";
import { describe, expect, it } from "vitest";
import * as blocks from "./index.js";

const root = resolve(import.meta.dirname, "../..");
const materials = () => (blocks as any).APP_FRAME_MATERIALS ?? [];

describe("AppFrame Material registration", () => {
  it("keeps the Drawer opener available through its authored inputs", async () => {
    const drawer = materials().find((entry: any) => entry.id === "drawer");
    const supplied = {
      heading: "Tools", closeLabel: "Close tools", children: "Tool content",
      trigger: createElement(Button, {}, "Open tools"),
    };
    const authored = Object.fromEntries(drawer.authoredInputs
      .filter((name: string) => name in supplied)
      .map((name: keyof typeof supplied) => [name, supplied[name]]));
    const view = render(createElement(blocks.Drawer, authored as ComponentProps<typeof blocks.Drawer>));
    await userEvent.click(view.getByRole("button", { name: "Open tools" }));
    expect(view.getByRole("dialog", { name: "Tools" })).toHaveTextContent("Tool content");
    view.unmount();
  });

  it("forwards the authored CommandMenu count message from its real record", () => {
    const command = materials().find((entry: any) => entry.id === "command-menu");
    const supplied = {
      heading: "Commands", searchLabel: "Search commands", closeLabel: "Close commands",
      emptyMessage: "No matching commands", groups: [], isOpen: true,
      onOpenChange: (_open: boolean) => {}, query: "", onQueryChange: (_query: string) => {},
      resultCountMessage: (count: number) => `Commands found: ${count}`,
    };
    const authored = Object.fromEntries(command.authoredInputs
      .filter((name: string) => name in supplied)
      .map((name: keyof typeof supplied) => [name, supplied[name]]));
    const view = render(createElement(blocks.CommandMenu, authored as ComponentProps<typeof blocks.CommandMenu>));
    expect(view.getByRole("status")).toHaveTextContent(/^Commands found: 0$/);
    view.unmount();
  });

  it("registers actual exported Block components, named regions, dependencies and finite configs", () => {
    expect(materials().map((entry: any) => entry.id)).toEqual(["panel", "drawer", "resizable-pane", "command-menu"]);
    for (const entry of materials()) {
      expect(entry.layer).toBe("blocks");
      expect(entry.component).toBe((blocks as any)[entry.exportName]);
      expect(entry.component).toBeTypeOf("function");
      expect(entry.regions).toContain("content");
      const source = readFileSync(join(root, entry.source), "utf8");
      const ast = ts.createSourceFile(entry.source, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
      const rendered = new Set<string>();
      const imports = new Map<string, string>();
      for (const statement of ast.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
          if (!binding.isTypeOnly) imports.set(binding.name.text, statement.moduleSpecifier.text);
        }
      }
      const visit = (node: ts.Node) => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) rendered.add(node.tagName.getText(ast));
        ts.forEachChild(node, visit);
      };
      visit(ast);
      for (const dependency of entry.dependencies) {
        expect(rendered.has(dependency.exportName), `${entry.id} really renders ${dependency.exportName}`).toBe(true);
        const importedSource = resolve(dirname(join(root, entry.source)), imports.get(dependency.exportName)!);
        expect(importedSource.replace(/\.js$/, ".tsx")).toBe(join(root, dependency.source));
      }
      for (const config of entry.configs) {
        const configSource = readFileSync(join(root, config.source), "utf8");
        expect(config.values.length).toBeGreaterThan(1);
        expect(config.values).toContain(config.default);
        for (const value of config.values) expect(configSource, `${entry.id}.${config.prop}`).toContain(`"${value}"`);
      }
    }
  });

  it("keeps Dialog the single overlay owner and all additions outside server subsets", () => {
    const dialog = readFileSync(join(root, "src/atoms/Dialog.tsx"), "utf8");
    const drawer = readFileSync(join(root, "src/blocks/Drawer.tsx"), "utf8");
    expect([...dialog.matchAll(/<ModalOverlay\b/g)]).toHaveLength(1);
    expect(drawer).not.toMatch(/ModalOverlay|DialogTrigger|usePreventScroll|document\.(?:body|documentElement)\.style/);
    for (const layer of ["atoms", "blocks", "shell"]) {
      const source = readFileSync(join(root, `src/${layer}/server.ts`), "utf8");
      expect(source).not.toMatch(/ResizeHandle|ResizablePane|\bDrawer\b|\bPanel\b|APP_FRAME_MATERIALS/);
    }
  });

  it("consumes the real named exports and Material records from a packed artifact", () => {
    // Existing ancestor peers satisfy this probe; isolated consumer protocols are checked separately.
    const temporary = mkdtempSync(join(root, "../../.app-frame-packed-"));
    try {
      const packed = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], { cwd: root, encoding: "utf8" }));
      execFileSync("tar", ["-xzf", join(temporary, packed[0].filename), "-C", temporary]);
      const atomEntry = pathToFileURL(join(temporary, "package/dist/atoms/index.js")).href;
      const blockEntry = pathToFileURL(join(temporary, "package/dist/blocks/index.js")).href;
      const script = `import * as atoms from ${JSON.stringify(atomEntry)}; import * as blocks from ${JSON.stringify(blockEntry)}; console.log(JSON.stringify({ handle: typeof atoms.ResizeHandle, materials: blocks.APP_FRAME_MATERIALS.map(entry => [entry.id, entry.component === blocks[entry.exportName]]) }));`;
      const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", cwd: root }));
      expect(result).toEqual({ handle: "function", materials: [["panel", true], ["drawer", true], ["resizable-pane", true], ["command-menu", true]] });
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  });

  it("imports every real server subset under react-server without exporting interactive additions", () => {
    const additions = ["ResizeHandle", "Panel", "Drawer", "ResizablePane", "APP_FRAME_MATERIALS", "CommandMenu", "useCommandMenuShortcut"];
    const entries = ["atoms", "blocks", "shell"].map(layer => pathToFileURL(join(root, `dist/${layer}/server.js`)).href);
    const script = `const modules = await Promise.all(${JSON.stringify(entries)}.map(entry => import(entry))); console.log(JSON.stringify(modules.map(module => ${JSON.stringify(additions)}.filter(name => name in module))));`;
    const result = JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", script], { encoding: "utf8", cwd: root }));
    expect(result).toEqual([[], [], []]);
  });
});
