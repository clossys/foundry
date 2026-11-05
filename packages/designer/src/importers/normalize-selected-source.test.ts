// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { sha256 } from "../catalog-core/digest.js";
import { importShadcnAriaComponents, type ShadcnComponentInput } from "./shadcn-aria-components.js";
import { normalizeSelectedSource } from "./normalize-selected-source.js";

const directory = resolve(import.meta.dirname, "__fixtures__/shadcn-aria");
const read = (name: string) => readFileSync(resolve(directory, name), "utf8");
function pinnedInput(): ShadcnComponentInput {
  return { items: readdirSync(directory).filter(name => name.endsWith(".json")).map(name => JSON.parse(read(name))).filter(item => item.type === "registry:ui"),
    styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") }, notice: { path: "LICENSE.md", content: read("LICENSE.md") } };
}
const cohort = {
  select: { leaf: "select", entry: "select", types: ["ComponentProps", "ReactNode"], values: [] },
  combobox: { leaf: "combo-box", entry: "combobox", types: ["ComponentProps", "ReactNode", "RefObject"], values: ["useContext", "useRef"] },
  calendar: { leaf: "calendar", entry: "calendar", types: ["ComponentProps", "ReactElement", "ReactNode", "Ref", "RefAttributes"], values: ["forwardRef"] },
  popover: { leaf: "popover", entry: "popover", types: ["ComponentProps"], values: [] },
  checkbox: { leaf: "checkbox", entry: "checkbox", types: [], values: [] },
} as const;
const inputGroupNames = ["InputGroup", "InputGroupAddon", "InputGroupButton", "InputGroupText", "InputGroupInput", "InputGroupTextarea"];
function imports(code: string) {
  const source = ts.createSourceFile("selected.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bindings = new Map<string, { local: string; typeOnly: boolean }>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "react") continue;
    const clause = statement.importClause;
    expect(clause?.namedBindings && ts.isNamedImports(clause.namedBindings), "React must use named imports").toBe(true);
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const binding of clause.namedBindings.elements) {
      bindings.set(binding.propertyName?.text ?? binding.name.text, { local: binding.name.text, typeOnly: clause.isTypeOnly || binding.isTypeOnly });
    }
  }
  return { source, bindings };
}

describe("selected pinned-source normalization", () => {
  it("B1-N1 normalizes the actual five-leaf type and runtime import census", () => {
    const result = importShadcnAriaComponents(pinnedInput());
    for (const [item, expected] of Object.entries(cohort)) {
      const code = result.rewrites[item]!.files.find(file => file.path === `components/${expected.leaf}/${expected.entry}.tsx`)!.content;
      const { source, bindings } = imports(code);
      expect([...bindings.keys()].sort(), item).toEqual([...expected.types, ...expected.values].sort());
      for (const type of expected.types) expect(bindings.get(type)?.typeOnly, `${item}.${type}`).toBe(true);
      for (const value of expected.values) {
        expect(bindings.get(value)?.typeOnly, `${item}.${value}`).toBe(false);
        const calls: string[] = [];
        const visit = (node: ts.Node): void => { if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) calls.push(node.expression.text); ts.forEachChild(node, visit); };
        visit(source); expect(calls, `${item}.${value} callable`).toContain(bindings.get(value)!.local);
      }
      const namespaceReferences: string[] = [];
      const visit = (node: ts.Node): void => { if (ts.isIdentifier(node) && node.text === "React") namespaceReferences.push(node.text); ts.forEachChild(node, visit); };
      visit(source); expect(namespaceReferences, item).toEqual([]);
      expect(code.startsWith('"use client"')).toBe(true);
    }
  });
  it("B1-N2 shares exactly the six explicit InputGroup exports and final hashes", () => {
    const result = importShadcnAriaComponents(pinnedInput());
    const bundles = [result.rewrites.select!, result.rewrites.combobox!];
    for (const bundle of bundles) {
      const implementation = bundle.files.find(file => file.path === "components/_parts/input-group/input-group.tsx")!;
      const { bindings } = imports(implementation.content);
      expect([...bindings.keys()]).toEqual(["ComponentProps"]); expect(bindings.get("ComponentProps")?.typeOnly).toBe(true);
      expect(implementation.content).not.toContain("React.ComponentProps");
      expect(implementation.content).toContain('import { Input } from "react-aria-components"');
      expect(implementation.content).toContain('import { TextArea as Textarea } from "react-aria-components"');
      const index = bundle.files.find(file => file.path === "components/_parts/input-group/index.ts")!;
      expect(index.content).toBe(`export { ${inputGroupNames.join(", ")} } from "./input-group"\n`);
      for (const file of [implementation, index]) expect(bundle.outputSha256).toContainEqual({ path: file.path, sha256: sha256(file.content) });
    }
    for (const path of ["components/_parts/input-group/input-group.tsx", "components/_parts/input-group/index.ts"]) {
      expect(bundles[0]!.files.find(file => file.path === path)).toEqual(bundles[1]!.files.find(file => file.path === path));
      expect(bundles[0]!.outputSha256.find(file => file.path === path)).toEqual(bundles[1]!.outputSha256.find(file => file.path === path));
    }
  });
  it("B1-N3 leaves all five selected facade paths to emission", () => {
    const result = importShadcnAriaComponents(pinnedInput());
    for (const [item, { leaf, entry }] of Object.entries(cohort)) {
      const bundle = result.rewrites[item]!;
      expect(bundle.files.map(file => file.path), item).not.toContain(`components/${leaf}/index.ts`);
      expect(bundle.outputSha256.map(file => file.path), item).not.toContain(`components/${leaf}/index.ts`);
      expect(bundle.files.map(file => file.path)).toContain(`components/${leaf}/${entry}.tsx`);
    }
  });
  // The former 206 K4 + 2 K7 tuples are now accounted for by rewrite.ts selectedBindings: each exact,
  // accepted restyle is kept as a "Restyled source" receipt note rather than a blocker.
  it("B1-N4 receipts every final file and keeps every accepted restyle as a note, not a blocker", () => {
    const result = importShadcnAriaComponents(pinnedInput());
    const blockers = result.fills.flatMap(doc => Object.values(doc.components).flatMap(fill => fill.blockers));
    expect(blockers).toHaveLength(0);
    const restyled = result.receipt.filter(row => row.status === "candidate").flatMap(row => row.notes ?? []).filter(note => note.message.startsWith("Restyled source"));
    expect(restyled).toHaveLength(136);
    for (const [item, bundle] of Object.entries(result.rewrites)) {
      expect(bundle.outputSha256, item).toEqual(bundle.files.map(file => ({ path: file.path, sha256: sha256(file.content) })).sort((a, b) => a.path.localeCompare(b.path)));
    }
  });
});

describe("bounded React namespace normalization controls", () => {
  const path = "components/select/select.tsx";
  const normalize = (content: string) => normalizeSelectedSource({ path, content }).content;
  it("preserves client directives, comments, string literals and source exports", () => {
    const input = '"use client"\n// React.ComponentProps\nimport /* import comment */ * as React from "react"\nconst label = "React.ReactNode"\nconst literal = `React.ComponentProps`\ntype Props = React /* before dot */ . /* after dot */ ComponentProps<"div">\nexport { label, literal }\n';
    const output = normalize(input);
    for (const bytes of ['"use client"', '// React.ComponentProps', '/* import comment */', '"React.ReactNode"', '`React.ComponentProps`', '/* before dot */', '/* after dot */', 'export { label, literal }']) expect(output).toContain(bytes);
    expect(output).toContain('type Props = ReactComponentProps /* before dot */  /* after dot */ <"div">');
    expect(normalize(output)).toBe(output);
    expect(ts.transpileModule(output, { compilerOptions: { target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true }).diagnostics).toEqual([]);
  });
  it.each([
    "type Props = React.Unknown<unknown>",
    'type Props = React["ComponentProps"]',
    "const value = React[key]",
    "const value = React?.ComponentProps",
    "const value = React",
    "const value = (React).ComponentProps",
    "const value = import(React)",
    "React.ComponentProps = replacement",
    "const ReactComponentProps = 1; type Props = React.ComponentProps<\"div\">",
    "const ReactNode = 1; type Node = React.ReactNode",
    "const value = `${React.ReactNode}`",
    "const value = /React.ComponentProps/",
  ])("refuses unsupported access or ambiguous alias: %s", body => {
    expect(() => normalize(`import * as React from "react"\n${body}`)).toThrow(/selected-source:/);
  });
  it("does not broaden normalization to other source families", () => {
    const file = { path: "components/button/button.tsx", content: 'import * as React from "react"\ntype Props = React.ComponentProps<"button">' };
    expect(normalizeSelectedSource(file)).toBe(file);
  });
  it("typechecks named React type references and callable hook/ref values against installed React", () => {
    const examples = [
      { path, content: 'import * as React from "react"\nexport type Props = React.ComponentProps<"div">; export type Child = React.ReactNode;' },
      { path: "components/combo-box/combobox.tsx", content: 'import * as React from "react"\nimport { createContext } from "react"\nconst context = createContext(false); export const value = React.useContext(context); export const ref = React.useRef<HTMLDivElement | null>(null); export type Ref = React.RefObject<HTMLDivElement | null>;' },
      { path: "components/calendar/calendar.tsx", content: 'import * as React from "react"\nexport const Calendar = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>((props, ref) => <div {...props} ref={ref} />);' },
    ];
    for (const [index, example] of examples.entries()) {
      const filename = resolve(import.meta.dirname, `__selected_typecheck_${index}.tsx`);
      const content = normalizeSelectedSource(example).content;
      const options: ts.CompilerOptions = { noEmit: true, jsx: ts.JsxEmit.ReactJSX, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: [] };
      const host = ts.createCompilerHost(options), source = host.getSourceFile.bind(host);
      host.getSourceFile = (name, version, onError, create) => name === filename ? ts.createSourceFile(filename, content, version, true, ts.ScriptKind.TSX) : source(name, version, onError, create);
      const program = ts.createProgram([filename], options, host);
      expect(ts.getPreEmitDiagnostics(program).map(item => ts.flattenDiagnosticMessageText(item.messageText, "\n")), example.path).toEqual([]);
    }
  });
});
