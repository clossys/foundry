/**
 * Class-wide check (T14): no Designer composition passes a Foundry-only prop to a slot the ambient
 * selection binds to stock shadcn source. The facade forwards props verbatim to the selected export,
 * so a Foundry prop (`trigger`, `controls`, `heading`, `isDestructive`, a Tooltip `delay`) is silently
 * dropped and the control it carried never renders. Every JSX use of a `componentLeaf` binding is
 * checked against the first-parameter properties of the stock export it resolves to (the root impl, or
 * the declared secondary export for a part); root propMap axes and `key`/`data-*` are allowed.
 *
 * BASELINE freezes the violations that existed when the check landed, outside the shell compositions
 * T14 rewrote. It is ratchet-only: a new violation fails, and a fixed one must be removed here (a stale
 * entry fails too).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { marketingComponentSelection } from "../studio/marketing-component-selection.js";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSITION_DIRS = ["blocks", "frames", "sections", "shell"];
/** Compositions rewritten onto stock anatomy; they may never regress. */
const CLEAN = ["blocks/AccountMenu.tsx", "blocks/CommandMenu.tsx", "blocks/shell-menu.tsx", "frames/AppFrame.tsx", "frames/AppFrameBrandTheme.tsx"];

interface Use { readonly file: string; readonly leaf: string; readonly part?: string; readonly attrs: readonly string[] }
interface Bound { readonly leaf: string; readonly part?: string }

function compositionFiles(): string[] {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__fixtures__" ? [] : walk(path);
    return name.endsWith(".tsx") && !/\.(test|stories)\.tsx$/.test(name) ? [path] : [];
  });
  return COMPOSITION_DIRS.flatMap(dir => walk(join(src, dir))).sort();
}

function declaredLeaves(sf: ts.SourceFile): Map<string, Bound> {
  const leaves = new Map<string, Bound>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression) && node.initializer.expression.text === "componentLeaf") {
      const [leaf, part] = node.initializer.arguments;
      if (leaf && ts.isStringLiteral(leaf)) leaves.set(node.name.text, { leaf: leaf.text, ...(part && ts.isStringLiteral(part) ? { part: part.text } : {}) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return leaves;
}

const parse = (file: string, text = readFileSync(file, "utf8")) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/**
 * Every JSX element whose tag is a `componentLeaf(...)` binding, declared in the file or imported
 * by name from a relative module that declares it (the shared shell anatomy).
 */
function leafUses(file: string, text?: string): Use[] {
  const sf = parse(file, text);
  const leaves = declaredLeaves(sf);
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.startsWith(".")) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings) || statement.importClause?.isTypeOnly) continue;
    const target = join(dirname(file), statement.moduleSpecifier.text.replace(/\.js$/, ".tsx"));
    let exported: Map<string, Bound>;
    try { exported = declaredLeaves(parse(target)); } catch { continue; }
    for (const element of bindings.elements) {
      const bound = exported.get((element.propertyName ?? element.name).text);
      if (bound) leaves.set(element.name.text, bound);
    }
  }
  const uses: Use[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const [head, ...member] = node.tagName.getText(sf).split(".");
      const bound = leaves.get(head!);
      if (bound) {
        const part = bound.part ?? (member.length ? member.join(".") : undefined);
        uses.push({ file: relative(src, file), leaf: bound.leaf, ...(part ? { part } : {}),
          attrs: node.attributes.properties.filter(ts.isJsxAttribute).map(attribute => attribute.name.getText(sf)) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return uses;
}

interface StockBinding { readonly entry: string; readonly export: string; readonly axes: ReadonlySet<string>; readonly parts: Readonly<Record<string, string>> }

function stockBindings(): Map<string, StockBinding> {
  const components = marketingComponentSelection().profile.components.components as Record<string, {
    impl: { kind: string; entry?: string; export: string };
    propMap?: Record<string, string>;
    descriptor: { secondaryExports?: readonly { name: string; export: string }[] };
  }>;
  const bindings = new Map<string, StockBinding>();
  for (const [leaf, chosen] of Object.entries(components)) {
    if (chosen.impl.kind !== "source" || !chosen.impl.entry) continue;
    bindings.set(leaf, {
      entry: join(src, "components/preview-runtime", chosen.impl.entry),
      export: chosen.impl.export,
      axes: new Set(Object.keys(chosen.propMap ?? {}).map(key => key.split(".")[0]!)),
      parts: Object.fromEntries((chosen.descriptor.secondaryExports ?? []).map(row => [row.name, row.export])),
    });
  }
  return bindings;
}

/** `file: leaf[.part] -> props` rows, one per distinct offending use shape. */
const bindings = stockBindings();
/** One program over every stock-bound entry, shared by the scan and the probe. */
const program = ts.createProgram([...new Set([...bindings.values()].map(binding => binding.entry))], {
  jsx: ts.JsxEmit.ReactJSX, strict: true, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022, skipLibCheck: true, noEmit: true, types: [],
});
const checker = program.getTypeChecker();
const cache = new Map<string, ReadonlySet<string> | null>();

function violations(uses: readonly Use[]): Record<string, string[]> {
  const relevant = uses.filter(use => bindings.has(use.leaf));
  const propsOf = (entry: string, name: string): ReadonlySet<string> | null => {
    const key = entry + "#" + name;
    if (cache.has(key)) return cache.get(key)!;
    const sf = program.getSourceFile(entry);
    const moduleSymbol = sf && checker.getSymbolAtLocation(sf);
    const symbol = moduleSymbol && checker.getExportsOfModule(moduleSymbol).find(candidate => candidate.name === name);
    const parameter = symbol && checker.getTypeOfSymbolAtLocation(symbol, sf!).getCallSignatures()[0]?.parameters[0];
    const props = symbol ? new Set(parameter ? checker.getPropertiesOfType(checker.getApparentType(checker.getTypeOfSymbolAtLocation(parameter, sf!))).map(property => property.name) : []) : null;
    cache.set(key, props);
    return props;
  };
  const rows: Record<string, Set<string>> = {};
  for (const use of relevant) {
    const binding = bindings.get(use.leaf)!;
    const target = use.part ? binding.parts[use.part] : binding.export;
    const label = use.leaf + (use.part ? "." + use.part : "");
    let row: string | undefined;
    if (!target) row = `${label} undeclared part`;
    else {
      const props = propsOf(binding.entry, target);
      if (!props) row = `${label} missing export ${target}`;
      else {
        const foreign = use.attrs.filter(name => name !== "key" && !name.startsWith("data-") && !props.has(name) && !(!use.part && binding.axes.has(name)));
        if (foreign.length) row = `${label} -> ${[...new Set(foreign)].sort().join(",")}`;
      }
    }
    if (row) (rows[use.file] ??= new Set()).add(row);
  }
  return Object.fromEntries(Object.entries(rows).sort(([a], [b]) => a.localeCompare(b)).map(([file, set]) => [file, [...set].sort()]));
}

const BASELINE: Readonly<Record<string, readonly string[]>> = {
  "blocks/Drawer.tsx": ["components.dialog -> overlayClassName,trigger", "components.dialog.Heading undeclared part"],
  "blocks/EventItem.tsx": ["components.avatar -> alt,src"],
  "blocks/NoticeList.tsx": ["components.banner -> dismissLabel,onDismiss"],
  "blocks/chat/Chat.tsx": ["components.avatar -> alt"],
  "blocks/matrix/choices.tsx": ["components.radio-group -> label"],
  "frames/FrameDock.tsx": ["components.banner -> onDismiss"],
  "shell/SiteHeader.tsx": ["components.button.LinkButton -> aria-current"],
};

describe("stock-bound slot props (T14)", () => {
  const uses = compositionFiles().flatMap(file => leafUses(file));
  const found = violations(uses);

  it("scans the shell compositions it guards", () => {
    for (const file of CLEAN) expect(uses.some(use => use.file === file), file).toBe(true);
  });

  it("keeps the rewritten shell compositions free of Foundry-only props on stock-bound slots", () => {
    expect(Object.fromEntries(CLEAN.map(file => [file, found[file] ?? []]))).toEqual(Object.fromEntries(CLEAN.map(file => [file, []])));
  });

  it("matches the frozen baseline everywhere else (ratchet-only)", () => {
    expect(found).toEqual(BASELINE);
  });

  it("flags a Foundry-only prop and an undeclared part on a stock-bound leaf", () => {
    const fixture = join(src, "blocks/__probe__.tsx");
    const probe = leafUses(fixture, `const Menu = componentLeaf<any>("components.menu");
const Item = componentLeaf<any>("components.menu", "MenuItem");
export const a = <Menu trigger={null} presentation="popup" key="k" data-x="1"><Item isDestructive id="x" /><Menu.Section heading="h" /></Menu>;`);
    expect(violations(probe)).toEqual({ "blocks/__probe__.tsx": ["components.menu -> trigger", "components.menu.MenuItem -> isDestructive", "components.menu.Section undeclared part"] });
  });
});
