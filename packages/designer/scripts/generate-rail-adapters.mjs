// Repository tooling. Immutable upstream input becomes explicit, checked adaptation data.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hash = text => createHash("sha256").update(text).digest("hex");
const read = path => readFileSync(resolve(packageRoot, path), "utf8");
const packageIdentity = JSON.parse(read("package.json"));
const leaves = ["command", "dropdown-menu", "empty", "item", "scroll-area", "sheet", "sidebar"];
const extraRoots = {
  "text-field": ["input", "textarea", "label"], "search-field": ["input-group", "input", "label", "button"],
  "tag-group": ["badge", "button"], toolbar: ["button-group"], link: ["button"], "native-action": ["button"],
  toast: ["sonner"], "status-mark": ["badge"], "grid-list": ["item"],
};
const displayDefaults = new Set(["title", "description"]);
const copyKeys = ["command.title", "command.description", "command.search", "sheet.close", "sidebar.title", "sidebar.description", "sidebar.toggle"];

function literal(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map(property => {
    if (!ts.isPropertyAssignment(property) || !property.name || ts.isComputedPropertyName(property.name)) throw new Error("Closed upstream variant property required");
    return [property.name.text, literal(property.initializer)];
  }));
  throw new Error("Closed upstream variant literal required");
}

/** Lower the pinned, closed CVA tables, retaining its null/undefined/compound/class semantics. */
export function lowerVariant(name, base, config) {
  const axes = Object.entries(config.variants ?? {});
  const type = axes.map(([axis, values]) => `${JSON.stringify(axis)}?: ${Object.keys(values).map(value => value === "true" || value === "false" ? value : JSON.stringify(value)).join(" | ")} | null`).join("; ");
  const definition = JSON.stringify({ base, variants: {}, defaultVariants: {}, ...config });
  return `const ${name}_DEFINITION = ${definition}
function ${name}(props: { ${type}; class?: ClassValue; className?: ClassValue } = {}) {
  props ??= {}
  const definition = ${name}_DEFINITION
  const key = (value: unknown) => typeof value === "boolean" ? String(value) : value === 0 ? "0" : value
  const supplied = Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined))
  const values: { [axis: string]: unknown } = { ...definition.defaultVariants, ...supplied }
  const selected = Object.entries(definition.variants).map(([axis, choices]) => {
    if ((props as { [axis: string]: unknown })[axis] === null) return null
    const value = key((props as { [axis: string]: unknown })[axis]) || key((definition.defaultVariants as { [axis: string]: unknown })[axis])
    return (choices as { [value: string]: ClassValue })[String(value)]
  })
  const compound = ((${JSON.stringify(config.compoundVariants ?? [])}) as { [key: string]: unknown }[]).flatMap(({ class: value, className, ...conditions }) =>
    Object.entries(conditions).every(([axis, expected]) => Array.isArray(expected) ? expected.includes(values[axis]) : values[axis] === expected)
      ? [value as ClassValue, className as ClassValue] : [])
  return classNames(definition.base, selected, compound, props.class, props.className)
}`;
}

export const utilitySource = `import { mergeUiClasses as cx } from "${packageIdentity.name}/components"
import type { ClassValue, CopyResolver, CopyRef } from "./types"
export { type ClassValue, type VariantProps, type CopyResolver } from "./types"
export { RAIL_COPY_REFS } from "./copy"
function flatten(value: ClassValue): string {
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (Array.isArray(value)) return value.filter(Boolean).map(flatten).filter(Boolean).join(" ")
  if (value && typeof value === "object") {
    const keys: string[] = []
    for (const key in value) if ((value as { [key: string]: unknown })[key]) keys.push(key)
    return keys.join(" ")
  }
  return ""
}
export function classNames(...values: ClassValue[]): string { return values.filter(Boolean).map(flatten).filter(Boolean).join(" ") }
export function cn(...values: ClassValue[]): string { return cx(classNames(...values)) }
export function resolveRailCopy(resolver: CopyResolver | undefined, ref: CopyRef): string {
  if (!resolver) throw new TypeError("Designer component copy requires a host resolver")
  const result = resolver(ref)
  if (!result || result.ref.id !== ref.id || result.ref.locale !== ref.locale || typeof result.text !== "string" || !result.text.trim()) throw new TypeError(\`Designer component copy unresolved: \${ref.id}\`)
  return result.text
}
`;

function addCopyPort(source, names) {
  let ast = ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  for (const node of ast.statements) if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) {
    const parameter = node.parameters[0];
    if (!parameter?.type || !ts.isObjectBindingPattern(parameter.name)) throw new Error(`Unsupported copy port ${node.name.text}`);
    edits.push({ start: parameter.name.getStart(ast) + 1, end: parameter.name.getStart(ast) + 1, text: "\n  copyResolver," });
    edits.push({ start: parameter.type.getStart(ast), end: parameter.type.end, text: `(${parameter.type.getText(ast)}) & { copyResolver?: CopyResolver }` });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
}

export function adaptFile(file) {
  let source = file.content;
  const ast = ts.createSourceFile(file.path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const defaults = [], variants = [], edits = [];
  for (const node of ast.statements) {
    if (ts.isFunctionDeclaration(node)) for (const parameter of node.parameters) if (ts.isObjectBindingPattern(parameter.name)) {
      for (const binding of parameter.name.elements) if (binding.initializer && ts.isIdentifier(binding.name) && !displayDefaults.has(binding.name.text)) {
        let value; try { value = literal(binding.initializer); } catch { continue; }
        defaults.push({ function: node.name.text, prop: binding.name.text, value });
        edits.push({ start: binding.getStart(ast), end: binding.getStart(ast), text: `/** @default ${JSON.stringify(value)} */\n  ` });
      }
    }
    if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) {
      if (declaration.initializer && ts.isCallExpression(declaration.initializer) && declaration.initializer.expression.getText(ast) === "cva") {
        if (node.declarationList.declarations.length !== 1 || !ts.isIdentifier(declaration.name) || declaration.initializer.arguments.length !== 2) throw new Error("Closed CVA declaration required");
        const [base, config] = declaration.initializer.arguments.map(literal);
        const row = { item: file.item, name: declaration.name.text, base, config };
        variants.push(row);
        edits.push({ start: node.getStart(ast), end: node.end, text: lowerVariant(row.name, base, config) });
      }
    }
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  source = source.replace(/^import\s*\{[^}]*\}\s*from "class-variance-authority"\s*\n/gm, "");
  // Retained Badge consumers use its span seat; the unused render callback is not part of their contract.
  if (file.item === "badge") source = source.replace("  render,\n", "")
    .replace(/ & \{\n    render\?:[^\n]*\n  \}/, "")
    .replace(/  if \(render\) \{[\s\S]*?\n  \}\n\n/, "");
  const ports = { command: ["CommandDialog", "CommandInput"], dialog: ["Dialog", "DialogFooter"], sheet: ["Sheet"], sidebar: ["Sidebar", "SidebarTrigger", "SidebarRail"] }[file.item] ?? [];
  if (ports.length) source = addCopyPort(source, ports);
  if (file.item === "command") {
    source = source.replace('title = "Command Palette"', "title").replace('description = "Search for a command to run..."', "description")
      .replace("<Dialog\n", "<Dialog\n      copyResolver={copyResolver}\n")
      .replace("<DialogTitle>{title}</DialogTitle>", '<DialogTitle>{title ?? resolveRailCopy(copyResolver, RAIL_COPY_REFS["command.title"])}</DialogTitle>')
      .replace("<DialogDescription>{description}</DialogDescription>", '<DialogDescription>{description ?? resolveRailCopy(copyResolver, RAIL_COPY_REFS["command.description"])}</DialogDescription>')
      .replace('props.placeholder || "Search"', 'props.placeholder || resolveRailCopy(copyResolver, RAIL_COPY_REFS["command.search"])');
  }
  if (file.item === "dialog" || file.item === "sheet") source = source.replace(/>Close<\/span>/g, '>{resolveRailCopy(copyResolver, RAIL_COPY_REFS["sheet.close"])}</span>')
    .replace(/>Close<\/DialogClose>/g, '>{resolveRailCopy(copyResolver, RAIL_COPY_REFS["sheet.close"])}</DialogClose>');
  if (file.item === "sidebar") source = source.replace("<Sheet\n", "<Sheet\n        copyResolver={copyResolver}\n")
    .replace("<SheetTitle>Sidebar</SheetTitle>", '<SheetTitle>{resolveRailCopy(copyResolver, RAIL_COPY_REFS["sidebar.title"])}</SheetTitle>')
    .replace("<SheetDescription>Displays the mobile sidebar.</SheetDescription>", '<SheetDescription>{resolveRailCopy(copyResolver, RAIL_COPY_REFS["sidebar.description"])}</SheetDescription>')
    .replace(/>Toggle Sidebar<\/span>/g, '>{resolveRailCopy(copyResolver, RAIL_COPY_REFS["sidebar.toggle"])}</span>')
    .replace(/(aria-label|title)="Toggle Sidebar"/g, '$1={resolveRailCopy(copyResolver, RAIL_COPY_REFS["sidebar.toggle"])}');
  if (variants.length || ports.length) {
    const types = variants.length ? ", classNames, type ClassValue, type VariantProps" : "";
    const copy = ports.length ? ", resolveRailCopy, RAIL_COPY_REFS, type CopyResolver" : "";
    source = source.replace(/import \{ cn \} from "cn"/, `import { cn${types}${copy} } from "cn"`);
  }
  return { item: file.item, path: file.path, inputSha256: file.sha256, content: source, defaults, variants };
}

export function generateRailAdapters() {
  const input = JSON.parse(read("src/importers/vendor/shadcn-aria-rail.data.json"));
  for (const file of input.files) if (hash(file.content) !== file.sha256) throw new Error(`Upstream hash mismatch: ${file.path}`);
  const slots = new Set(JSON.parse(read("src/catalog/slots/components.json")).map(row => row.id));
  for (const leaf of leaves) if (!slots.has(`components.${leaf}`)) throw new Error(`Unregistered leaf: ${leaf}`);
  const writer = JSON.parse(read("../writer/src/catalog/records/admin-studio.r1.en.json"));
  const copy = copyKeys.map(key => {
    const context = `designer.component.${key}`;
    const rows = writer.records.filter(record => record.context === context);
    if (rows.length !== 1 || rows[0].status !== "draft" || rows[0].approval) throw new Error(`Expected real Writer draft: ${context}`);
    const binding = writer.bindings.filter(binding => binding.cellId === context && binding.recordId === rows[0].id);
    if (binding.length !== 1) throw new Error(`Writer binding missing: ${context}`);
    return { key, ref: { id: rows[0].id } };
  });
  let files = input.files.filter(file => !["style", "license", "use-mobile", "kbd"].includes(file.item)).map(adaptFile);
  const byItem = new Map(input.files.map(file => [file.item, file]));
  const owners = new Map(files.map(file => [file.item, []]));
  for (const leaf of leaves) {
    const seen = new Set();
    const visit = item => {
      if (seen.has(item) || item !== leaf && leaves.includes(item)) return;
      seen.add(item);
      owners.get(item)?.push(`components.${leaf}`);
      for (const match of byItem.get(item).content.matchAll(/from\s*"@\/registry\/bases\/aria\/ui\/([a-z-]+)"/g)) visit(match[1]);
    };
    visit(leaf);
  }
  for (const [leaf, roots] of Object.entries(extraRoots)) {
    const seen = new Set();
    const visit = item => {
      if (seen.has(item)) return;
      seen.add(item); owners.get(item)?.push(`components.${leaf}`);
      for (const match of byItem.get(item).content.matchAll(/from\s*"@\/registry\/bases\/aria\/ui\/([a-z-]+)"/g)) visit(match[1]);
    };
    roots.forEach(visit);
  }
  files = files.filter(file => owners.get(file.item)?.length);
  for (const file of files) for (const row of file.defaults) {
    row.slots = [...new Set(owners.get(file.item))].sort();
    if (!row.slots.length || row.slots.some(slot => !slots.has(slot))) throw new Error(`Unregistered default owner: ${file.item}.${row.function}.${row.prop}`);
  }
  const host = [{ file: "components/_parts/rail-utils/index.ts", consumerImport: `import { mergeUiClasses as cx } from "${packageIdentity.name}/components"`, packageImport: 'import { cx } from "../../internal/cx"', source: "components/internal/cx.ts", sourceSha256: hash(read("src/components/internal/cx.ts")), dependency: { name: packageIdentity.name, version: packageIdentity.version, license: packageIdentity.license } }];
  host.push({ file: "components/native-action/native-action.tsx", consumerImport: `import { mergeUiClasses as cx } from "${packageIdentity.name}/components/server"`, packageImport: 'import { cx } from "../internal/cx"', source: "components/internal/cx.ts", sourceSha256: hash(read("src/components/internal/cx.ts")), dependency: { name: packageIdentity.name, version: packageIdentity.version, license: packageIdentity.license } });
  const refs = `export const RAIL_COPY_REFS = ${JSON.stringify(Object.fromEntries(copy.map(row => [row.key, row.ref])), null, 2)} as const\n`;
  return { version: 1, upstreamCommit: input.commit, upstreamDataSha256: hash(read("src/importers/vendor/shadcn-aria-rail.data.json")), registeredSlots: leaves.map(leaf => `components.${leaf}`), copy, files, host, utility: utilitySource, copySource: refs, utilityTypes: 'interface CopyRef { readonly id: string; readonly locale?: string; readonly values?: Readonly<Record<string, string | number | boolean>> }\ntype CopyResolver = (ref: CopyRef) => { readonly ref: CopyRef; readonly text: string } | undefined\ntype ClassValue = string | number | boolean | null | undefined | object | ClassValue[]\ntype VariantProps<T extends (...args: any[]) => unknown> = Omit<NonNullable<Parameters<T>[0]>, "class" | "className">\nexport { type CopyRef, type CopyResolver, type ClassValue, type VariantProps }\n' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = generateRailAdapters();
  writeFileSync(resolve(packageRoot, "src/importers/vendor/shadcn-aria-rail.adapters.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(`Registered ${result.files.flatMap(file => file.defaults).length} machine defaults and ${result.copy.length} Writer references; lowered ${result.files.flatMap(file => file.variants).length} closed variant tables.`);
  if (process.argv.includes("--emit")) {
    const cache = resolve(packageRoot, "node_modules/.cache");
    mkdirSync(cache, { recursive: true });
    const temporary = mkdtempSync(resolve(cache, "rail-transform-"));
    const entry = resolve(temporary, "importer.mjs");
    await build({ entryPoints: [resolve(packageRoot, "src/importers/shadcn-aria-rail.ts")], outfile: entry, bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "silent" });
    const module = await import(pathToFileURL(entry).href);
    const imported = module.importShadcnAriaRail();
    if (imported.candidates.some(row => row.blockers.length)) throw new Error("Adapted source still has rewrite blockers");
    for (const document of imported.fills) {
      const slot = document.$extensions["com.clossys.fill"].slot;
      if (slot !== "components.keyboard") writeFileSync(resolve(packageRoot, `src/catalog/fills/shadcn@aria/${slot}.json`), JSON.stringify(document, null, 2) + "\n");
    }
    for (const file of imported.files) {
      if (!file.path.startsWith("components/") || file.path.startsWith("components/keyboard/")) continue;
      const path = resolve(packageRoot, "src", file.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, module.railPackageFile(file).content);
    }
    const native = imported.sourceBundles.find(bundle => bundle.slot === "components.native-action");
    if (native) {
      const path = resolve(packageRoot, "src/catalog/rules/components.native-action.json");
      const rule = JSON.parse(readFileSync(path, "utf8"));
      writeFileSync(path, JSON.stringify({ ...rule, files: native.files }, null, 2) + "\n");
    }
    console.log(`Emitted ${imported.files.length} adapted source/support files with zero rewrite blockers.`);
  }
}
