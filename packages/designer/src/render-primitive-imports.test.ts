/** @vitest-environment node */
/**
 * Owner rule (2026-10-26): no headless engine renders raw. Every rendered UI
 * goes through a styled component (shadcn-on-aria, Foundry components, or a
 * consumer-authored on-aria component). Importing a react-aria-components
 * render primitive is allowed only inside the Foundry-on-aria layer,
 * packages/designer/src/components/**. Contexts, hooks and types are plumbing
 * and stay allowed anywhere.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { HEADLESS_ENGINE_EXCEPTIONS, type HeadlessEngineException } from "./components/internal/headless-engine-exceptions.js";

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENGINE = "react-aria-components";
const STYLED_LAYER = "designer/src/components/";
/** Runtime values that render nothing: a toast queue instance and render-prop helpers. */
const NON_RENDER_VALUES = new Set(["UNSTABLE_ToastQueue", "composeRenderProps"]);

/**
 * Known raw imports owned by other lanes, each to be replaced by a styled
 * component and then removed from this list (a stale entry fails the test).
 */
const BASELINE: Readonly<Record<string, readonly string[]>> = {
  // Mobile navigation sheet renders raw Dialog/Modal; nav shell is the frame lane's file.
  "designer/src/shell/NavShell.tsx": ["Dialog", "DialogTrigger", "Modal", "ModalOverlay"],
};

/** Non-Aria headless engines: allowed only with a registered exception record for that component. */
const OTHER_HEADLESS_ENGINES: readonly RegExp[] = [
  /^@tanstack\//, /^downshift$/, /^@headlessui\//, /^@radix-ui\/react-/, /^radix-ui$/, /^@ariakit\//, /^ariakit$/,
  /^@base-ui-components\//, /^@base-ui\//, /^@zag-js\//, /^@ark-ui\//, /^cmdk$/, /^vaul$/,
];
const isOtherEngine = (specifier: string): boolean => OTHER_HEADLESS_ENGINES.some(pattern => pattern.test(specifier));

/** Non-Aria headless engine modules a file imports or re-exports without a registered exception. */
function unregisteredEngineImports(path: string, text: string, exceptions: readonly HeadlessEngineException[]): string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const engines = new Set<string>();
  for (const statement of source.statements) {
    const specifier = (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : undefined;
    if (specifier && isOtherEngine(specifier)) engines.add(specifier);
  }
  return [...engines].filter(engine => !exceptions.some(record => record.component === path && record.engine === engine)).sort();
}

const isPlumbing = (name: string): boolean => /Context$/.test(name) || /^use[A-Z]/.test(name) || NON_RENDER_VALUES.has(name);

/** Render-primitive names a module imports or re-exports from the engine (type-only specifiers excluded). */
function renderPrimitiveImports(path: string, text: string): string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const names: string[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === ENGINE) {
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly) continue;
      if (clause.name) names.push("default");
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) names.push("*");
      if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) if (!element.isTypeOnly) names.push((element.propertyName ?? element.name).text);
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === ENGINE && !statement.isTypeOnly) {
      if (!statement.exportClause) names.push("*");
      else if (ts.isNamedExports(statement.exportClause)) for (const element of statement.exportClause.elements) if (!element.isTypeOnly) names.push((element.propertyName ?? element.name).text);
    }
  }
  return [...new Set(names.filter(name => !isPlumbing(name)))].sort();
}

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "__fixtures__") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

function scan(visit: (rel: string, text: string) => void): void {
  for (const pkg of readdirSync(PACKAGES, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    let files: string[];
    try { files = sources(join(PACKAGES, pkg.name, "src")); } catch { continue; }
    for (const file of files) {
      visit(relative(PACKAGES, file).split(sep).join("/"), readFileSync(file, "utf8"));
    }
  }
}

function violations(): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  scan((rel, text) => {
    if (rel.startsWith(STYLED_LAYER)) return;
    const names = renderPrimitiveImports(rel, text);
    if (names.length) found[rel] = names;
  });
  return found;
}

function engineViolations(): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  scan((rel, text) => {
    const engines = unregisteredEngineImports(rel, text, HEADLESS_ENGINE_EXCEPTIONS);
    if (engines.length) found[rel] = engines;
  });
  return found;
}

describe("render primitives come only from the styled component layer", () => {
  it("classifies primitives, plumbing and types", () => {
    expect(renderPrimitiveImports("x.tsx", 'import { Button, Disclosure as D } from "react-aria-components";')).toEqual(["Button", "Disclosure"]);
    expect(renderPrimitiveImports("x.tsx", 'import { FieldInputContext, useSlottedContext, type Key } from "react-aria-components";\nimport type { SortDescriptor } from "react-aria-components";')).toEqual([]);
    expect(renderPrimitiveImports("x.ts", 'export { Form } from "react-aria-components";')).toEqual(["Form"]);
    expect(renderPrimitiveImports("x.ts", 'const text = `import { Button } from "react-aria-components"`;')).toEqual([]);
  });

  it("finds no raw render-primitive import outside packages/designer/src/components beyond the recorded baseline", () => {
    expect(violations()).toEqual(BASELINE);
  });
});

describe("React Aria is the default headless engine; any other needs a registered exception", () => {
  const record: HeadlessEngineException = { component: "designer/src/components/DataGrid.tsx", engine: "@tanstack/react-table", reason: "virtualised pivot grid", ariaGap: "no row virtualisation with pivoting" };
  const text = 'import { useReactTable } from "@tanstack/react-table";\nimport type { Key } from "react-aria-components";';
  it("fails an unregistered non-Aria engine import", () => {
    expect(unregisteredEngineImports(record.component, text, [])).toEqual(["@tanstack/react-table"]);
    expect(unregisteredEngineImports("designer/src/blocks/X.tsx", 'export { Root } from "@radix-ui/react-dialog";\nimport { useCombobox } from "downshift";', [])).toEqual(["@radix-ui/react-dialog", "downshift"]);
  });
  it("passes the same import once that component has a registered record, and only for that component and engine", () => {
    expect(unregisteredEngineImports(record.component, text, [record])).toEqual([]);
    expect(unregisteredEngineImports("designer/src/blocks/Other.tsx", text, [record])).toEqual(["@tanstack/react-table"]);
    expect(unregisteredEngineImports(record.component, 'import { useSelect } from "downshift";', [record])).toEqual(["downshift"]);
  });
  it("has well-formed records and no unregistered engine import anywhere in packages/*/src", () => {
    for (const row of HEADLESS_ENGINE_EXCEPTIONS) {
      expect(isOtherEngine(row.engine), row.component).toBe(true);
      expect(row.reason.trim() && row.ariaGap.trim(), row.component).toBeTruthy();
    }
    expect(engineViolations()).toEqual({});
  });
});
