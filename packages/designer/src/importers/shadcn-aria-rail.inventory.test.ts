import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { componentSecondaryExports } from "../catalog-core/component-secondary-exports.js";
import { componentOf } from "../catalog-core/resolve-components.js";
import { importShadcnAriaRail } from "./shadcn-aria-rail.js";
import * as command from "../components/command/command.js";
import * as dropdownMenu from "../components/dropdown-menu/dropdown-menu.js";
import * as empty from "../components/empty/empty.js";
import * as item from "../components/item/item.js";
import * as scrollArea from "../components/scroll-area/scroll-area.js";
import * as sheet from "../components/sheet/sheet.js";
import * as sidebar from "../components/sidebar/sidebar.js";

// These are the actual package modules and installed peers; no component is mocked.
const runtimes: Record<string, Record<string, unknown>> = {
  command, "dropdown-menu": dropdownMenu, empty, item, "scroll-area": scrollArea, sheet, sidebar,
};
const imported = importShadcnAriaRail();

describe("official Aria rail component anatomy inventory", () => {
  it.each(Object.keys(runtimes))("proves %s local function exports independently of the descriptor", leaf => {
    const doc = imported.fills.find(doc => componentOf(doc).slot === `components.${leaf}`)!;
    const fill = componentOf(doc);
    const file = imported.files.find(file => fill.impl.kind === "source" && file.path === fill.impl.entry)!;
    const ast = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    expect((ast as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics).toEqual([]);
    const functions = new Set(ast.statements.filter(ts.isFunctionDeclaration)
      .filter(node => node.body !== undefined).map(node => node.name!.text));
    const erased = new Set<string>();
    const exports = ast.statements.filter(ts.isExportDeclaration).flatMap(node => {
      expect(node.moduleSpecifier).toBeUndefined();
      if (!node.exportClause || !ts.isNamedExports(node.exportClause)) throw new Error("expected local value exports");
      return node.exportClause.elements.flatMap(binding => {
        if (node.isTypeOnly || binding.isTypeOnly) { erased.add(binding.name.text); return []; }
        expect(binding.propertyName).toBeUndefined();
        return [binding.name.text];
      });
    }).sort();
    expect(Object.keys(runtimes[leaf]!).sort()).toEqual(exports);
    for (const name of erased) expect(runtimes[leaf]!).not.toHaveProperty(name);
    if (leaf === "sheet") expect([...erased].sort()).toEqual(["SheetPrimitiveProps", "SheetTriggerPrimitiveProps"]);
    for (const name of exports) {
      expect(functions.has(name), name).toBe(true);
      expect(typeof runtimes[leaf]![name], name).toBe("function");
    }
    const anatomy = exports.filter(name => name !== fill.impl.export && /^[A-Z]/.test(name))
      .map(name => ({ name, export: name }));
    expect(componentSecondaryExports(fill, imported.files)).toEqual(anatomy);
    expect(fill.secondaryExports ?? []).toEqual(expect.arrayContaining(anatomy));
    if (leaf === "scroll-area") expect(fill).not.toHaveProperty("secondaryExports");
    if (leaf === "sidebar") {
      expect(exports).toContain("useSidebar");
      expect(anatomy.map(row => row.name)).not.toContain("useSidebar");
    }
    // The checked-in offer and the importer must authenticate the same inventory.
    const saved = JSON.parse(readFileSync(resolve(import.meta.dirname, `../catalog/fills/shadcn@aria/components.${leaf}.json`), "utf8"));
    expect(saved).toEqual(doc);
    const materialized = readFileSync(resolve(import.meta.dirname, `../${file.path}`), "utf8");
    expect(materialized).toBe(file.content.replace(/((?:from\s*|import\s*)["'])(\.[^"']+)(["'])/g,
      (_match, before, specifier, after) => before + specifier + (/\.(js|json)$/.test(specifier) ? "" : ".js") + after));
  });

  it.each(Object.keys(runtimes).filter(leaf => leaf !== "scroll-area"))(
    "refuses %s mutated bytes, relocated receipts and non-component values", leaf => {
      const fill = componentOf(imported.fills.find(doc => componentOf(doc).slot === `components.${leaf}`)!);
      if (fill.impl.kind !== "source") throw new Error("expected source implementation");
      const file = imported.files.find(file => file.path === fill.impl.entry)!;
      expect(() => componentSecondaryExports(fill, [{ ...file, content: file.content + " " }])).toThrow(/secondary/);
      const path = `components/${leaf}/relocated.tsx`;
      expect(() => componentSecondaryExports({ ...fill, impl: { ...fill.impl, entry: path } }, [{ ...file, path }])).toThrow(/secondary/);
      for (const name of ["Missing", "SidebarContext", "VariantProps", "React", "useSidebar", "emptyMediaVariants", "dropdownMenuItemVariants", "itemVariants", "SheetOverlay"]) {
        expect(() => componentSecondaryExports({ ...fill, secondaryExports: [{ name: "PublicPart", export: name }] }, [file]), name).toThrow(/secondary/);
      }
    },
  );
});
